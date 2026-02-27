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
		talent_id?: unknown;
		filename?: unknown;
		size_bytes?: unknown;
	};

	try {
		payload = (await request.json()) as typeof payload;
	} catch {
		return json({ message: 'Invalid request payload.' }, { status: 400 });
	}

	const talentId = typeof payload.talent_id === 'string' ? payload.talent_id.trim() : '';
	const filename = sanitizeFilename(payload.filename);
	const sizeBytes = parseSizeBytes(payload.size_bytes);

	if (!talentId) {
		return json({ message: 'Invalid talent id.' }, { status: 400 });
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

	const [{ data: talent, error: talentError }, permissions] = await Promise.all([
		adminClient.from('talents').select('id').eq('id', talentId).maybeSingle(),
		getResumeEditPermissions(supabase, adminClient, talentId)
	]);

	if (talentError || !talent?.id) {
		return json({ message: 'Talent not found.' }, { status: 404 });
	}

	if (!permissions.canEdit || !permissions.userId) {
		return json({ message: 'Not authorized to create resumes for this talent.' }, { status: 403 });
	}

	const now = new Date().toISOString();
	const model = process.env.LLM_MODEL_PDF_IMPORT?.trim() || process.env.LLM_MODEL?.trim() || null;
	const { data: created, error: createError } = await adminClient
		.from('resume_import_jobs')
		.insert({
			talent_id: talentId,
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
