export const ORGANISATION_BUILT_IN_MAIN_FONT_KEYS = [
	'inter',
	'roboto',
	'lora',
	'merriweather',
	'playfair-display',
	'domine',
	'montserrat'
] as const;

export type OrganisationBuiltInMainFontKey = (typeof ORGANISATION_BUILT_IN_MAIN_FONT_KEYS)[number];

export type OrganisationMainFontKey = OrganisationBuiltInMainFontKey | 'uploaded';

export type OrganisationUploadedFontMode = 'variable' | 'static';

export type OrganisationUploadedFontFiles = {
	variablePath?: string;
	regularPath?: string;
	italicPath?: string;
	boldPath?: string;
	boldItalicPath?: string;
};

export type OrganisationUploadedFontConfig = {
	mode: OrganisationUploadedFontMode;
	family: string;
	files: OrganisationUploadedFontFiles;
};

export type OrganisationBrandingTypography = {
	mainFontKey: OrganisationMainFontKey;
	uploadedFont: OrganisationUploadedFontConfig | null;
};

export type ResolvedOrganisationMainFont = {
	mainFontKey: OrganisationMainFontKey;
	cssStack: string;
	fontFaceCss: string | null;
	family: string;
};

export const DEFAULT_ORGANISATION_MAIN_FONT_KEY: OrganisationBuiltInMainFontKey = 'inter';

export const ORGANISATION_MAIN_FONT_OPTIONS: Array<{
	key: OrganisationBuiltInMainFontKey;
	label: string;
}> = [
	{ key: 'inter', label: 'Inter' },
	{ key: 'roboto', label: 'Roboto' },
	{ key: 'lora', label: 'Lora' },
	{ key: 'merriweather', label: 'Merriweather' },
	{ key: 'playfair-display', label: 'Playfair Display' },
	{ key: 'domine', label: 'Domine' }
];

export const ORGANISATION_UPLOADED_FONT_FIELD_NAMES = {
	variable: 'uploaded_font_variable',
	regular: 'uploaded_font_regular',
	italic: 'uploaded_font_italic',
	bold: 'uploaded_font_bold',
	boldItalic: 'uploaded_font_bold_italic'
} as const;

const SANS_STACK = "'Inter', 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
const SERIF_STACK = "'Georgia', 'Times New Roman', serif";

const BUILT_IN_FONT_DETAILS: Record<
	OrganisationBuiltInMainFontKey,
	{ family: string; cssStack: string }
> = {
	inter: {
		family: 'Inter',
		cssStack: SANS_STACK
	},
	roboto: {
		family: 'Roboto',
		cssStack: "'Roboto', 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
	},
	lora: {
		family: 'Lora',
		cssStack: "'Lora', 'Merriweather', " + SERIF_STACK
	},
	merriweather: {
		family: 'Merriweather',
		cssStack: "'Merriweather', 'Lora', " + SERIF_STACK
	},
	'playfair-display': {
		family: 'Playfair Display',
		cssStack: "'Playfair Display', 'Merriweather', " + SERIF_STACK
	},
	domine: {
		family: 'Domine',
		cssStack: "'Domine', 'Merriweather', " + SERIF_STACK
	},
	montserrat: {
		family: 'Montserrat',
		cssStack:
			"'Montserrat', 'Inter', 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
	}
};

const FONT_EXTENSION_REGEX = /\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeText = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

const normalizeMainFontKey = (value: unknown): OrganisationMainFontKey => {
	if (typeof value !== 'string') return DEFAULT_ORGANISATION_MAIN_FONT_KEY;
	const normalized = value.trim().toLowerCase();
	if (normalized === 'uploaded') return 'uploaded';
	if (ORGANISATION_BUILT_IN_MAIN_FONT_KEYS.includes(normalized as OrganisationBuiltInMainFontKey)) {
		return normalized as OrganisationBuiltInMainFontKey;
	}
	return DEFAULT_ORGANISATION_MAIN_FONT_KEY;
};

const normalizeFontPath = (value: unknown): string | undefined => {
	const raw = normalizeText(value);
	if (!raw) return undefined;
	return raw;
};

const normalizeUploadedFontFiles = (value: unknown): OrganisationUploadedFontFiles => {
	if (!isRecord(value)) return {};
	return {
		variablePath: normalizeFontPath(value.variablePath),
		regularPath: normalizeFontPath(value.regularPath),
		italicPath: normalizeFontPath(value.italicPath),
		boldPath: normalizeFontPath(value.boldPath),
		boldItalicPath: normalizeFontPath(value.boldItalicPath)
	};
};

const normalizeUploadedFont = (value: unknown): OrganisationUploadedFontConfig | null => {
	if (!isRecord(value)) return null;
	const modeRaw = normalizeText(value.mode)?.toLowerCase();
	const mode: OrganisationUploadedFontMode | null =
		modeRaw === 'variable' || modeRaw === 'static'
			? (modeRaw as OrganisationUploadedFontMode)
			: null;
	if (!mode) return null;

	const family = sanitizeFontFamilyName(normalizeText(value.family) ?? '');
	if (!family) return null;

	const files = normalizeUploadedFontFiles(value.files);
	return { mode, family, files };
};

const resolveAssetUrl = (
	path: string,
	pathToUrl?: (path: string) => string | null
): string | null => {
	if (/^https?:\/\//i.test(path)) return path;
	if (path.startsWith('/')) return path;
	if (!pathToUrl) return null;
	return pathToUrl(path);
};

const escapeCssString = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const inferCssFormat = (value: string): string | null => {
	const extension = value.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase() ?? '';
	switch (extension) {
		case 'ttf':
			return 'truetype';
		case 'otf':
			return 'opentype';
		case 'woff':
			return 'woff';
		case 'woff2':
			return 'woff2';
		default:
			return null;
	}
};

const buildSrc = (url: string) => {
	const format = inferCssFormat(url);
	if (!format) return `url('${escapeCssString(url)}')`;
	return `url('${escapeCssString(url)}') format('${format}')`;
};

export const isUploadedFontConfigUsable = (uploadedFont: OrganisationUploadedFontConfig | null) => {
	if (!uploadedFont) return false;
	if (uploadedFont.mode === 'variable') {
		return Boolean(uploadedFont.files.variablePath);
	}
	return Boolean(
		uploadedFont.files.regularPath &&
			uploadedFont.files.italicPath &&
			uploadedFont.files.boldPath &&
			uploadedFont.files.boldItalicPath
	);
};

const buildUploadedFontFaceCss = (
	uploadedFont: OrganisationUploadedFontConfig,
	pathToUrl?: (path: string) => string | null
): string | null => {
	const family = escapeCssString(uploadedFont.family);
	if (uploadedFont.mode === 'variable') {
		const variablePath = uploadedFont.files.variablePath;
		if (!variablePath) return null;
		const variableUrl = resolveAssetUrl(variablePath, pathToUrl);
		if (!variableUrl) return null;
		const src = buildSrc(variableUrl);
		return [
			'@font-face {',
			`\tfont-family: '${family}';`,
			`\tsrc: ${src};`,
			'\tfont-weight: 100 900;',
			'\tfont-style: normal;',
			'\tfont-display: swap;',
			'}',
			'@font-face {',
			`\tfont-family: '${family}';`,
			`\tsrc: ${src};`,
			'\tfont-weight: 100 900;',
			'\tfont-style: italic;',
			'\tfont-display: swap;',
			'}'
		].join('\n');
	}

	const regularUrl = resolveAssetUrl(uploadedFont.files.regularPath ?? '', pathToUrl);
	const italicUrl = resolveAssetUrl(uploadedFont.files.italicPath ?? '', pathToUrl);
	const boldUrl = resolveAssetUrl(uploadedFont.files.boldPath ?? '', pathToUrl);
	const boldItalicUrl = resolveAssetUrl(uploadedFont.files.boldItalicPath ?? '', pathToUrl);
	if (!regularUrl || !italicUrl || !boldUrl || !boldItalicUrl) return null;

	return [
		'@font-face {',
		`\tfont-family: '${family}';`,
		`\tsrc: ${buildSrc(regularUrl)};`,
		'\tfont-weight: 400;',
		'\tfont-style: normal;',
		'\tfont-display: swap;',
		'}',
		'@font-face {',
		`\tfont-family: '${family}';`,
		`\tsrc: ${buildSrc(italicUrl)};`,
		'\tfont-weight: 400;',
		'\tfont-style: italic;',
		'\tfont-display: swap;',
		'}',
		'@font-face {',
		`\tfont-family: '${family}';`,
		`\tsrc: ${buildSrc(boldUrl)};`,
		'\tfont-weight: 700;',
		'\tfont-style: normal;',
		'\tfont-display: swap;',
		'}',
		'@font-face {',
		`\tfont-family: '${family}';`,
		`\tsrc: ${buildSrc(boldItalicUrl)};`,
		'\tfont-weight: 700;',
		'\tfont-style: italic;',
		'\tfont-display: swap;',
		'}'
	].join('\n');
};

export const sanitizeFontFamilyName = (value: string) =>
	value
		.replace(/["'`]+/g, '')
		.replace(/\s+/g, ' ')
		.trim();

export const normalizeFontUploadFilename = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/\.[^/.]+$/, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'font';

export const isSupportedFontFilename = (value: string) => FONT_EXTENSION_REGEX.test(value);

export const isSupportedFontMime = (value: string | null | undefined) => {
	if (!value) return false;
	const mime = value.trim().toLowerCase();
	return [
		'font/ttf',
		'font/otf',
		'font/woff',
		'font/woff2',
		'application/font-sfnt',
		'application/x-font-ttf',
		'application/x-font-opentype',
		'application/font-woff',
		'application/font-woff2',
		'application/octet-stream'
	].includes(mime);
};

export const resolveOrganisationBrandingTypography = (
	brandSettings: unknown
): OrganisationBrandingTypography => {
	const settings = isRecord(brandSettings) ? brandSettings : null;
	const typography = isRecord(settings?.typography) ? settings.typography : null;

	const mainFontKey = normalizeMainFontKey(typography?.mainFontKey);
	const uploadedFont = normalizeUploadedFont(typography?.uploadedFont);

	return {
		mainFontKey,
		uploadedFont
	};
};

export const resolveOrganisationMainFont = (
	brandSettings: unknown,
	options?: {
		pathToUrl?: (path: string) => string | null;
	}
): ResolvedOrganisationMainFont => {
	const typography = resolveOrganisationBrandingTypography(brandSettings);

	if (typography.mainFontKey !== 'uploaded') {
		const builtIn = BUILT_IN_FONT_DETAILS[typography.mainFontKey];
		return {
			mainFontKey: typography.mainFontKey,
			cssStack: builtIn.cssStack,
			fontFaceCss: null,
			family: builtIn.family
		};
	}

	if (!isUploadedFontConfigUsable(typography.uploadedFont)) {
		const fallback = BUILT_IN_FONT_DETAILS[DEFAULT_ORGANISATION_MAIN_FONT_KEY];
		return {
			mainFontKey: DEFAULT_ORGANISATION_MAIN_FONT_KEY,
			cssStack: fallback.cssStack,
			fontFaceCss: null,
			family: fallback.family
		};
	}

	const uploadedFont = typography.uploadedFont as OrganisationUploadedFontConfig;
	const cssStack = `'${escapeCssString(uploadedFont.family)}', ${SANS_STACK}`;
	const fontFaceCss = buildUploadedFontFaceCss(uploadedFont, options?.pathToUrl);
	if (!fontFaceCss) {
		const fallback = BUILT_IN_FONT_DETAILS[DEFAULT_ORGANISATION_MAIN_FONT_KEY];
		return {
			mainFontKey: DEFAULT_ORGANISATION_MAIN_FONT_KEY,
			cssStack: fallback.cssStack,
			fontFaceCss: null,
			family: fallback.family
		};
	}

	return {
		mainFontKey: 'uploaded',
		cssStack,
		fontFaceCss,
		family: uploadedFont.family
	};
};

export const mergeOrganisationBrandingTypography = (
	existingBrandSettings: unknown,
	updates: {
		mainFontKey?: OrganisationMainFontKey;
		uploadedFont?: OrganisationUploadedFontConfig | null;
	}
): Record<string, unknown> => {
	const base = isRecord(existingBrandSettings) ? { ...existingBrandSettings } : {};
	const currentTypography = isRecord(base.typography) ? { ...base.typography } : {};

	if (updates.mainFontKey) {
		currentTypography.mainFontKey = normalizeMainFontKey(updates.mainFontKey);
	}

	if (updates.uploadedFont !== undefined) {
		if (updates.uploadedFont === null) {
			delete currentTypography.uploadedFont;
		} else {
			currentTypography.uploadedFont = {
				mode: updates.uploadedFont.mode,
				family: sanitizeFontFamilyName(updates.uploadedFont.family),
				files: {
					variablePath: updates.uploadedFont.files.variablePath,
					regularPath: updates.uploadedFont.files.regularPath,
					italicPath: updates.uploadedFont.files.italicPath,
					boldPath: updates.uploadedFont.files.boldPath,
					boldItalicPath: updates.uploadedFont.files.boldItalicPath
				}
			};
		}
	}

	base.typography = currentTypography;
	return base;
};

export const getOrganisationUploadedFontPaths = (brandSettings: unknown): string[] => {
	const typography = resolveOrganisationBrandingTypography(brandSettings);
	if (!typography.uploadedFont) return [];
	const files = typography.uploadedFont.files;
	const values = [
		files.variablePath,
		files.regularPath,
		files.italicPath,
		files.boldPath,
		files.boldItalicPath
	].filter((value): value is string => Boolean(value));
	return Array.from(new Set(values));
};
