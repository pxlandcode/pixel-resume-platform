import { redirect } from '@sveltejs/kit';
import { clearAuthCookies } from '$lib/server/supabase';
import {
	DEFAULT_ORGANISATION_BRANDING_THEME,
	resolveOrganisationBrandingTheme,
	type OrganisationBrandingTheme
} from '$lib/branding/theme';
import { resolveOrganisationMainFont } from '$lib/branding/font';
import {
	isLegalExemptPath,
	normalizeSafeRedirect,
	resolveLegalAcceptanceState
} from '$lib/server/legalGate';
import type { PageMetaInput } from '$lib/seo';
import type { LayoutServerLoad } from './$types';

type Role = 'admin' | 'broker' | 'talent' | 'employer';

type Profile = {
	first_name: string | null;
	last_name: string | null;
};

type LoadResult = {
	user: { id: string; email?: string } | null;
	profile: Profile | null;
	role: Role | null;
	roles: Role[];
	currentTalentId: string | null;
	brandingTheme: OrganisationBrandingTheme;
	brandingFont: {
		cssStack: string;
		fontFaceCss: string | null;
	};
	meta?: PageMetaInput;
};
const DATA_CACHE_CONTROL = 'private, max-age=20, stale-while-revalidate=60';

const normalizePath = (pathname: string) => pathname.replace(/\/$/, '') || '/';

const isPublicPagePath = (pathname: string) =>
	pathname === '/login' || pathname === '/reset-password' || pathname.startsWith('/print/');

const roleGuards: Array<{ pattern: RegExp; roles: Role[] }> = [
	{ pattern: /^\/$/, roles: ['admin', 'broker', 'talent', 'employer'] },
	{ pattern: /^\/users(\/.*)?$/, roles: ['admin', 'broker', 'employer'] },
	{ pattern: /^\/organisations(\/.*)?$/, roles: ['admin'] },
	{ pattern: /^\/settings(\/.*)?$/, roles: ['admin'] },
	{ pattern: /^\/talents(\/.*)?$/, roles: ['admin', 'broker', 'talent', 'employer'] },
	{ pattern: /^\/resumes(\/.*)?$/, roles: ['admin', 'broker', 'talent', 'employer'] }
];

const guardRoute = (pathname: string, roles: Role[]): string | null => {
	const match = roleGuards.find((guard) => guard.pattern.test(pathname));
	if (!match) return null;

	const allowed = roles.some((role) => match.roles.includes(role));
	if (allowed) return null;

	if (roles.includes('talent') || roles.includes('employer')) {
		return '/';
	}

	return '/?unauthorized=1';
};

const appMeta = (pathname: string): PageMetaInput => ({
	title: 'Resume Platform',
	description: 'Secure workspace for managing talents and consultant resumes.',
	path: pathname,
	noindex: true
});

export const load: LayoutServerLoad = async ({ cookies, url, locals, setHeaders }) => {
	const pathname = normalizePath(url.pathname);
	const requestContext = locals.requestContext;
	const accessToken = requestContext.accessToken;
	const defaultMainFont = resolveOrganisationMainFont(null);

	if (!accessToken) {
		if (isPublicPagePath(pathname)) {
			return {
				user: null,
				profile: null,
				role: null,
				roles: [],
				currentTalentId: null,
				brandingTheme: DEFAULT_ORGANISATION_BRANDING_THEME,
				brandingFont: {
					cssStack: defaultMainFont.cssStack,
					fontFaceCss: defaultMainFont.fontFaceCss
				},
				meta: appMeta(pathname)
			} satisfies LoadResult;
		}

		const redirectParam = encodeURIComponent(pathname);
		throw redirect(303, `/login?redirect=${redirectParam}`);
	}

	if (isPublicPagePath(pathname)) {
		return {
			user: null,
			profile: null,
			role: null,
			roles: [],
			currentTalentId: null,
			brandingTheme: DEFAULT_ORGANISATION_BRANDING_THEME,
			brandingFont: {
				cssStack: defaultMainFont.cssStack,
				fontFaceCss: defaultMainFont.fontFaceCss
			},
			meta: appMeta(pathname)
		} satisfies LoadResult;
	}

	const supabase = requestContext.getSupabaseClient();
	if (!supabase) {
		clearAuthCookies(cookies);
		throw redirect(303, '/login');
	}
	setHeaders({
		'cache-control': DATA_CACHE_CONTROL,
		vary: 'cookie'
	});

	try {
		const authUser = await requestContext.getAuthenticatedUser();
		if (!authUser) {
			clearAuthCookies(cookies);
			throw redirect(303, '/login');
		}

		const userId = authUser.id;
		if (authUser.app_metadata?.active === false) {
			clearAuthCookies(cookies);
			throw redirect(303, '/login?inactive=1');
		}

		const adminClient = requestContext.getAdminClient();
		const [profileResult, actorContext] = await Promise.all([
			supabase
				.from('user_profiles')
				.select('first_name, last_name')
				.eq('user_id', userId)
				.maybeSingle(),
			requestContext.getActorContext()
		]);
		const profileData = profileResult.data;
		const roles = actorContext.roles as Role[];
		const effectiveRoles: Role[] = roles.length > 0 ? roles : ['talent'];
		const primaryRole = (actorContext.primaryRole as Role | null) ?? effectiveRoles[0] ?? 'talent';
		const currentTalentId = actorContext.talentId;
		let homeOrganisationId = actorContext.homeOrganisationId;
		let brandingTheme = DEFAULT_ORGANISATION_BRANDING_THEME;
		let brandingFont = defaultMainFont;

		if (!homeOrganisationId && adminClient && currentTalentId) {
			const { data: talentHomeRow, error: talentHomeError } = await adminClient
				.from('organisation_talents')
				.select('organisation_id')
				.eq('talent_id', currentTalentId)
				.order('updated_at', { ascending: false })
				.order('created_at', { ascending: false })
				.limit(1)
				.maybeSingle();
			if (talentHomeError) {
				console.warn(
					'[layout] could not resolve home organisation from talent membership',
					talentHomeError
				);
			} else {
				homeOrganisationId = talentHomeRow?.organisation_id ?? null;
			}
		}

		if (adminClient && !isLegalExemptPath(pathname)) {
			const legalState = await resolveLegalAcceptanceState({
				adminClient,
				userId,
				homeOrganisationId
			});

			homeOrganisationId = legalState.homeOrganisationId;
			if (!legalState.homeOrganisationId || !legalState.status?.hasAcceptedCurrent) {
				const destination = normalizeSafeRedirect(`${url.pathname}${url.search}`, '/');
				throw redirect(303, `/legal/accept?redirect=${encodeURIComponent(destination)}`);
			}
		}

		const redirectTo = guardRoute(pathname, effectiveRoles);
		if (redirectTo) throw redirect(303, redirectTo);

		if (adminClient && homeOrganisationId) {
			const { data: organisationRow, error: organisationError } = await adminClient
				.from('organisations')
				.select('brand_settings')
				.eq('id', homeOrganisationId)
				.maybeSingle();
			if (organisationError) {
				console.warn('[layout] could not resolve organisation brand settings', organisationError);
			} else {
				brandingTheme = resolveOrganisationBrandingTheme(organisationRow?.brand_settings ?? null);
				brandingFont = resolveOrganisationMainFont(organisationRow?.brand_settings ?? null, {
					pathToUrl: (path) => {
						if (!adminClient) return null;
						const normalizedPath = path.replace(/^\/+/, '').replace(/^organisation-images\//, '');
						const { data } = adminClient.storage
							.from('organisation-images')
							.getPublicUrl(normalizedPath);
						return data.publicUrl ?? null;
					}
				});
			}
		}

		return {
			user: { id: userId, email: authUser.email ?? undefined },
			profile: (profileData as Profile | null) ?? null,
			role: primaryRole,
			roles: effectiveRoles,
			currentTalentId,
			brandingTheme,
			brandingFont: {
				cssStack: brandingFont.cssStack,
				fontFaceCss: brandingFont.fontFaceCss
			},
			meta: appMeta(pathname)
		} satisfies LoadResult;
	} catch (error) {
		if (error && typeof error === 'object' && 'status' in error && 'location' in error) {
			throw error;
		}

		clearAuthCookies(cookies);
		throw redirect(303, '/login');
	}
};
