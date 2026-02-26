import { redirect, type LayoutServerLoad } from '@sveltejs/kit';
import type { PostgrestError } from '@supabase/supabase-js';
import {
	AUTH_COOKIE_NAMES,
	clearAuthCookies,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import type { PageMetaInput } from '$lib/seo';

type Role = 'admin' | 'cms_admin' | 'employee' | 'employer';

type Profile = {
	first_name: string | null;
	last_name: string | null;
};

type LoadResult = {
	user: { id: string; email?: string } | null;
	profile: Profile | null;
	role: Role | null;
	roles: Role[];
	meta?: PageMetaInput;
};

const normalizePath = (pathname: string) => pathname.replace(/\/$/, '') || '/';

const isPublicPagePath = (pathname: string) =>
	pathname === '/login' || pathname === '/reset-password' || pathname.startsWith('/print/');

const roleGuards: Array<{ pattern: RegExp; roles: Role[] }> = [
	{ pattern: /^\/$/, roles: ['admin', 'cms_admin', 'employee', 'employer'] },
	{ pattern: /^\/users(\/.*)?$/, roles: ['admin', 'employer'] },
	{ pattern: /^\/employees(\/.*)?$/, roles: ['admin', 'employer', 'employee'] },
	{ pattern: /^\/resumes(\/.*)?$/, roles: ['admin', 'cms_admin', 'employee', 'employer'] }
];

const normalizeRole = (role: string | null | undefined): Role | null => {
	if (!role) return null;
	const value = role.toLowerCase().replace(/\s+/g, '_');

	switch (value) {
		case 'admin':
			return 'admin';
		case 'cms_admin':
		case 'cms-admin':
		case 'cmsadmin':
			return 'cms_admin';
		case 'employee':
		case 'employees':
			return 'employee';
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

	if (roles.includes('employee') || roles.includes('employer')) {
		return '/';
	}

	return '/?unauthorized=1';
};

const appMeta = (pathname: string): PageMetaInput => ({
	title: 'Resume Platform',
	description: 'Secure workspace for managing employees and consultant resumes.',
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
				meta: appMeta(pathname)
			} satisfies LoadResult;
		}

		const redirectParam = encodeURIComponent(pathname);
		throw redirect(303, `/login?redirect=${redirectParam}`);
	}

	// Let /login and /reset-password render, their own route loads handle redirect behavior.
	if (isPublicPagePath(pathname)) {
		return {
			user: null,
			profile: null,
			role: null,
			roles: [],
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

		const [{ data: profileData }, rolesResult] = await Promise.all([
			supabase.from('profiles').select('first_name, last_name').eq('id', userId).maybeSingle(),
			(async () => {
				if (!adminClient) {
					const fallbackError: PostgrestError = {
						message: 'Admin client unavailable',
						details: null,
						hint: null,
						code: 'PGRST'
					};
					return { data: null, error: fallbackError };
				}

				return adminClient.from('user_roles').select('role, user_id').eq('user_id', userId);
			})()
		]);

		const roleRows = (rolesResult.data as { role: string }[] | null) ?? [];
		const rolesFromTable = roleRows
			.map((row) => normalizeRole(row.role))
			.filter(Boolean) as Role[];

		let roles = rolesFromTable;
		if (roles.length === 0) {
			const appRolesNormalized = (
				Array.isArray(userData.user.app_metadata?.roles)
					? (userData.user.app_metadata?.roles as string[])
					: []
			)
				.map((r) => normalizeRole(r))
				.filter(Boolean) as Role[];

			if (appRolesNormalized.length > 0) {
				roles = appRolesNormalized;
			} else if (typeof userData.user.app_metadata?.role === 'string') {
				const normalizedRole = normalizeRole(userData.user.app_metadata.role);
				if (normalizedRole) roles = [normalizedRole];
			}
		}

		roles = Array.from(new Set(roles));
		const primaryRole = (roles[0] as Role | undefined) ?? 'employee';
		const effectiveRoles = roles.length ? roles : ['employee'];
		const redirectTo = guardRoute(pathname, effectiveRoles);

		if (redirectTo) throw redirect(303, redirectTo);

		return {
			user: { id: userId, email: userData.user.email ?? undefined },
			profile: (profileData as Profile | null) ?? null,
			role: primaryRole,
			roles: effectiveRoles,
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
