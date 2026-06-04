import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const AUTH_COOKIE_ACCESS = 'sb-access-token';

type NetlifyEvent = {
	body: string | null;
	headers: Record<string, string | undefined>;
	httpMethod: string;
	isBase64Encoded?: boolean;
	path?: string;
};

type NetlifyResponse = {
	statusCode: number;
	headers?: Record<string, string>;
	body: string;
};

const jsonResponse = (statusCode: number, body: Record<string, unknown>): NetlifyResponse => ({
	statusCode,
	headers: {
		'content-type': 'application/json; charset=utf-8'
	},
	body: JSON.stringify(body)
});

const getCookieValue = (cookieHeader: string | undefined, key: string): string | null => {
	if (!cookieHeader) return null;
	const parts = cookieHeader.split(';');
	for (const part of parts) {
		const [rawName, ...rest] = part.trim().split('=');
		if (rawName !== key) continue;
		return decodeURIComponent(rest.join('=') || '');
	}
	return null;
};

const getRequiredEnv = (names: string | string[]): string => {
	const keys = Array.isArray(names) ? names : [names];
	for (const name of keys) {
		const value = process.env[name]?.trim();
		if (value) return value;
	}
	throw new Error(`${keys.join(' or ')} is required.`);
};

const createSupabaseClients = (
	accessToken: string
): { supabase: SupabaseClient; adminClient: SupabaseClient } => {
	const supabaseUrl = getRequiredEnv('SUPABASE_URL');
	const supabasePublishableKey = getRequiredEnv(['SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY']);
	const secretKey = getRequiredEnv(['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY']);

	const supabase = createClient(supabaseUrl, supabasePublishableKey, {
		global: {
			headers: {
				Authorization: `Bearer ${accessToken}`
			}
		},
		auth: {
			persistSession: false,
			autoRefreshToken: false
		}
	});

	const adminClient = createClient(supabaseUrl, secretKey, {
		auth: {
			persistSession: false,
			autoRefreshToken: false
		}
	});

	return { supabase, adminClient };
};

const toSafeMessage = (value: unknown, fallback: string): string => {
	if (typeof value !== 'string') return fallback;
	const trimmed = value.trim();
	return trimmed ? trimmed.slice(0, 300) : fallback;
};

const getErrorStatus = (error: unknown, fallback = 500) =>
	typeof error === 'object' &&
	error !== null &&
	typeof (error as { status?: unknown }).status === 'number'
		? (error as { status: number }).status
		: fallback;

const logPhase = (
	phase: string,
	meta: Record<string, unknown> = {},
	level: 'info' | 'warn' | 'error' = 'info'
) => {
	const payload = { phase, ...meta };
	if (level === 'error') {
		console.error('[resume-search-bg]', payload);
		return;
	}
	if (level === 'warn') {
		console.warn('[resume-search-bg]', payload);
		return;
	}
	console.info('[resume-search-bg]', payload);
};

console.info('[resume-search-bg] module:loaded');

export const handler = async (event: NetlifyEvent): Promise<NetlifyResponse> => {
	const requestId = event.headers['x-nf-request-id'] ?? null;
	const startedAtMs = Date.now();
	let jobId = '';

	try {
		logPhase('handler:entered', {
			request_id: requestId,
			method: event.httpMethod || 'POST',
			path: event.path || null
		});

		const payload = JSON.parse(
			event.body
				? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8').toString('utf8')
				: '{}'
		) as { job_id?: unknown };
		jobId = typeof payload.job_id === 'string' ? payload.job_id.trim() : '';
		if (!jobId) {
			return jsonResponse(400, { message: 'Missing job_id.' });
		}

		const accessToken = getCookieValue(event.headers.cookie, AUTH_COOKIE_ACCESS);
		if (!accessToken) {
			return jsonResponse(401, { message: 'Unauthorized.' });
		}

		const [{ getActorAccessContext }, { runResumeSearchJob }] = await Promise.all([
			import('../../src/lib/server/access'),
			import('../../src/lib/server/resumes/searchJobs')
		]);
		const clients = createSupabaseClients(accessToken);
		const actor = await getActorAccessContext(clients.supabase, clients.adminClient);
		if (!actor.userId) {
			return jsonResponse(401, { message: 'Unauthorized.' });
		}

		logPhase('job:start', { job_id: jobId, request_id: requestId });
		const job = await runResumeSearchJob({
			adminClient: clients.adminClient,
			actor,
			jobId,
			requestId
		});
		logPhase('job:done', {
			job_id: jobId,
			status: job.status,
			duration_ms: Date.now() - startedAtMs,
			request_id: requestId
		});

		return jsonResponse(202, { ok: true, status: job.status });
	} catch (error) {
		const status = getErrorStatus(error);
		const message = toSafeMessage(
			error instanceof Error ? error.message : undefined,
			'Could not run background resume search.'
		);
		logPhase(
			'job:failed',
			{
				job_id: jobId || null,
				status,
				message,
				duration_ms: Date.now() - startedAtMs,
				request_id: requestId
			},
			'error'
		);
		return jsonResponse(status >= 400 && status <= 599 ? status : 500, { message });
	}
};
