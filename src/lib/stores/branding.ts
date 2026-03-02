import { writable } from 'svelte/store';
import {
	DEFAULT_ORGANISATION_BRANDING_THEME,
	resolveOrganisationBrandingTheme,
	type OrganisationBrandingTheme
} from '$lib/branding/theme';

export const DEFAULT_BRANDING_FONT_STACK =
	"'Inter', 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif";

export type BrandingFontState = {
	cssStack: string;
	fontFaceCss: string | null;
};

export type BrandingState = {
	hydrated: boolean;
	theme: OrganisationBrandingTheme;
	font: BrandingFontState;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeBrandingFont = (value: unknown): BrandingFontState => {
	if (!isRecord(value)) {
		return {
			cssStack: DEFAULT_BRANDING_FONT_STACK,
			fontFaceCss: null
		};
	}

	const cssStack =
		typeof value.cssStack === 'string' && value.cssStack.trim().length > 0
			? value.cssStack
			: DEFAULT_BRANDING_FONT_STACK;
	const fontFaceCss =
		typeof value.fontFaceCss === 'string' && value.fontFaceCss.trim().length > 0
			? value.fontFaceCss
			: null;

	return {
		cssStack,
		fontFaceCss
	};
};

const initialState: BrandingState = {
	hydrated: false,
	theme: DEFAULT_ORGANISATION_BRANDING_THEME,
	font: {
		cssStack: DEFAULT_BRANDING_FONT_STACK,
		fontFaceCss: null
	}
};

function createBrandingStore() {
	const { subscribe, set } = writable<BrandingState>(initialState);

	const setFromLayoutData = (payload: { brandingTheme?: unknown; brandingFont?: unknown }) => {
		set({
			hydrated: true,
			theme: resolveOrganisationBrandingTheme(payload.brandingTheme ?? null),
			font: normalizeBrandingFont(payload.brandingFont)
		});
	};

	const reset = () => {
		set(initialState);
	};

	return {
		subscribe,
		setFromLayoutData,
		reset
	};
}

export const brandingStore = createBrandingStore();
