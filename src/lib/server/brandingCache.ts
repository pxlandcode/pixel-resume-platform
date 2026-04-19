import type { OrganisationBrandingTheme } from '$lib/branding/theme';

export type BrandingCacheValue = {
	theme: OrganisationBrandingTheme;
	font: {
		cssStack: string;
		fontFaceCss: string | null;
	};
};

type BrandingCacheEntry = {
	expiresAt: number;
	value: BrandingCacheValue;
};

const brandingCache = new Map<string, BrandingCacheEntry>();

export const getCachedBranding = (
	organisationId: string,
	now: number
): BrandingCacheValue | null => {
	const cached = brandingCache.get(organisationId);
	if (!cached) return null;
	if (cached.expiresAt <= now) {
		brandingCache.delete(organisationId);
		return null;
	}
	return cached.value;
};

export const setCachedBranding = (
	organisationId: string,
	value: BrandingCacheValue,
	now: number,
	ttlMs: number
) => {
	brandingCache.set(organisationId, {
		expiresAt: now + ttlMs,
		value
	});
};

export const invalidateOrganisationBrandingCache = (organisationId: string | null | undefined) => {
	if (!organisationId) return;
	brandingCache.delete(organisationId);
};
