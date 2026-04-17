import { redirect, type RequestHandler } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import {
	AUTH_COOKIE_NAMES,
	clearAuthCookies,
	getSupabasePublishableKey,
	getSupabaseUrl
} from '$lib/server/supabase';

export const POST: RequestHandler = async ({ cookies }) => {
	const accessToken = cookies.get(AUTH_COOKIE_NAMES.access) ?? null;
	const refreshToken = cookies.get(AUTH_COOKIE_NAMES.refresh) ?? null;
	const supabaseUrl = getSupabaseUrl();
	const publishableKey = getSupabasePublishableKey();

	if (accessToken && refreshToken && supabaseUrl && publishableKey) {
		const supabase = createClient(supabaseUrl, publishableKey, {
			auth: {
				persistSession: false,
				autoRefreshToken: false
			}
		});
		const { error: sessionError } = await supabase.auth.setSession({
			access_token: accessToken,
			refresh_token: refreshToken
		});
		if (!sessionError) {
			await supabase.auth.signOut().catch(() => undefined);
		}
	}

	clearAuthCookies(cookies);
	throw redirect(303, '/login');
};
