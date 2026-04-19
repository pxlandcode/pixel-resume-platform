/**
 * Shared organisation management action helpers.
 *
 * Used by both /organisations (admin-only) and /settings/organisation
 * (organisation admins managing their own home org).
 */
import { fail } from '@sveltejs/kit';
import { create as createFont, type Font, type FontCollection } from 'fontkit';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { getActorAccessContext } from '$lib/server/access';
import {
	OrganisationEmailDomainError,
	assertOrganisationEmailDomainsAvailable,
	parseEmailDomainList,
	replaceOrganisationEmailDomains
} from '$lib/server/organisationEmailDomains';
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

// ── Constants ────────────────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORGANISATION_IMAGES_BUCKET = 'organisation-images';
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

// ── Utility helpers ──────────────────────────────────────────────────────────

export const isValidUuid = (value: string | null | undefined) =>
	typeof value === 'string' && UUID_REGEX.test(value);

export const normalizeSlug = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

export const normalizeOptionalText = (value: FormDataEntryValue | null) =>
	typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

export const parseOptionalHomepageUrl = (value: FormDataEntryValue | null): string | null => {
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

export const parseOptionalJsonObject = (value: string | null) => {
	if (!value || value.trim().length === 0) return {};
	const parsed = JSON.parse(value);
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('Template JSON must be an object.');
	}
	return parsed as Record<string, unknown>;
};

export const domainActionError = (actionType: string, domainError: unknown) => {
	const message =
		domainError instanceof OrganisationEmailDomainError
			? domainError.message
			: 'Could not update email domains.';
	const status = domainError instanceof OrganisationEmailDomainError ? domainError.status : 500;
	return fail(status, { type: actionType, ok: false, message });
};

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
	if (name.includes('extra bold') || name.includes('extrabold') || name.includes('ultrabold'))
		return 800;
	if (name.includes('bold')) return 700;
	if (name.includes('semi bold') || name.includes('semibold') || name.includes('demi bold'))
		return 600;
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
	if (!family) throw new Error('Font family name could not be read from the uploaded file.');
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
	return { family, subfamily, weight, italic, variationAxes: font.variationAxes ?? {} };
};

const validateFontFileInput = (file: File, label: string) => {
	const extension = getFontFileExtension(file);
	const extensionLooksLikeFont = isSupportedFontFilename(`x${extension}`);
	const mimeLooksLikeFont = isSupportedFontMime(file.type);
	if (!extensionLooksLikeFont && !mimeLooksLikeFont) {
		throw new Error(`${label} must be a .ttf, .otf, .woff, or .woff2 font file.`);
	}
	if (file.size <= 0) throw new Error(`${label} is empty.`);
	if (file.size > MAX_UPLOADED_FONT_SIZE_BYTES)
		throw new Error(`${label} must be 20MB or smaller.`);
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

// ── Auth context helpers ─────────────────────────────────────────────────────

export type OrgActionContext =
	| { ok: false; status: number; message: string }
	| {
			ok: true;
			supabase: NonNullable<ReturnType<typeof createSupabaseServerClient>>;
			adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>;
			actor: Awaited<ReturnType<typeof getActorAccessContext>> & { userId: string };
	  };

export const getAuthContext = async (cookies: { get(name: string): string | undefined }) => {
	const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
	const adminClient = getSupabaseAdminClient();
	const actor = await getActorAccessContext(supabase, adminClient);
	return { supabase, adminClient, actor };
};

/**
 * Ensures the caller is an admin (full access to any organisation).
 */
export const ensureAdminContext = async (cookies: {
	get(name: string): string | undefined;
}): Promise<OrgActionContext> => {
	const context = await getAuthContext(cookies);
	if (!context.supabase || !context.adminClient || !context.actor.userId) {
		return { ok: false, status: 401, message: 'You are not authenticated.' };
	}
	if (!context.actor.isAdmin) {
		return { ok: false, status: 403, message: 'Only admins can manage organisations.' };
	}
	return {
		ok: true,
		supabase: context.supabase,
		adminClient: context.adminClient,
		actor: { ...context.actor, userId: context.actor.userId }
	};
};

/**
 * Ensures the caller is an organisation admin with a home organisation,
 * and that the target organisation matches their home org.
 */
export const ensureOrgManagerContext = async (
	cookies: { get(name: string): string | undefined },
	targetOrganisationId?: string | null
): Promise<OrgActionContext> => {
	const context = await getAuthContext(cookies);
	if (!context.supabase || !context.adminClient || !context.actor.userId) {
		return { ok: false, status: 401, message: 'You are not authenticated.' };
	}

	const { isAdmin, isOrganisationAdmin, homeOrganisationId } = context.actor;
	if (!isAdmin && !isOrganisationAdmin) {
		return {
			ok: false,
			status: 403,
			message: 'You do not have permission to manage organisations.'
		};
	}
	if (!isAdmin && !homeOrganisationId) {
		return { ok: false, status: 403, message: 'No home organisation is linked to your account.' };
	}
	if (!isAdmin && targetOrganisationId && targetOrganisationId !== homeOrganisationId) {
		return { ok: false, status: 403, message: 'You can only manage your own organisation.' };
	}

	return {
		ok: true,
		supabase: context.supabase,
		adminClient: context.adminClient,
		actor: { ...context.actor, userId: context.actor.userId }
	};
};

// ── Action implementations ───────────────────────────────────────────────────

export const handleUpdateOrganisation = async (
	formData: FormData,
	context: Extract<OrgActionContext, { ok: true }>
) => {
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
	let emailDomains: string[] = [];
	try {
		homepageUrl = parseOptionalHomepageUrl(formData.get('homepage_url'));
		emailDomains = parseEmailDomainList(formData.getAll('email_domains'));
		await assertOrganisationEmailDomainsAvailable({
			adminClient: context.adminClient,
			organisationId: orgId,
			domains: emailDomains
		});
	} catch (urlError) {
		if (urlError instanceof OrganisationEmailDomainError) {
			return domainActionError('updateOrganisation', urlError);
		}
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

	try {
		await replaceOrganisationEmailDomains({
			adminClient: context.adminClient,
			organisationId: orgId,
			domains: emailDomains
		});
	} catch (domainError) {
		return domainActionError('updateOrganisation', domainError);
	}

	return { type: 'updateOrganisation', ok: true, message: 'Organisation updated.' };
};

export const handleUpdateOrganisationBranding = async (
	formData: FormData,
	context: Extract<OrgActionContext, { ok: true }>
) => {
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

	const existingTypography = resolveOrganisationBrandingTypography(organisationRow.brand_settings);
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
			regularFileEntry instanceof File && regularFileEntry.size > 0 ? regularFileEntry : undefined,
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
			uploadedFontUpdate = { mode: 'variable', family: metadata.family, files: { variablePath } };
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
			if (!(staticFiles[slot] instanceof File)) {
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
				{ slot: 'regular', label: 'Regular', weightMatch: isRegularWeight, italic: false },
				{ slot: 'italic', label: 'Italic', weightMatch: isRegularWeight, italic: true },
				{ slot: 'bold', label: 'Bold', weightMatch: isBoldWeight, italic: false },
				{ slot: 'boldItalic', label: 'Bold Italic', weightMatch: isBoldWeight, italic: true }
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

			uploadedFontUpdate = { mode: 'static', family: metadataBySlot[0].metadata.family, files };
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

	const isPixelCodeRaw = formData.get('is_pixel_code');
	const isPixelCode = isPixelCodeRaw === 'true';
	mergedBrandSettings.isPixelCode = isPixelCode;

	const { error: updateError } = await context.adminClient
		.from('organisations')
		.update({ brand_settings: mergedBrandSettings, updated_at: new Date().toISOString() })
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
};

export const handleUpdateOrganisationTemplate = async (
	formData: FormData,
	context: Extract<OrgActionContext, { ok: true }>
) => {
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
};

// ── Membership helpers ───────────────────────────────────────────────────────

export const ensureUserAndLinkedTalentHomeOrg = async (
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

export const ensureTalentAndLinkedUserHomeOrg = async (
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

export const disconnectUserAndLinkedTalentHomeOrg = async (
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

export const disconnectTalentAndLinkedUserHomeOrg = async (
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

export const handleConnectUserHome = async (
	formData: FormData,
	context: Extract<OrgActionContext, { ok: true }>
) => {
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
};

export const handleDisconnectUserHome = async (
	formData: FormData,
	context: Extract<OrgActionContext, { ok: true }>
) => {
	const userId = formData.get('user_id');
	if (typeof userId !== 'string' || !isValidUuid(userId)) {
		return fail(400, { type: 'disconnectUserHome', ok: false, message: 'Invalid user id.' });
	}

	await disconnectUserAndLinkedTalentHomeOrg(context.adminClient, userId);
	return { type: 'disconnectUserHome', ok: true, message: 'User disconnected from organisation.' };
};

export const handleConnectTalentHome = async (
	formData: FormData,
	context: Extract<OrgActionContext, { ok: true }>
) => {
	const organisationId = formData.get('organisation_id');
	const talentId = formData.get('talent_id');
	if (typeof organisationId !== 'string' || !isValidUuid(organisationId)) {
		return fail(400, { type: 'connectTalentHome', ok: false, message: 'Invalid organisation id.' });
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
};

export const handleDisconnectTalentHome = async (
	formData: FormData,
	context: Extract<OrgActionContext, { ok: true }>
) => {
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
};
