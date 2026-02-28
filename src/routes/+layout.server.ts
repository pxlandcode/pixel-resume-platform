import { redirect } from '@sveltejs/kit';
import {
	AUTH_COOKIE_NAMES,
	clearAuthCookies,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import {
	DEFAULT_ORGANISATION_BRANDING_THEME,
	resolveOrganisationBrandingTheme,
	type OrganisationBrandingTheme
} from '$lib/branding/theme';
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
	meta?: PageMetaInput;
};

const normalizePath = (pathname: string) => pathname.replace(/\/$/, '') || '/';

const isPublicPagePath = (pathname: string) =>
	pathname === '/login' || pathname === '/reset-password' || pathname.startsWith('/print/');

const roleGuards: Array<{ pattern: RegExp; roles: Role[] }> = [
	{ pattern: /^\/$/, roles: ['admin', 'broker', 'talent', 'employer'] },
	{ pattern: /^\/users(\/.*)?$/, roles: ['admin', 'broker', 'employer'] },
	{ pattern: /^\/organisations(\/.*)?$/, roles: ['admin'] },
	{ pattern: /^\/talents(\/.*)?$/, roles: ['admin', 'broker', 'talent', 'employer'] },
	{ pattern: /^\/resumes(\/.*)?$/, roles: ['admin', 'broker', 'talent', 'employer'] }
];

const normalizeRolesFromJoin = (
	rows: Array<{ roles?: { key?: string | null } | Array<{ key?: string | null }> | null }>
): Role[] =>
	rows
		.flatMap((row) => {
			if (Array.isArray(row.roles)) {
				return row.roles
					.map((roleRow) => normalizeRole(roleRow?.key))
					.filter((value): value is Role => value !== null);
			}
			const role = normalizeRole(row.roles?.key);
			return role ? [role] : [];
		})
		.filter((value, index, all) => all.indexOf(value) === index);

const normalizeRole = (role: string | null | undefined): Role | null => {
	if (!role) return null;
	const value = role.toLowerCase().replace(/\s+/g, '_');

	switch (value) {
		case 'admin':
			return 'admin';
		case 'broker':
			return 'broker';
		case 'talent':
			return 'talent';
		case 'employer':
		case 'employers':
			return 'employer';
		default:
			return null;
	}
};

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

export const load: LayoutServerLoad = async ({ cookies, url }) => {
	const pathname = normalizePath(url.pathname);
	const accessToken = cookies.get(AUTH_COOKIE_NAMES.access) ?? null;

	if (!accessToken) {
		if (isPublicPagePath(pathname)) {
			return {
				user: null,
				profile: null,
				role: null,
				roles: [],
				currentTalentId: null,
				brandingTheme: DEFAULT_ORGANISATION_BRANDING_THEME,
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
			meta: appMeta(pathname)
		} satisfies LoadResult;
	}

	const supabase = createSupabaseServerClient(accessToken);
	if (!supabase) {
		clearAuthCookies(cookies);
		throw redirect(303, '/login');
	}

	try {
		const { data: userData, error: userError } = await supabase.auth.getUser();

		if (userError || !userData.user) {
			clearAuthCookies(cookies);
			throw redirect(303, '/login');
		}

		const userId = userData.user.id;
		if (userData.user.app_metadata?.active === false) {
			clearAuthCookies(cookies);
			throw redirect(303, '/login?inactive=1');
		}

		const adminClient = getSupabaseAdminClient();

		const [{ data: profileData }, roleResult, talentResult, homeOrgResult] = await Promise.all([
			supabase
				.from('user_profiles')
				.select('first_name, last_name')
				.eq('user_id', userId)
				.maybeSingle(),
			adminClient
				? adminClient.from('user_roles').select('roles(key)').eq('user_id', userId)
				: Promise.resolve({ data: null, error: null }),
			supabase.from('talents').select('id').eq('user_id', userId).maybeSingle(),
			adminClient
				? adminClient
						.from('organisation_users')
						.select('organisation_id')
						.eq('user_id', userId)
						.order('updated_at', { ascending: false })
						.order('created_at', { ascending: false })
						.limit(1)
						.maybeSingle()
				: Promise.resolve({ data: null, error: null })
		]);

		if (roleResult.error) {
			console.warn('[layout] could not load user roles', roleResult.error);
		}
		if (homeOrgResult.error) {
			console.warn('[layout] could not load home organisation branding', homeOrgResult.error);
		}

		const roleRows =
			(roleResult.data as Array<{
				roles?: { key?: string | null } | Array<{ key?: string | null }> | null;
			}> | null) ?? [];
		const rolesFromTable = normalizeRolesFromJoin(roleRows);

		let roles = rolesFromTable;
		if (roles.length === 0) {
			const appRolesNormalized = (
				Array.isArray(userData.user.app_metadata?.roles)
					? (userData.user.app_metadata?.roles as string[])
					: []
			)
				.map((value) => normalizeRole(value))
				.filter(Boolean) as Role[];

			if (appRolesNormalized.length > 0) {
				roles = appRolesNormalized;
			} else if (typeof userData.user.app_metadata?.role === 'string') {
				const normalizedRole = normalizeRole(userData.user.app_metadata.role);
				if (normalizedRole) roles = [normalizedRole];
			}
		}

		roles = Array.from(new Set(roles));
		const primaryRole = (roles[0] as Role | undefined) ?? 'talent';
		const effectiveRoles: Role[] = roles.length ? roles : ['talent'];
		const redirectTo = guardRoute(pathname, effectiveRoles);

		if (redirectTo) throw redirect(303, redirectTo);

			const currentTalentId =
				talentResult.data && typeof talentResult.data.id === 'string' ? talentResult.data.id : null;
			let homeOrganisationId = homeOrgResult.data?.organisation_id ?? null;
			let brandingTheme = DEFAULT_ORGANISATION_BRANDING_THEME;

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
			}
		}

		return {
			user: { id: userId, email: userData.user.email ?? undefined },
			profile: (profileData as Profile | null) ?? null,
			role: primaryRole,
			roles: effectiveRoles,
			currentTalentId,
			brandingTheme,
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
