import { json, type RequestHandler } from '@sveltejs/kit';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { getResumeEditPermissions } from '$lib/server/resumes/permissions';

const STALE_PROCESSING_MS = 15 * 60 * 1000;

type JobStatus = 'queued' | 'processing' | 'succeeded' | 'failed';

type ResumeImportJobRow = {
	id: string;
	person_id: string;
	requested_by_user_id: string;
	status: JobStatus;
	error_message: string | null;
	resume_id: string | null;
	resume_version_name: string | null;
	created_at: string | null;
	started_at: string | null;
	completed_at: string | null;
};

const isStaleProcessingJob = (row: ResumeImportJobRow): boolean => {
	if (row.status !== 'processing' || !row.started_at) return false;
	const startedAt = new Date(row.started_at).getTime();
	if (!Number.isFinite(startedAt)) return false;
	return Date.now() - startedAt > STALE_PROCESSING_MS;
};

export const GET: RequestHandler = async ({ params, cookies }) => {
	const jobId = params.jobId?.trim();
	if (!jobId) {
		return json({ message: 'Invalid job id.' }, { status: 400 });
	}

	const accessToken = cookies.get(AUTH_COOKIE_NAMES.access) ?? null;
	const supabase = createSupabaseServerClient(accessToken);
	const adminClient = getSupabaseAdminClient();

	if (!supabase || !adminClient) {
		return json({ message: 'Unauthorized.' }, { status: 401 });
	}

	const { data: row, error } = await adminClient
		.from('resume_import_jobs')
		.select(
			'id, person_id, requested_by_user_id, status, error_message, resume_id, resume_version_name, created_at, started_at, completed_at'
		)
		.eq('id', jobId)
		.maybeSingle();

	if (error) {
		return json({ message: error.message }, { status: 500 });
	}

	if (!row?.id) {
		return json({ message: 'Import job not found.' }, { status: 404 });
	}

	const typedRow = row as ResumeImportJobRow;
	const permissions = await getResumeEditPermissions(supabase, adminClient, typedRow.person_id);
	const canView =
		permissions.canEdit ||
		(permissions.userId && permissions.userId === typedRow.requested_by_user_id);

	if (!canView) {
		return json({ message: 'Not authorized to view this import job.' }, { status: 403 });
	}

	const stale = isStaleProcessingJob(typedRow);

	return json({
		id: String(typedRow.id),
		status: stale ? ('failed' as const) : typedRow.status,
		error_message: stale
			? 'The PDF import timed out while processing. Please try again with a smaller PDF or import in parts.'
			: typedRow.error_message,
		resume_id: typedRow.resume_id ? String(typedRow.resume_id) : null,
		resume_version_name: typedRow.resume_version_name,
		created_at: typedRow.created_at,
		started_at: typedRow.started_at,
		completed_at: typedRow.completed_at
	});
};
