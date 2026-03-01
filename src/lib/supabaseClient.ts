import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';

let browserClient: SupabaseClient | null = null;

/**
 * Returns a singleton Supabase client for browser usage.
 * The client keeps the session in local storage so subsequent requests remain authenticated.
 */
export const getSupabaseClient = () => {
	const url = env.PUBLIC_SUPABASE_URL;
	const publishableKey = env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.PUBLIC_SUPABASE_ANON_KEY;

	if (!url || !publishableKey) {
		throw new Error(
			'Missing PUBLIC_SUPABASE_URL or publishable key (PUBLIC_SUPABASE_PUBLISHABLE_KEY / legacy PUBLIC_SUPABASE_ANON_KEY).'
		);
	}

	if (!browserClient) {
		browserClient = createClient(url, publishableKey, {
			auth: {
				persistSession: true,
				autoRefreshToken: true
			}
		});
	}

	return browserClient;
};
