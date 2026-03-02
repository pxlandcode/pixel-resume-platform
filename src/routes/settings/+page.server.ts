import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { getActorAccessContext } from '$lib/server/access';

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
	if (!actor.isAdmin) {
		throw error(403, 'Only admins can access settings.');
	}

	const legalDocumentsResult = await adminClient
		.from('legal_documents')
		.select('id, doc_type, version, content_html, effective_date, is_active, created_at')
		.order('doc_type', { ascending: true })
		.order('effective_date', { ascending: false });

	if (legalDocumentsResult.error) {
		throw error(500, legalDocumentsResult.error.message);
	}

	return {
		legalDocuments: legalDocumentsResult.data ?? []
	};
};
