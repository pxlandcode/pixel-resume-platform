import { json, type RequestHandler } from '@sveltejs/kit';
import { getResumeSearchJob, updateResumeSearchJobTerms } from '$lib/server/resumes/searchJobs';
import { sanitizeResumeSearchTermOverrides } from '$lib/server/resumes/searchScope';

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

export const GET: RequestHandler = async ({ params, locals }) => {
	const jobId = params.jobId?.trim();
	if (!jobId) {
		return json({ message: 'Invalid job id.' }, { status: 400, headers: buildHeaders() });
	}

	const requestContext = locals.requestContext;
	const adminClient = requestContext.getAdminClient();
	const actor = await requestContext.getActorContext();

	if (!actor.userId || !adminClient) {
		return json({ message: 'Unauthorized.' }, { status: 401, headers: buildHeaders() });
	}

	try {
		const job = await getResumeSearchJob({ adminClient, actor, jobId });
		if (!job) {
			return json({ message: 'Search job not found.' }, { status: 404, headers: buildHeaders() });
		}
		return json({ job }, { headers: buildHeaders() });
	} catch (error) {
		return json(
			{ message: error instanceof Error ? error.message : 'Could not load search job.' },
			{ status: getErrorStatus(error), headers: buildHeaders() }
		);
	}
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const jobId = params.jobId?.trim();
	if (!jobId) {
		return json({ message: 'Invalid job id.' }, { status: 400, headers: buildHeaders() });
	}

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
	const rawTerms = Object.prototype.hasOwnProperty.call(requestBody, 'terms')
		? requestBody.terms
		: requestBody.termOverrides;
	const termOverrides = sanitizeResumeSearchTermOverrides(rawTerms);
	if (!termOverrides) {
		return json(
			{ message: 'Invalid search term overrides.' },
			{ status: 400, headers: buildHeaders() }
		);
	}

	try {
		const job = await updateResumeSearchJobTerms({
			adminClient,
			actor,
			jobId,
			termOverrides
		});
		if (!job) {
			return json({ message: 'Search job not found.' }, { status: 404, headers: buildHeaders() });
		}
		return json({ job }, { headers: buildHeaders() });
	} catch (error) {
		return json(
			{ message: error instanceof Error ? error.message : 'Could not update search job.' },
			{ status: getErrorStatus(error), headers: buildHeaders() }
		);
	}
};
