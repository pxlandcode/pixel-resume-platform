import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env as privateEnv } from '$env/dynamic/private';
import type { Cookies } from '@sveltejs/kit';

export const AUTH_COOKIE_NAMES = {
	access: 'sb-access-token',
	refresh: 'sb-refresh-token'
} as const;

let adminClient: SupabaseClient | null = null;

const readEnv = (...keys: string[]): string | null => {
	for (const key of keys) {
		const value = privateEnv[key]?.trim();
		if (value) return value;
	}
	return null;
};

export const getSupabaseUrl = (): string | null => readEnv('SUPABASE_URL');

export const getSupabasePublishableKey = (): string | null =>
	readEnv('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY');

export const getSupabaseSecretKey = (): string | null =>
	readEnv('SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY');

export const createSupabaseServerClient = (accessToken: string | null): SupabaseClient | null => {
	if (!accessToken) {
		return null;
	}

	const supabaseUrl = getSupabaseUrl();
	const publishableKey = getSupabasePublishableKey();

	if (!supabaseUrl || !publishableKey) {
		console.warn(
			'[supabase] Missing SUPABASE_URL or publishable key (SUPABASE_PUBLISHABLE_KEY / legacy SUPABASE_ANON_KEY).'
		);
		return null;
	}

	return createClient(supabaseUrl, publishableKey, {
		global: {
			headers: {
				Authorization: `Bearer ${accessToken}`
			}
		},
		auth: {
			persistSession: false,
			autoRefreshToken: false
		}
	});
};

export const getSupabaseAdminClient = (): SupabaseClient | null => {
	const supabaseUrl = getSupabaseUrl();
	const secretKey = getSupabaseSecretKey();

	if (!supabaseUrl || !secretKey) {
		console.warn(
			'[supabase] Missing SUPABASE_URL or secret key (SUPABASE_SECRET_KEY / legacy SUPABASE_SERVICE_ROLE_KEY).'
		);
		return null;
	}

	if (!adminClient) {
		adminClient = createClient(supabaseUrl, secretKey, {
			auth: {
				persistSession: false,
				autoRefreshToken: false
			}
		});
	}

	return adminClient;
};

export const getSupabaseFromCookies = (cookies: Cookies): SupabaseClient | null => {
	const accessToken = cookies.get(AUTH_COOKIE_NAMES.access) ?? null;
	return createSupabaseServerClient(accessToken);
};

export const clearAuthCookies = (cookies: Cookies) => {
	cookies.delete(AUTH_COOKIE_NAMES.access, { path: '/' });
	cookies.delete(AUTH_COOKIE_NAMES.refresh, { path: '/' });
};

export const sbAdmin = (() => {
	const client = getSupabaseAdminClient();
	if (!client) {
		throw new Error(
			'[supabase] Secret key is not configured (SUPABASE_SECRET_KEY / legacy SUPABASE_SERVICE_ROLE_KEY).'
		);
	}
	return client;
})();
