import { json, type RequestHandler } from '@sveltejs/kit';
import {
	executeDeepResumeSearch,
	MAX_RESUME_SEARCH_QUERY_LENGTH
} from '$lib/server/resumes/deepSearch';
import {
	parseResumeSearchOrgIds,
	resolveResumeSearchScope,
	sanitizeResumeSearchTermOverrides
} from '$lib/server/resumes/searchScope';
import type { ResumeSearchFilterTerm } from '$lib/types/resumes';

type SearchRequestPayload = {
	query: string;
	orgIds: string[];
	termOverrides: ResumeSearchFilterTerm[] | null;
	hasExplicitTermOverrides: boolean;
};

const buildResponseHeaders = () => ({
	'Cache-Control': 'private, no-store',
	Vary: 'Cookie'
});

const executeSearch = async (payload: {
	requestPayload: SearchRequestPayload;
	locals: App.Locals;
}) => {
	const { requestPayload, locals } = payload;
	const requestContext = locals.requestContext;
	const adminClient = requestContext.getAdminClient();
	const actor = await requestContext.getActorContext();

	if (!actor.userId || !adminClient) {
		return json({ message: 'Unauthorized.' }, { status: 401, headers: buildResponseHeaders() });
	}

	if (!requestPayload.query) {
		return json(
			{
				title: 'Deep search',
				query: '',
				scope: { orgIds: [], signature: 'default' },
				aiApplied: false,
				analyzedTerms: [],
				appliedTerms: [],
				items: [],
				generatedAt: new Date().toISOString()
			},
			{ headers: buildResponseHeaders() }
		);
	}

	if (requestPayload.query.length > MAX_RESUME_SEARCH_QUERY_LENGTH) {
		return json(
			{ message: `Query is too long. Max ${MAX_RESUME_SEARCH_QUERY_LENGTH} characters.` },
			{ status: 400, headers: buildResponseHeaders() }
		);
	}

	const parsedOrgIds = parseResumeSearchOrgIds(requestPayload.orgIds);
	if (!parsedOrgIds.ok) {
		return json(
			{ message: parsedOrgIds.message },
			{ status: 400, headers: buildResponseHeaders() }
		);
	}

	const scope = resolveResumeSearchScope(actor, parsedOrgIds.orgIds);
	if (!scope.ok) {
		return json(
			{ message: scope.message },
			{ status: scope.status, headers: buildResponseHeaders() }
		);
	}

	try {
		const response = await executeDeepResumeSearch({
			adminClient,
			actor,
			query: requestPayload.query,
			scope: { orgIds: scope.orgIds, signature: scope.signature },
			termOverrides: requestPayload.termOverrides,
			hasExplicitTermOverrides: requestPayload.hasExplicitTermOverrides
		});

		return json(response, { headers: buildResponseHeaders() });
	} catch (error) {
		console.error('[resume-search] failed to run search', error);
		return json(
			{ message: error instanceof Error ? error.message : 'Could not load search results.' },
			{ status: 500, headers: buildResponseHeaders() }
		);
	}
};

export const GET: RequestHandler = async ({ url, locals }) =>
	executeSearch({
		requestPayload: {
			query: (url.searchParams.get('q') ?? '').trim(),
			orgIds: url.searchParams.getAll('org'),
			termOverrides: null,
			hasExplicitTermOverrides: false
		},
		locals
	});

export const POST: RequestHandler = async ({ request, locals }) => {
	let body: unknown = null;

	try {
		body = await request.json();
	} catch {
		return json(
			{ message: 'Invalid JSON body.' },
			{ status: 400, headers: buildResponseHeaders() }
		);
	}

	if (!body || typeof body !== 'object') {
		return json(
			{ message: 'Invalid request body.' },
			{ status: 400, headers: buildResponseHeaders() }
		);
	}

	const requestBody = body as Record<string, unknown>;
	const hasTerms = Object.prototype.hasOwnProperty.call(requestBody, 'terms');
	const hasTermOverrides = Object.prototype.hasOwnProperty.call(requestBody, 'termOverrides');
	const hasExplicitTermOverrides = hasTerms || hasTermOverrides;
	const rawTermOverrides = hasTerms ? requestBody.terms : requestBody.termOverrides;
	const termOverrides = sanitizeResumeSearchTermOverrides(rawTermOverrides);

	if (hasExplicitTermOverrides && termOverrides === null) {
		return json(
			{ message: 'Invalid search term overrides.' },
			{ status: 400, headers: buildResponseHeaders() }
		);
	}

	return executeSearch({
		requestPayload: {
			query: typeof requestBody.q === 'string' ? requestBody.q.trim() : '',
			orgIds: Array.isArray(requestBody.orgIds)
				? requestBody.orgIds.filter((value): value is string => typeof value === 'string')
				: [],
			termOverrides,
			hasExplicitTermOverrides
		},
		locals
	});
};
