import { json, type RequestHandler } from '@sveltejs/kit';
import { markResumeSearchJobRead } from '$lib/server/resumes/searchJobs';

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

export const POST: RequestHandler = async ({ params, locals }) => {
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
		const job = await markResumeSearchJobRead({ adminClient, actor, jobId });
		return json({ job }, { headers: buildHeaders() });
	} catch (error) {
		return json(
			{ message: error instanceof Error ? error.message : 'Could not update search job.' },
			{ status: getErrorStatus(error), headers: buildHeaders() }
		);
	}
};
