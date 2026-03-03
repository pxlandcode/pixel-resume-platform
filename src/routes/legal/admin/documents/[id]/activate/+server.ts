import { error, json, type RequestHandler } from '@sveltejs/kit';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { getActorAccessContext } from '$lib/server/access';

const requireAdminContext = async (accessToken: string | null) => {
	const supabase = createSupabaseServerClient(accessToken);
	const adminClient = getSupabaseAdminClient();
	if (!supabase || !adminClient) {
		throw error(401, 'Unauthorized');
	}

	const actor = await getActorAccessContext(supabase, adminClient);
	if (!actor.userId || !actor.isAdmin) {
		throw error(403, 'Only admins can activate legal documents.');
	}

	return { adminClient };
};

export const POST: RequestHandler = async ({ params, cookies }) => {
	const { adminClient } = await requireAdminContext(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
	const documentId = params.id?.trim();

	if (!documentId) {
		return json({ message: 'Document ID is required.' }, { status: 400 });
	}

	const { data: targetDoc, error: fetchError } = await adminClient
		.from('legal_documents')
		.select('id, doc_type')
		.eq('id', documentId)
		.maybeSingle();

	if (fetchError) {
		return json({ message: fetchError.message }, { status: 500 });
	}
	if (!targetDoc?.id || !targetDoc.doc_type) {
		return json({ message: 'Legal document not found.' }, { status: 404 });
	}

	const { error: deactivateError } = await adminClient
		.from('legal_documents')
		.update({ is_active: false })
		.eq('doc_type', targetDoc.doc_type)
		.neq('id', targetDoc.id);

	if (deactivateError) {
		return json({ message: deactivateError.message }, { status: 500 });
	}

	const { error: activateError } = await adminClient
		.from('legal_documents')
		.update({ is_active: true })
		.eq('id', targetDoc.id)
		.eq('doc_type', targetDoc.doc_type);

	if (activateError) {
		return json({ message: activateError.message }, { status: 500 });
	}

	return json({ ok: true, id: targetDoc.id, doc_type: targetDoc.doc_type });
};
