import { json, type RequestHandler } from '@sveltejs/kit';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { getResumeEditPermissions } from '$lib/server/resumes/permissions';

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['application/pdf']);
const RESUME_IMPORTS_TEMP_BUCKET = 'resume-imports-temp';

type ResumeImportJobRow = {
	id: string;
	person_id: string;
	requested_by_user_id: string;
	status: 'queued' | 'processing' | 'succeeded' | 'failed';
	source_size_bytes: number;
	source_bucket?: string | null;
	source_object_path?: string | null;
};

const hasPdfExtension = (filename: string): boolean => filename.toLowerCase().endsWith('.pdf');

const sanitizeName = (value: string) => {
	const nameWithoutExtension = value.replace(/\.[^/.]+$/, '');
	const normalized =
		nameWithoutExtension
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 120) || 'resume';

	return normalized;
};

const isUploadFile = (
	value: FormDataEntryValue | null
): value is File & { arrayBuffer: () => Promise<ArrayBuffer> } =>
	!!value &&
	typeof value === 'object' &&
	typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function';

export const POST: RequestHandler = async ({ params, request, cookies }) => {
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

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return json({ message: 'Invalid upload payload.' }, { status: 400 });
	}

	const personId =
		typeof formData.get('person_id') === 'string' ? String(formData.get('person_id')).trim() : '';
	const file = formData.get('file');

	if (!personId) {
		return json({ message: 'Invalid person id.' }, { status: 400 });
	}

	if (!isUploadFile(file)) {
		return json({ message: 'PDF file is required.' }, { status: 400 });
	}

	const filename = file.name || 'resume.pdf';
	const mimeType = (file.type || '').toLowerCase();
	if (!ALLOWED_MIME_TYPES.has(mimeType) && !hasPdfExtension(filename)) {
		return json({ message: 'Only PDF files are allowed.' }, { status: 400 });
	}

	const fileBytes = new Uint8Array(await file.arrayBuffer());
	if (fileBytes.byteLength === 0) {
		return json({ message: 'PDF file is empty.' }, { status: 400 });
	}
	if (fileBytes.byteLength > MAX_PDF_BYTES) {
		return json({ message: 'PDF file is too large. Max size is 10MB.' }, { status: 400 });
	}

	const { data: jobRow, error: jobError } = await adminClient
		.from('resume_import_jobs')
		.select(
			'id, person_id, requested_by_user_id, status, source_size_bytes, source_bucket, source_object_path'
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
	if (job.person_id !== personId) {
		return json({ message: 'Import job does not match target profile.' }, { status: 400 });
	}

	if (job.status !== 'queued') {
		return json({ message: 'Import job is not ready for file upload.' }, { status: 409 });
	}

	if (typeof job.source_size_bytes === 'number' && job.source_size_bytes !== fileBytes.byteLength) {
		return json(
			{ message: 'Uploaded file does not match queued import metadata.' },
			{ status: 400 }
		);
	}

	const permissions = await getResumeEditPermissions(supabase, adminClient, personId);
	if (!permissions.canEdit || !permissions.userId) {
		return json({ message: 'Not authorized to create resumes for this user.' }, { status: 403 });
	}

	if (permissions.userId !== job.requested_by_user_id) {
		return json({ message: 'Import job requester mismatch.' }, { status: 403 });
	}

	// Best-effort cleanup if a queued job is being re-staged.
	if (job.source_bucket && job.source_object_path) {
		await adminClient.storage.from(job.source_bucket).remove([job.source_object_path]);
	}

	const sanitized = sanitizeName(filename);
	const objectPath = `resume-imports/${personId}/${jobId}-${Date.now()}-${sanitized}.pdf`;

	const { error: uploadError } = await adminClient.storage
		.from(RESUME_IMPORTS_TEMP_BUCKET)
		.upload(objectPath, fileBytes, {
			contentType: 'application/pdf',
			cacheControl: '3600',
			upsert: false
		});

	if (uploadError) {
		console.error('[resume-import/stage-file] Failed to store staged PDF', uploadError);
		return json({ message: uploadError.message }, { status: 500 });
	}

	const now = new Date().toISOString();
	const { error: updateError } = await adminClient
		.from('resume_import_jobs')
		.update({
			source_bucket: RESUME_IMPORTS_TEMP_BUCKET,
			source_object_path: objectPath,
			source_uploaded_at: now,
			source_deleted_at: null,
			error_message: null,
			updated_at: now
		})
		.eq('id', jobId);

	if (updateError) {
		console.error(
			'[resume-import/stage-file] Failed to update import job with staged file path',
			updateError
		);
		// Best-effort cleanup if DB update fails after upload
		await adminClient.storage.from(RESUME_IMPORTS_TEMP_BUCKET).remove([objectPath]);
		return json({ message: updateError.message }, { status: 500 });
	}

	return json({
		ok: true,
		job_id: jobId,
		source_bucket: RESUME_IMPORTS_TEMP_BUCKET,
		source_object_path: objectPath
	});
};
