import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env as privateEnv } from '$env/dynamic/private';

export const AUTH_COOKIE_NAMES = {
	access: 'sb-access-token',
	refresh: 'sb-refresh-token'
} as const;

const MICROSOFT_OAUTH_STORAGE_KEY = 'sb-ms-oauth';
const MICROSOFT_OAUTH_CODE_VERIFIER_COOKIE = `${MICROSOFT_OAUTH_STORAGE_KEY}-code-verifier`;

export const authCookieOptions = {
	path: '/',
	httpOnly: true,
	sameSite: 'lax' as const,
	secure: !dev
};

let adminClient: SupabaseClient | null = null;

const readEnv = (...keys: string[]): string | null => {
	for (const key of keys) {
		const value = privateEnv[key]?.trim() ?? process.env[key]?.trim();
		if (value) return value;
	}
	return null;
};

export const getSupabaseUrl = (): string | null => readEnv('SUPABASE_URL');

export const getSupabasePublishableKey = (): string | null =>
	readEnv('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY');

export const getSupabaseSecretKey = (): string | null =>
	readEnv('SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY');

const createSupabaseTokenClient = (): SupabaseClient | null => {
	const supabaseUrl = getSupabaseUrl();
	const publishableKey = getSupabasePublishableKey();

	if (!supabaseUrl || !publishableKey) {
		console.warn(
			'[supabase] Missing SUPABASE_URL or publishable key (SUPABASE_PUBLISHABLE_KEY / legacy SUPABASE_ANON_KEY).'
		);
		return null;
	}

	return createClient(supabaseUrl, publishableKey, {
		auth: {
			persistSession: false,
			autoRefreshToken: false
		}
	});
};

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

const shouldClearAuthCookies = (error: { status?: number; message?: string } | null | undefined) => {
	if (!error) return false;
	if (typeof error.status === 'number') {
		return error.status >= 400 && error.status < 500;
	}
	return /refresh token|invalid|expired|jwt/i.test(error.message ?? '');
};

export const refreshAuthSession = async (cookies: Cookies): Promise<Session | null> => {
	const refreshToken = cookies.get(AUTH_COOKIE_NAMES.refresh) ?? null;
	if (!refreshToken) return null;

	const client = createSupabaseTokenClient();
	if (!client) return null;

	try {
		const { data, error } = await client.auth.refreshSession({
			refresh_token: refreshToken
		});

		if (error || !data.session) {
			if (shouldClearAuthCookies(error)) {
				clearAuthCookies(cookies);
			}
			return null;
		}

		setAuthCookies(cookies, data.session);
		return data.session;
	} catch (error) {
		console.warn('[supabase] session refresh failed', error);
		return null;
	}
};

export const createSupabaseMicrosoftOAuthClient = (cookies: Cookies): SupabaseClient | null => {
	const supabaseUrl = getSupabaseUrl();
	const publishableKey = getSupabasePublishableKey();

	if (!supabaseUrl || !publishableKey) {
		console.warn(
			'[supabase] Missing SUPABASE_URL or publishable key (SUPABASE_PUBLISHABLE_KEY / legacy SUPABASE_ANON_KEY).'
		);
		return null;
	}

	return createClient(supabaseUrl, publishableKey, {
		auth: {
			persistSession: true,
			autoRefreshToken: false,
			detectSessionInUrl: false,
			flowType: 'pkce',
			storageKey: MICROSOFT_OAUTH_STORAGE_KEY,
			storage: {
				getItem: (key: string) => {
					if (key !== MICROSOFT_OAUTH_CODE_VERIFIER_COOKIE) return null;
					const value = cookies.get(MICROSOFT_OAUTH_CODE_VERIFIER_COOKIE);
					try {
						return value ? decodeURIComponent(value) : null;
					} catch {
						return null;
					}
				},
				setItem: (key: string, value: string) => {
					if (key !== MICROSOFT_OAUTH_CODE_VERIFIER_COOKIE) return;
					cookies.set(MICROSOFT_OAUTH_CODE_VERIFIER_COOKIE, encodeURIComponent(value), {
						...authCookieOptions,
						maxAge: 10 * 60
					});
				},
				removeItem: (key: string) => {
					if (key !== MICROSOFT_OAUTH_CODE_VERIFIER_COOKIE) return;
					cookies.delete(MICROSOFT_OAUTH_CODE_VERIFIER_COOKIE, { path: '/' });
				}
			}
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

export const clearMicrosoftOAuthCookies = (cookies: Cookies) => {
	cookies.delete(MICROSOFT_OAUTH_CODE_VERIFIER_COOKIE, { path: '/' });
};

export const setAuthCookies = (cookies: Cookies, session: Session) => {
	const now = Math.floor(Date.now() / 1000);
	const accessMaxAge = session.expires_at
		? Math.max(session.expires_at - now - 30, 0)
		: Math.max(session.expires_in - 30, 0);

	cookies.set(AUTH_COOKIE_NAMES.access, session.access_token, {
		...authCookieOptions,
		maxAge: accessMaxAge
	});

	cookies.set(AUTH_COOKIE_NAMES.refresh, session.refresh_token, {
		...authCookieOptions,
		maxAge: 60 * 60 * 24 * 30
	});
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
