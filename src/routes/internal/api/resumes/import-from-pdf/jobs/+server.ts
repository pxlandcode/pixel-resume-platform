import { json, type RequestHandler } from '@sveltejs/kit';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { getResumeEditPermissions } from '$lib/server/resumes/permissions';

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_FILENAME_LENGTH = 240;

const sanitizeFilename = (value: unknown): string => {
	if (typeof value !== 'string') return '';
	const trimmed = value.trim();
	return trimmed ? trimmed.slice(0, MAX_FILENAME_LENGTH) : '';
};

const parseSizeBytes = (value: unknown): number | null => {
	if (typeof value !== 'number') return null;
	if (!Number.isInteger(value)) return null;
	if (value <= 0) return null;
	if (value > MAX_PDF_BYTES) return null;
	return value;
};

export const POST: RequestHandler = async ({ request, cookies }) => {
	const accessToken = cookies.get(AUTH_COOKIE_NAMES.access) ?? null;
	const supabase = createSupabaseServerClient(accessToken);
	const adminClient = getSupabaseAdminClient();

	if (!supabase || !adminClient) {
		return json({ message: 'Unauthorized.' }, { status: 401 });
	}

	let payload: {
		person_id?: unknown;
		filename?: unknown;
		size_bytes?: unknown;
	};

	try {
		payload = (await request.json()) as typeof payload;
	} catch {
		return json({ message: 'Invalid request payload.' }, { status: 400 });
	}

	const personId = typeof payload.person_id === 'string' ? payload.person_id.trim() : '';
	const filename = sanitizeFilename(payload.filename);
	const sizeBytes = parseSizeBytes(payload.size_bytes);

	if (!personId) {
		return json({ message: 'Invalid person id.' }, { status: 400 });
	}

	if (!filename) {
		return json({ message: 'Invalid filename.' }, { status: 400 });
	}

	if (!filename.toLowerCase().endsWith('.pdf')) {
		return json({ message: 'Only PDF files are allowed.' }, { status: 400 });
	}

	if (sizeBytes === null) {
		return json({ message: 'Invalid file size. Max size is 10MB.' }, { status: 400 });
	}

	const [{ data: profile, error: profileError }, permissions] = await Promise.all([
		adminClient.from('profiles').select('id').eq('id', personId).maybeSingle(),
		getResumeEditPermissions(supabase, adminClient, personId)
	]);

	if (profileError || !profile?.id) {
		return json({ message: 'Profile not found.' }, { status: 404 });
	}

	if (!permissions.canEdit || !permissions.userId) {
		return json({ message: 'Not authorized to create resumes for this user.' }, { status: 403 });
	}

	const now = new Date().toISOString();
	const model = process.env.LLM_MODEL_PDF_IMPORT?.trim() || process.env.LLM_MODEL?.trim() || null;
	const { data: created, error: createError } = await adminClient
		.from('resume_import_jobs')
		.insert({
			person_id: personId,
			requested_by_user_id: permissions.userId,
			status: 'queued',
			source_filename: filename,
			source_size_bytes: sizeBytes,
			model,
			created_at: now,
			updated_at: now
		})
		.select('id')
		.single();

	if (createError || !created?.id) {
		return json(
			{ message: createError?.message ?? 'Failed to create import job.' },
			{ status: 500 }
		);
	}

	return json({ job_id: String(created.id) });
};
