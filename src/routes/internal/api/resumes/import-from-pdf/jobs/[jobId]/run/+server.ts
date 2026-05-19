import { json, type RequestHandler } from '@sveltejs/kit';
import { dev } from '$app/environment';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { getResumeEditPermissions } from '$lib/server/resumes/permissions';
import { importResumeFromPdf, ResumePdfImportError } from '$lib/server/resumes/pdfImport';
import { saveResumeData } from '$lib/server/resumes/store';

const MAX_PDF_BYTES = 10 * 1024 * 1024;

type ResumeImportJobStatus = 'queued' | 'processing' | 'succeeded' | 'failed';

type ResumeImportJobRow = {
	id: string;
	talent_id: string;
	requested_by_user_id: string;
	status: ResumeImportJobStatus;
	source_filename: string;
	source_size_bytes: number;
	source_bucket: string | null;
	source_object_path: string | null;
};

const shouldUseNetlifyBackgroundImport = () =>
	!dev &&
	(process.env.NETLIFY === 'true' ||
		!!process.env.URL ||
		!!process.env.DEPLOY_URL ||
		!!process.env.DEPLOY_PRIME_URL ||
		!!process.env.CONTEXT);

const toSafeMessage = (value: unknown, fallback: string): string => {
	if (typeof value !== 'string') return fallback;
	const trimmed = value.trim();
	return trimmed ? trimmed.slice(0, 300) : fallback;
};

const updateJob = async (
	adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
	jobId: string,
	patch: Record<string, unknown>
) => {
	const { error } = await adminClient
		.from('resume_import_jobs')
		.update({ ...patch, updated_at: new Date().toISOString() })
		.eq('id', jobId);

	if (error) throw new Error(error.message);
};

const failJob = async (
	adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
	jobId: string,
	message: string
) => {
	await updateJob(adminClient, jobId, {
		status: 'failed',
		error_message: toSafeMessage(message, 'Could not import resume from PDF right now.'),
		completed_at: new Date().toISOString()
	});
};

const readBlobArrayBuffer = async (value: unknown): Promise<ArrayBuffer | null> => {
	if (value && typeof value === 'object' && typeof (value as Blob).arrayBuffer === 'function') {
		return (value as Blob).arrayBuffer();
	}
	if (value instanceof ArrayBuffer) return value;
	if (ArrayBuffer.isView(value)) {
		const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
		return new Uint8Array(view).buffer;
	}
	return null;
};

const startNetlifyBackgroundImport = async (
	request: Request,
	url: URL,
	jobId: string,
	talentId: string
) => {
	const response = await fetch(
		`${url.origin}/.netlify/functions/resume-import-from-pdf-background`,
		{
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				cookie: request.headers.get('cookie') ?? ''
			},
			body: JSON.stringify({
				job_id: jobId,
				talent_id: talentId
			})
		}
	);

	if (response.ok) {
		return;
	}

	const payload = (await response.json().catch(() => null)) as { message?: unknown } | null;
	const message = toSafeMessage(payload?.message, 'Could not start background PDF import.');
	throw new Error(message);
};

export const POST: RequestHandler = async ({ params, cookies, request, url }) => {
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

	let cleanupBucket: string | null = null;
	let cleanupObjectPath: string | null = null;

	try {
		const { data: jobRow, error: jobError } = await adminClient
			.from('resume_import_jobs')
			.select(
				'id, talent_id, requested_by_user_id, status, source_filename, source_size_bytes, source_bucket, source_object_path'
			)
			.eq('id', jobId)
			.maybeSingle();

		if (jobError) {
			return json({ message: jobError.message }, { status: 500 });
		}
		if (!jobRow?.id) {
			return json({ message: 'Import job not found.' }, { status: 404 });
		}

		const job = jobRow as ResumeImportJobRow;
		if (job.status === 'succeeded') {
			return json({ ok: true, status: 'succeeded' });
		}
		if (job.status === 'processing') {
			return json({ ok: true, status: 'processing' });
		}
		if (job.status !== 'queued') {
			return json({ message: 'Import job cannot be started again.' }, { status: 409 });
		}

		const permissions = await getResumeEditPermissions(supabase, adminClient, job.talent_id);
		if (!permissions.canEdit || !permissions.userId) {
			await failJob(adminClient, jobId, 'Not authorized to create resumes for this talent.');
			return json(
				{ message: 'Not authorized to create resumes for this talent.' },
				{ status: 403 }
			);
		}
		if (permissions.userId !== job.requested_by_user_id) {
			await failJob(adminClient, jobId, 'Import job requester mismatch.');
			return json({ message: 'Import job requester mismatch.' }, { status: 403 });
		}

		if (!job.source_bucket || !job.source_object_path) {
			await failJob(
				adminClient,
				jobId,
				'Staged PDF could not be loaded. Please re-upload and try again.'
			);
			return json(
				{ message: 'Staged PDF could not be loaded. Please re-upload and try again.' },
				{ status: 400 }
			);
		}

		if (shouldUseNetlifyBackgroundImport()) {
			await startNetlifyBackgroundImport(request, url, jobId, job.talent_id);
			return json({ ok: true, status: 'queued' }, { status: 202 });
		}

		cleanupBucket = job.source_bucket;
		cleanupObjectPath = job.source_object_path;

		const { data: talent, error: talentError } = await adminClient
			.from('talents')
			.select('id, first_name, last_name')
			.eq('id', job.talent_id)
			.maybeSingle();

		if (talentError || !talent?.id) {
			await failJob(adminClient, jobId, 'Talent not found.');
			return json({ message: 'Talent not found.' }, { status: 404 });
		}

		await updateJob(adminClient, jobId, {
			status: 'processing',
			error_message: null,
			started_at: new Date().toISOString(),
			completed_at: null
		});

		const { data: stagedFile, error: downloadError } = await adminClient.storage
			.from(job.source_bucket)
			.download(job.source_object_path);

		if (downloadError || !stagedFile) {
			throw new Error('Staged PDF could not be loaded. Please re-upload and try again.');
		}

		const stagedArrayBuffer = await readBlobArrayBuffer(stagedFile);
		if (!stagedArrayBuffer) {
			throw new Error('Staged PDF could not be read. Please re-upload and try again.');
		}

		const fileBytes = new Uint8Array(stagedArrayBuffer);
		if (fileBytes.byteLength === 0) {
			throw new Error('Staged PDF is empty. Please re-upload and try again.');
		}
		if (fileBytes.byteLength > MAX_PDF_BYTES) {
			throw new Error('Staged PDF is too large. Max size is 10MB.');
		}
		if (job.source_size_bytes && job.source_size_bytes !== fileBytes.byteLength) {
			throw new Error('Staged PDF size does not match queued import metadata.');
		}

		const personName =
			[talent.first_name, talent.last_name].filter(Boolean).join(' ').trim() || 'Talent';
		const imported = await importResumeFromPdf({
			pdfBytes: fileBytes,
			filename: job.source_filename || 'resume.pdf',
			personName
		});

		const versionName = imported.versionNameEn || 'Imported Resume';
		const { data: createdResume, error: createResumeError } = await adminClient
			.from('resumes')
			.insert({
				talent_id: job.talent_id,
				version_name: versionName,
				is_main: false,
				is_active: true,
				allow_word_export: false,
				preview_html: null
			})
			.select('id, version_name')
			.single();

		if (createResumeError || !createdResume?.id) {
			throw new Error(createResumeError?.message ?? 'Failed to create imported resume.');
		}

		await saveResumeData(adminClient, String(createdResume.id), job.talent_id, imported.content);

		await updateJob(adminClient, jobId, {
			status: 'succeeded',
			error_message: null,
			resume_id: createdResume.id,
			resume_version_name: createdResume.version_name ?? versionName,
			usage: imported.usage ?? null,
			completed_at: new Date().toISOString()
		});

		return json({ ok: true, status: 'succeeded', resume_id: String(createdResume.id) });
	} catch (error) {
		const message = toSafeMessage(
			error instanceof Error ? error.message : undefined,
			'Could not import resume from PDF right now.'
		);

		await failJob(adminClient, jobId, message).catch((failError) => {
			console.error('[resume-import/start] Failed to mark job as failed', failError);
		});

		if (error instanceof ResumePdfImportError) {
			return json({ message }, { status: error.status });
		}

		return json({ message }, { status: 500 });
	} finally {
		if (cleanupBucket && cleanupObjectPath) {
			await adminClient.storage
				.from(cleanupBucket)
				.remove([cleanupObjectPath])
				.catch((cleanupError) => {
					console.warn('[resume-import/start] Failed to remove staged PDF', cleanupError);
				});

			await updateJob(adminClient, jobId, {
				source_deleted_at: new Date().toISOString()
			}).catch((cleanupError) => {
				console.warn('[resume-import/start] Failed to mark staged PDF deleted', cleanupError);
			});
		}
	}
};
