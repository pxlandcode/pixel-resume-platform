import { redirect, type RequestHandler } from '@sveltejs/kit';
import {
	clearAuthCookies,
	clearMicrosoftOAuthCookies,
	createSupabaseMicrosoftOAuthClient,
	getSupabaseAdminClient,
	setAuthCookies
} from '$lib/server/supabase';
import { normalizeAppRedirect } from '$lib/server/authRedirect';
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

export const GET: RequestHandler = async ({ url, cookies }) => {
	const destination = normalizeAppRedirect(url.searchParams.get('redirect'), '/');
	const providerError = url.searchParams.get('error') ?? null;
	if (providerError) {
		clearMicrosoftOAuthCookies(cookies);
		throw redirect(303, toLoginRedirect('microsoft_oauth_failed', destination));
	}

	const code = url.searchParams.get('code');
	if (!code) {
		clearMicrosoftOAuthCookies(cookies);
		throw redirect(303, toLoginRedirect('missing_oauth_code', destination));
	}

	const supabase = createSupabaseMicrosoftOAuthClient(cookies);
	const adminClient = getSupabaseAdminClient();
	if (!supabase || !adminClient) {
		clearMicrosoftOAuthCookies(cookies);
		throw redirect(303, toLoginRedirect('server_not_configured', destination));
	}

	const { data, error } = await supabase.auth.exchangeCodeForSession(code);
	clearMicrosoftOAuthCookies(cookies);

	if (error || !data.session || !data.user) {
		clearAuthCookies(cookies);
		throw redirect(303, toLoginRedirect('microsoft_oauth_failed', destination));
	}

	try {
		await provisionMicrosoftOAuthUser({ adminClient, user: data.user });
		setAuthCookies(cookies, data.session);
	} catch (provisioningError) {
		clearAuthCookies(cookies);
		throw redirect(303, toLoginRedirect(toErrorCode(provisioningError), destination));
	}

	throw redirect(303, destination);
};
