import { json, type RequestHandler } from '@sveltejs/kit';
import { getAccessibleTalentIds } from '$lib/server/access';
import { searchResumeDocuments } from '$lib/server/resumes/searchDocuments';
import { parseResumeSearchOrgIds, resolveResumeSearchScope } from '$lib/server/resumes/searchScope';

const buildHeaders = () => ({
	'Cache-Control': 'private, no-store',
	Vary: 'Cookie'
});

export const POST: RequestHandler = async ({ request, locals }) => {
	const requestContext = locals.requestContext;
	const adminClient = requestContext.getAdminClient();
	const actor = await requestContext.getActorContext();

	if (!actor.userId || !adminClient) {
		return json({ message: 'Unauthorized.' }, { status: 401, headers: buildHeaders() });
	}

	let body: unknown = null;
	try {
		body = await request.json();
	} catch {
		return json({ message: 'Invalid JSON body.' }, { status: 400, headers: buildHeaders() });
	}

	if (!body || typeof body !== 'object') {
		return json({ message: 'Invalid request body.' }, { status: 400, headers: buildHeaders() });
	}

	const requestBody = body as Record<string, unknown>;
	const query = typeof requestBody.q === 'string' ? requestBody.q.trim() : '';
	const parsedOrgIds = parseResumeSearchOrgIds(
		Array.isArray(requestBody.orgIds)
			? requestBody.orgIds.filter((value): value is string => typeof value === 'string')
			: []
	);
	if (!parsedOrgIds.ok) {
		return json({ message: parsedOrgIds.message }, { status: 400, headers: buildHeaders() });
	}

	const scope = resolveResumeSearchScope(actor, parsedOrgIds.orgIds);
	if (!scope.ok) {
		return json({ message: scope.message }, { status: scope.status, headers: buildHeaders() });
	}

	try {
		const accessibleTalentIds =
			!actor.isAdmin && scope.orgIds.length === 0
				? await getAccessibleTalentIds(adminClient, actor)
				: null;
		const payload = await searchResumeDocuments({
			adminClient,
			query,
			scope: { orgIds: scope.orgIds, signature: scope.signature },
			accessibleTalentIds,
			limit: typeof requestBody.limit === 'number' ? requestBody.limit : undefined,
			offset: typeof requestBody.offset === 'number' ? requestBody.offset : undefined
		});

		return json(payload, { headers: buildHeaders() });
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Could not load simple search results.';
		const status = message.startsWith('Query is too long') ? 400 : 500;
		return json({ message }, { status, headers: buildHeaders() });
	}
};
