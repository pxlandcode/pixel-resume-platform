import { json, type RequestHandler } from '@sveltejs/kit';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { getResumeEditPermissions } from '$lib/server/resumes/permissions';
import { importResumeFromPdf, ResumePdfImportError } from '$lib/server/resumes/pdfImport';

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['application/pdf']);

const toSafeMessage = (value: unknown, fallback: string): string => {
	if (typeof value !== 'string') return fallback;
	const trimmed = value.trim();
	return trimmed ? trimmed.slice(0, 300) : fallback;
};

const hasPdfExtension = (filename: string): boolean => filename.toLowerCase().endsWith('.pdf');

export const POST: RequestHandler = async ({ request, cookies }) => {
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
	const personId = formData.get('person_id');
	const file = formData.get('file');

	if (typeof personId !== 'string' || !personId.trim()) {
		return json({ message: 'Invalid person id.' }, { status: 400 });
	}

	const isUploadFile =
		!!file &&
		typeof file === 'object' &&
		typeof (file as { arrayBuffer?: unknown }).arrayBuffer === 'function';

	if (!isUploadFile) {
		return json({ message: 'PDF file is required.' }, { status: 400 });
	}

	const uploadFile = file as File;
	const filename = uploadFile.name || 'resume.pdf';
	const mimeType = (uploadFile.type || '').toLowerCase();
	if (!ALLOWED_MIME_TYPES.has(mimeType) && !hasPdfExtension(filename)) {
		return json({ message: 'Only PDF files are allowed.' }, { status: 400 });
	}

	const fileBytes = new Uint8Array(await uploadFile.arrayBuffer());
	if (fileBytes.byteLength === 0) {
		return json({ message: 'PDF file is empty.' }, { status: 400 });
	}

	if (fileBytes.byteLength > MAX_PDF_BYTES) {
		return json({ message: 'PDF file is too large. Max size is 10MB.' }, { status: 400 });
	}

	const { data: profile, error: profileError } = await adminClient
		.from('profiles')
		.select('id, first_name, last_name')
		.eq('id', personId)
		.maybeSingle();

	if (profileError || !profile?.id) {
		return json({ message: 'Profile not found.' }, { status: 404 });
	}

	const { canEdit } = await getResumeEditPermissions(supabase, adminClient, personId);
	if (!canEdit) {
		return json({ message: 'Not authorized to create resumes for this user.' }, { status: 403 });
	}

	const personName =
		[profile.first_name, profile.last_name].filter(Boolean).join(' ').trim() || 'Consultant';

	try {
		const imported = await importResumeFromPdf({
			pdfBytes: fileBytes,
			filename,
			personName
		});

		const versionName = imported.versionNameEn || 'Imported Resume';

		const { data: created, error: createError } = await adminClient
			.from('resumes')
			.insert({
				user_id: personId,
				version_name: versionName,
				is_main: false,
				is_active: true,
				allow_word_export: false,
				content: imported.content,
				preview_html: null
			})
			.select('id, version_name')
			.single();

		if (createError || !created?.id) {
			return json(
				{ message: createError?.message ?? 'Failed to create imported resume.' },
				{ status: 500 }
			);
		}

		return json({
			id: String(created.id),
			version_name: created.version_name ?? versionName
		});
	} catch (error) {
		if (error instanceof ResumePdfImportError) {
			return json({ message: error.message }, { status: error.status });
		}

		const status =
			typeof error === 'object' &&
			error !== null &&
			typeof (error as { status?: unknown }).status === 'number'
				? (error as { status: number }).status < 400 || (error as { status: number }).status > 599
					? 502
					: (error as { status: number }).status
				: 502;

		const message = toSafeMessage(
			typeof error === 'object' && error !== null
				? (error as { message?: unknown }).message
				: undefined,
			'Could not import resume from PDF right now.'
		);

		return json({ message }, { status });
	}
};
