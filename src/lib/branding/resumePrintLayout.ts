export type ResumePrintLayout = {
	firstPageAccentLogoScale: number;
	lastPageAccentLogoScale: number;
	endLogoScale: number;
	showLastPageAccentLogo: boolean;
};

export const RESUME_PRINT_LAYOUT_LIMITS = {
	firstPageAccentLogoScale: { min: 0.75, max: 1.6, step: 0.05 },
	lastPageAccentLogoScale: { min: 0.75, max: 1.6, step: 0.05 },
	endLogoScale: { min: 0.75, max: 1.8, step: 0.05 }
} as const;

export const DEFAULT_RESUME_PRINT_LAYOUT: ResumePrintLayout = {
	firstPageAccentLogoScale: 1,
	lastPageAccentLogoScale: 1,
	endLogoScale: 1,
	showLastPageAccentLogo: true
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const parseFiniteNumber = (value: unknown): number | null => {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value !== 'string') return null;
	const parsed = Number.parseFloat(value.trim().replace(',', '.'));
	return Number.isFinite(parsed) ? parsed : null;
};

const normalizeNumber = (value: unknown, fallback: number, limits: { min: number; max: number }) =>
	clamp(parseFiniteNumber(value) ?? fallback, limits.min, limits.max);

const normalizeBoolean = (value: unknown, fallback: boolean) => {
	if (typeof value === 'boolean') return value;
	if (typeof value !== 'string') return fallback;
	const normalized = value.trim().toLowerCase();
	if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
	if (['false', '0', 'no', 'off'].includes(normalized)) return false;
	return fallback;
};

const getLayoutSource = (value: unknown): Record<string, unknown> | null => {
	if (!isRecord(value)) return null;
	const nested = value.resumePrintLayout;
	if (isRecord(nested)) return nested;
	return value;
};

export const resolveResumePrintLayout = (value: unknown): ResumePrintLayout => {
	const source = getLayoutSource(value);
	if (!source) return { ...DEFAULT_RESUME_PRINT_LAYOUT };

	return {
		firstPageAccentLogoScale: normalizeNumber(
			source.firstPageAccentLogoScale,
			DEFAULT_RESUME_PRINT_LAYOUT.firstPageAccentLogoScale,
			RESUME_PRINT_LAYOUT_LIMITS.firstPageAccentLogoScale
		),
		lastPageAccentLogoScale: normalizeNumber(
			source.lastPageAccentLogoScale,
			DEFAULT_RESUME_PRINT_LAYOUT.lastPageAccentLogoScale,
			RESUME_PRINT_LAYOUT_LIMITS.lastPageAccentLogoScale
		),
		endLogoScale: normalizeNumber(
			source.endLogoScale,
			DEFAULT_RESUME_PRINT_LAYOUT.endLogoScale,
			RESUME_PRINT_LAYOUT_LIMITS.endLogoScale
		),
		showLastPageAccentLogo: normalizeBoolean(
			source.showLastPageAccentLogo,
			DEFAULT_RESUME_PRINT_LAYOUT.showLastPageAccentLogo
		)
	};
};

export const parseResumePrintLayoutFormData = (
	formData: FormData,
	fallback: ResumePrintLayout = DEFAULT_RESUME_PRINT_LAYOUT
): ResumePrintLayout => ({
	firstPageAccentLogoScale: normalizeNumber(
		formData.get('resume_print_first_page_accent_logo_scale'),
		fallback.firstPageAccentLogoScale,
		RESUME_PRINT_LAYOUT_LIMITS.firstPageAccentLogoScale
	),
	lastPageAccentLogoScale: normalizeNumber(
		formData.get('resume_print_last_page_accent_logo_scale'),
		fallback.lastPageAccentLogoScale,
		RESUME_PRINT_LAYOUT_LIMITS.lastPageAccentLogoScale
	),
	endLogoScale: normalizeNumber(
		formData.get('resume_print_end_logo_scale'),
		fallback.endLogoScale,
		RESUME_PRINT_LAYOUT_LIMITS.endLogoScale
	),
	showLastPageAccentLogo: normalizeBoolean(
		formData.get('resume_print_show_last_page_accent_logo'),
		fallback.showLastPageAccentLogo
	)
});

export const mergeResumePrintLayoutIntoTemplateJson = (
	templateJson: unknown,
	layout: ResumePrintLayout
): Record<string, unknown> => {
	const base = isRecord(templateJson) ? { ...templateJson } : {};
	base.resumePrintLayout = { ...layout };
	return base;
};

const formatNumber = (value: number) =>
	Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');

export const resumePrintLayoutToInlineStyle = (layout: ResumePrintLayout): string =>
	[
		`--resume-first-page-accent-logo-scale: ${formatNumber(layout.firstPageAccentLogoScale)}`,
		`--resume-last-page-accent-logo-scale: ${formatNumber(layout.lastPageAccentLogoScale)}`,
		`--resume-end-logo-scale: ${formatNumber(layout.endLogoScale)}`
	].join('; ');
