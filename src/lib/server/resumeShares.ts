import type { RequestEvent, Cookies } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	createCipheriv,
	createDecipheriv,
	createHash,
	createHmac,
	randomBytes,
	scrypt as scryptCallback,
	timingSafeEqual
} from 'node:crypto';
import { promisify } from 'node:util';
import { ResumeService } from '$lib/services/resume';
import { getResumeAccess, resolveOrganisationTemplateContext, type ActorAccessContext } from '$lib/server/access';
import { extractRequestMetadata } from '$lib/server/legalService';
import { loadResumeData } from '$lib/server/resumes/store';
import { anonymizeResumeExport } from '$lib/resumes/anonymize';
import type { Resume, Person } from '$lib/types/resume';
import type {
	ResumeShareAccessMode,
	ResumeShareEvent,
	ResumeShareEventOutcome,
	ResumeShareLanguageMode,
	ResumeShareLink,
	ResumeShareStatus
} from '$lib/types/resumeShares';
import { writeAuditLog } from '$lib/server/legalService';

const scrypt = promisify(scryptCallback);

const SHARE_SECRET_ENV_KEY = 'RESUME_SHARE_SECRET';
const SHARE_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SHARE_COOKIE_PREFIX = 'resume-share-';
const EXPIRING_SOON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_EXPIRY_DAYS = 30;
const MAX_EXPIRY_DAYS = 365;
const MIN_EXPIRY_DAYS = 1;
const MAX_CONTACT_NAME_LENGTH = 120;
const MAX_CONTACT_EMAIL_LENGTH = 320;
const MAX_CONTACT_PHONE_LENGTH = 64;
const MAX_CONTACT_NOTE_LENGTH = 1000;

type ShareLinkRow = {
	id: string;
	organisation_id: string;
	talent_id: string;
	resume_id: string;
	created_by_user_id: string;
	label: string | null;
	is_anonymized: boolean;
	access_mode: ResumeShareAccessMode;
	language_mode: ResumeShareLanguageMode;
	token_hash: string;
	token_encrypted: string;
	token_hint: string;
	password_hash: string | null;
	expires_at: string | null;
	allow_download: boolean;
	contact_name: string | null;
	contact_email: string | null;
	contact_phone: string | null;
	contact_note: string | null;
	revoked_at: string | null;
	revoked_by_user_id: string | null;
	revoked_reason: string | null;
	replaced_by_share_link_id: string | null;
	total_request_count: number;
	successful_view_count: number;
	download_count: number;
	first_viewed_at: string | null;
	last_viewed_at: string | null;
	created_at: string;
	updated_at: string;
};

type ShareAccessSessionRow = {
	id: string;
	share_link_id: string;
	session_hash: string;
	client_ip_hash: string | null;
	user_agent: string | null;
	granted_at: string;
	last_used_at: string;
	expires_at: string;
};

type ShareEventRow = {
	id: number;
	share_link_id: string | null;
	outcome: ResumeShareEventOutcome;
	occurred_at: string;
	user_agent: string | null;
	referrer_url_sanitized: string | null;
	download_triggered: boolean;
};

type PublicResumeShareBase = {
	link: ShareLinkRow | null;
	status: 'ready' | 'password_required' | 'invalid' | 'expired' | 'revoked' | 'rate_limited';
	requestedTokenHash: string;
	language: 'sv' | 'en';
	organisationName: string | null;
};

export type PublicResumeSharePageResult =
	| (PublicResumeShareBase & {
			status: 'ready';
			link: ShareLinkRow;
			resume: Resume;
			resumePerson: Person | null;
			templateContext: Awaited<ReturnType<typeof resolveOrganisationTemplateContext>>;
			downloadHref: string | null;
			languageMode: ResumeShareLanguageMode;
			availableLanguages: Array<'sv' | 'en'>;
			contactInfo: {
				name: string | null;
				email: string | null;
				phone: string | null;
				note: string | null;
			} | null;
	  })
	| (PublicResumeShareBase & {
			status: 'password_required';
			link: ShareLinkRow;
	  })
	| (PublicResumeShareBase & {
			status: 'invalid' | 'expired' | 'revoked' | 'rate_limited';
	  });

export type VisibleResumeShareLink = ResumeShareLink & {
	events: ResumeShareEvent[];
};

export class ResumeShareConfigError extends Error {
	constructor(message = 'Resume share feature is not configured.') {
		super(message);
		this.name = 'ResumeShareConfigError';
	}
}

export class ResumeShareAccessError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'ResumeShareAccessError';
		this.status = status;
	}
}

const runtimeEnv: Record<string, string | undefined> =
	typeof process !== 'undefined' && process.env ? process.env : {};

const getResumeShareSecret = () => {
	const secret = runtimeEnv[SHARE_SECRET_ENV_KEY]?.trim() ?? '';
	if (secret.length < 32) {
		throw new ResumeShareConfigError(
			`${SHARE_SECRET_ENV_KEY} must be configured with at least 32 characters.`
		);
	}
	return secret;
};

const deriveSecretKey = (purpose: string) =>
	createHash('sha256').update(`${purpose}:${getResumeShareSecret()}`).digest();

const hashToken = (token: string) =>
	createHash('sha256').update(token.trim()).digest('hex');

const hashSessionToken = (token: string) =>
	createHmac('sha256', deriveSecretKey('session-hash')).update(token).digest('hex');

const hashClientIp = (ipAddress: string | null) => {
	if (!ipAddress) return null;
	return createHmac('sha256', deriveSecretKey('client-ip'))
		.update(ipAddress.trim())
		.digest('hex');
};

const encryptToken = (token: string) => {
	const key = deriveSecretKey('token-encryption');
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
};

const decryptToken = (encryptedValue: string) => {
	const [ivRaw, tagRaw, payloadRaw] = encryptedValue.split('.');
	if (!ivRaw || !tagRaw || !payloadRaw) {
		throw new ResumeShareConfigError('Stored resume share token is malformed.');
	}

	const decipher = createDecipheriv(
		'aes-256-gcm',
		deriveSecretKey('token-encryption'),
		Buffer.from(ivRaw, 'base64url')
	);
	decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));

	const decrypted = Buffer.concat([
		decipher.update(Buffer.from(payloadRaw, 'base64url')),
		decipher.final()
	]);
	return decrypted.toString('utf8');
};

const buildTokenHint = (token: string) => `...${token.slice(-6)}`;

const normalizeText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const normalizeOptionalText = (value: unknown) => {
	const normalized = normalizeText(value);
	return normalized || null;
};

const normalizeBoolean = (value: unknown) => {
	if (typeof value === 'boolean') return value;
	if (typeof value !== 'string') return false;
	const normalized = value.trim().toLowerCase();
	return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
};

const normalizePositiveInt = (value: unknown) => {
	if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
	if (typeof value !== 'string') return null;
	const parsed = Number.parseInt(value.trim(), 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const normalizeLanguageMode = (value: unknown): ResumeShareLanguageMode => {
	if (value === 'sv' || value === 'en' || value === 'both') {
		return value;
	}
	if (typeof value !== 'string') return 'both';
	const normalized = value.trim().toLowerCase();
	return normalized === 'sv' || normalized === 'en' || normalized === 'both'
		? normalized
		: 'both';
};

const normalizeOptionalLimitedText = (value: unknown, maxLength: number) =>
	normalizeOptionalText(value)?.slice(0, maxLength) ?? null;

const buildShareContactInfo = (row: {
	contact_name?: string | null;
	contact_email?: string | null;
	contact_phone?: string | null;
	contact_note?: string | null;
}) => {
	const name = normalizeOptionalText(row.contact_name);
	const email = normalizeOptionalText(row.contact_email);
	const phone = normalizeOptionalText(row.contact_phone);
	const note = normalizeOptionalText(row.contact_note);

	if (!name && !email && !phone && !note) {
		return null;
	}

	return {
		name,
		email,
		phone,
		note
	};
};

const resolveAvailableLanguages = (
	languageMode: ResumeShareLanguageMode
): Array<'sv' | 'en'> => {
	if (languageMode === 'sv') return ['sv'];
	if (languageMode === 'en') return ['en'];
	return ['sv', 'en'];
};

const resolveSelectedLanguage = (
	languageMode: ResumeShareLanguageMode,
	requestedLanguage: 'sv' | 'en'
): 'sv' | 'en' => {
	if (languageMode === 'sv' || languageMode === 'en') {
		return languageMode;
	}
	return requestedLanguage;
};

const loadOrganisationName = async (adminClient: SupabaseClient, organisationId: string) => {
	const { data, error } = await adminClient
		.from('organisations')
		.select('name')
		.eq('id', organisationId)
		.maybeSingle();

	if (error) {
		throw new ResumeShareAccessError(500, error.message);
	}

	return normalizeOptionalText(data?.name) ?? null;
};

const buildShareUrl = (origin: string, token: string) =>
	new URL(`/s/${encodeURIComponent(token)}`, origin).toString();

const getCookieName = (shareLinkId: string) => `${SHARE_COOKIE_PREFIX}${shareLinkId}`;

const deriveStatusFromRow = (row: Pick<ShareLinkRow, 'revoked_at' | 'expires_at'>): ResumeShareStatus => {
	if (row.revoked_at) return 'revoked';
	if (row.expires_at) {
		const expiresAt = Date.parse(row.expires_at);
		if (!Number.isNaN(expiresAt)) {
			if (expiresAt <= Date.now()) return 'expired';
			if (expiresAt - Date.now() <= EXPIRING_SOON_WINDOW_MS) return 'expiring_soon';
		}
	}
	return 'active';
};

const formatPersonName = (value: { first_name?: string | null; last_name?: string | null }) => {
	const name = [value.first_name, value.last_name].filter(Boolean).join(' ').trim();
	return name || 'Unknown';
};

const formatCreatorName = (value: {
	first_name?: string | null;
	last_name?: string | null;
	email?: string | null;
}) => {
	const fullName = [value.first_name, value.last_name].filter(Boolean).join(' ').trim();
	return fullName || value.email?.trim() || 'Unknown';
};

const sanitizeReferrer = (value: string | null | undefined) => {
	const referrer = value?.trim() ?? '';
	if (!referrer) return null;
	try {
		const parsed = new URL(referrer);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
		return `${parsed.origin}${parsed.pathname}`;
	} catch {
		return null;
	}
};

const parsePasswordHash = (value: string) => {
	const [algorithm, saltHex, hashHex] = value.split('$');
	if (algorithm !== 'scrypt' || !saltHex || !hashHex) {
		throw new ResumeShareConfigError('Stored resume share password hash is malformed.');
	}
	return {
		salt: Buffer.from(saltHex, 'hex'),
		hash: Buffer.from(hashHex, 'hex')
	};
};

const hashPassword = async (password: string) => {
	const salt = randomBytes(16);
	const derived = (await scrypt(password, salt, 64)) as Buffer;
	return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
};

const verifyPassword = async (password: string, passwordHash: string | null) => {
	if (!passwordHash) return false;
	const { salt, hash } = parsePasswordHash(passwordHash);
	const derived = (await scrypt(password, salt, hash.byteLength)) as Buffer;
	return timingSafeEqual(hash, derived);
};

const mapEvent = (row: ShareEventRow): ResumeShareEvent => ({
	id: row.id,
	shareLinkId: row.share_link_id ?? null,
	occurredAt: row.occurred_at,
	outcome: row.outcome,
	userAgent: row.user_agent ?? null,
	referrerUrlSanitized: row.referrer_url_sanitized ?? null,
	downloadTriggered: Boolean(row.download_triggered)
});

const canActorManageLink = (actor: ActorAccessContext, row: ShareLinkRow) => {
	if (!actor.userId) return false;
	if (actor.isAdmin) return true;
	if (row.created_by_user_id === actor.userId) return true;
	if ((actor.isBroker || actor.isEmployer) && actor.homeOrganisationId === row.organisation_id) {
		return true;
	}
	if (actor.talentId && actor.talentId === row.talent_id) return true;
	return false;
};

const parseExpiresAt = (payload: {
	neverExpires?: boolean;
	expiresInDays?: number | null;
}) => {
	if (payload.neverExpires) return null;
	const expiresInDays = payload.expiresInDays ?? DEFAULT_EXPIRY_DAYS;
	if (expiresInDays < MIN_EXPIRY_DAYS || expiresInDays > MAX_EXPIRY_DAYS) {
		throw new ResumeShareAccessError(
			400,
			`Expiration must be between ${MIN_EXPIRY_DAYS} and ${MAX_EXPIRY_DAYS} days.`
		);
	}
	return new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
};

const getShareLinkQuery = (adminClient: SupabaseClient, actor: ActorAccessContext) => {
	const query = adminClient.from('resume_share_links').select('*').order('created_at', { ascending: false });
	if (actor.isAdmin) return query;

	const filters: string[] = [];
	if (actor.userId) filters.push(`created_by_user_id.eq.${actor.userId}`);
	if ((actor.isBroker || actor.isEmployer) && actor.homeOrganisationId) {
		filters.push(`organisation_id.eq.${actor.homeOrganisationId}`);
	}
	if (actor.talentId) filters.push(`talent_id.eq.${actor.talentId}`);

	if (filters.length === 0) {
		return query.eq('id', '00000000-0000-0000-0000-000000000000');
	}

	return query.or(filters.join(','));
};

const recordShareEvent = async (payload: {
	adminClient: SupabaseClient;
	shareLinkId: string | null;
	requestedTokenHash: string;
	outcome: ResumeShareEventOutcome;
	userAgent?: string | null;
	referrerUrlSanitized?: string | null;
	clientIpHash?: string | null;
	downloadTriggered?: boolean;
}) => {
	const { error } = await payload.adminClient.rpc('record_resume_share_event', {
		p_share_link_id: payload.shareLinkId,
		p_requested_token_hash: payload.requestedTokenHash,
		p_outcome: payload.outcome,
		p_user_agent: payload.userAgent ?? null,
		p_referrer_url_sanitized: payload.referrerUrlSanitized ?? null,
		p_client_ip_hash: payload.clientIpHash ?? null,
		p_download_triggered: payload.downloadTriggered ?? false
	});

	if (error) {
		console.warn('[resume share] failed to record access event', {
			shareLinkId: payload.shareLinkId,
			outcome: payload.outcome,
			error: error.message
		});
	}
};

const countEventsByIp = async (payload: {
	adminClient: SupabaseClient;
	clientIpHash: string | null;
	outcome: ResumeShareEventOutcome;
	sinceIso: string;
}) => {
	if (!payload.clientIpHash) return 0;
	const { count } = await payload.adminClient
		.from('resume_share_link_events')
		.select('id', { count: 'exact', head: true })
		.eq('client_ip_hash', payload.clientIpHash)
		.eq('outcome', payload.outcome)
		.gte('occurred_at', payload.sinceIso);
	return count ?? 0;
};

const countEventsByLinkAndIp = async (payload: {
	adminClient: SupabaseClient;
	shareLinkId: string;
	clientIpHash: string | null;
	sinceIso: string;
}) => {
	if (!payload.clientIpHash) return 0;
	const { count } = await payload.adminClient
		.from('resume_share_link_events')
		.select('id', { count: 'exact', head: true })
		.eq('share_link_id', payload.shareLinkId)
		.eq('client_ip_hash', payload.clientIpHash)
		.neq('outcome', 'success')
		.gte('occurred_at', payload.sinceIso);
	return count ?? 0;
};

const resolveShareOwnerContext = async (adminClient: SupabaseClient, resumeId: string) => {
	const [{ data: resumeRow, error: resumeError }, { data: titleRows, error: titleError }] =
		await Promise.all([
			adminClient
				.from('resumes')
				.select('id, talent_id, version_name')
				.eq('id', resumeId)
				.maybeSingle(),
			adminClient
				.from('resume_basics')
				.select('resume_id, title_en, title_sv')
				.eq('resume_id', resumeId)
				.limit(1)
		]);

	if (resumeError || !resumeRow?.id || !resumeRow.talent_id) {
		throw new ResumeShareAccessError(404, resumeError?.message ?? 'Resume not found.');
	}
	if (titleError) {
		console.warn('[resume share] failed to load resume title', {
			resumeId,
			error: titleError.message
		});
	}

	const { data: orgMembership } = await adminClient
		.from('organisation_talents')
		.select('organisation_id')
		.eq('talent_id', resumeRow.talent_id)
		.order('updated_at', { ascending: false })
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();

	const organisationId =
		typeof orgMembership?.organisation_id === 'string' ? orgMembership.organisation_id : null;
	if (!organisationId) {
		throw new ResumeShareAccessError(
			400,
			'Resume share links require the talent to belong to an organisation.'
		);
	}

	const titleRow = Array.isArray(titleRows) ? titleRows[0] : null;
	const resumeTitle =
		normalizeText(titleRow?.title_en) ||
		normalizeText(titleRow?.title_sv) ||
		normalizeText(resumeRow.version_name) ||
		'Resume';

	return {
		organisationId,
		talentId: resumeRow.talent_id,
		resumeTitle
	};
};

const loadShareLinkById = async (adminClient: SupabaseClient, shareLinkId: string) => {
	const { data, error } = await adminClient
		.from('resume_share_links')
		.select('*')
		.eq('id', shareLinkId)
		.maybeSingle();

	if (error || !data) {
		throw new ResumeShareAccessError(404, error?.message ?? 'Share link not found.');
	}

	return data as ShareLinkRow;
};

const assertCanManageShareLink = (actor: ActorAccessContext, row: ShareLinkRow) => {
	if (!canActorManageLink(actor, row)) {
		throw new ResumeShareAccessError(403, 'Not authorized to manage this share link.');
	}
};

const invalidateShareSessions = async (adminClient: SupabaseClient, shareLinkId: string) => {
	const { error } = await adminClient
		.from('resume_share_access_sessions')
		.delete()
		.eq('share_link_id', shareLinkId);
	if (error) {
		console.warn('[resume share] failed to invalidate sessions', {
			shareLinkId,
			error: error.message
		});
	}
};

const createShareSession = async (payload: {
	adminClient: SupabaseClient;
	link: ShareLinkRow;
	cookies: Cookies;
	token: string;
	clientIpHash: string | null;
	userAgent: string | null;
	path: string;
}) => {
	const sessionToken = randomBytes(32).toString('base64url');
	const sessionHash = hashSessionToken(sessionToken);
	const linkExpiryMs = payload.link.expires_at ? Date.parse(payload.link.expires_at) : null;
	const maxExpiryMs = Date.now() + SHARE_SESSION_TTL_MS;
	const expiresAtMs =
		linkExpiryMs && !Number.isNaN(linkExpiryMs) ? Math.min(linkExpiryMs, maxExpiryMs) : maxExpiryMs;
	const expiresAt = new Date(expiresAtMs).toISOString();

	const { error } = await payload.adminClient.from('resume_share_access_sessions').insert({
		share_link_id: payload.link.id,
		session_hash: sessionHash,
		client_ip_hash: payload.clientIpHash,
		user_agent: payload.userAgent,
		expires_at: expiresAt
	});

	if (error) {
		throw new ResumeShareAccessError(500, error.message);
	}

	payload.cookies.set(getCookieName(payload.link.id), sessionToken, {
		path: payload.path,
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		expires: new Date(expiresAtMs)
	});
};

const hasValidShareSession = async (payload: {
	adminClient: SupabaseClient;
	link: ShareLinkRow;
	cookies: Cookies;
}) => {
	const rawToken = payload.cookies.get(getCookieName(payload.link.id)) ?? null;
	if (!rawToken) return false;

	const sessionHash = hashSessionToken(rawToken);
	const { data, error } = await payload.adminClient
		.from('resume_share_access_sessions')
		.select('*')
		.eq('share_link_id', payload.link.id)
		.eq('session_hash', sessionHash)
		.gt('expires_at', new Date().toISOString())
		.maybeSingle();

	if (error || !data) {
		return false;
	}

	const row = data as ShareAccessSessionRow;
	const { error: updateError } = await payload.adminClient
		.from('resume_share_access_sessions')
		.update({ last_used_at: new Date().toISOString() })
		.eq('id', row.id);
	if (updateError) {
		console.warn('[resume share] failed to update session timestamp', {
			sessionId: row.id,
			error: updateError.message
		});
	}

	return true;
};

const loadSharePublicPayload = async (payload: {
	adminClient: SupabaseClient;
	link: ShareLinkRow;
	token: string;
	origin: string;
	language: 'sv' | 'en';
}) => {
	const resume = await ResumeService.getResume(payload.link.resume_id);
	if (!resume) {
		throw new ResumeShareAccessError(404, 'Shared resume no longer exists.');
	}

	let resumePerson = (await ResumeService.getPerson(payload.link.talent_id)) ?? null;
	let exportResume = resume;
	if (payload.link.is_anonymized) {
		const anonymizedExport = anonymizeResumeExport({
			resumeData: exportResume.data,
			person: resumePerson ?? null
		});
		exportResume = {
			...exportResume,
			title: payload.language === 'sv' ? 'Anonymized CV' : 'Anonymized Resume',
			data: anonymizedExport.resumeData
		};
		resumePerson = anonymizedExport.person ?? null;
	}

	const templateContext = await resolveOrganisationTemplateContext(
		payload.adminClient,
		payload.link.organisation_id,
		{ source: 'source_org' }
	);

	return {
		resume: exportResume,
		resumePerson,
		templateContext,
		downloadHref: payload.link.allow_download ? `/s/${encodeURIComponent(payload.token)}/pdf` : null,
		languageMode: normalizeLanguageMode(payload.link.language_mode),
		availableLanguages: resolveAvailableLanguages(normalizeLanguageMode(payload.link.language_mode)),
		contactInfo: buildShareContactInfo(payload.link)
	};
};

const mapShareRow = (payload: {
	row: ShareLinkRow;
	origin: string;
	shareToken: string;
	talentName: string;
	resumeTitle: string;
	createdByName: string;
	events: ResumeShareEvent[];
}): VisibleResumeShareLink => ({
	id: payload.row.id,
	organisationId: payload.row.organisation_id,
	talentId: payload.row.talent_id,
	resumeId: payload.row.resume_id,
	createdByUserId: payload.row.created_by_user_id,
	label: payload.row.label ?? null,
	isAnonymized: Boolean(payload.row.is_anonymized),
	accessMode: payload.row.access_mode,
	languageMode: normalizeLanguageMode(payload.row.language_mode),
	expiresAt: payload.row.expires_at ?? null,
	allowDownload: Boolean(payload.row.allow_download),
	contactName: payload.row.contact_name ?? null,
	contactEmail: payload.row.contact_email ?? null,
	contactPhone: payload.row.contact_phone ?? null,
	contactNote: payload.row.contact_note ?? null,
	status: deriveStatusFromRow(payload.row),
	totalRequestCount: Number(payload.row.total_request_count ?? 0),
	successfulViewCount: Number(payload.row.successful_view_count ?? 0),
	downloadCount: Number(payload.row.download_count ?? 0),
	firstViewedAt: payload.row.first_viewed_at ?? null,
	lastViewedAt: payload.row.last_viewed_at ?? null,
	createdAt: payload.row.created_at,
	updatedAt: payload.row.updated_at,
	revokedAt: payload.row.revoked_at ?? null,
	shareUrl: buildShareUrl(payload.origin, payload.shareToken),
	tokenHint: payload.row.token_hint,
	talentName: payload.talentName,
	resumeTitle: payload.resumeTitle,
	createdByName: payload.createdByName,
	passwordProtected: payload.row.access_mode === 'password',
	events: payload.events
});

export const getPublicResumeShareHeaders = () => ({
	'x-robots-tag': 'noindex, nofollow, noarchive',
	'cache-control': 'no-store'
});

export const getResumeShareCookieName = (shareLinkId: string) => getCookieName(shareLinkId);

export const createResumeShareLink = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
	resumeId: string;
	label?: string | null;
	isAnonymized?: boolean;
	accessMode?: ResumeShareAccessMode;
	languageMode?: ResumeShareLanguageMode;
	password?: string | null;
	neverExpires?: boolean;
	expiresInDays?: number | null;
	allowDownload?: boolean;
	contactName?: string | null;
	contactEmail?: string | null;
	contactPhone?: string | null;
	contactNote?: string | null;
	origin: string;
}) => {
	if (!payload.actor.userId) {
		throw new ResumeShareAccessError(401, 'Unauthorized');
	}

	const resumeAccess = await getResumeAccess(payload.adminClient, payload.actor, payload.resumeId);
	if (!resumeAccess.exists) {
		throw new ResumeShareAccessError(404, 'Resume not found.');
	}
	if (!resumeAccess.canEdit) {
		throw new ResumeShareAccessError(403, 'Not authorized to share this resume.');
	}

	const ownerContext = await resolveShareOwnerContext(payload.adminClient, payload.resumeId);
	const accessMode = payload.accessMode === 'link' ? 'link' : 'password';
	const languageMode = normalizeLanguageMode(payload.languageMode);
	const label = normalizeOptionalText(payload.label)?.slice(0, 120) ?? null;
	const contactName = normalizeOptionalLimitedText(payload.contactName, MAX_CONTACT_NAME_LENGTH);
	const contactEmail = normalizeOptionalLimitedText(payload.contactEmail, MAX_CONTACT_EMAIL_LENGTH);
	const contactPhone = normalizeOptionalLimitedText(payload.contactPhone, MAX_CONTACT_PHONE_LENGTH);
	const contactNote = normalizeOptionalLimitedText(payload.contactNote, MAX_CONTACT_NOTE_LENGTH);
	const password = normalizeText(payload.password);
	if (accessMode === 'password' && password.length < 6) {
		throw new ResumeShareAccessError(400, 'Password-protected links require a password of at least 6 characters.');
	}

	const token = randomBytes(32).toString('base64url');
	const tokenHash = hashToken(token);
	const tokenEncrypted = encryptToken(token);
	const tokenHint = buildTokenHint(token);
	const expiresAt = parseExpiresAt({
		neverExpires: payload.neverExpires ?? false,
		expiresInDays: payload.expiresInDays ?? null
	});
	const passwordHash =
		accessMode === 'password' ? await hashPassword(password) : null;

	const insertPayload = {
		organisation_id: ownerContext.organisationId,
		talent_id: ownerContext.talentId,
		resume_id: payload.resumeId,
		created_by_user_id: payload.actor.userId,
		label,
		is_anonymized: Boolean(payload.isAnonymized),
		access_mode: accessMode,
		language_mode: languageMode,
		token_hash: tokenHash,
		token_encrypted: tokenEncrypted,
		token_hint: tokenHint,
		password_hash: passwordHash,
		expires_at: expiresAt,
		allow_download: Boolean(payload.allowDownload),
		contact_name: contactName,
		contact_email: contactEmail,
		contact_phone: contactPhone,
		contact_note: contactNote
	};

	const { data, error } = await payload.adminClient
		.from('resume_share_links')
		.insert(insertPayload)
		.select('*')
		.maybeSingle();

	if (error || !data) {
		throw new ResumeShareAccessError(500, error?.message ?? 'Could not create share link.');
	}

	await writeAuditLog({
		actorUserId: payload.actor.userId,
		organisationId: ownerContext.organisationId,
		actionType: 'RESUME_SHARE_CREATED',
		resourceType: 'resume_share_link',
		resourceId: data.id,
		metadata: {
			resume_id: payload.resumeId,
			talent_id: ownerContext.talentId,
			access_mode: accessMode,
			language_mode: languageMode,
			allow_download: Boolean(payload.allowDownload),
			is_anonymized: Boolean(payload.isAnonymized),
			expires_at: expiresAt,
			label,
			has_contact_info: Boolean(buildShareContactInfo(insertPayload))
		}
	});

	return {
		linkId: data.id,
		shareUrl: buildShareUrl(payload.origin, token),
		tokenHint,
		resumeTitle: ownerContext.resumeTitle
	};
};

export const listVisibleResumeShareLinks = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
	origin: string;
}) => {
	if (!payload.actor.userId) return [] as VisibleResumeShareLink[];

	const visibleLinksResult = await getShareLinkQuery(payload.adminClient, payload.actor);
	if (visibleLinksResult.error) {
		throw new ResumeShareAccessError(500, visibleLinksResult.error.message);
	}

	const rows = ((visibleLinksResult.data ?? []) as ShareLinkRow[]).filter((row) =>
		canActorManageLink(payload.actor, row)
	);
	if (rows.length === 0) return [] as VisibleResumeShareLink[];

	const creatorIds = [...new Set(rows.map((row) => row.created_by_user_id))];
	const talentIds = [...new Set(rows.map((row) => row.talent_id))];
	const resumeIds = [...new Set(rows.map((row) => row.resume_id))];
	const shareLinkIds = rows.map((row) => row.id);

	const [creatorsResult, talentsResult, resumesResult, basicsResult, eventsResult] =
		await Promise.all([
			payload.adminClient
				.from('user_profiles')
				.select('user_id, first_name, last_name, email')
				.in('user_id', creatorIds),
			payload.adminClient
				.from('talents')
				.select('id, first_name, last_name')
				.in('id', talentIds),
			payload.adminClient.from('resumes').select('id, version_name').in('id', resumeIds),
			payload.adminClient
				.from('resume_basics')
				.select('resume_id, title_en, title_sv')
				.in('resume_id', resumeIds),
			payload.adminClient
				.from('resume_share_link_events')
				.select(
					'id, share_link_id, outcome, occurred_at, user_agent, referrer_url_sanitized, download_triggered'
				)
				.in('share_link_id', shareLinkIds)
				.order('occurred_at', { ascending: false })
				.limit(500)
		]);

	if (creatorsResult.error) throw new ResumeShareAccessError(500, creatorsResult.error.message);
	if (talentsResult.error) throw new ResumeShareAccessError(500, talentsResult.error.message);
	if (resumesResult.error) throw new ResumeShareAccessError(500, resumesResult.error.message);
	if (basicsResult.error) throw new ResumeShareAccessError(500, basicsResult.error.message);
	if (eventsResult.error) throw new ResumeShareAccessError(500, eventsResult.error.message);

	const creatorByUserId = new Map(
		(
			(creatorsResult.data ?? []) as Array<{
				user_id: string;
				first_name?: string | null;
				last_name?: string | null;
				email?: string | null;
			}>
		).map((row) => [row.user_id, formatCreatorName(row)])
	);
	const talentById = new Map(
		(
			(talentsResult.data ?? []) as Array<{
				id: string;
				first_name?: string | null;
				last_name?: string | null;
			}>
		).map((row) => [row.id, formatPersonName(row)])
	);
	const resumeVersionById = new Map(
		(
			(resumesResult.data ?? []) as Array<{
				id: string;
				version_name?: string | null;
			}>
		).map((row) => [row.id, normalizeText(row.version_name) || 'Resume'])
	);
	const resumeTitleById = new Map<string, string>();
	for (const row of (basicsResult.data ?? []) as Array<{
		resume_id?: string | null;
		title_en?: string | null;
		title_sv?: string | null;
	}>) {
		const resumeId = normalizeText(row.resume_id);
		if (!resumeId) continue;
		resumeTitleById.set(
			resumeId,
			normalizeText(row.title_en) || normalizeText(row.title_sv) || resumeVersionById.get(resumeId) || 'Resume'
		);
	}

	const eventsByShareLinkId = new Map<string, ResumeShareEvent[]>();
	for (const row of (eventsResult.data ?? []) as ShareEventRow[]) {
		if (!row.share_link_id) continue;
		const existing = eventsByShareLinkId.get(row.share_link_id) ?? [];
		if (existing.length >= 50) continue;
		existing.push(mapEvent(row));
		eventsByShareLinkId.set(row.share_link_id, existing);
	}

	return rows.map((row) => {
		const decryptedToken = decryptToken(row.token_encrypted);
		return mapShareRow({
			row,
			origin: payload.origin,
			shareToken: decryptedToken,
			talentName: talentById.get(row.talent_id) ?? 'Unknown',
			resumeTitle: resumeTitleById.get(row.resume_id) ?? resumeVersionById.get(row.resume_id) ?? 'Resume',
			createdByName: creatorByUserId.get(row.created_by_user_id) ?? 'Unknown',
			events: eventsByShareLinkId.get(row.id) ?? []
		});
	});
};

export const updateResumeShareLink = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
	shareLinkId: string;
	label?: string | null;
	isAnonymized?: boolean;
	accessMode?: ResumeShareAccessMode;
	languageMode?: ResumeShareLanguageMode;
	password?: string | null;
	neverExpires?: boolean;
	expiresInDays?: number | null;
	allowDownload?: boolean;
	contactName?: string | null;
	contactEmail?: string | null;
	contactPhone?: string | null;
	contactNote?: string | null;
}) => {
	const row = await loadShareLinkById(payload.adminClient, payload.shareLinkId);
	assertCanManageShareLink(payload.actor, row);

	const label = normalizeOptionalText(payload.label)?.slice(0, 120) ?? null;
	const accessMode = payload.accessMode === 'link' ? 'link' : 'password';
	const languageMode = normalizeLanguageMode(payload.languageMode);
	const contactName = normalizeOptionalLimitedText(payload.contactName, MAX_CONTACT_NAME_LENGTH);
	const contactEmail = normalizeOptionalLimitedText(payload.contactEmail, MAX_CONTACT_EMAIL_LENGTH);
	const contactPhone = normalizeOptionalLimitedText(payload.contactPhone, MAX_CONTACT_PHONE_LENGTH);
	const contactNote = normalizeOptionalLimitedText(payload.contactNote, MAX_CONTACT_NOTE_LENGTH);
	const password = normalizeText(payload.password);
	if (accessMode === 'password' && !row.password_hash && password.length < 6) {
		throw new ResumeShareAccessError(400, 'Password-protected links require a password of at least 6 characters.');
	}

	const passwordHash =
		accessMode === 'password'
			? password
				? await hashPassword(password)
				: row.password_hash
			: null;
	if (accessMode === 'password' && !passwordHash) {
		throw new ResumeShareAccessError(400, 'Password-protected links require a password.');
	}

	const expiresAt = parseExpiresAt({
		neverExpires: payload.neverExpires ?? false,
		expiresInDays: payload.expiresInDays ?? null
	});

	const updatePayload = {
		label,
		is_anonymized: Boolean(payload.isAnonymized),
		access_mode: accessMode,
		language_mode: languageMode,
		password_hash: passwordHash,
		expires_at: expiresAt,
		allow_download: Boolean(payload.allowDownload),
		contact_name: contactName,
		contact_email: contactEmail,
		contact_phone: contactPhone,
		contact_note: contactNote
	};

	const { error } = await payload.adminClient
		.from('resume_share_links')
		.update(updatePayload)
		.eq('id', row.id);

	if (error) {
		throw new ResumeShareAccessError(500, error.message);
	}

	if (
		row.access_mode !== accessMode ||
		(accessMode === 'password' && Boolean(password)) ||
		row.password_hash !== passwordHash
	) {
		await invalidateShareSessions(payload.adminClient, row.id);
	}

	await writeAuditLog({
		actorUserId: payload.actor.userId,
		organisationId: row.organisation_id,
		actionType: 'RESUME_SHARE_UPDATED',
		resourceType: 'resume_share_link',
		resourceId: row.id,
		metadata: {
			access_mode: accessMode,
			language_mode: languageMode,
			allow_download: Boolean(payload.allowDownload),
			is_anonymized: Boolean(payload.isAnonymized),
			expires_at: expiresAt,
			label,
			has_contact_info: Boolean(buildShareContactInfo(updatePayload))
		}
	});
};

export const extendResumeShareLink = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
	shareLinkId: string;
	neverExpires?: boolean;
	expiresInDays?: number | null;
}) => {
	const row = await loadShareLinkById(payload.adminClient, payload.shareLinkId);
	assertCanManageShareLink(payload.actor, row);

	const expiresAt = parseExpiresAt({
		neverExpires: payload.neverExpires ?? false,
		expiresInDays: payload.expiresInDays ?? null
	});

	const { error } = await payload.adminClient
		.from('resume_share_links')
		.update({ expires_at: expiresAt })
		.eq('id', row.id);
	if (error) {
		throw new ResumeShareAccessError(500, error.message);
	}

	await writeAuditLog({
		actorUserId: payload.actor.userId,
		organisationId: row.organisation_id,
		actionType: 'RESUME_SHARE_UPDATED',
		resourceType: 'resume_share_link',
		resourceId: row.id,
		metadata: {
			expires_at: expiresAt,
			action: 'extend'
		}
	});
};

export const revokeResumeShareLink = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
	shareLinkId: string;
	reason?: string | null;
}) => {
	const row = await loadShareLinkById(payload.adminClient, payload.shareLinkId);
	assertCanManageShareLink(payload.actor, row);

	const revokedAt = new Date().toISOString();
	const { error } = await payload.adminClient
		.from('resume_share_links')
		.update({
			revoked_at: revokedAt,
			revoked_by_user_id: payload.actor.userId,
			revoked_reason: normalizeOptionalText(payload.reason)
		})
		.eq('id', row.id);
	if (error) {
		throw new ResumeShareAccessError(500, error.message);
	}

	await invalidateShareSessions(payload.adminClient, row.id);
	await writeAuditLog({
		actorUserId: payload.actor.userId,
		organisationId: row.organisation_id,
		actionType: 'RESUME_SHARE_REVOKED',
		resourceType: 'resume_share_link',
		resourceId: row.id,
		metadata: {
			revoked_at: revokedAt,
			reason: normalizeOptionalText(payload.reason)
		}
	});
};

export const regenerateResumeShareLink = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
	shareLinkId: string;
	origin: string;
}) => {
	const row = await loadShareLinkById(payload.adminClient, payload.shareLinkId);
	assertCanManageShareLink(payload.actor, row);

	const token = randomBytes(32).toString('base64url');
	const tokenHash = hashToken(token);
	const tokenEncrypted = encryptToken(token);
	const tokenHint = buildTokenHint(token);

	const insertPayload = {
		organisation_id: row.organisation_id,
		talent_id: row.talent_id,
		resume_id: row.resume_id,
		created_by_user_id: payload.actor.userId ?? row.created_by_user_id,
		label: row.label,
		is_anonymized: row.is_anonymized,
		access_mode: row.access_mode,
		language_mode: row.language_mode,
		token_hash: tokenHash,
		token_encrypted: tokenEncrypted,
		token_hint: tokenHint,
		password_hash: row.password_hash,
		expires_at: row.expires_at,
		allow_download: row.allow_download,
		contact_name: row.contact_name,
		contact_email: row.contact_email,
		contact_phone: row.contact_phone,
		contact_note: row.contact_note
	};

	const { data, error } = await payload.adminClient
		.from('resume_share_links')
		.insert(insertPayload)
		.select('id')
		.maybeSingle();

	if (error || !data?.id) {
		throw new ResumeShareAccessError(500, error?.message ?? 'Could not regenerate share link.');
	}

	const revokedAt = new Date().toISOString();
	const { error: revokeError } = await payload.adminClient
		.from('resume_share_links')
		.update({
			revoked_at: revokedAt,
			revoked_by_user_id: payload.actor.userId,
			revoked_reason: 'Replaced by regenerated link',
			replaced_by_share_link_id: data.id
		})
		.eq('id', row.id);
	if (revokeError) {
		throw new ResumeShareAccessError(500, revokeError.message);
	}

	await invalidateShareSessions(payload.adminClient, row.id);
	await writeAuditLog({
		actorUserId: payload.actor.userId,
		organisationId: row.organisation_id,
		actionType: 'RESUME_SHARE_REGENERATED',
		resourceType: 'resume_share_link',
		resourceId: data.id,
		metadata: {
			replaced_share_link_id: row.id
		}
	});

	return {
		linkId: data.id,
		shareUrl: buildShareUrl(payload.origin, token),
		tokenHint
	};
};

export const resolvePublicResumeSharePage = async (payload: {
	adminClient: SupabaseClient;
	cookies: Cookies;
	token: string;
	origin: string;
	language: 'sv' | 'en';
	requestEvent: Pick<RequestEvent, 'request' | 'getClientAddress'>;
}) => {
	const fallbackLanguage = payload.language;
	const requestedTokenHash = hashToken(payload.token);
	const requestMeta = extractRequestMetadata(payload.requestEvent);
	const clientIpHash = hashClientIp(requestMeta.ipAddress);
	const referrerUrlSanitized = sanitizeReferrer(payload.requestEvent.request.headers.get('referer'));

	const invalidSince = new Date(Date.now() - 15 * 60 * 1000).toISOString();
	const invalidCount = await countEventsByIp({
		adminClient: payload.adminClient,
		clientIpHash,
		outcome: 'invalid_token',
		sinceIso: invalidSince
	});
	if (invalidCount >= 20) {
		await recordShareEvent({
			adminClient: payload.adminClient,
			shareLinkId: null,
			requestedTokenHash,
			outcome: 'rate_limited',
			userAgent: requestMeta.userAgent,
			referrerUrlSanitized,
			clientIpHash
		});
		return {
			status: 'rate_limited',
			link: null,
			requestedTokenHash,
			language: fallbackLanguage,
			organisationName: null
		} satisfies PublicResumeSharePageResult;
	}

	const { data, error } = await payload.adminClient
		.from('resume_share_links')
		.select('*')
		.eq('token_hash', requestedTokenHash)
		.maybeSingle();

	if (error) {
		throw new ResumeShareAccessError(500, error.message);
	}

	const link = (data as ShareLinkRow | null) ?? null;
	if (!link) {
		await recordShareEvent({
			adminClient: payload.adminClient,
			shareLinkId: null,
			requestedTokenHash,
			outcome: 'invalid_token',
			userAgent: requestMeta.userAgent,
			referrerUrlSanitized,
			clientIpHash
		});
		return {
			status: 'invalid',
			link: null,
			requestedTokenHash,
			language: fallbackLanguage,
			organisationName: null
		} satisfies PublicResumeSharePageResult;
	}

	const selectedLanguage = resolveSelectedLanguage(
		normalizeLanguageMode(link.language_mode),
		payload.language
	);
	const organisationName = await loadOrganisationName(payload.adminClient, link.organisation_id);

	const status = deriveStatusFromRow(link);
	if (status === 'revoked') {
		await recordShareEvent({
			adminClient: payload.adminClient,
			shareLinkId: link.id,
			requestedTokenHash,
			outcome: 'revoked',
			userAgent: requestMeta.userAgent,
			referrerUrlSanitized,
			clientIpHash
		});
		return {
			status: 'revoked',
			link,
			requestedTokenHash,
			language: selectedLanguage,
			organisationName
		} satisfies PublicResumeSharePageResult;
	}
	if (status === 'expired') {
		await recordShareEvent({
			adminClient: payload.adminClient,
			shareLinkId: link.id,
			requestedTokenHash,
			outcome: 'expired',
			userAgent: requestMeta.userAgent,
			referrerUrlSanitized,
			clientIpHash
		});
		return {
			status: 'expired',
			link,
			requestedTokenHash,
			language: selectedLanguage,
			organisationName
		} satisfies PublicResumeSharePageResult;
	}

	if (link.access_mode === 'password') {
		const hasSession = await hasValidShareSession({
			adminClient: payload.adminClient,
			link,
			cookies: payload.cookies
		});
		if (!hasSession) {
			return {
				status: 'password_required',
				link,
				requestedTokenHash,
				language: selectedLanguage,
				organisationName
			} satisfies PublicResumeSharePageResult;
		}
	}

	await recordShareEvent({
		adminClient: payload.adminClient,
		shareLinkId: link.id,
		requestedTokenHash,
		outcome: 'success',
		userAgent: requestMeta.userAgent,
		referrerUrlSanitized,
		clientIpHash
	});

	const publicPayload = await loadSharePublicPayload({
		adminClient: payload.adminClient,
		link,
		token: payload.token,
		origin: payload.origin,
		language: selectedLanguage
	});

	return {
		status: 'ready',
		link,
		requestedTokenHash,
		language: selectedLanguage,
		organisationName,
		...publicPayload
	} satisfies PublicResumeSharePageResult;
};

export const verifyPublicResumeSharePassword = async (payload: {
	adminClient: SupabaseClient;
	cookies: Cookies;
	token: string;
	password: string;
	requestEvent: Pick<RequestEvent, 'request' | 'getClientAddress'>;
}) => {
	const requestedTokenHash = hashToken(payload.token);
	const requestMeta = extractRequestMetadata(payload.requestEvent);
	const clientIpHash = hashClientIp(requestMeta.ipAddress);
	const referrerUrlSanitized = sanitizeReferrer(payload.requestEvent.request.headers.get('referer'));

	const { data, error } = await payload.adminClient
		.from('resume_share_links')
		.select('*')
		.eq('token_hash', requestedTokenHash)
		.maybeSingle();

	if (error) {
		throw new ResumeShareAccessError(500, error.message);
	}
	const link = (data as ShareLinkRow | null) ?? null;
	if (!link) {
		await recordShareEvent({
			adminClient: payload.adminClient,
			shareLinkId: null,
			requestedTokenHash,
			outcome: 'invalid_token',
			userAgent: requestMeta.userAgent,
			referrerUrlSanitized,
			clientIpHash
		});
		throw new ResumeShareAccessError(404, 'Invalid share link.');
	}

	const status = deriveStatusFromRow(link);
	if (status === 'revoked') {
		await recordShareEvent({
			adminClient: payload.adminClient,
			shareLinkId: link.id,
			requestedTokenHash,
			outcome: 'revoked',
			userAgent: requestMeta.userAgent,
			referrerUrlSanitized,
			clientIpHash
		});
		throw new ResumeShareAccessError(410, 'This share link has been revoked.');
	}
	if (status === 'expired') {
		await recordShareEvent({
			adminClient: payload.adminClient,
			shareLinkId: link.id,
			requestedTokenHash,
			outcome: 'expired',
			userAgent: requestMeta.userAgent,
			referrerUrlSanitized,
			clientIpHash
		});
		throw new ResumeShareAccessError(410, 'This share link has expired.');
	}

	const wrongPasswordSince = new Date(Date.now() - 15 * 60 * 1000).toISOString();
	const linkLimitedSince = new Date(Date.now() - 10 * 60 * 1000).toISOString();
	const [wrongPasswordCount, linkIpCount] = await Promise.all([
		countEventsByIp({
			adminClient: payload.adminClient,
			clientIpHash,
			outcome: 'wrong_password',
			sinceIso: wrongPasswordSince
		}),
		countEventsByLinkAndIp({
			adminClient: payload.adminClient,
			shareLinkId: link.id,
			clientIpHash,
			sinceIso: linkLimitedSince
		})
	]);

	if (wrongPasswordCount >= 10 || linkIpCount >= 5) {
		await recordShareEvent({
			adminClient: payload.adminClient,
			shareLinkId: link.id,
			requestedTokenHash,
			outcome: 'rate_limited',
			userAgent: requestMeta.userAgent,
			referrerUrlSanitized,
			clientIpHash
		});
		throw new ResumeShareAccessError(429, 'Too many attempts. Please wait and try again.');
	}

	if (link.access_mode !== 'password') {
		throw new ResumeShareAccessError(400, 'This share link does not require a password.');
	}

	const isValid = await verifyPassword(payload.password, link.password_hash);
	if (!isValid) {
		await recordShareEvent({
			adminClient: payload.adminClient,
			shareLinkId: link.id,
			requestedTokenHash,
			outcome: 'wrong_password',
			userAgent: requestMeta.userAgent,
			referrerUrlSanitized,
			clientIpHash
		});
		throw new ResumeShareAccessError(403, 'Incorrect password.');
	}

	await createShareSession({
		adminClient: payload.adminClient,
		link,
		cookies: payload.cookies,
		token: payload.token,
		clientIpHash,
		userAgent: requestMeta.userAgent,
		path: `/s/${encodeURIComponent(payload.token)}`
	});

	return link;
};

export const resolvePublicResumeShareDownload = async (payload: {
	adminClient: SupabaseClient;
	cookies: Cookies;
	token: string;
	requestEvent: Pick<RequestEvent, 'request' | 'getClientAddress'>;
}) => {
	const requestedTokenHash = hashToken(payload.token);
	const requestMeta = extractRequestMetadata(payload.requestEvent);
	const clientIpHash = hashClientIp(requestMeta.ipAddress);
	const referrerUrlSanitized = sanitizeReferrer(payload.requestEvent.request.headers.get('referer'));

	const { data, error } = await payload.adminClient
		.from('resume_share_links')
		.select('*')
		.eq('token_hash', requestedTokenHash)
		.maybeSingle();

	if (error) {
		throw new ResumeShareAccessError(500, error.message);
	}
	const link = (data as ShareLinkRow | null) ?? null;
	if (!link) {
		await recordShareEvent({
			adminClient: payload.adminClient,
			shareLinkId: null,
			requestedTokenHash,
			outcome: 'invalid_token',
			userAgent: requestMeta.userAgent,
			referrerUrlSanitized,
			clientIpHash
		});
		throw new ResumeShareAccessError(404, 'Invalid share link.');
	}

	const status = deriveStatusFromRow(link);
	if (status === 'revoked') {
		await recordShareEvent({
			adminClient: payload.adminClient,
			shareLinkId: link.id,
			requestedTokenHash,
			outcome: 'revoked',
			userAgent: requestMeta.userAgent,
			referrerUrlSanitized,
			clientIpHash
		});
		throw new ResumeShareAccessError(410, 'This share link has been revoked.');
	}
	if (status === 'expired') {
		await recordShareEvent({
			adminClient: payload.adminClient,
			shareLinkId: link.id,
			requestedTokenHash,
			outcome: 'expired',
			userAgent: requestMeta.userAgent,
			referrerUrlSanitized,
			clientIpHash
		});
		throw new ResumeShareAccessError(410, 'This share link has expired.');
	}
	if (!link.allow_download) {
		throw new ResumeShareAccessError(403, 'Downloads are disabled for this share link.');
	}
	if (link.access_mode === 'password') {
		const hasSession = await hasValidShareSession({
			adminClient: payload.adminClient,
			link,
			cookies: payload.cookies
		});
		if (!hasSession) {
			throw new ResumeShareAccessError(403, 'Unlock the share link before downloading.');
		}
	}

	return {
		link,
		requestedTokenHash,
		userAgent: requestMeta.userAgent,
		referrerUrlSanitized,
		clientIpHash
	};
};

export const recordSuccessfulShareDownload = async (payload: {
	adminClient: SupabaseClient;
	shareLinkId: string;
	requestedTokenHash: string;
	userAgent?: string | null;
	referrerUrlSanitized?: string | null;
	clientIpHash?: string | null;
}) => {
	await recordShareEvent({
		adminClient: payload.adminClient,
		shareLinkId: payload.shareLinkId,
		requestedTokenHash: payload.requestedTokenHash,
		outcome: 'success',
		userAgent: payload.userAgent,
		referrerUrlSanitized: payload.referrerUrlSanitized,
		clientIpHash: payload.clientIpHash,
		downloadTriggered: true
	});
};

export const parseResumeShareForm = (formData: FormData) => {
	const accessModeRaw = normalizeText(formData.get('access_mode'));
	const accessMode: ResumeShareAccessMode =
		accessModeRaw === 'link' ? 'link' : 'password';
	const neverExpires = normalizeBoolean(formData.get('never_expires'));
	const expiresInDays = normalizePositiveInt(formData.get('expires_in_days'));

	return {
		label: normalizeOptionalText(formData.get('label')),
		isAnonymized: normalizeBoolean(formData.get('is_anonymized')),
		accessMode,
		languageMode: normalizeLanguageMode(formData.get('language_mode')),
		password: normalizeOptionalText(formData.get('password')),
		neverExpires,
		expiresInDays,
		allowDownload: normalizeBoolean(formData.get('allow_download')),
		contactName: normalizeOptionalLimitedText(formData.get('contact_name'), MAX_CONTACT_NAME_LENGTH),
		contactEmail: normalizeOptionalLimitedText(formData.get('contact_email'), MAX_CONTACT_EMAIL_LENGTH),
		contactPhone: normalizeOptionalLimitedText(formData.get('contact_phone'), MAX_CONTACT_PHONE_LENGTH),
		contactNote: normalizeOptionalLimitedText(formData.get('contact_note'), MAX_CONTACT_NOTE_LENGTH)
	};
};

export const parseResumeShareUpdateForm = (formData: FormData) => ({
	shareLinkId: normalizeText(formData.get('share_link_id')),
	reason: normalizeOptionalText(formData.get('reason')),
	...parseResumeShareForm(formData)
});

export const decryptResumeShareUrl = (origin: string, encryptedToken: string) =>
	buildShareUrl(origin, decryptToken(encryptedToken));

export const loadResumeForShare = async (
	adminClient: SupabaseClient,
	resumeId: string
): Promise<Resume> => {
	const resume = await ResumeService.getResume(resumeId);
	if (resume) return resume;

	const resumeData = await loadResumeData(adminClient, resumeId);
	return {
		id: resumeId,
		personId: '',
		title: 'Resume',
		version: 'Resume',
		updatedAt: new Date().toISOString(),
		isMain: false,
		data: resumeData
	};
};
