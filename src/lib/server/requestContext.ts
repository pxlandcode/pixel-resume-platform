import type { Cookies } from '@sveltejs/kit';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient,
	refreshAuthSession
} from '$lib/server/supabase';
import { getActorAccessContext, type ActorAccessContext } from '$lib/server/access';

export type RequestContext = {
	accessToken: string | null;
	refreshToken: string | null;
	ensureSession: () => Promise<Session | null>;
	getSupabaseClient: () => SupabaseClient | null;
	getAdminClient: () => SupabaseClient | null;
	getAuthenticatedUser: () => Promise<User | null>;
	getActorContext: () => Promise<ActorAccessContext>;
};

export const createRequestContext = (cookies: Cookies): RequestContext => {
	let supabaseClient: SupabaseClient | null | undefined;
	let supabaseClientAccessToken: string | null | undefined;
	let adminClient: SupabaseClient | null | undefined;
	let authenticatedUserPromise: Promise<User | null> | null = null;
	let actorContextPromise: Promise<ActorAccessContext> | null = null;
	let sessionPromise: Promise<Session | null> | null = null;

	const getAccessToken = () => cookies.get(AUTH_COOKIE_NAMES.access) ?? null;
	const getRefreshToken = () => cookies.get(AUTH_COOKIE_NAMES.refresh) ?? null;

	const resetAuthCaches = () => {
		supabaseClient = undefined;
		supabaseClientAccessToken = undefined;
		authenticatedUserPromise = null;
		actorContextPromise = null;
	};

	const ensureSession = async () => {
		const existingAccessToken = getAccessToken();
		if (existingAccessToken) return null;
		if (!getRefreshToken()) return null;
		if (sessionPromise) return sessionPromise;

		sessionPromise = (async () => {
			const session = await refreshAuthSession(cookies);
			resetAuthCaches();
			return session;
		})();

		try {
			return await sessionPromise;
		} finally {
			sessionPromise = null;
		}
	};

	const getSupabaseClient = () => {
		const accessToken = getAccessToken();
		if (supabaseClient !== undefined && supabaseClientAccessToken === accessToken) {
			return supabaseClient;
		}
		supabaseClientAccessToken = accessToken;
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
			await ensureSession();

			let supabase = getSupabaseClient();
			if (!supabase) return null;

			let { data, error } = await supabase.auth.getUser();
			if (!error && data.user) return data.user;
			if (!getRefreshToken()) return null;

			const refreshedSession = await refreshAuthSession(cookies);
			if (!refreshedSession) return null;

			resetAuthCaches();
			supabase = getSupabaseClient();
			if (!supabase) return null;

			({ data, error } = await supabase.auth.getUser());
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
		get accessToken() {
			return getAccessToken();
		},
		get refreshToken() {
			return getRefreshToken();
		},
		ensureSession,
		getSupabaseClient,
		getAdminClient,
		getAuthenticatedUser,
		getActorContext
	};
};
