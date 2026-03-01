import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const AUTH_COOKIE_ACCESS = 'sb-access-token';
const MAX_PDF_BYTES = 10 * 1024 * 1024;

type NetlifyEvent = {
	body: string | null;
	headers: Record<string, string | undefined>;
	httpMethod: string;
	isBase64Encoded?: boolean;
	path?: string;
	rawUrl?: string;
};

type NetlifyResponse = {
	statusCode: number;
	headers?: Record<string, string>;
	body: string;
};

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

type ResumePdfImportErrorLike = Error & {
	status?: number;
	name?: string;
};

const jsonResponse = (statusCode: number, body: Record<string, unknown>): NetlifyResponse => ({
	statusCode,
	headers: {
		'content-type': 'application/json; charset=utf-8'
	},
	body: JSON.stringify(body)
});

const toSafeMessage = (value: unknown, fallback: string): string => {
	if (typeof value !== 'string') return fallback;
	const trimmed = value.trim();
	return trimmed ? trimmed.slice(0, 300) : fallback;
};

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

const toRequest = (event: NetlifyEvent): Request => {
	const headers = new Headers();
	for (const [key, value] of Object.entries(event.headers ?? {})) {
		if (typeof value === 'string') {
			headers.set(key, value);
		}
	}

	const body =
		typeof event.body === 'string'
			? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8')
			: undefined;

	const url =
		event.rawUrl ||
		`https://${event.headers.host || 'localhost'}${event.path || '/.netlify/functions/resume-import-from-pdf-background'}`;

	return new Request(url, {
		method: event.httpMethod || 'POST',
		headers,
		body
	});
};

const logPhase = (
	phase: string,
	meta: Record<string, unknown> = {},
	level: 'info' | 'warn' | 'error' = 'info'
) => {
	const payload = { phase, ...meta };
	if (level === 'error') {
		console.error('[resume-import-bg]', payload);
		return;
	}
	if (level === 'warn') {
		console.warn('[resume-import-bg]', payload);
		return;
	}
	console.info('[resume-import-bg]', payload);
};

const updateJob = async (
	adminClient: SupabaseClient,
	jobId: string,
	patch: Record<string, unknown>
) => {
	const now = new Date().toISOString();
	const { error } = await adminClient
		.from('resume_import_jobs')
		.update({ ...patch, updated_at: now })
		.eq('id', jobId);

	if (error) {
		throw new Error(error.message);
	}
};

const failJob = async (
	adminClient: SupabaseClient,
	jobId: string,
	message: string,
	extra: Record<string, unknown> = {}
) => {
	await updateJob(adminClient, jobId, {
		status: 'failed',
		error_message: toSafeMessage(message, 'Could not import resume from PDF right now.'),
		completed_at: new Date().toISOString(),
		...extra
	});
};

console.info('[resume-import-bg] module:loaded');

export const handler = async (event: NetlifyEvent): Promise<NetlifyResponse> => {
	const requestId = event.headers['x-nf-request-id'] ?? null;
	const startedAtMs = Date.now();

	let jobId = '';
	let talentId = '';
	let filename = '';
	let sizeBytes = 0;
	let adminClient: SupabaseClient | null = null;
	let cleanupBucket: string | null = null;
	let cleanupObjectPath: string | null = null;

	try {
		logPhase('handler:entered', {
			request_id: requestId,
			method: event.httpMethod || 'POST',
			path: event.path || null
		});

		const [{ getResumeEditPermissions }, { importResumeFromPdf }, { saveResumeData }] =
			await Promise.all([
				import('../../src/lib/server/resumes/permissions'),
				import('../../src/lib/server/resumes/pdfImport'),
				import('../../src/lib/server/resumes/store')
			]);

		const request = toRequest(event);
		const payload = (await request.json().catch(() => null)) as {
			job_id?: unknown;
			talent_id?: unknown;
		} | null;

		jobId = typeof payload?.job_id === 'string' ? payload.job_id.trim() : '';
		const requestedTalentId =
			typeof payload?.talent_id === 'string' ? payload.talent_id.trim() : '';

		if (!jobId) {
			return jsonResponse(400, { message: 'Missing job_id.' });
		}

		const accessToken = getCookieValue(event.headers.cookie, AUTH_COOKIE_ACCESS);
		if (!accessToken) {
			return jsonResponse(401, { message: 'Unauthorized.' });
		}

		const clients = createSupabaseClients(accessToken);
		adminClient = clients.adminClient;

		const { data: jobRow, error: jobError } = await adminClient
			.from('resume_import_jobs')
			.select(
				'id, talent_id, requested_by_user_id, status, source_filename, source_size_bytes, source_bucket, source_object_path'
			)
			.eq('id', jobId)
			.maybeSingle();

		if (jobError) {
			return jsonResponse(500, { message: jobError.message });
		}

		if (!jobRow?.id) {
			return jsonResponse(404, { message: 'Import job not found.' });
		}

		const job = jobRow as ResumeImportJobRow;
		talentId = job.talent_id;
		filename = job.source_filename || 'resume.pdf';
		logPhase('job:loaded', {
			job_id: jobId,
			talent_id: talentId,
			status: job.status,
			source_bucket: job.source_bucket,
			source_object_path: job.source_object_path,
			request_id: requestId
		});

		if (requestedTalentId && requestedTalentId !== talentId) {
			await failJob(adminClient, jobId, 'Import job does not match target talent.', {
				request_id: requestId
			});
			return jsonResponse(400, { message: 'Import job does not match target talent.' });
		}

		if (job.status === 'succeeded') {
			logPhase('job:duplicate-succeeded', {
				job_id: jobId,
				talent_id: talentId,
				request_id: requestId
			});
			return jsonResponse(202, { ok: true, status: 'succeeded' });
		}

		if (job.status === 'processing') {
			logPhase('job:duplicate-processing', {
				job_id: jobId,
				talent_id: talentId,
				request_id: requestId
			});
			return jsonResponse(202, { ok: true, status: 'processing' });
		}

		if (job.status !== 'queued') {
			return jsonResponse(409, { message: 'Import job cannot be started again.' });
		}

		if (!job.source_bucket || !job.source_object_path) {
			await failJob(
				adminClient,
				jobId,
				'Staged PDF could not be loaded. Please re-upload and try again.',
				{
					request_id: requestId
				}
			);
			return jsonResponse(400, {
				message: 'Staged PDF could not be loaded. Please re-upload and try again.'
			});
		}

		cleanupBucket = job.source_bucket;
		cleanupObjectPath = job.source_object_path;

		const permissions = await getResumeEditPermissions(clients.supabase, adminClient, talentId);
		if (!permissions.canEdit || !permissions.userId) {
			await failJob(adminClient, jobId, 'Not authorized to create resumes for this talent.', {
				request_id: requestId
			});
			return jsonResponse(403, { message: 'Not authorized to create resumes for this talent.' });
		}

		if (permissions.userId !== job.requested_by_user_id) {
			await failJob(adminClient, jobId, 'Import job requester mismatch.', {
				request_id: requestId
			});
			return jsonResponse(403, { message: 'Import job requester mismatch.' });
		}

		const { data: talent, error: talentError } = await adminClient
			.from('talents')
			.select('id, first_name, last_name')
			.eq('id', talentId)
			.maybeSingle();

		if (talentError || !talent?.id) {
			await failJob(adminClient, jobId, 'Talent not found.', { request_id: requestId });
			return jsonResponse(404, { message: 'Talent not found.' });
		}

		const personName =
			[talent.first_name, talent.last_name].filter(Boolean).join(' ').trim() || 'Talent';
		const model =
			process.env.LLM_MODEL_PDF_IMPORT?.trim() || process.env.LLM_MODEL?.trim() || 'gpt-4o-mini';

		await updateJob(adminClient, jobId, {
			status: 'processing',
			error_message: null,
			request_id: requestId,
			model,
			started_at: new Date().toISOString(),
			completed_at: null
		});

		logPhase('job:started', {
			job_id: jobId,
			talent_id: talentId,
			filename,
			size_bytes: sizeBytes,
			model,
			request_id: requestId
		});

		logPhase('storage:download:start', {
			job_id: jobId,
			talent_id: talentId,
			source_bucket: cleanupBucket,
			source_object_path: cleanupObjectPath,
			request_id: requestId
		});
		const { data: stagedFile, error: downloadError } = await adminClient.storage
			.from(job.source_bucket)
			.download(job.source_object_path);

		if (downloadError || !stagedFile) {
			throw new Error('Staged PDF could not be loaded. Please re-upload and try again.');
		}

		const stagedArrayBuffer =
			typeof (stagedFile as { arrayBuffer?: unknown }).arrayBuffer === 'function'
				? await (stagedFile as Blob).arrayBuffer()
				: stagedFile instanceof ArrayBuffer
					? stagedFile
					: ArrayBuffer.isView(stagedFile)
						? stagedFile.buffer.slice(
								stagedFile.byteOffset,
								stagedFile.byteOffset + stagedFile.byteLength
							)
						: null;

		if (!stagedArrayBuffer) {
			throw new Error('Staged PDF could not be read. Please re-upload and try again.');
		}

		const fileBytes = new Uint8Array(stagedArrayBuffer);
		sizeBytes = fileBytes.byteLength;
		if (sizeBytes === 0) {
			throw new Error('Staged PDF is empty. Please re-upload and try again.');
		}
		if (sizeBytes > MAX_PDF_BYTES) {
			throw new Error('Staged PDF is too large. Max size is 10MB.');
		}
		if (job.source_size_bytes && job.source_size_bytes !== sizeBytes) {
			throw new Error('Staged PDF size does not match queued import metadata.');
		}

		logPhase('storage:download:done', {
			job_id: jobId,
			talent_id: talentId,
			size_bytes: sizeBytes,
			request_id: requestId
		});

		logPhase('openai:import:start', { job_id: jobId, talent_id: talentId, request_id: requestId });
		const imported = await importResumeFromPdf({
			pdfBytes: fileBytes,
			filename,
			personName
		});
		logPhase('openai:import:done', {
			job_id: jobId,
			talent_id: talentId,
			request_id: requestId,
			usage: imported.usage ?? null
		});

		const versionName = imported.versionNameEn || 'Imported Resume';
		const { data: createdResume, error: createResumeError } = await adminClient
			.from('resumes')
			.insert({
				talent_id: talentId,
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

		await saveResumeData(adminClient, String(createdResume.id), talentId, imported.content);

		logPhase('resume:inserted', {
			job_id: jobId,
			talent_id: talentId,
			resume_id: createdResume.id,
			request_id: requestId
		});

		await updateJob(adminClient, jobId, {
			status: 'succeeded',
			error_message: null,
			resume_id: createdResume.id,
			resume_version_name: createdResume.version_name ?? versionName,
			usage: imported.usage ?? null,
			completed_at: new Date().toISOString()
		});

		logPhase('job:succeeded', {
			job_id: jobId,
			talent_id: talentId,
			resume_id: createdResume.id,
			duration_ms: Date.now() - startedAtMs,
			request_id: requestId
		});

		return jsonResponse(202, { ok: true, status: 'processing' });
	} catch (error) {
		const errorLike =
			error && typeof error === 'object' ? (error as ResumePdfImportErrorLike) : null;
		const isMappedImportError = errorLike?.name === 'ResumePdfImportError';
		const status =
			isMappedImportError && typeof errorLike?.status === 'number'
				? errorLike.status
				: typeof error === 'object' &&
					  error !== null &&
					  typeof (error as { status?: unknown }).status === 'number'
					? ((error as { status: number }).status ?? 500)
					: 500;
		const message = toSafeMessage(
			error instanceof Error ? error.message : undefined,
			'Could not import resume from PDF right now.'
		);

		if (adminClient && jobId) {
			try {
				await failJob(adminClient, jobId, message, {
					request_id: requestId,
					completed_at: new Date().toISOString()
				});
			} catch (jobUpdateError) {
				logPhase(
					'job:failed-update-error',
					{
						job_id: jobId,
						request_id: requestId,
						message: toSafeMessage(
							jobUpdateError instanceof Error ? jobUpdateError.message : undefined,
							'Failed to update job state.'
						)
					},
					'error'
				);
			}
		}

		logPhase(
			'job:failed',
			{
				job_id: jobId || null,
				talent_id: talentId || null,
				filename: filename || null,
				size_bytes: sizeBytes || null,
				status,
				message,
				duration_ms: Date.now() - startedAtMs,
				request_id: requestId
			},
			'error'
		);

		return jsonResponse(status >= 400 && status <= 599 ? status : 500, { message });
	} finally {
		if (adminClient && cleanupBucket && cleanupObjectPath) {
			const { error: removeError } = await adminClient.storage
				.from(cleanupBucket)
				.remove([cleanupObjectPath]);

			if (removeError) {
				logPhase(
					'storage:delete:failed',
					{
						job_id: jobId || null,
						talent_id: talentId || null,
						source_bucket: cleanupBucket,
						source_object_path: cleanupObjectPath,
						message: toSafeMessage(removeError.message, 'Failed to delete staged PDF.'),
						request_id: requestId
					},
					'warn'
				);
			} else {
				try {
					await updateJob(adminClient, jobId, {
						source_deleted_at: new Date().toISOString()
					});
				} catch (error) {
					logPhase(
						'storage:delete:metadata-update-failed',
						{
							job_id: jobId || null,
							source_bucket: cleanupBucket,
							source_object_path: cleanupObjectPath,
							message: toSafeMessage(
								error instanceof Error ? error.message : undefined,
								'Failed to update staged file deletion metadata.'
							),
							request_id: requestId
						},
						'warn'
					);
				}

				logPhase('storage:delete:ok', {
					job_id: jobId || null,
					talent_id: talentId || null,
					source_bucket: cleanupBucket,
					source_object_path: cleanupObjectPath,
					request_id: requestId
				});
			}
		}
	}
};
