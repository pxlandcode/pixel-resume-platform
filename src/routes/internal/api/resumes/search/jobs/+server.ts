import { json, type RequestHandler } from '@sveltejs/kit';
import { createResumeSearchJob, listResumeSearchJobs } from '$lib/server/resumes/searchJobs';
import {
	parseResumeSearchOrgIds,
	sanitizeResumeSearchTermOverrides
} from '$lib/server/resumes/searchScope';

const buildHeaders = () => ({
	'Cache-Control': 'private, no-store',
	Vary: 'Cookie'
});

const getErrorStatus = (error: unknown, fallback = 500) =>
	typeof error === 'object' &&
	error !== null &&
	typeof (error as { status?: unknown }).status === 'number'
		? (error as { status: number }).status
		: fallback;

export const GET: RequestHandler = async ({ locals }) => {
	const requestContext = locals.requestContext;
	const adminClient = requestContext.getAdminClient();
	const actor = await requestContext.getActorContext();

	if (!actor.userId || !adminClient) {
		return json({ message: 'Unauthorized.' }, { status: 401, headers: buildHeaders() });
	}

	try {
		const jobs = await listResumeSearchJobs({ adminClient, actor });
		return json({ jobs, generatedAt: new Date().toISOString() }, { headers: buildHeaders() });
	} catch (error) {
		return json(
			{ message: error instanceof Error ? error.message : 'Could not load search jobs.' },
			{ status: getErrorStatus(error), headers: buildHeaders() }
		);
	}
};

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
	const parsedOrgIds = parseResumeSearchOrgIds(
		Array.isArray(requestBody.orgIds)
			? requestBody.orgIds.filter((value): value is string => typeof value === 'string')
			: []
	);
	if (!parsedOrgIds.ok) {
		return json({ message: parsedOrgIds.message }, { status: 400, headers: buildHeaders() });
	}

	const hasTerms = Object.prototype.hasOwnProperty.call(requestBody, 'terms');
	const hasTermOverrides = Object.prototype.hasOwnProperty.call(requestBody, 'termOverrides');
	const hasExplicitTermOverrides = hasTerms || hasTermOverrides;
	const rawTermOverrides = hasTerms ? requestBody.terms : requestBody.termOverrides;
	const termOverrides = sanitizeResumeSearchTermOverrides(rawTermOverrides);
	if (hasExplicitTermOverrides && termOverrides === null) {
		return json(
			{ message: 'Invalid search term overrides.' },
			{ status: 400, headers: buildHeaders() }
		);
	}

	try {
		const jobId = await createResumeSearchJob({
			adminClient,
			actor,
			query: typeof requestBody.q === 'string' ? requestBody.q : '',
			orgIds: parsedOrgIds.orgIds,
			termOverrides,
			hasExplicitTermOverrides
		});
		return json({ jobId }, { status: 201, headers: buildHeaders() });
	} catch (error) {
		return json(
			{ message: error instanceof Error ? error.message : 'Could not create search job.' },
			{ status: getErrorStatus(error), headers: buildHeaders() }
		);
	}
};
