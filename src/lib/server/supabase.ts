import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from '$env/static/private';
import type { Cookies } from '@sveltejs/kit';

export const AUTH_COOKIE_NAMES = {
        access: 'sb-access-token',
        refresh: 'sb-refresh-token'
} as const;

let adminClient: SupabaseClient | null = null;

export const createSupabaseServerClient = (accessToken: string | null): SupabaseClient | null => {
        if (!accessToken) {
                return null;
        }

        return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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
        if (!SUPABASE_SERVICE_ROLE_KEY) {
                console.warn('[supabase] Service role key is not configured.');
                return null;
        }

        if (!adminClient) {
                adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
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
                throw new Error('[supabase] Service role key is not configured.');
        }
        return client;
})();
