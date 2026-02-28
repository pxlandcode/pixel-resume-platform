export const BRANDING_MODES = ['light', 'dark'] as const;
export type OrganisationBrandingMode = (typeof BRANDING_MODES)[number];

export const BRANDING_COLOR_KEYS = [
	'primary',
	'background',
	'foreground',
	'text',
	'secondaryText',
	'card',
	'cardForeground',
	'border',
	'input',
	'muted',
	'mutedForeground'
] as const;
export type OrganisationBrandingColorKey = (typeof BRANDING_COLOR_KEYS)[number];

export type OrganisationBrandingPalette = Record<OrganisationBrandingColorKey, string>;

export type OrganisationBrandingTheme = Record<
	OrganisationBrandingMode,
	OrganisationBrandingPalette
>;

const DEFAULT_LIGHT_PALETTE: OrganisationBrandingPalette = {
	primary: '#E76F51',
	background: '#F6F8FB',
	foreground: '#0F172A',
	text: '#0F172A',
	secondaryText: '#2E333A',
	card: '#FFFFFF',
	cardForeground: '#0F172A',
	border: '#E2E8F0',
	input: '#FFFFFF',
	muted: '#EDF2F7',
	mutedForeground: '#2e333a'
};

const DEFAULT_DARK_PALETTE: OrganisationBrandingPalette = {
	primary: '#E76F51',
	background: '#0F0F11',
	foreground: '#F5F6F8',
	text: '#F0F0F0',
	secondaryText: '#94A3B8',
	card: '#121316',
	cardForeground: '#F5F6F8',
	border: '#334155',
	input: '#18191B',
	muted: '#1F2937',
	mutedForeground: '#94A3B8'
};

export const DEFAULT_ORGANISATION_BRANDING_THEME: OrganisationBrandingTheme = {
	light: DEFAULT_LIGHT_PALETTE,
	dark: DEFAULT_DARK_PALETTE
};

const COLOR_ALIASES: Record<OrganisationBrandingColorKey, string[]> = {
	primary: ['primary', 'colorPrimary', '--color-primary'],
	background: ['background', 'colorBackground', '--color-background'],
	foreground: ['foreground', 'colorForeground', '--color-foreground'],
	text: ['text', 'colorText', '--color-text'],
	secondaryText: [
		'secondaryText',
		'secondary',
		'colorSecondaryText',
		'--color-secondary-text',
		'--color-secondary'
	],
	card: ['card', 'cardBg', 'colorCard', '--color-card', '--color-card-bg'],
	cardForeground: ['cardForeground', 'colorCardForeground', '--color-card-fg'],
	border: ['border', 'cardBorder', 'colorBorder', '--color-border', '--color-card-border'],
	input: ['input', 'colorInput', '--color-input'],
	muted: ['muted', 'colorMuted', '--color-muted'],
	mutedForeground: ['mutedForeground', 'colorMutedForeground', '--color-muted-fg']
};

const CSS_SUFFIX_BY_KEY: Record<OrganisationBrandingColorKey, string> = {
	primary: 'primary',
	background: 'background',
	foreground: 'foreground',
	text: 'text',
	secondaryText: 'secondary-text',
	card: 'card',
	cardForeground: 'card-fg',
	border: 'border',
	input: 'input',
	muted: 'muted',
	mutedForeground: 'muted-fg'
};

const HEX_SHORT = /^#([0-9a-f]{3})$/i;
const HEX_LONG = /^#([0-9a-f]{6})$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const clonePalette = (palette: OrganisationBrandingPalette): OrganisationBrandingPalette => ({
	...palette
});

export const normalizeHexColor = (value: string | null | undefined): string | null => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;

	if (HEX_LONG.test(trimmed)) {
		return trimmed.toUpperCase();
	}

	const shortMatch = trimmed.match(HEX_SHORT);
	if (!shortMatch) return null;
	const [r, g, b] = shortMatch[1].split('');
	return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
};

const readColorFromRecord = (
	record: Record<string, unknown> | null,
	key: OrganisationBrandingColorKey
): string | null => {
	if (!record) return null;
	for (const alias of COLOR_ALIASES[key]) {
		const value = record[alias];
		if (typeof value !== 'string') continue;
		const normalized = normalizeHexColor(value);
		if (normalized) return normalized;
	}
	return null;
};

const resolvePalette = (
	value: unknown,
	fallback: OrganisationBrandingPalette
): OrganisationBrandingPalette => {
	const paletteRecord = isRecord(value) ? value : null;
	const palette = clonePalette(fallback);
	for (const key of BRANDING_COLOR_KEYS) {
		const color = readColorFromRecord(paletteRecord, key);
		if (color) palette[key] = color;
	}
	return palette;
};

export const resolveOrganisationBrandingTheme = (
	brandSettings: unknown
): OrganisationBrandingTheme => {
	const settings = isRecord(brandSettings) ? brandSettings : null;
	const settingsTheme = isRecord(settings?.theme) ? settings.theme : null;

	const lightSource = settingsTheme?.light ?? settings?.light ?? settings;
	const darkSource = settingsTheme?.dark ?? settings?.dark ?? null;

	return {
		light: resolvePalette(lightSource, DEFAULT_ORGANISATION_BRANDING_THEME.light),
		dark: resolvePalette(darkSource, DEFAULT_ORGANISATION_BRANDING_THEME.dark)
	};
};

export const parseOrganisationBrandingThemeFormData = (
	formData: FormData,
	fallbackTheme: OrganisationBrandingTheme = DEFAULT_ORGANISATION_BRANDING_THEME
): OrganisationBrandingTheme => {
	const parsed: OrganisationBrandingTheme = {
		light: clonePalette(fallbackTheme.light),
		dark: clonePalette(fallbackTheme.dark)
	};

	for (const mode of BRANDING_MODES) {
		for (const key of BRANDING_COLOR_KEYS) {
			const fieldName = `theme_${mode}_${key}`;
			const rawValue = formData.get(fieldName);
			if (typeof rawValue !== 'string') continue;

			const normalized = normalizeHexColor(rawValue);
			if (!normalized) {
				throw new Error(`Invalid ${mode} ${key} color.`);
			}

			parsed[mode][key] = normalized;
		}
	}

	return parsed;
};

export const mergeOrganisationBrandingTheme = (
	existingBrandSettings: unknown,
	theme: OrganisationBrandingTheme
): Record<string, unknown> => {
	const base = isRecord(existingBrandSettings) ? { ...existingBrandSettings } : {};
	base.theme = {
		light: { ...theme.light },
		dark: { ...theme.dark }
	};
	return base;
};

export const organisationBrandingThemeToVarEntries = (
	theme: OrganisationBrandingTheme
): Array<[name: string, value: string]> =>
	BRANDING_MODES.flatMap((mode) =>
		BRANDING_COLOR_KEYS.map((key): [string, string] => [
			`--org-${mode}-${CSS_SUFFIX_BY_KEY[key]}`,
			theme[mode][key]
		])
	);

export const organisationBrandingThemeToInlineStyle = (theme: OrganisationBrandingTheme): string =>
	organisationBrandingThemeToVarEntries(theme)
		.map(([name, value]) => `${name}: ${value}`)
		.join('; ');
