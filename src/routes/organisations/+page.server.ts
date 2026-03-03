import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { create as createFont, type Font, type FontCollection } from 'fontkit';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { getActorAccessContext, normalizeRolesFromJoinRows } from '$lib/server/access';
import { writeAuditLog } from '$lib/server/legalService';
import {
	mergeOrganisationBrandingTheme,
	parseOrganisationBrandingThemeFormData,
	resolveOrganisationBrandingTheme
} from '$lib/branding/theme';
import {
	DEFAULT_ORGANISATION_MAIN_FONT_KEY,
	mergeOrganisationBrandingTypography,
	resolveOrganisationBrandingTypography,
	type OrganisationMainFontKey,
	type OrganisationUploadedFontConfig,
	type OrganisationUploadedFontFiles,
	sanitizeFontFamilyName,
	isSupportedFontFilename,
	isSupportedFontMime,
	normalizeFontUploadFilename,
	ORGANISATION_UPLOADED_FONT_FIELD_NAMES,
	ORGANISATION_BUILT_IN_MAIN_FONT_KEYS,
	isUploadedFontConfigUsable,
	getOrganisationUploadedFontPaths
} from '$lib/branding/font';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORGANISATION_IMAGES_BUCKET = 'organisation-images';
const SHARING_SCOPES = new Set(['view', 'export_org_template', 'export_broker_template']);
const MAX_UPLOADED_FONT_SIZE_BYTES = 20 * 1024 * 1024;
const MAIN_FONT_KEY_OPTIONS = new Set<OrganisationMainFontKey>([
	...ORGANISATION_BUILT_IN_MAIN_FONT_KEYS,
	'uploaded'
]);
const FONT_UPLOAD_FIELD_NAMES = ORGANISATION_UPLOADED_FONT_FIELD_NAMES;

type FontFaceSlot = keyof typeof FONT_UPLOAD_FIELD_NAMES;

type ParsedFontMetadata = {
	family: string;
	subfamily: string;
	weight: number;
	italic: boolean;
	variationAxes: NonNullable<Font['variationAxes']>;
};

const isValidUuid = (value: string | null | undefined) =>
	typeof value === 'string' && UUID_REGEX.test(value);

const normalizeSlug = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

const normalizeOptionalText = (value: FormDataEntryValue | null) =>
	typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const normalizeFontKey = (value: FormDataEntryValue | null): OrganisationMainFontKey => {
	if (typeof value !== 'string') return DEFAULT_ORGANISATION_MAIN_FONT_KEY;
	const normalized = value.trim().toLowerCase();
	if (!MAIN_FONT_KEY_OPTIONS.has(normalized as OrganisationMainFontKey)) {
		return DEFAULT_ORGANISATION_MAIN_FONT_KEY;
	}
	return normalized as OrganisationMainFontKey;
};

const sanitizeStorageObjectName = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'file';

const getFontFileExtension = (file: File) => {
	const rawName = file.name?.trim() ?? '';
	const dotIndex = rawName.lastIndexOf('.');
	if (dotIndex >= 0 && dotIndex < rawName.length - 1) {
		return rawName.slice(dotIndex).toLowerCase();
	}
	const mime = file.type?.trim().toLowerCase() ?? '';
	if (mime.includes('woff2')) return '.woff2';
	if (mime.includes('woff')) return '.woff';
	if (mime.includes('ttf')) return '.ttf';
	if (mime.includes('otf') || mime.includes('opentype')) return '.otf';
	return '';
};

const inferWeightFromName = (value: string): number | null => {
	const name = value.toLowerCase();
	if (name.includes('black')) return 900;
	if (name.includes('extra bold') || name.includes('extrabold') || name.includes('ultrabold')) {
		return 800;
	}
	if (name.includes('bold')) return 700;
	if (name.includes('semi bold') || name.includes('semibold') || name.includes('demi bold')) {
		return 600;
	}
	if (name.includes('medium')) return 500;
	if (name.includes('regular') || name.includes('normal') || name.includes('book')) return 400;
	if (name.includes('light')) return 300;
	if (name.includes('thin')) return 100;
	return null;
};

const inferItalicFromName = (value: string) => {
	const lower = value.toLowerCase();
	return lower.includes('italic') || lower.includes('oblique');
};

const resolveFontFromFile = async (file: File): Promise<Font> => {
	const fileBuffer = Buffer.from(await file.arrayBuffer());
	const parsed = createFont(fileBuffer) as Font | FontCollection;
	if ('fonts' in parsed) {
		const firstFont = parsed.fonts?.[0] ?? null;
		if (!firstFont) throw new Error('Font file does not contain a readable font.');
		return firstFont;
	}
	return parsed;
};

const parseUploadedFontMetadata = async (file: File): Promise<ParsedFontMetadata> => {
	const font = await resolveFontFromFile(file);
	const rawFamily = font.familyName?.trim() || font.fullName?.trim() || '';
	const family = sanitizeFontFamilyName(rawFamily);
	if (!family) {
		throw new Error('Font family name could not be read from the uploaded file.');
	}
	const subfamily = font.subfamilyName?.trim() ?? '';
	const weightFromTable = Number(font['OS/2']?.usWeightClass);
	const inferredWeight = inferWeightFromName(subfamily) ?? inferWeightFromName(font.fullName ?? '');
	const weight =
		Number.isFinite(weightFromTable) && weightFromTable > 0
			? weightFromTable
			: (inferredWeight ?? 400);
	const italic = Boolean(
		font['OS/2']?.fsSelection?.italic ||
			font['OS/2']?.fsSelection?.oblique ||
			font.italicAngle !== 0 ||
			inferItalicFromName(subfamily) ||
			inferItalicFromName(font.fullName ?? '')
	);
	return {
		family,
		subfamily,
		weight,
		italic,
		variationAxes: font.variationAxes ?? {}
	};
};

const validateFontFileInput = (file: File, label: string) => {
	const extension = getFontFileExtension(file);
	const extensionLooksLikeFont = isSupportedFontFilename(`x${extension}`);
	const mimeLooksLikeFont = isSupportedFontMime(file.type);
	if (!extensionLooksLikeFont && !mimeLooksLikeFont) {
		throw new Error(`${label} must be a .ttf, .otf, .woff, or .woff2 font file.`);
	}
	if (file.size <= 0) {
		throw new Error(`${label} is empty.`);
	}
	if (file.size > MAX_UPLOADED_FONT_SIZE_BYTES) {
		throw new Error(`${label} must be 20MB or smaller.`);
	}
};

const uploadFontFile = async (
	adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
	organisationId: string,
	file: File,
	slot: FontFaceSlot
) => {
	validateFontFileInput(file, file.name || 'Font file');
	const extension = getFontFileExtension(file);
	const normalizedName = sanitizeStorageObjectName(
		normalizeFontUploadFilename(file.name || 'font')
	);
	const objectPath = `${organisationId}/fonts/${slot}/${Date.now()}-${normalizedName}${extension}`;
	const payload = new Uint8Array(await file.arrayBuffer());
	const { error: uploadError } = await adminClient.storage
		.from(ORGANISATION_IMAGES_BUCKET)
		.upload(objectPath, payload, {
			contentType: file.type || 'application/octet-stream',
			cacheControl: '3600',
			upsert: false
		});
	if (uploadError) throw new Error(uploadError.message);
	return objectPath;
};

const isRegularWeight = (weight: number) => weight >= 350 && weight <= 500;
const isBoldWeight = (weight: number) => weight >= 600 && weight <= 900;

const parseOptionalHomepageUrl = (value: FormDataEntryValue | null): string | null => {
	const raw = normalizeOptionalText(value);
	if (!raw) return null;
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		throw new Error('Homepage URL must be a valid absolute URL.');
	}
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
		throw new Error('Homepage URL must use http:// or https://.');
	}
	return parsed.toString();
};

const parseOptionalJsonObject = (value: string | null) => {
	if (!value || value.trim().length === 0) return {};
	const parsed = JSON.parse(value);
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('Template JSON must be an object.');
	}
	return parsed as Record<string, unknown>;
};

const resolveStoragePublicUrl = (
	adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
	value: string | null | undefined
) => {
	if (!value || typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (/^https?:\/\//i.test(trimmed)) return trimmed;
	const normalizedPath = trimmed.replace(/^\/+/, '').replace(/^organisation-images\//, '');
	const { data } = adminClient.storage
		.from(ORGANISATION_IMAGES_BUCKET)
		.getPublicUrl(normalizedPath);
	return data.publicUrl ?? null;
};

const getAdminContext = async (cookies: { get(name: string): string | undefined }) => {
	const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
	const adminClient = getSupabaseAdminClient();
	const actor = await getActorAccessContext(supabase, adminClient);
	return { supabase, adminClient, actor };
};

type AdminActionContext =
	| { ok: false; status: number; message: string }
	| {
			ok: true;
			supabase: NonNullable<ReturnType<typeof createSupabaseServerClient>>;
			adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>;
			actor: Awaited<ReturnType<typeof getActorAccessContext>> & { userId: string };
	  };

const ensureAdminForAction = async (cookies: { get(name: string): string | undefined }) => {
	const context = await getAdminContext(cookies);
	if (!context.supabase || !context.adminClient || !context.actor.userId) {
		return {
			ok: false as const,
			status: 401,
			message: 'You are not authenticated.'
		} satisfies AdminActionContext;
	}
	if (!context.actor.isAdmin) {
		return {
			ok: false as const,
			status: 403,
			message: 'Only admins can manage organisations.'
		} satisfies AdminActionContext;
	}
	return {
		ok: true as const,
		supabase: context.supabase,
		adminClient: context.adminClient,
		actor: { ...context.actor, userId: context.actor.userId }
	} satisfies AdminActionContext;
};

const ensureUserAndLinkedTalentHomeOrg = async (
	adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
	userId: string,
	organisationId: string
) => {
	const { data: existingUserHome } = await adminClient
		.from('organisation_users')
		.select('id, organisation_id')
		.eq('user_id', userId)
		.maybeSingle();

	if (existingUserHome?.organisation_id && existingUserHome.organisation_id !== organisationId) {
		throw new Error('User already belongs to another home organisation. Disconnect first.');
	}

	if (!existingUserHome) {
		const { error: userLinkError } = await adminClient.from('organisation_users').insert({
			organisation_id: organisationId,
			user_id: userId
		});
		if (userLinkError) throw new Error(userLinkError.message);
	}

	const { data: linkedTalent } = await adminClient
		.from('talents')
		.select('id')
		.eq('user_id', userId)
		.maybeSingle();

	if (!linkedTalent?.id) return;

	const { data: existingTalentHome } = await adminClient
		.from('organisation_talents')
		.select('id, organisation_id')
		.eq('talent_id', linkedTalent.id)
		.maybeSingle();

	if (
		existingTalentHome?.organisation_id &&
		existingTalentHome.organisation_id !== organisationId
	) {
		throw new Error(
			'Linked talent already belongs to another home organisation. Disconnect first.'
		);
	}

	if (!existingTalentHome) {
		const { error: talentLinkError } = await adminClient.from('organisation_talents').insert({
			organisation_id: organisationId,
			talent_id: linkedTalent.id
		});
		if (talentLinkError) throw new Error(talentLinkError.message);
	}
};

const ensureTalentAndLinkedUserHomeOrg = async (
	adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
	talentId: string,
	organisationId: string
) => {
	const { data: existingTalentHome } = await adminClient
		.from('organisation_talents')
		.select('id, organisation_id')
		.eq('talent_id', talentId)
		.maybeSingle();

	if (
		existingTalentHome?.organisation_id &&
		existingTalentHome.organisation_id !== organisationId
	) {
		throw new Error('Talent already belongs to another home organisation. Disconnect first.');
	}

	if (!existingTalentHome) {
		const { error: talentLinkError } = await adminClient.from('organisation_talents').insert({
			organisation_id: organisationId,
			talent_id: talentId
		});
		if (talentLinkError) throw new Error(talentLinkError.message);
	}

	const { data: talentRow } = await adminClient
		.from('talents')
		.select('user_id')
		.eq('id', talentId)
		.maybeSingle();
	const linkedUserId = talentRow?.user_id ?? null;
	if (!linkedUserId) return;

	const { data: existingUserHome } = await adminClient
		.from('organisation_users')
		.select('id, organisation_id')
		.eq('user_id', linkedUserId)
		.maybeSingle();

	if (existingUserHome?.organisation_id && existingUserHome.organisation_id !== organisationId) {
		throw new Error('Linked user already belongs to another home organisation. Disconnect first.');
	}

	if (!existingUserHome) {
		const { error: userLinkError } = await adminClient.from('organisation_users').insert({
			organisation_id: organisationId,
			user_id: linkedUserId
		});
		if (userLinkError) throw new Error(userLinkError.message);
	}
};

const disconnectUserAndLinkedTalentHomeOrg = async (
	adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
	userId: string
) => {
	const { data: linkedTalent } = await adminClient
		.from('talents')
		.select('id')
		.eq('user_id', userId)
		.maybeSingle();

	await adminClient.from('organisation_users').delete().eq('user_id', userId);
	if (linkedTalent?.id) {
		await adminClient.from('organisation_talents').delete().eq('talent_id', linkedTalent.id);
	}
};

const disconnectTalentAndLinkedUserHomeOrg = async (
	adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
	talentId: string
) => {
	const { data: talentRow } = await adminClient
		.from('talents')
		.select('user_id')
		.eq('id', talentId)
		.maybeSingle();

	await adminClient.from('organisation_talents').delete().eq('talent_id', talentId);
	if (talentRow?.user_id) {
		await adminClient.from('organisation_users').delete().eq('user_id', talentRow.user_id);
	}
};

export const load: PageServerLoad = async ({ cookies }) => {
	const { supabase, adminClient, actor } = await getAdminContext(cookies);
	if (!supabase || !adminClient || !actor.userId) {
		throw error(401, 'Unauthorized');
	}
	if (!actor.isAdmin) {
		throw error(403, 'Only admins can view organisation settings.');
	}

	const [
		organisationsResult,
		templatesResult,
		membershipsUsersResult,
		membershipsTalentsResult,
		accessGrantsResult,
		dataSharingPermissionsResult,
		usersResult,
		userRolesResult,
		talentsResult
	] = await Promise.all([
		adminClient
			.from('organisations')
			.select('id, name, slug, homepage_url, brand_settings, created_at, updated_at')
			.order('name', { ascending: true }),
		adminClient
			.from('organisation_templates')
			.select(
				'id, organisation_id, template_key, template_json, template_version, main_logotype_path, accent_logo_path, end_logo_path'
			),
		adminClient
			.from('organisation_users')
			.select('id, organisation_id, user_id, created_at, updated_at'),
		adminClient
			.from('organisation_talents')
			.select('id, organisation_id, talent_id, created_at, updated_at'),
		adminClient
			.from('organisation_access_grants')
			.select('id, organisation_id, grantee_user_id, created_at, created_by_user_id'),
		adminClient
			.from('data_sharing_permissions')
			.select(
				'id, source_organisation_id, target_organisation_id, sharing_scope, approved_by_admin_id, approved_at'
			),
		adminClient
			.from('user_profiles')
			.select('user_id, first_name, last_name, email')
			.order('last_name', { ascending: true })
			.order('first_name', { ascending: true }),
		adminClient.from('user_roles').select('user_id, roles(key)'),
		adminClient
			.from('talents')
			.select('id, user_id, first_name, last_name')
			.order('last_name', { ascending: true })
			.order('first_name', { ascending: true })
	]);

	if (organisationsResult.error) throw error(500, organisationsResult.error.message);
	if (templatesResult.error) throw error(500, templatesResult.error.message);
	if (membershipsUsersResult.error) throw error(500, membershipsUsersResult.error.message);
	if (membershipsTalentsResult.error) throw error(500, membershipsTalentsResult.error.message);
	if (accessGrantsResult.error) throw error(500, accessGrantsResult.error.message);
	if (dataSharingPermissionsResult.error)
		throw error(500, dataSharingPermissionsResult.error.message);
	if (usersResult.error) throw error(500, usersResult.error.message);
	if (userRolesResult.error) throw error(500, userRolesResult.error.message);
	if (talentsResult.error) throw error(500, talentsResult.error.message);

	const templates = (templatesResult.data ?? []).map((template) => ({
		...template,
		main_logotype_url: resolveStoragePublicUrl(adminClient, template.main_logotype_path),
		accent_logo_url: resolveStoragePublicUrl(adminClient, template.accent_logo_path),
		end_logo_url: resolveStoragePublicUrl(adminClient, template.end_logo_path)
	}));

	const rolesByUserId = new Map<string, Role[]>();
	for (const row of (userRolesResult.data ?? []) as Array<{
		user_id: string;
		roles?: { key?: string | null } | Array<{ key?: string | null }> | null;
	}>) {
		rolesByUserId.set(row.user_id, normalizeRolesFromJoinRows([{ roles: row.roles }]) as Role[]);
	}

	const users = (usersResult.data ?? []).map((row) => ({
		user_id: row.user_id,
		first_name: row.first_name ?? '',
		last_name: row.last_name ?? '',
		email: row.email ?? null,
		roles: rolesByUserId.get(row.user_id) ?? ['talent']
	}));

	return {
		organisations: organisationsResult.data ?? [],
		templates,
		membershipsUsers: membershipsUsersResult.data ?? [],
		membershipsTalents: membershipsTalentsResult.data ?? [],
		accessGrants: accessGrantsResult.data ?? [],
		dataSharingPermissions: dataSharingPermissionsResult.data ?? [],
		users,
		talents: talentsResult.data ?? []
	};
};

type Role = 'admin' | 'broker' | 'talent' | 'employer';

export const actions: Actions = {
	createOrganisation: async ({ request, cookies }) => {
		const context = await ensureAdminForAction(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'createOrganisation',
				ok: false,
				message: context.message
			});
		}

		const formData = await request.formData();
		const nameRaw = formData.get('name');
		const slugRaw = formData.get('slug');

		const name = typeof nameRaw === 'string' ? nameRaw.trim() : '';
		const slugInput = typeof slugRaw === 'string' ? slugRaw.trim() : '';
		let homepageUrl: string | null = null;
		try {
			homepageUrl = parseOptionalHomepageUrl(formData.get('homepage_url'));
		} catch (urlError) {
			return fail(400, {
				type: 'createOrganisation',
				ok: false,
				message: urlError instanceof Error ? urlError.message : 'Invalid homepage URL.'
			});
		}

		if (!name) {
			return fail(400, {
				type: 'createOrganisation',
				ok: false,
				message: 'Organisation name is required.'
			});
		}

		const slug = normalizeSlug(slugInput || name);
		if (!slug) {
			return fail(400, {
				type: 'createOrganisation',
				ok: false,
				message: 'Organisation slug is required.'
			});
		}

		const { data: orgRow, error: insertError } = await context.adminClient
			.from('organisations')
			.insert({
				name,
				slug,
				homepage_url: homepageUrl,
				brand_settings: {
					typography: {
						mainFontKey: DEFAULT_ORGANISATION_MAIN_FONT_KEY
					}
				},
				created_by_user_id: context.actor.userId
			})
			.select('id')
			.single();

		if (insertError || !orgRow?.id) {
			return fail(500, {
				type: 'createOrganisation',
				ok: false,
				message: insertError?.message ?? 'Could not create organisation.'
			});
		}

		await context.adminClient.from('organisation_templates').upsert(
			{
				organisation_id: orgRow.id,
				template_key: 'default',
				template_json: {},
				template_version: 1
			},
			{ onConflict: 'organisation_id' }
		);

		return { type: 'createOrganisation', ok: true, message: 'Organisation created.' };
	},

	updateOrganisation: async ({ request, cookies }) => {
		const context = await ensureAdminForAction(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'updateOrganisation',
				ok: false,
				message: context.message
			});
		}

		const formData = await request.formData();
		const orgId = formData.get('organisation_id');
		const nameRaw = formData.get('name');
		const slugRaw = formData.get('slug');
		const brandSettingsRaw = formData.get('brand_settings');

		if (typeof orgId !== 'string' || !isValidUuid(orgId)) {
			return fail(400, {
				type: 'updateOrganisation',
				ok: false,
				message: 'Invalid organisation id.'
			});
		}

		const name = typeof nameRaw === 'string' ? nameRaw.trim() : '';
		const slug = normalizeSlug(typeof slugRaw === 'string' ? slugRaw : name);
		let homepageUrl: string | null = null;
		try {
			homepageUrl = parseOptionalHomepageUrl(formData.get('homepage_url'));
		} catch (urlError) {
			return fail(400, {
				type: 'updateOrganisation',
				ok: false,
				message: urlError instanceof Error ? urlError.message : 'Invalid homepage URL.'
			});
		}

		const updatePayload: {
			name: string;
			slug: string;
			homepage_url: string | null;
			updated_at: string;
			brand_settings?: Record<string, unknown>;
		} = {
			name,
			slug,
			homepage_url: homepageUrl,
			updated_at: new Date().toISOString()
		};

		if (typeof brandSettingsRaw === 'string') {
			try {
				updatePayload.brand_settings = parseOptionalJsonObject(brandSettingsRaw);
			} catch (jsonError) {
				return fail(400, {
					type: 'updateOrganisation',
					ok: false,
					message: jsonError instanceof Error ? jsonError.message : 'Invalid brand settings JSON.'
				});
			}
		}

		const { error: updateError } = await context.adminClient
			.from('organisations')
			.update(updatePayload)
			.eq('id', orgId);

		if (updateError) {
			return fail(500, { type: 'updateOrganisation', ok: false, message: updateError.message });
		}

		return { type: 'updateOrganisation', ok: true, message: 'Organisation updated.' };
	},

	updateOrganisationBranding: async ({ request, cookies }) => {
		const context = await ensureAdminForAction(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'updateOrganisationBranding',
				ok: false,
				message: context.message
			});
		}

		const formData = await request.formData();
		const organisationId = formData.get('organisation_id');
		if (typeof organisationId !== 'string' || !isValidUuid(organisationId)) {
			return fail(400, {
				type: 'updateOrganisationBranding',
				ok: false,
				message: 'Invalid organisation id.'
			});
		}

		const { data: organisationRow, error: organisationError } = await context.adminClient
			.from('organisations')
			.select('brand_settings')
			.eq('id', organisationId)
			.maybeSingle();
		if (organisationError) {
			return fail(500, {
				type: 'updateOrganisationBranding',
				ok: false,
				message: organisationError.message
			});
		}
		if (!organisationRow) {
			return fail(404, {
				type: 'updateOrganisationBranding',
				ok: false,
				message: 'Organisation not found.'
			});
		}

		const fallbackTheme = resolveOrganisationBrandingTheme(organisationRow.brand_settings);
		let theme: typeof fallbackTheme;
		try {
			theme = parseOrganisationBrandingThemeFormData(formData, fallbackTheme);
		} catch (parseError) {
			return fail(400, {
				type: 'updateOrganisationBranding',
				ok: false,
				message: parseError instanceof Error ? parseError.message : 'Invalid branding colors.'
			});
		}

		const existingTypography = resolveOrganisationBrandingTypography(
			organisationRow.brand_settings
		);
		let nextMainFontKey = normalizeFontKey(formData.get('main_font_key'));
		let uploadedFontUpdate: OrganisationUploadedFontConfig | undefined;
		const uploadedPathsForRollback: string[] = [];
		const existingUploadedFontPaths = getOrganisationUploadedFontPaths(
			organisationRow.brand_settings
		);

		const variableFileEntry = formData.get(FONT_UPLOAD_FIELD_NAMES.variable);
		const regularFileEntry = formData.get(FONT_UPLOAD_FIELD_NAMES.regular);
		const italicFileEntry = formData.get(FONT_UPLOAD_FIELD_NAMES.italic);
		const boldFileEntry = formData.get(FONT_UPLOAD_FIELD_NAMES.bold);
		const boldItalicFileEntry = formData.get(FONT_UPLOAD_FIELD_NAMES.boldItalic);

		const variableFile =
			variableFileEntry instanceof File && variableFileEntry.size > 0 ? variableFileEntry : null;
		const staticFiles: Partial<Record<FontFaceSlot, File>> = {
			regular:
				regularFileEntry instanceof File && regularFileEntry.size > 0
					? regularFileEntry
					: undefined,
			italic:
				italicFileEntry instanceof File && italicFileEntry.size > 0 ? italicFileEntry : undefined,
			bold: boldFileEntry instanceof File && boldFileEntry.size > 0 ? boldFileEntry : undefined,
			boldItalic:
				boldItalicFileEntry instanceof File && boldItalicFileEntry.size > 0
					? boldItalicFileEntry
					: undefined
		};

		const staticFileCount = Object.values(staticFiles).filter(Boolean).length;
		if (variableFile && staticFileCount > 0) {
			return fail(400, {
				type: 'updateOrganisationBranding',
				ok: false,
				message:
					'Upload either one variable font file or four static files (Regular, Italic, Bold, Bold Italic), not both at the same time.'
			});
		}

		if (variableFile) {
			try {
				validateFontFileInput(variableFile, 'Variable font');
				const metadata = await parseUploadedFontMetadata(variableFile);
				const variationAxes = metadata.variationAxes ?? {};
				const weightAxis = variationAxes.wght;
				const italAxis = variationAxes.ital;
				const slantAxis = variationAxes.slnt;

				const hasRequiredWeightRange = Boolean(
					weightAxis &&
						Number.isFinite(weightAxis.min) &&
						Number.isFinite(weightAxis.max) &&
						weightAxis.min <= 400 &&
						weightAxis.max >= 700
				);
				if (!hasRequiredWeightRange) {
					throw new Error(
						'Variable font must include a `wght` axis that supports at least 400 and 700.'
					);
				}

				const hasItalicSupport = Boolean(
					(italAxis &&
						Number.isFinite(italAxis.max) &&
						Number.isFinite(italAxis.min) &&
						italAxis.max > italAxis.min) ||
						(slantAxis &&
							Number.isFinite(slantAxis.max) &&
							Number.isFinite(slantAxis.min) &&
							slantAxis.max > slantAxis.min)
				);
				if (!hasItalicSupport) {
					throw new Error(
						'Variable font must include italic support (`ital` or `slnt` axis) so italic styles render correctly.'
					);
				}

				const variablePath = await uploadFontFile(
					context.adminClient,
					organisationId,
					variableFile,
					'variable'
				);
				uploadedPathsForRollback.push(variablePath);
				uploadedFontUpdate = {
					mode: 'variable',
					family: metadata.family,
					files: { variablePath }
				};
				nextMainFontKey = 'uploaded';
			} catch (fontError) {
				return fail(400, {
					type: 'updateOrganisationBranding',
					ok: false,
					message: fontError instanceof Error ? fontError.message : 'Invalid variable font upload.'
				});
			}
		} else if (staticFileCount > 0) {
			if (staticFileCount !== 4) {
				return fail(400, {
					type: 'updateOrganisationBranding',
					ok: false,
					message:
						'Static font uploads require all four files: Regular (400), Italic (400), Bold (700), and Bold Italic (700).'
				});
			}

			const requiredSlots: FontFaceSlot[] = ['regular', 'italic', 'bold', 'boldItalic'];
			for (const slot of requiredSlots) {
				const file = staticFiles[slot];
				if (!(file instanceof File)) {
					return fail(400, {
						type: 'updateOrganisationBranding',
						ok: false,
						message:
							'Static font uploads require all four files: Regular (400), Italic (400), Bold (700), and Bold Italic (700).'
					});
				}
			}

			try {
				const metadataBySlot = await Promise.all(
					requiredSlots.map(async (slot) => ({
						slot,
						file: staticFiles[slot] as File,
						metadata: await parseUploadedFontMetadata(staticFiles[slot] as File)
					}))
				);

				const baseFamily = sanitizeFontFamilyName(metadataBySlot[0].metadata.family).toLowerCase();
				const familyMismatch = metadataBySlot.find(
					({ metadata }) => sanitizeFontFamilyName(metadata.family).toLowerCase() !== baseFamily
				);
				if (familyMismatch) {
					throw new Error(
						'All static uploads must belong to the same font family (Regular, Italic, Bold, Bold Italic).'
					);
				}

				const slotChecks: Array<{
					slot: FontFaceSlot;
					label: string;
					weightMatch: (weight: number) => boolean;
					italic: boolean;
				}> = [
					{
						slot: 'regular',
						label: 'Regular',
						weightMatch: isRegularWeight,
						italic: false
					},
					{
						slot: 'italic',
						label: 'Italic',
						weightMatch: isRegularWeight,
						italic: true
					},
					{
						slot: 'bold',
						label: 'Bold',
						weightMatch: isBoldWeight,
						italic: false
					},
					{
						slot: 'boldItalic',
						label: 'Bold Italic',
						weightMatch: isBoldWeight,
						italic: true
					}
				];

				for (const check of slotChecks) {
					const current = metadataBySlot.find((item) => item.slot === check.slot);
					if (!current) continue;
					if (
						!check.weightMatch(current.metadata.weight) ||
						current.metadata.italic !== check.italic
					) {
						throw new Error(
							`${check.label} file does not match expected style metadata (${check.italic ? 'italic' : 'normal'}, weight ${check.italic ? '400/700' : check.slot === 'bold' ? '700' : '400'}).`
						);
					}
				}

				const files: OrganisationUploadedFontFiles = {};
				for (const slot of requiredSlots) {
					const path = await uploadFontFile(
						context.adminClient,
						organisationId,
						staticFiles[slot] as File,
						slot
					);
					uploadedPathsForRollback.push(path);
					if (slot === 'regular') files.regularPath = path;
					if (slot === 'italic') files.italicPath = path;
					if (slot === 'bold') files.boldPath = path;
					if (slot === 'boldItalic') files.boldItalicPath = path;
				}

				uploadedFontUpdate = {
					mode: 'static',
					family: metadataBySlot[0].metadata.family,
					files
				};
				nextMainFontKey = 'uploaded';
			} catch (fontError) {
				if (uploadedPathsForRollback.length > 0) {
					await context.adminClient.storage
						.from(ORGANISATION_IMAGES_BUCKET)
						.remove(uploadedPathsForRollback);
				}
				return fail(400, {
					type: 'updateOrganisationBranding',
					ok: false,
					message: fontError instanceof Error ? fontError.message : 'Invalid static font upload.'
				});
			}
		}

		const effectiveUploadedFont = uploadedFontUpdate ?? existingTypography.uploadedFont;
		if (nextMainFontKey === 'uploaded' && !isUploadedFontConfigUsable(effectiveUploadedFont)) {
			if (uploadedPathsForRollback.length > 0) {
				await context.adminClient.storage
					.from(ORGANISATION_IMAGES_BUCKET)
					.remove(uploadedPathsForRollback);
			}
			return fail(400, {
				type: 'updateOrganisationBranding',
				ok: false,
				message:
					'Uploaded font selection requires either one valid variable font or all four static files (Regular, Italic, Bold, Bold Italic).'
			});
		}

		let mergedBrandSettings = mergeOrganisationBrandingTheme(organisationRow.brand_settings, theme);
		mergedBrandSettings = mergeOrganisationBrandingTypography(mergedBrandSettings, {
			mainFontKey: nextMainFontKey,
			...(uploadedFontUpdate ? { uploadedFont: uploadedFontUpdate } : {})
		});

		// Handle isPixelCode flag
		const isPixelCodeRaw = formData.get('is_pixel_code');
		const isPixelCode = isPixelCodeRaw === 'true';
		mergedBrandSettings.isPixelCode = isPixelCode;

		const { error: updateError } = await context.adminClient
			.from('organisations')
			.update({
				brand_settings: mergedBrandSettings,
				updated_at: new Date().toISOString()
			})
			.eq('id', organisationId);
		if (updateError) {
			if (uploadedPathsForRollback.length > 0) {
				await context.adminClient.storage
					.from(ORGANISATION_IMAGES_BUCKET)
					.remove(uploadedPathsForRollback);
			}
			return fail(500, {
				type: 'updateOrganisationBranding',
				ok: false,
				message: updateError.message
			});
		}

		if (uploadedFontUpdate) {
			const newUploadedPaths = getOrganisationUploadedFontPaths(mergedBrandSettings);
			const stalePaths = existingUploadedFontPaths.filter(
				(existingPath) => !newUploadedPaths.includes(existingPath)
			);
			if (stalePaths.length > 0) {
				await context.adminClient.storage.from(ORGANISATION_IMAGES_BUCKET).remove(stalePaths);
			}
		}

		return {
			type: 'updateOrganisationBranding',
			ok: true,
			message: 'Organisation branding updated.'
		};
	},

	updateOrganisationTemplate: async ({ request, cookies }) => {
		const context = await ensureAdminForAction(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'updateOrganisationTemplate',
				ok: false,
				message: context.message
			});
		}

		const formData = await request.formData();
		const organisationId = formData.get('organisation_id');
		const templateKeyRaw = formData.get('template_key');
		const templateVersionRaw = formData.get('template_version');
		const templateJsonRaw = formData.get('template_json');

		if (typeof organisationId !== 'string' || !isValidUuid(organisationId)) {
			return fail(400, {
				type: 'updateOrganisationTemplate',
				ok: false,
				message: 'Invalid organisation id.'
			});
		}

		const templateKey =
			typeof templateKeyRaw === 'string' && templateKeyRaw.trim().length > 0
				? templateKeyRaw.trim()
				: 'default';
		const templateVersion = Number(templateVersionRaw);

		let templateJson: Record<string, unknown> = {};
		try {
			templateJson = parseOptionalJsonObject(
				typeof templateJsonRaw === 'string' ? templateJsonRaw : '{}'
			);
		} catch (jsonError) {
			return fail(400, {
				type: 'updateOrganisationTemplate',
				ok: false,
				message: jsonError instanceof Error ? jsonError.message : 'Invalid template JSON.'
			});
		}

		const { error: upsertError } = await context.adminClient.from('organisation_templates').upsert(
			{
				organisation_id: organisationId,
				template_key: templateKey,
				template_json: templateJson,
				template_version:
					Number.isFinite(templateVersion) && templateVersion > 0 ? Math.floor(templateVersion) : 1
			},
			{ onConflict: 'organisation_id' }
		);

		if (upsertError) {
			return fail(500, {
				type: 'updateOrganisationTemplate',
				ok: false,
				message: upsertError.message
			});
		}

		return { type: 'updateOrganisationTemplate', ok: true, message: 'Template settings updated.' };
	},

	connectUserHome: async ({ request, cookies }) => {
		const context = await ensureAdminForAction(cookies);
		if (!context.ok) {
			return fail(context.status, { type: 'connectUserHome', ok: false, message: context.message });
		}

		const formData = await request.formData();
		const organisationId = formData.get('organisation_id');
		const userId = formData.get('user_id');
		if (typeof organisationId !== 'string' || !isValidUuid(organisationId)) {
			return fail(400, { type: 'connectUserHome', ok: false, message: 'Invalid organisation id.' });
		}
		if (typeof userId !== 'string' || !isValidUuid(userId)) {
			return fail(400, { type: 'connectUserHome', ok: false, message: 'Invalid user id.' });
		}

		try {
			await ensureUserAndLinkedTalentHomeOrg(context.adminClient, userId, organisationId);
		} catch (connectError) {
			return fail(409, {
				type: 'connectUserHome',
				ok: false,
				message: connectError instanceof Error ? connectError.message : 'Could not connect user.'
			});
		}

		return { type: 'connectUserHome', ok: true, message: 'User connected to organisation.' };
	},

	disconnectUserHome: async ({ request, cookies }) => {
		const context = await ensureAdminForAction(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'disconnectUserHome',
				ok: false,
				message: context.message
			});
		}

		const formData = await request.formData();
		const userId = formData.get('user_id');
		if (typeof userId !== 'string' || !isValidUuid(userId)) {
			return fail(400, { type: 'disconnectUserHome', ok: false, message: 'Invalid user id.' });
		}

		await disconnectUserAndLinkedTalentHomeOrg(context.adminClient, userId);
		return {
			type: 'disconnectUserHome',
			ok: true,
			message: 'User disconnected from organisation.'
		};
	},

	connectTalentHome: async ({ request, cookies }) => {
		const context = await ensureAdminForAction(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'connectTalentHome',
				ok: false,
				message: context.message
			});
		}

		const formData = await request.formData();
		const organisationId = formData.get('organisation_id');
		const talentId = formData.get('talent_id');
		if (typeof organisationId !== 'string' || !isValidUuid(organisationId)) {
			return fail(400, {
				type: 'connectTalentHome',
				ok: false,
				message: 'Invalid organisation id.'
			});
		}
		if (typeof talentId !== 'string' || !isValidUuid(talentId)) {
			return fail(400, { type: 'connectTalentHome', ok: false, message: 'Invalid talent id.' });
		}

		try {
			await ensureTalentAndLinkedUserHomeOrg(context.adminClient, talentId, organisationId);
		} catch (connectError) {
			return fail(409, {
				type: 'connectTalentHome',
				ok: false,
				message: connectError instanceof Error ? connectError.message : 'Could not connect talent.'
			});
		}

		return { type: 'connectTalentHome', ok: true, message: 'Talent connected to organisation.' };
	},

	disconnectTalentHome: async ({ request, cookies }) => {
		const context = await ensureAdminForAction(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'disconnectTalentHome',
				ok: false,
				message: context.message
			});
		}

		const formData = await request.formData();
		const talentId = formData.get('talent_id');
		if (typeof talentId !== 'string' || !isValidUuid(talentId)) {
			return fail(400, { type: 'disconnectTalentHome', ok: false, message: 'Invalid talent id.' });
		}

		await disconnectTalentAndLinkedUserHomeOrg(context.adminClient, talentId);
		return {
			type: 'disconnectTalentHome',
			ok: true,
			message: 'Talent disconnected from organisation.'
		};
	},

	grantOrganisationAccess: async ({ request, cookies }) => {
		const context = await ensureAdminForAction(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'grantOrganisationAccess',
				ok: false,
				message: context.message
			});
		}

		const formData = await request.formData();
		const organisationId = formData.get('organisation_id');
		const userId = formData.get('user_id');
		if (typeof organisationId !== 'string' || !isValidUuid(organisationId)) {
			return fail(400, {
				type: 'grantOrganisationAccess',
				ok: false,
				message: 'Invalid organisation id.'
			});
		}
		if (typeof userId !== 'string' || !isValidUuid(userId)) {
			return fail(400, { type: 'grantOrganisationAccess', ok: false, message: 'Invalid user id.' });
		}

		const { data: roleRows } = await context.adminClient
			.from('user_roles')
			.select('roles(key)')
			.eq('user_id', userId);
		const roles = normalizeRolesFromJoinRows(
			(roleRows as Array<{
				roles?: { key?: string | null } | Array<{ key?: string | null }> | null;
			}> | null) ?? []
		);
		if (!roles.includes('broker') && !roles.includes('employer')) {
			return fail(400, {
				type: 'grantOrganisationAccess',
				ok: false,
				message: 'Only broker or employer users can receive cross-organisation access.'
			});
		}

		const { error: grantError } = await context.adminClient
			.from('organisation_access_grants')
			.insert({
				organisation_id: organisationId,
				grantee_user_id: userId,
				created_by_user_id: context.actor.userId
			});
		if (grantError) {
			return fail(500, { type: 'grantOrganisationAccess', ok: false, message: grantError.message });
		}

		return { type: 'grantOrganisationAccess', ok: true, message: 'Access grant created.' };
	},

	revokeOrganisationAccess: async ({ request, cookies }) => {
		const context = await ensureAdminForAction(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'revokeOrganisationAccess',
				ok: false,
				message: context.message
			});
		}

		const formData = await request.formData();
		const grantId = formData.get('grant_id');
		if (typeof grantId !== 'string' || !isValidUuid(grantId)) {
			return fail(400, {
				type: 'revokeOrganisationAccess',
				ok: false,
				message: 'Invalid grant id.'
			});
		}

		const { error: revokeError } = await context.adminClient
			.from('organisation_access_grants')
			.delete()
			.eq('id', grantId);
		if (revokeError) {
			return fail(500, {
				type: 'revokeOrganisationAccess',
				ok: false,
				message: revokeError.message
			});
		}

		return { type: 'revokeOrganisationAccess', ok: true, message: 'Access grant removed.' };
	},

	approveDataSharingPermission: async ({ request, cookies }) => {
		const context = await ensureAdminForAction(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'approveDataSharingPermission',
				ok: false,
				message: context.message
			});
		}

		const formData = await request.formData();
		const sourceOrganisationId = formData.get('source_organisation_id');
		const targetOrganisationId = formData.get('target_organisation_id');
		const sharingScope = formData.get('sharing_scope');

		if (typeof sourceOrganisationId !== 'string' || !isValidUuid(sourceOrganisationId)) {
			return fail(400, {
				type: 'approveDataSharingPermission',
				ok: false,
				message: 'Invalid source organisation id.'
			});
		}
		if (typeof targetOrganisationId !== 'string' || !isValidUuid(targetOrganisationId)) {
			return fail(400, {
				type: 'approveDataSharingPermission',
				ok: false,
				message: 'Invalid target organisation id.'
			});
		}
		if (sourceOrganisationId === targetOrganisationId) {
			return fail(400, {
				type: 'approveDataSharingPermission',
				ok: false,
				message: 'Source and target organisations must be different.'
			});
		}
		if (typeof sharingScope !== 'string' || !SHARING_SCOPES.has(sharingScope)) {
			return fail(400, {
				type: 'approveDataSharingPermission',
				ok: false,
				message: 'Invalid sharing scope.'
			});
		}

		const { error: upsertError } = await context.adminClient
			.from('data_sharing_permissions')
			.upsert(
				{
					source_organisation_id: sourceOrganisationId,
					target_organisation_id: targetOrganisationId,
					sharing_scope: sharingScope,
					approved_by_admin_id: context.actor.userId,
					approved_at: new Date().toISOString()
				},
				{
					onConflict: 'source_organisation_id,target_organisation_id,sharing_scope'
				}
			);
		if (upsertError) {
			return fail(500, {
				type: 'approveDataSharingPermission',
				ok: false,
				message: upsertError.message
			});
		}

		const auditResult = await writeAuditLog({
			actorUserId: context.actor.userId,
			organisationId: sourceOrganisationId,
			actionType: 'SHARING_APPROVED',
			resourceType: 'organisation',
			resourceId: sourceOrganisationId,
			metadata: {
				source_org_id: sourceOrganisationId,
				target_org_id: targetOrganisationId,
				sharing_scope: sharingScope
			}
		});
		if (!auditResult.ok) {
			console.warn('[organisations] could not write sharing approval audit log', auditResult.error);
		}

		return {
			type: 'approveDataSharingPermission',
			ok: true,
			message: 'Data sharing permission approved.'
		};
	},

	revokeDataSharingPermission: async ({ request, cookies }) => {
		const context = await ensureAdminForAction(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'revokeDataSharingPermission',
				ok: false,
				message: context.message
			});
		}

		const formData = await request.formData();
		const permissionId = formData.get('permission_id');
		if (typeof permissionId !== 'string' || !isValidUuid(permissionId)) {
			return fail(400, {
				type: 'revokeDataSharingPermission',
				ok: false,
				message: 'Invalid permission id.'
			});
		}

		const { error: revokeError } = await context.adminClient
			.from('data_sharing_permissions')
			.delete()
			.eq('id', permissionId);
		if (revokeError) {
			return fail(500, {
				type: 'revokeDataSharingPermission',
				ok: false,
				message: revokeError.message
			});
		}

		return {
			type: 'revokeDataSharingPermission',
			ok: true,
			message: 'Data sharing permission revoked.'
		};
	}
};
