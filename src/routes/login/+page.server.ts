import { fail, redirect } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import {
	createSupabaseServerClient,
	AUTH_COOKIE_NAMES,
	createSupabaseMicrosoftOAuthClient,
	getSupabasePublishableKey,
	getSupabaseUrl,
	setAuthCookies
} from '$lib/server/supabase';
import { normalizeAppRedirect, resolvePublicOrigin } from '$lib/server/authRedirect';
import type { Actions, PageServerLoad } from './$types';

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
	password: async ({ request, cookies }) => {
		const formData = await request.formData();
		const email = formData.get('email');
		const password = formData.get('password');
		const redirectTo = formData.get('redirectTo');

		if (typeof email !== 'string' || typeof password !== 'string') {
			return fail(400, { message: 'Email and password are required.' });
		}

		const supabaseUrl = getSupabaseUrl();
		const publishableKey = getSupabasePublishableKey();
		if (!supabaseUrl || !publishableKey) {
			return fail(500, {
				message:
					'Supabase keys are not configured (SUPABASE_PUBLISHABLE_KEY / legacy SUPABASE_ANON_KEY).'
			});
		}

		const supabase = createClient(supabaseUrl, publishableKey, {
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

		setAuthCookies(cookies, data.session);
		const destination = normalizeAppRedirect(redirectTo, '/');

		throw redirect(303, destination);
	},
	microsoft: async ({ request, cookies, url }) => {
		const formData = await request.formData();
		const destination = normalizeAppRedirect(formData.get('redirectTo'), '/');
		const publicOrigin = resolvePublicOrigin({ url, headers: request.headers });
		const supabase = createSupabaseMicrosoftOAuthClient(cookies);
		if (!supabase) {
			return fail(500, {
				message:
					'Supabase keys are not configured (SUPABASE_PUBLISHABLE_KEY / legacy SUPABASE_ANON_KEY).'
			});
		}

		const callbackUrl = new URL('/auth/callback', publicOrigin);
		callbackUrl.searchParams.set('redirect', destination);

		const { data, error } = await supabase.auth.signInWithOAuth({
			provider: 'azure',
			options: {
				redirectTo: callbackUrl.toString(),
				scopes: 'email',
				skipBrowserRedirect: true
			}
		});

		if (error || !data.url) {
			return fail(400, { message: error?.message ?? 'Unable to start Microsoft sign-in.' });
		}

		throw redirect(303, data.url);
	}
};
