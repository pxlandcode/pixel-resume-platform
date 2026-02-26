import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { getResumeEditPermissions } from '$lib/server/resumes/permissions';
import {
	generateResumeProjectText,
	type ResumeAiFieldKey,
	type ResumeAiLanguage,
	type ResumeAiSectionType
} from '$lib/server/resumes/aiWriter';

type GenerateBody = {
	prompt?: unknown;
	language?: unknown;
	sectionType?: unknown;
	company?: unknown;
	role?: unknown;
	location?: unknown;
	technologies?: unknown;
	startDate?: unknown;
	endDate?: unknown;
	unlockedFields?: unknown;
	currentText?: unknown;
	consultantName?: unknown;
	resumeContext?: unknown;
};

const asString = (value: unknown) => (typeof value === 'string' ? value : '');
const asStringArray = (value: unknown) =>
	Array.isArray(value)
		? value
				.filter((entry): entry is string => typeof entry === 'string')
				.map((entry) => entry.trim())
				.filter(Boolean)
		: [];

const ALLOWED_FIELD_KEYS: ResumeAiFieldKey[] = [
	'company',
	'role',
	'location',
	'technologies',
	'startDate',
	'endDate'
];

const asFieldKeyArray = (value: unknown): ResumeAiFieldKey[] => {
	const items = asStringArray(value);
	const deduped = Array.from(
		new Set(
			items.filter((entry): entry is ResumeAiFieldKey =>
				ALLOWED_FIELD_KEYS.includes(entry as ResumeAiFieldKey)
			)
		)
	);
	return deduped;
};

const asSafeStatusCode = (value: unknown): number | null => {
	const parsed = Number(value);
	if (!Number.isInteger(parsed)) return null;
	if (parsed < 400 || parsed > 599) return null;
	return parsed;
};

const asSafeMessage = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed ? trimmed.slice(0, 240) : null;
};

const getErrorLogPayload = (error: unknown): Record<string, unknown> => {
	if (!error || typeof error !== 'object') {
		return { error: String(error) };
	}

	const record = error as Record<string, unknown>;
	const headersCandidate = record.headers;
	const responseCandidate =
		record.response && typeof record.response === 'object'
			? (record.response as Record<string, unknown>)
			: null;
	const responseHeadersCandidate = responseCandidate?.headers;
	let requestId: string | undefined;

	const tryReadRequestIdFromHeaders = (headers: unknown): string | undefined => {
		if (!headers || typeof headers !== 'object') return undefined;
		const withGetter = headers as { get?: (name: string) => string | null };
		if (typeof withGetter.get === 'function') {
			const fromGetter = withGetter.get('x-request-id') ?? withGetter.get('X-Request-Id');
			if (typeof fromGetter === 'string' && fromGetter.trim()) {
				return fromGetter.trim();
			}
		}

		const asRecord = headers as Record<string, unknown>;
		const direct =
			(typeof asRecord['x-request-id'] === 'string' ? asRecord['x-request-id'] : undefined) ??
			(typeof asRecord['X-Request-Id'] === 'string' ? asRecord['X-Request-Id'] : undefined);
		return direct?.trim() || undefined;
	};

	requestId = tryReadRequestIdFromHeaders(headersCandidate);
	if (!requestId) {
		requestId = tryReadRequestIdFromHeaders(responseHeadersCandidate);
	}

	if (!requestId && typeof record.request_id === 'string' && record.request_id.trim()) {
		requestId = record.request_id.trim();
	}

	return {
		name: typeof record.name === 'string' ? record.name : undefined,
		status: asSafeStatusCode(record.status),
		code: typeof record.code === 'string' ? record.code : undefined,
		type: typeof record.type === 'string' ? record.type : undefined,
		requestId,
		message: asSafeMessage(record.message)
	};
};

const formatGenerationError = (error: unknown): { status: number; message: string } => {
	const fallback = { status: 502, message: 'Could not generate text right now.' };
	if (!error || typeof error !== 'object') {
		return fallback;
	}

	const record = error as Record<string, unknown>;
	const status = asSafeStatusCode(record.status) ?? fallback.status;
	const code = typeof record.code === 'string' ? record.code : '';
	const message = asSafeMessage(record.message);

	if (status === 429 || code === 'insufficient_quota') {
		return {
			status: 429,
			message: 'OpenAI quota exceeded. Please check billing and usage limits.'
		};
	}

	if (status === 401 || status === 403) {
		return {
			status,
			message: 'OpenAI authentication failed. Check API key and project access.'
		};
	}

	if (status === 404 && message?.toLowerCase().includes('model')) {
		return {
			status,
			message: 'Configured OpenAI model is unavailable. Update LLM_MODEL.'
		};
	}

	return {
		status,
		message: message ?? fallback.message
	};
};

export const POST: RequestHandler = async ({ params, request, cookies }) => {
	const resumeId = params.id;
	if (!resumeId) {
		return json({ message: 'Invalid resume id.' }, { status: 400 });
	}

	const accessToken = cookies.get(AUTH_COOKIE_NAMES.access) ?? null;
	const supabase = createSupabaseServerClient(accessToken);
	const adminClient = getSupabaseAdminClient();
	if (!supabase || !adminClient) {
		return json({ message: 'Unauthorized.' }, { status: 401 });
	}

	const { data: resumeRow, error: resumeError } = await adminClient
		.from('resumes')
		.select('id, user_id')
		.eq('id', resumeId)
		.maybeSingle();

	if (resumeError || !resumeRow?.user_id) {
		return json({ message: 'Resume not found.' }, { status: 404 });
	}

	const permissions = await getResumeEditPermissions(supabase, adminClient, resumeRow.user_id);
	if (!permissions.canEdit) {
		return json({ message: 'Not authorized to generate resume text.' }, { status: 403 });
	}

	const body = (await request.json().catch(() => null)) as GenerateBody | null;
	if (!body || typeof body !== 'object') {
		return json({ message: 'Invalid request body.' }, { status: 400 });
	}

	const language = body.language === 'en' ? 'en' : 'sv';
	const sectionType =
		body.sectionType === 'highlighted' ||
		body.sectionType === 'summary' ||
		body.sectionType === 'exampleSkills'
			? body.sectionType
			: 'experience';
	const prompt = asString(body.prompt).trim();
	if (!prompt) {
		return json({ message: 'Prompt is required.' }, { status: 400 });
	}

	try {
		const result = await generateResumeProjectText({
			prompt,
			language: language as ResumeAiLanguage,
			sectionType: sectionType as ResumeAiSectionType,
			company: asString(body.company),
			role: asString(body.role),
			location: asString(body.location),
			technologies: asStringArray(body.technologies),
			startDate: asString(body.startDate),
			endDate:
				body.endDate === null ? null : typeof body.endDate === 'string' ? body.endDate : undefined,
			unlockedFields: asFieldKeyArray(body.unlockedFields),
			currentText: asString(body.currentText),
			consultantName: asString(body.consultantName),
			resumeContext: asString(body.resumeContext)
		});

		return json({ result });
	} catch (error) {
		console.error('[resume ai-write] generation failed', getErrorLogPayload(error));
		const { status, message } = formatGenerationError(error);
		return json({ message }, { status });
	}
};
