import { redirect, type RequestHandler } from '@sveltejs/kit';
import {
	clearAuthCookies,
	clearMicrosoftOAuthCookies,
	createSupabaseMicrosoftOAuthClient,
	getSupabaseAdminClient,
	setAuthCookies
} from '$lib/server/supabase';
import { normalizeAppRedirect, resolvePublicOrigin } from '$lib/server/authRedirect';
import {
	MicrosoftOAuthProvisioningError,
	provisionMicrosoftOAuthUser
} from '$lib/server/oauthProvisioning';

const toLoginRedirect = (code: string, redirectTo: string) => {
	const params = new URLSearchParams({ microsoft_error: code });
	if (redirectTo !== '/') params.set('redirect', redirectTo);
	return `/login?${params.toString()}`;
};

const toErrorCode = (error: unknown) => {
	if (error instanceof MicrosoftOAuthProvisioningError) return error.code;
	return 'microsoft_oauth_failed';
};

export const GET: RequestHandler = async ({ url, cookies, request }) => {
	const publicOrigin = resolvePublicOrigin({ url, headers: request.headers });
	const destination = normalizeAppRedirect(url.searchParams.get('redirect'), '/');
	const providerError = url.searchParams.get('error') ?? null;
	if (providerError) {
		clearMicrosoftOAuthCookies(cookies);
		throw redirect(303, new URL(toLoginRedirect('microsoft_oauth_failed', destination), publicOrigin).toString());
	}

	const code = url.searchParams.get('code');
	if (!code) {
		clearMicrosoftOAuthCookies(cookies);
		throw redirect(303, new URL(toLoginRedirect('missing_oauth_code', destination), publicOrigin).toString());
	}

	const supabase = createSupabaseMicrosoftOAuthClient(cookies);
	const adminClient = getSupabaseAdminClient();
	if (!supabase || !adminClient) {
		clearMicrosoftOAuthCookies(cookies);
		throw redirect(303, new URL(toLoginRedirect('server_not_configured', destination), publicOrigin).toString());
	}

	const { data, error } = await supabase.auth.exchangeCodeForSession(code);
	clearMicrosoftOAuthCookies(cookies);

	if (error || !data.session || !data.user) {
		clearAuthCookies(cookies);
		throw redirect(303, new URL(toLoginRedirect('microsoft_oauth_failed', destination), publicOrigin).toString());
	}

	try {
		await provisionMicrosoftOAuthUser({ adminClient, user: data.user });
		setAuthCookies(cookies, data.session);
	} catch (provisioningError) {
		clearAuthCookies(cookies);
		throw redirect(303, new URL(toLoginRedirect(toErrorCode(provisioningError), destination), publicOrigin).toString());
	}

	throw redirect(303, new URL(destination, publicOrigin).toString());
};
