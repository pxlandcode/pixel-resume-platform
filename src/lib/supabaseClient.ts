import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';

let browserClient: SupabaseClient | null = null;

/**
 * Returns a singleton Supabase client for browser usage.
 * The client keeps the session in local storage so subsequent requests remain authenticated.
 */
export const getSupabaseClient = () => {
	const url = env.PUBLIC_SUPABASE_URL;
	const anonKey = env.PUBLIC_SUPABASE_ANON_KEY;

	if (!url || !anonKey) {
		throw new Error(
			'Missing PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY env vars. Update your .env to include them.'
		);
	}

	if (!browserClient) {
		browserClient = createClient(url, anonKey, {
			auth: {
				persistSession: true,
				autoRefreshToken: true
                        }
                });
        }

        return browserClient;
};
