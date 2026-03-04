import { error, fail, type Actions } from '@sveltejs/kit';
import type { AppRole } from '$lib/server/access';
import type { PageServerLoad } from './$types';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { getActorAccessContext } from '$lib/server/access';

const resolveEffectiveRoles = (roles: AppRole[]): AppRole[] => (roles.length > 0 ? roles : ['talent']);

const canUseUserSettings = (roles: AppRole[]) =>
	!roles.includes('admin') && !roles.includes('broker') && !roles.includes('employer');

const parseString = (value: FormDataEntryValue | null) =>
	typeof value === 'string' ? value.trim() : '';

export const load: PageServerLoad = async ({ cookies }) => {
	const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
	const adminClient = getSupabaseAdminClient();

	if (!supabase || !adminClient) {
		throw error(401, 'Unauthorized');
	}

	const actor = await getActorAccessContext(supabase, adminClient);
	if (!actor.userId) {
		throw error(401, 'Unauthorized');
	}

	const effectiveRoles = resolveEffectiveRoles(actor.roles);
	const isAdmin = effectiveRoles.includes('admin');
	if (!isAdmin && !canUseUserSettings(effectiveRoles)) {
		throw error(403, 'Only admins and talent users can access settings.');
	}

	if (!isAdmin) {
		return {
			mode: 'user' as const,
			legalDocuments: []
		};
	}

	const legalDocumentsResult = await adminClient
		.from('legal_documents')
		.select(
			'id, doc_type, version, content_html, effective_date, acceptance_scope, is_active, created_at'
		)
		.order('doc_type', { ascending: true })
		.order('effective_date', { ascending: false });

	if (legalDocumentsResult.error) {
		throw error(500, legalDocumentsResult.error.message);
	}

	return {
		mode: 'admin' as const,
		legalDocuments: legalDocumentsResult.data ?? []
	};
};

export const actions: Actions = {
	changePassword: async ({ request, cookies }) => {
		const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
		const adminClient = getSupabaseAdminClient();
		if (!supabase || !adminClient) {
			return fail(401, {
				type: 'changePassword',
				ok: false,
				message: 'You are not authenticated.'
			});
		}

		const { data: authData, error: authError } = await supabase.auth.getUser();
		if (authError || !authData.user) {
			return fail(401, {
				type: 'changePassword',
				ok: false,
				message: 'You are not authenticated.'
			});
		}

		const actor = await getActorAccessContext(supabase, adminClient, { authUser: authData.user });
		const effectiveRoles = resolveEffectiveRoles(actor.roles);
		const isAdmin = effectiveRoles.includes('admin');
		if (!isAdmin && !canUseUserSettings(effectiveRoles)) {
			return fail(403, {
				type: 'changePassword',
				ok: false,
				message: 'You are not authorized to change password from this page.'
			});
		}

		const formData = await request.formData();
		const password = parseString(formData.get('password'));
		const confirmPassword = parseString(formData.get('confirm_password'));

		if (!password || password.length < 8) {
			return fail(400, {
				type: 'changePassword',
				ok: false,
				message: 'Password must be at least 8 characters long.'
			});
		}

		if (password !== confirmPassword) {
			return fail(400, {
				type: 'changePassword',
				ok: false,
				message: 'Passwords do not match.'
			});
		}

		const accessToken = cookies.get(AUTH_COOKIE_NAMES.access) ?? null;
		const refreshToken = cookies.get(AUTH_COOKIE_NAMES.refresh) ?? null;
		if (!accessToken || !refreshToken) {
			return fail(401, {
				type: 'changePassword',
				ok: false,
				message: 'Your session has expired. Please sign in again.'
			});
		}

		const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
			access_token: accessToken,
			refresh_token: refreshToken
		});
		if (sessionError || !sessionData.session) {
			return fail(401, {
				type: 'changePassword',
				ok: false,
				message: sessionError?.message ?? 'Your session has expired. Please sign in again.'
			});
		}

		const { error: updateError } = await supabase.auth.updateUser({ password });
		if (updateError) {
			return fail(400, {
				type: 'changePassword',
				ok: false,
				message: updateError.message
			});
		}

		return {
			type: 'changePassword' as const,
			ok: true as const,
			message: 'Password updated successfully.'
		};
	}
};
