import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActorAccessContext } from '$lib/server/access';
import type {
	ResumeSearchFilterTerm,
	ResumeSearchInterpretedMatch,
	ResumeSearchItem,
	ResumeSearchJob,
	ResumeSearchJobStatus,
	ResumeSearchReason,
	ResumeSearchResponse
} from '$lib/types/resumes';
import {
	buildResumeSearchTitleFallback,
	executeDeepResumeSearch,
	MAX_RESUME_SEARCH_QUERY_LENGTH
} from '$lib/server/resumes/deepSearch';
import {
	resolveResumeSearchScope,
	sanitizeResumeSearchTermOverrides
} from '$lib/server/resumes/searchScope';

const SEARCH_JOB_TTL_DAYS = 30;
const MAX_LISTED_SEARCH_JOBS = 20;

type ResumeSearchJobRow = {
	id: string;
	requested_by_user_id: string;
	status: ResumeSearchJobStatus;
	title: string | null;
	query: string;
	scope_org_ids: string[] | null;
	scope_signature: string | null;
	term_overrides: unknown;
	result_json: unknown;
	error_message: string | null;
	request_id: string | null;
	model: string | null;
	usage: unknown;
	started_at: string | null;
	completed_at: string | null;
	read_at: string | null;
	expires_at: string | null;
	created_at: string | null;
	updated_at: string | null;
};

const toIsoFromNowDays = (days: number) =>
	new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

const toSafeMessage = (value: unknown, fallback: string): string => {
	if (typeof value !== 'string') return fallback;
	const trimmed = value.trim();
	return trimmed ? trimmed.slice(0, 300) : fallback;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const toSafeString = (value: unknown, maxLength = 300) =>
	typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const toSafeNumber = (value: unknown, fallback = 0) => {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return value;
};

const toSafePercent = (value: unknown, fallback = 0) =>
	Math.max(0, Math.min(100, toSafeNumber(value, fallback)));

const toStringArray = (value: unknown) => {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => (typeof entry === 'string' ? entry.trim().slice(0, 120) : ''))
		.filter(Boolean);
};

const normalizeSearchReason = (value: unknown): ResumeSearchReason | null => {
	if (!isRecord(value)) return null;

	const label = toSafeString(value.label, 120);
	const text = toSafeString(value.text, 300);
	if (!label || !text) return null;

	return {
		label,
		text,
		resumeId: toSafeString(value.resumeId ?? value.resume_id, 80) || null,
		resumeTitle: toSafeString(value.resumeTitle ?? value.resume_title, 160) || null
	};
};

const normalizeSearchReasons = (value: unknown): ResumeSearchReason[] => {
	if (!Array.isArray(value)) return [];
	return value
		.map(normalizeSearchReason)
		.filter((entry): entry is ResumeSearchReason => entry !== null);
};

const normalizeInterpretedMatch = (value: unknown): ResumeSearchInterpretedMatch | null => {
	if (!isRecord(value)) return null;

	const label = toSafeString(value.label, 120);
	if (!label) return null;

	const key = toSafeString(value.key, 120).toLowerCase() || label.toLowerCase();
	const evidence = toStringArray(value.evidence).slice(0, 8);

	return {
		label,
		key,
		evidence
	};
};

const normalizeInterpretedMatches = (value: unknown): ResumeSearchInterpretedMatch[] => {
	if (!Array.isArray(value)) return [];
	return value
		.map(normalizeInterpretedMatch)
		.filter((entry): entry is ResumeSearchInterpretedMatch => entry !== null);
};

const normalizeSearchItem = (value: unknown): ResumeSearchItem | null => {
	if (!isRecord(value)) return null;

	const talentId = toSafeString(value.talentId ?? value.talent_id, 80);
	if (!talentId) return null;

	const semanticSimilarity =
		typeof value.semanticSimilarity === 'number' && Number.isFinite(value.semanticSimilarity)
			? value.semanticSimilarity
			: null;
	const semanticMatchPercent =
		typeof value.semanticMatchPercent === 'number' && Number.isFinite(value.semanticMatchPercent)
			? value.semanticMatchPercent
			: null;

	return {
		talentId,
		score: toSafeNumber(value.score),
		matchPercent: toSafePercent(value.matchPercent, toSafePercent(value.score)),
		matchedTerms: toStringArray(value.matchedTerms),
		missingTerms: toStringArray(value.missingTerms),
		matchedQueryTechs: toStringArray(value.matchedQueryTechs),
		missingQueryTechs: toStringArray(value.missingQueryTechs),
		matchedTechs: toStringArray(value.matchedTechs),
		interpretedMatches: normalizeInterpretedMatches(value.interpretedMatches),
		reasons: normalizeSearchReasons(value.reasons),
		bestResumeId: toSafeString(value.bestResumeId ?? value.best_resume_id, 80) || null,
		bestResumeTitle: toSafeString(value.bestResumeTitle ?? value.best_resume_title, 160) || null,
		semanticSimilarity,
		semanticMatchPercent
	};
};

const normalizeOrgIds = (value: unknown) => {
	if (!Array.isArray(value)) return [];
	return value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean);
};

const normalizeSearchScope = (
	value: unknown,
	row: ResumeSearchJobRow
): ResumeSearchResponse['scope'] => {
	const record = isRecord(value) ? value : null;
	const rowOrgIds = normalizeOrgIds(row.scope_org_ids);
	const resultOrgIds = record ? normalizeOrgIds(record.orgIds) : [];
	const orgIds = resultOrgIds.length > 0 ? resultOrgIds : rowOrgIds;
	const signature =
		toSafeString(record?.signature, 500) ||
		toSafeString(row.scope_signature, 500) ||
		(orgIds.length > 0 ? `org:${orgIds.join(',')}` : 'default');

	return {
		orgIds,
		signature
	};
};

const normalizeResumeSearchResponse = (
	value: unknown,
	row: ResumeSearchJobRow
): ResumeSearchResponse | null => {
	if (!isRecord(value) || !Array.isArray(value.items)) return null;

	const query = toSafeString(value.query, MAX_RESUME_SEARCH_QUERY_LENGTH) || row.query;
	const rowTermOverrides = sanitizeResumeSearchTermOverrides(row.term_overrides) ?? [];
	const analyzedTerms = sanitizeResumeSearchTermOverrides(value.analyzedTerms) ?? [];
	const appliedTerms = sanitizeResumeSearchTermOverrides(value.appliedTerms) ?? rowTermOverrides;
	const items = value.items
		.map(normalizeSearchItem)
		.filter((entry): entry is ResumeSearchItem => entry !== null);
	const generatedAt =
		toSafeString(value.generatedAt, 80) ||
		row.completed_at ||
		row.updated_at ||
		row.created_at ||
		new Date().toISOString();

	const title =
		toSafeString(value.title, 300) ||
		toSafeString(row.title, 300) ||
		buildResumeSearchTitleFallback({ query, terms: appliedTerms });

	return {
		title: toSafeMessage(title, 'Deep search'),
		query,
		scope: normalizeSearchScope(value.scope, row),
		aiApplied: typeof value.aiApplied === 'boolean' ? value.aiApplied : false,
		analyzedTerms,
		appliedTerms,
		items,
		generatedAt
	};
};

const getSearchJobTitle = (row: ResumeSearchJobRow, result: ResumeSearchResponse | null) =>
	toSafeMessage(
		row.title || result?.title || buildResumeSearchTitleFallback({ query: row.query }),
		'Deep search'
	);

const toSearchJob = (row: ResumeSearchJobRow): ResumeSearchJob => {
	const result = normalizeResumeSearchResponse(row.result_json, row);
	return {
		id: String(row.id),
		status: row.status,
		title: getSearchJobTitle(row, result),
		query: row.query,
		scope: {
			orgIds: Array.isArray(row.scope_org_ids) ? row.scope_org_ids.filter(Boolean) : [],
			signature:
				typeof row.scope_signature === 'string' && row.scope_signature.trim()
					? row.scope_signature.trim()
					: 'default'
		},
		errorMessage: row.error_message,
		result,
		readAt: row.read_at,
		startedAt: row.started_at,
		completedAt: row.completed_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		expiresAt: row.expires_at
	};
};

const buildSearchModelLabel = () =>
	process.env.LLM_MODEL_SEARCH_QUERY?.trim() || process.env.LLM_MODEL?.trim() || null;

const updateJob = async (
	adminClient: SupabaseClient,
	jobId: string,
	patch: Record<string, unknown>
) => {
	const { error } = await adminClient
		.from('resume_search_jobs')
		.update({ ...patch, updated_at: new Date().toISOString() })
		.eq('id', jobId);
	if (error) throw new Error(error.message);
};

export const listResumeSearchJobs = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
	limit?: number;
}) => {
	const limit = Math.min(
		Math.max(payload.limit ?? MAX_LISTED_SEARCH_JOBS, 1),
		MAX_LISTED_SEARCH_JOBS
	);
	const { data, error } = await payload.adminClient
		.from('resume_search_jobs')
		.select(
			'id, requested_by_user_id, status, title, query, scope_org_ids, scope_signature, term_overrides, result_json, error_message, request_id, model, usage, started_at, completed_at, read_at, expires_at, created_at, updated_at'
		)
		.eq('requested_by_user_id', payload.actor.userId)
		.gt('expires_at', new Date().toISOString())
		.order('created_at', { ascending: false })
		.limit(limit);

	if (error) throw new Error(error.message);
	return ((data ?? []) as ResumeSearchJobRow[]).map(toSearchJob);
};

export const getResumeSearchJob = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
	jobId: string;
}) => {
	const { data, error } = await payload.adminClient
		.from('resume_search_jobs')
		.select(
			'id, requested_by_user_id, status, title, query, scope_org_ids, scope_signature, term_overrides, result_json, error_message, request_id, model, usage, started_at, completed_at, read_at, expires_at, created_at, updated_at'
		)
		.eq('id', payload.jobId)
		.maybeSingle();

	if (error) throw new Error(error.message);
	if (!data?.id) return null;
	const row = data as ResumeSearchJobRow;
	if (row.requested_by_user_id !== payload.actor.userId) {
		const isAdminViewing = payload.actor.isAdmin;
		if (!isAdminViewing) {
			throw Object.assign(new Error('Not authorized to view this search job.'), { status: 403 });
		}
	}
	return toSearchJob(row);
};

export const createResumeSearchJob = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
	query: string;
	orgIds: string[];
	termOverrides: ResumeSearchFilterTerm[] | null;
	hasExplicitTermOverrides: boolean;
}) => {
	const query = payload.query.trim();
	if (!payload.actor.userId) {
		throw Object.assign(new Error('Unauthorized.'), { status: 401 });
	}
	if (!query) {
		throw Object.assign(new Error('Search query is required.'), { status: 400 });
	}
	if (query.length > MAX_RESUME_SEARCH_QUERY_LENGTH) {
		throw Object.assign(
			new Error(`Query is too long. Max ${MAX_RESUME_SEARCH_QUERY_LENGTH} characters.`),
			{ status: 400 }
		);
	}

	const scope = resolveResumeSearchScope(payload.actor, payload.orgIds);
	if (!scope.ok) {
		throw Object.assign(new Error(scope.message), { status: scope.status });
	}

	const now = new Date().toISOString();
	const title = buildResumeSearchTitleFallback({
		query,
		terms: payload.hasExplicitTermOverrides ? payload.termOverrides : null
	});
	const { data, error } = await payload.adminClient
		.from('resume_search_jobs')
		.insert({
			requested_by_user_id: payload.actor.userId,
			status: 'queued',
			title,
			query,
			scope_org_ids: scope.orgIds,
			scope_signature: scope.signature,
			term_overrides: payload.hasExplicitTermOverrides ? (payload.termOverrides ?? []) : null,
			model: buildSearchModelLabel(),
			expires_at: toIsoFromNowDays(SEARCH_JOB_TTL_DAYS),
			created_at: now,
			updated_at: now
		})
		.select('id')
		.single();

	if (error || !data?.id) {
		throw new Error(error?.message ?? 'Could not create search job.');
	}

	return String(data.id);
};

export const updateResumeSearchJobTerms = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
	jobId: string;
	termOverrides: ResumeSearchFilterTerm[];
}) => {
	const job = await getResumeSearchJob(payload);
	if (!job) {
		throw Object.assign(new Error('Search job not found.'), { status: 404 });
	}
	if (!payload.actor.userId || job.status === 'processing') {
		throw Object.assign(new Error('Search job cannot be updated right now.'), { status: 409 });
	}

	const sanitizedTerms = sanitizeResumeSearchTermOverrides(payload.termOverrides);
	if (!sanitizedTerms) {
		throw Object.assign(new Error('Invalid search term overrides.'), { status: 400 });
	}

	await updateJob(payload.adminClient, payload.jobId, {
		status: 'queued',
		title: buildResumeSearchTitleFallback({ query: job.query, terms: sanitizedTerms }),
		term_overrides: sanitizedTerms,
		error_message: null,
		request_id: null,
		started_at: null,
		completed_at: null,
		read_at: null
	});

	return getResumeSearchJob(payload);
};

export const markResumeSearchJobRead = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
	jobId: string;
}) => {
	const job = await getResumeSearchJob(payload);
	if (!job) {
		throw Object.assign(new Error('Search job not found.'), { status: 404 });
	}
	if (job.status !== 'succeeded') return job;

	await updateJob(payload.adminClient, payload.jobId, {
		read_at: job.readAt ?? new Date().toISOString()
	});

	return getResumeSearchJob(payload);
};

export const runResumeSearchJob = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
	jobId: string;
	requestId?: string | null;
}) => {
	const { data, error } = await payload.adminClient
		.from('resume_search_jobs')
		.select(
			'id, requested_by_user_id, status, title, query, scope_org_ids, scope_signature, term_overrides, result_json, error_message, request_id, model, usage, started_at, completed_at, read_at, expires_at, created_at, updated_at'
		)
		.eq('id', payload.jobId)
		.maybeSingle();

	if (error) throw new Error(error.message);
	if (!data?.id) {
		throw Object.assign(new Error('Search job not found.'), { status: 404 });
	}

	const row = data as ResumeSearchJobRow;
	if (!payload.actor.userId || row.requested_by_user_id !== payload.actor.userId) {
		throw Object.assign(new Error('Not authorized to run this search job.'), { status: 403 });
	}

	if (row.status === 'succeeded' || row.status === 'processing') {
		return toSearchJob(row);
	}
	if (row.status !== 'queued') {
		throw Object.assign(new Error('Search job cannot be started again.'), { status: 409 });
	}

	const scope = resolveResumeSearchScope(payload.actor, row.scope_org_ids ?? []);
	if (!scope.ok) {
		await updateJob(payload.adminClient, row.id, {
			status: 'failed',
			error_message: scope.message,
			completed_at: new Date().toISOString()
		});
		throw Object.assign(new Error(scope.message), { status: scope.status });
	}

	await updateJob(payload.adminClient, row.id, {
		status: 'processing',
		error_message: null,
		request_id: payload.requestId ?? null,
		model: row.model ?? buildSearchModelLabel(),
		started_at: new Date().toISOString(),
		completed_at: null
	});

	try {
		const termOverrides = sanitizeResumeSearchTermOverrides(row.term_overrides);
		const hasExplicitTermOverrides = Array.isArray(row.term_overrides);
		const result = await executeDeepResumeSearch({
			adminClient: payload.adminClient,
			actor: payload.actor,
			query: row.query,
			scope: {
				orgIds: scope.orgIds,
				signature: scope.signature
			},
			termOverrides,
			hasExplicitTermOverrides
		});

		await updateJob(payload.adminClient, row.id, {
			status: 'succeeded',
			title: result.title,
			result_json: result,
			error_message: null,
			completed_at: new Date().toISOString()
		});
	} catch (error) {
		const message = toSafeMessage(
			error instanceof Error ? error.message : undefined,
			'Could not complete deep resume search.'
		);
		await updateJob(payload.adminClient, row.id, {
			status: 'failed',
			error_message: message,
			completed_at: new Date().toISOString()
		});
		throw error;
	}

	const completed = await getResumeSearchJob({
		adminClient: payload.adminClient,
		actor: payload.actor,
		jobId: row.id
	});
	if (!completed) {
		throw new Error('Search job completed but could not be reloaded.');
	}
	return completed;
};
