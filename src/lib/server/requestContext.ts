import type { Cookies } from '@sveltejs/kit';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { getActorAccessContext, type ActorAccessContext } from '$lib/server/access';

export type RequestContext = {
	accessToken: string | null;
	getSupabaseClient: () => SupabaseClient | null;
	getAdminClient: () => SupabaseClient | null;
	getAuthenticatedUser: () => Promise<User | null>;
	getActorContext: () => Promise<ActorAccessContext>;
};

export const createRequestContext = (cookies: Cookies): RequestContext => {
	const accessToken = cookies.get(AUTH_COOKIE_NAMES.access) ?? null;

	let supabaseClient: SupabaseClient | null | undefined;
	let adminClient: SupabaseClient | null | undefined;
	let authenticatedUserPromise: Promise<User | null> | null = null;
	let actorContextPromise: Promise<ActorAccessContext> | null = null;

	const getSupabaseClient = () => {
		if (supabaseClient !== undefined) return supabaseClient;
		supabaseClient = createSupabaseServerClient(accessToken);
		return supabaseClient;
	};

	const getAdminClient = () => {
		if (adminClient !== undefined) return adminClient;
		adminClient = getSupabaseAdminClient();
		return adminClient;
	};

	const getAuthenticatedUser = () => {
		if (authenticatedUserPromise) return authenticatedUserPromise;
		authenticatedUserPromise = (async () => {
			const supabase = getSupabaseClient();
			if (!supabase) return null;

			const { data, error } = await supabase.auth.getUser();
			if (error || !data.user) return null;
			return data.user;
		})();
		return authenticatedUserPromise;
	};

	const getActorContext = () => {
		if (actorContextPromise) return actorContextPromise;
		actorContextPromise = (async () => {
			const supabase = getSupabaseClient();
			const admin = getAdminClient();
			if (!supabase || !admin) return getActorAccessContext(null, null);

			const authUser = await getAuthenticatedUser();
			return getActorAccessContext(supabase, admin, { authUser });
		})();
		return actorContextPromise;
	};

	return {
		accessToken,
		getSupabaseClient,
		getAdminClient,
		getAuthenticatedUser,
		getActorContext
	};
};
