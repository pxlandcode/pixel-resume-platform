import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { getSupabaseAdminClient } from '$lib/server/supabase';
import {
	getPublicResumeShareHeaders,
	resolvePublicResumeSharePage,
	verifyPublicResumeSharePassword,
	ResumeShareAccessError
} from '$lib/server/resumeShares';

export const load: PageServerLoad = async ({ params, url, cookies, request, setHeaders, getClientAddress }) => {
	const adminClient = getSupabaseAdminClient();
	if (!adminClient) {
		throw new ResumeShareAccessError(503, 'Resume sharing is not configured.');
	}

	setHeaders(getPublicResumeShareHeaders());
	const requestedLanguage = url.searchParams.get('lang') === 'en' ? 'en' : 'sv';
	const printMode = url.searchParams.get('print') === '1';
	const result = await resolvePublicResumeSharePage({
		adminClient,
		cookies,
		token: params.token,
		origin: url.origin,
		language: requestedLanguage,
		requestEvent: {
			request,
			getClientAddress
		}
	});

	return {
		...result,
		printMode,
		meta: {
			title: result.organisationName
				? `${result.organisationName} shared a resume`
				: 'Shared resume',
			description: result.organisationName
				? `${result.organisationName} shared a resume`
				: 'Shared resume',
			noindex: true,
			path: `/s/${params.token}`
		}
	};
};

export const actions: Actions = {
	default: async ({ params, request, cookies, getClientAddress, url }) => {
		const adminClient = getSupabaseAdminClient();
		if (!adminClient) {
			return fail(503, {
				ok: false,
				message: 'Resume sharing is not configured.'
			});
		}

		const formData = await request.formData();
		const password = typeof formData.get('password') === 'string' ? String(formData.get('password')).trim() : '';
		if (!password) {
			return fail(400, {
				ok: false,
				message: 'Enter the password to continue.'
			});
		}

		try {
			await verifyPublicResumeSharePassword({
				adminClient,
				cookies,
				token: params.token,
				password,
				requestEvent: {
					request,
					getClientAddress
				}
			});
		} catch (error) {
			if (error instanceof ResumeShareAccessError) {
				return fail(error.status, {
					ok: false,
					message: error.message
				});
			}

			return fail(500, {
				ok: false,
				message: 'Could not verify the share password.'
			});
		}

		throw redirect(303, `${url.pathname}${url.search}`);
	}
};
