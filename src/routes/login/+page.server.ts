import { fail, redirect, type Actions, type PageServerLoad } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '$env/static/private';
import { AUTH_COOKIE_NAMES, createSupabaseServerClient } from '$lib/server/supabase';
import { dev } from '$app/environment';

const cookieOptions = {
	path: '/',
	httpOnly: true,
	sameSite: 'lax' as const,
	secure: !dev
};

const isAllowedAppRedirect = (value: unknown): value is string =>
	typeof value === 'string' &&
	/^\/(?:$|users(?:\/.*)?$|employees(?:\/.*)?$|resumes(?:\/.*)?$)/.test(value);

export const load: PageServerLoad = async ({ cookies }) => {
	const accessToken = cookies.get(AUTH_COOKIE_NAMES.access) ?? null;
	if (!accessToken) return {};

	const supabase = createSupabaseServerClient(accessToken);
	if (!supabase) return {};

	const { data, error } = await supabase.auth.getUser();
	if (!error && data.user && data.user.app_metadata?.active !== false) {
		throw redirect(303, '/');
	}

	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const formData = await request.formData();
		const email = formData.get('email');
		const password = formData.get('password');
		const redirectTo = formData.get('redirectTo');

		if (typeof email !== 'string' || typeof password !== 'string') {
			return fail(400, { message: 'Email and password are required.' });
		}

		const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
			auth: {
				persistSession: false,
				autoRefreshToken: false
			}
		});

		const { data, error } = await supabase.auth.signInWithPassword({ email, password });

		if (error || !data.session || data.user?.app_metadata?.active === false) {
			const message =
				data.user?.app_metadata?.active === false
					? 'Account is inactive. Contact an administrator.'
					: (error?.message ?? 'Unable to sign in.');
			return fail(400, { message });
		}

		const { session } = data;

		cookies.set(AUTH_COOKIE_NAMES.access, session.access_token, {
			...cookieOptions,
			maxAge: session.expires_in
		});

		cookies.set(AUTH_COOKIE_NAMES.refresh, session.refresh_token, {
			...cookieOptions,
			maxAge: 60 * 60 * 24 * 30
		});

		const destination = isAllowedAppRedirect(redirectTo) ? redirectTo : '/';

		throw redirect(303, destination);
	}
};
