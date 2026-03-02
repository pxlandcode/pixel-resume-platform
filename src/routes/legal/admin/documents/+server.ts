import { error, json, type RequestHandler } from '@sveltejs/kit';
import sanitizeHtml from 'sanitize-html';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { getActorAccessContext } from '$lib/server/access';

const LEGAL_DOC_TYPES = new Set(['tos', 'privacy', 'ai_notice', 'data_sharing']);

const htmlSanitizeOptions: sanitizeHtml.IOptions = {
	allowedTags: [
		'h1',
		'h2',
		'h3',
		'h4',
		'h5',
		'h6',
		'p',
		'ul',
		'ol',
		'li',
		'blockquote',
		'pre',
		'code',
		'strong',
		'em',
		'b',
		'i',
		'u',
		'a',
		'table',
		'thead',
		'tbody',
		'tr',
		'th',
		'td',
		'hr',
		'br',
		'div',
		'span'
	],
	allowedAttributes: {
		a: ['href', 'name', 'target', 'rel'],
		th: ['colspan', 'rowspan'],
		td: ['colspan', 'rowspan'],
		div: ['class'],
		span: ['class']
	},
	allowedSchemes: ['http', 'https', 'mailto'],
	allowProtocolRelative: false
};

const requireAdminContext = async (accessToken: string | null) => {
	const supabase = createSupabaseServerClient(accessToken);
	const adminClient = getSupabaseAdminClient();

	if (!supabase || !adminClient) {
		throw error(401, 'Unauthorized');
	}

	const actor = await getActorAccessContext(supabase, adminClient);
	if (!actor.userId || !actor.isAdmin) {
		throw error(403, 'Only admins can manage legal documents.');
	}

	return { supabase, adminClient, actor };
};

const normalizeBoolean = (value: unknown) =>
	value === true || value === 'true' || value === '1' || value === 'on';

const parseRequestBody = async (request: Request) => {
	const contentType = request.headers.get('content-type') || '';

	if (contentType.includes('application/json')) {
		const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
		return {
			docType: payload.doc_type,
			version: payload.version,
			effectiveDate: payload.effective_date,
			contentHtml: payload.content_html,
			isActive: payload.is_active
		};
	}

	const formData = await request.formData();
	return {
		docType: formData.get('doc_type'),
		version: formData.get('version'),
		effectiveDate: formData.get('effective_date'),
		contentHtml: formData.get('content_html'),
		isActive: formData.get('is_active')
	};
};

export const GET: RequestHandler = async ({ cookies }) => {
	const { adminClient } = await requireAdminContext(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);

	const { data, error: queryError } = await adminClient
		.from('legal_documents')
		.select('id, doc_type, version, content_html, effective_date, is_active, created_at')
		.order('doc_type', { ascending: true })
		.order('effective_date', { ascending: false })
		.order('created_at', { ascending: false });

	if (queryError) {
		return json({ message: queryError.message }, { status: 500 });
	}

	return json({ documents: data ?? [] });
};

export const POST: RequestHandler = async ({ request, cookies }) => {
	const { adminClient } = await requireAdminContext(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);

	const parsed = await parseRequestBody(request);
	const docType = typeof parsed.docType === 'string' ? parsed.docType.trim() : '';
	const version = typeof parsed.version === 'string' ? parsed.version.trim() : '';
	const effectiveDate = typeof parsed.effectiveDate === 'string' ? parsed.effectiveDate.trim() : '';
	const rawHtml = typeof parsed.contentHtml === 'string' ? parsed.contentHtml : '';
	const isActive = normalizeBoolean(parsed.isActive);

	if (!LEGAL_DOC_TYPES.has(docType)) {
		return json({ message: 'Invalid legal document type.' }, { status: 400 });
	}
	if (!version) {
		return json({ message: 'Version is required.' }, { status: 400 });
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
		return json({ message: 'Effective date must be in YYYY-MM-DD format.' }, { status: 400 });
	}

	const sanitizedHtml = sanitizeHtml(rawHtml, htmlSanitizeOptions).trim();
	if (!sanitizedHtml) {
		return json({ message: 'Legal document HTML is empty after sanitization.' }, { status: 400 });
	}

	const { data: insertedDoc, error: insertError } = await adminClient
		.from('legal_documents')
		.insert({
			doc_type: docType,
			version,
			content_html: sanitizedHtml,
			effective_date: effectiveDate,
			is_active: false
		})
		.select('id, doc_type, version, content_html, effective_date, is_active, created_at')
		.single();

	if (insertError || !insertedDoc?.id) {
		return json({ message: insertError?.message ?? 'Could not create legal document.' }, { status: 500 });
	}

	if (isActive) {
		const { error: deactivateError } = await adminClient
			.from('legal_documents')
			.update({ is_active: false })
			.eq('doc_type', docType)
			.neq('id', insertedDoc.id);

		if (deactivateError) {
			return json({ message: deactivateError.message }, { status: 500 });
		}

		const { error: activateError } = await adminClient
			.from('legal_documents')
			.update({ is_active: true })
			.eq('id', insertedDoc.id)
			.eq('doc_type', docType);

		if (activateError) {
			return json({ message: activateError.message }, { status: 500 });
		}
	}

	return json({
		ok: true,
		document: {
			...insertedDoc,
			is_active: isActive
		}
	});
};
