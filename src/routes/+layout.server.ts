import { clearAuthCookies } from '$lib/server/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	DEFAULT_ORGANISATION_BRANDING_THEME,
	resolveOrganisationBrandingTheme,
	type OrganisationBrandingTheme
} from '$lib/branding/theme';
import { resolveOrganisationMainFont } from '$lib/branding/font';
import type { PageMetaInput } from '$lib/seo';
import { resolveHomeOrganisationId } from '$lib/server/homeOrganisation';
import type { LayoutServerLoad } from './$types';

type Role = 'admin' | 'organisation_admin' | 'broker' | 'talent' | 'employer';

type Profile = {
	first_name: string | null;
	last_name: string | null;
	avatar_url: string | null;
};

type LoadResult = {
	user: { id: string; email?: string } | null;
	profile: Profile | null;
	role: Role | null;
	roles: Role[];
	currentTalentId: string | null;
	effectiveHomeOrganisationId: string | null;
	brandingTheme: OrganisationBrandingTheme;
	brandingFont: {
		cssStack: string;
		fontFaceCss: string | null;
	};
	meta?: PageMetaInput;
};

type ProfileCacheEntry = {
	expiresAt: number;
	value: Profile | null;
};

type BrandingCacheEntry = {
	expiresAt: number;
	value: {
		theme: OrganisationBrandingTheme;
		font: {
			cssStack: string;
			fontFaceCss: string | null;
		};
	};
};

const PROFILE_CACHE_TTL_MS = 60_000;
const BRANDING_CACHE_TTL_MS = 120_000;
const DEFAULT_MAIN_FONT = resolveOrganisationMainFont(null);

const profileCache = new Map<string, ProfileCacheEntry>();
const brandingCache = new Map<string, BrandingCacheEntry>();

const APP_META: PageMetaInput = {
	title: 'Resume Platform',
	description: 'Secure workspace for managing talents and consultant resumes.',
	noindex: true
};

const getCachedProfile = (
	userId: string,
	now: number
): { hit: true; value: Profile | null } | null => {
	const cached = profileCache.get(userId);
	if (!cached) return null;
	if (cached.expiresAt <= now) {
		profileCache.delete(userId);
		return null;
	}
	return { hit: true, value: cached.value };
};

const setCachedProfile = (userId: string, value: Profile | null, now: number) => {
	profileCache.set(userId, {
		expiresAt: now + PROFILE_CACHE_TTL_MS,
		value
	});
};

const getCachedBranding = (
	organisationId: string,
	now: number
): BrandingCacheEntry['value'] | null => {
	const cached = brandingCache.get(organisationId);
	if (!cached) return null;
	if (cached.expiresAt <= now) {
		brandingCache.delete(organisationId);
		return null;
	}
	return cached.value;
};

const setCachedBranding = (
	organisationId: string,
	value: BrandingCacheEntry['value'],
	now: number
) => {
	brandingCache.set(organisationId, {
		expiresAt: now + BRANDING_CACHE_TTL_MS,
		value
	});
};

const resolveProfile = async (payload: {
	supabase: SupabaseClient;
	adminClient: SupabaseClient | null;
	userId: string;
}) => {
	const now = Date.now();
	const cached = getCachedProfile(payload.userId, now);
	if (cached) return cached.value;

	const profileResult = await payload.supabase
		.from('user_profiles')
		.select('first_name, last_name, avatar_url')
		.eq('user_id', payload.userId)
		.maybeSingle();
	const profileData = (profileResult.data as Profile | null) ?? null;

	let avatar_url = profileData?.avatar_url ?? null;
	if (!avatar_url && payload.adminClient) {
		const { data: linkedTalent } = await payload.adminClient
			.from('talents')
			.select('avatar_url')
			.eq('user_id', payload.userId)
			.limit(1)
			.maybeSingle();
		avatar_url = (linkedTalent as { avatar_url?: string | null } | null)?.avatar_url ?? null;
	}

	const resolvedProfile = profileData
		? {
				...profileData,
				avatar_url
			}
		: null;
	setCachedProfile(payload.userId, resolvedProfile, now);
	return resolvedProfile;
};

const resolveBranding = async (payload: {
	adminClient: SupabaseClient | null;
	organisationId: string | null;
}) => {
	const fallback = {
		theme: DEFAULT_ORGANISATION_BRANDING_THEME,
		font: {
			cssStack: DEFAULT_MAIN_FONT.cssStack,
			fontFaceCss: DEFAULT_MAIN_FONT.fontFaceCss
		}
	};

	if (!payload.adminClient || !payload.organisationId) return fallback;
	const adminClient = payload.adminClient;

	const now = Date.now();
	const cached = getCachedBranding(payload.organisationId, now);
	if (cached) return cached;

	const { data: organisationRow, error: organisationError } = await adminClient
		.from('organisations')
		.select('brand_settings')
		.eq('id', payload.organisationId)
		.maybeSingle();

	if (organisationError) {
		console.warn('[layout] could not resolve organisation brand settings', organisationError);
		return fallback;
	}

	const theme = resolveOrganisationBrandingTheme(organisationRow?.brand_settings ?? null);
	const resolvedFont = resolveOrganisationMainFont(organisationRow?.brand_settings ?? null, {
		pathToUrl: (path) => {
			const normalizedPath = path.replace(/^\/+/, '').replace(/^organisation-images\//, '');
			const { data } = adminClient.storage.from('organisation-images').getPublicUrl(normalizedPath);
			return data.publicUrl ?? null;
		}
	});

	const value = {
		theme,
		font: {
			cssStack: resolvedFont.cssStack,
			fontFaceCss: resolvedFont.fontFaceCss
		}
	};
	setCachedBranding(payload.organisationId, value, now);
	return value;
};

const buildAnonymousResult = () => {
	return {
		user: null,
		profile: null,
		role: null,
		roles: [],
		currentTalentId: null,
		effectiveHomeOrganisationId: null,
		brandingTheme: DEFAULT_ORGANISATION_BRANDING_THEME,
		brandingFont: {
			cssStack: DEFAULT_MAIN_FONT.cssStack,
			fontFaceCss: DEFAULT_MAIN_FONT.fontFaceCss
		},
		meta: APP_META
	} satisfies LoadResult;
};

export const load: LayoutServerLoad = async ({ cookies, locals }) => {
	const requestContext = locals.requestContext;
	const accessToken = requestContext.accessToken;

	if (!accessToken) {
		return buildAnonymousResult();
	}

	const supabase = requestContext.getSupabaseClient();
	if (!supabase) {
		clearAuthCookies(cookies);
		return buildAnonymousResult();
	}

	try {
		const authUser = await requestContext.getAuthenticatedUser();
		if (!authUser) {
			clearAuthCookies(cookies);
			return buildAnonymousResult();
		}
		if (authUser.app_metadata?.active === false) {
			clearAuthCookies(cookies);
			return buildAnonymousResult();
		}

		const userId = authUser.id;
		const actorContext = await requestContext.getActorContext();
		const roles = actorContext.roles as Role[];
		const effectiveRoles: Role[] = roles.length > 0 ? roles : ['talent'];
		const primaryRole = (actorContext.primaryRole as Role | null) ?? effectiveRoles[0] ?? 'talent';
		const adminClient = requestContext.getAdminClient();
		const homeOrganisationId = await resolveHomeOrganisationId({
			adminClient,
			homeOrganisationId: actorContext.homeOrganisationId,
			talentId: actorContext.talentId
		});
		const [profile, branding] = await Promise.all([
			resolveProfile({ supabase, adminClient, userId }),
			resolveBranding({
				adminClient,
				organisationId: homeOrganisationId
			})
		]);

		return {
			user: { id: userId, email: authUser.email ?? undefined },
			profile,
			role: primaryRole,
			roles: effectiveRoles,
			currentTalentId: actorContext.talentId,
			effectiveHomeOrganisationId: homeOrganisationId,
			brandingTheme: branding.theme,
			brandingFont: branding.font,
			meta: APP_META
		} satisfies LoadResult;
	} catch {
		clearAuthCookies(cookies);
		return buildAnonymousResult();
	}
};
