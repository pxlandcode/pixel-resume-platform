import { dev } from '$app/environment';
import { json, type RequestHandler } from '@sveltejs/kit';
import { runResumeSearchJob } from '$lib/server/resumes/searchJobs';

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

const shouldUseNetlifyBackgroundSearch = () =>
	!dev &&
	(process.env.NETLIFY === 'true' ||
		!!process.env.URL ||
		!!process.env.DEPLOY_URL ||
		!!process.env.DEPLOY_PRIME_URL ||
		!!process.env.CONTEXT);

const startNetlifyBackgroundSearch = async (request: Request, url: URL, jobId: string) => {
	const response = await fetch(`${url.origin}/.netlify/functions/resume-search-background`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			cookie: request.headers.get('cookie') ?? ''
		},
		body: JSON.stringify({ job_id: jobId })
	});

	if (response.ok) return;

	const payload = (await response.json().catch(() => null)) as { message?: unknown } | null;
	const message =
		typeof payload?.message === 'string' && payload.message.trim()
			? payload.message.trim()
			: 'Could not start background resume search.';
	throw new Error(message);
};

export const POST: RequestHandler = async ({ params, locals, request, url }) => {
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
		if (shouldUseNetlifyBackgroundSearch()) {
			await startNetlifyBackgroundSearch(request, url, jobId);
			return json({ ok: true, status: 'queued' }, { status: 202, headers: buildHeaders() });
		}

		const job = await runResumeSearchJob({ adminClient, actor, jobId });
		return json({ ok: true, status: job.status, job }, { headers: buildHeaders() });
	} catch (error) {
		return json(
			{ message: error instanceof Error ? error.message : 'Could not start resume search.' },
			{ status: getErrorStatus(error), headers: buildHeaders() }
		);
	}
};
