import { json, type RequestHandler } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAccessibleTalentIds, type ActorAccessContext } from '$lib/server/access';
import { loadEffectiveTechCatalog } from '$lib/server/techCatalog';
import {
	buildResumeSearchIndex,
	type ResumeSearchConsultantDocument,
	searchResumeIndex
} from '$lib/server/resumes/searchIndex';
import {
	analyzeResumeSearchQuery,
	buildParsedResumeSearchQueryFromFilterTerms,
	MAX_RESUME_SEARCH_QUERY_LENGTH,
	type ResumeSearchQueryCatalogContext,
	toResumeSearchFilterTerms
} from '$lib/server/resumes/searchQueryAnalysis';
import type {
	ResumeSearchFilterKind,
	ResumeSearchFilterTerm,
	ResumeSearchResponse
} from '$lib/types/resumes';

const CACHE_TTL_MS = 60_000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEARCH_FILTER_KINDS = new Set<ResumeSearchFilterKind>(['technology', 'role', 'concept']);

type SearchIndexCacheEntry = {
	expiresAt: number;
	generatedAt: string;
	scope: ResumeSearchResponse['scope'];
	documents: ResumeSearchConsultantDocument[];
};

type SearchRequestPayload = {
	query: string;
	orgIds: string[];
	termOverrides: ResumeSearchFilterTerm[] | null;
	hasExplicitTermOverrides: boolean;
};

const searchIndexCache = new Map<string, SearchIndexCacheEntry>();

const buildHash = (value: string) => {
	let hash = 5381;
	for (let index = 0; index < value.length; index += 1) {
		hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
	}
	return hash.toString(36);
};

const buildTechCatalogContext = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
}): Promise<ResumeSearchQueryCatalogContext | null> => {
	const catalog = await loadEffectiveTechCatalog({
		adminClient: payload.adminClient,
		actor: payload.actor,
		requestedMode: 'auto'
	});

	const technologies = catalog.categories.flatMap((category) =>
		category.items.map((item) => ({
			label: item.label,
			aliases: item.aliases,
			category: category.name || null
		}))
	);

	if (technologies.length === 0) return null;

	const fingerprint = buildHash(
		technologies
			.map((technology) =>
				[
					technology.category ?? '',
					technology.label.trim(),
					technology.aliases.map((alias) => alias.trim()).join('|')
				].join('::')
			)
			.join('\n')
	);

	return {
		scopeSignature: catalog.scope.signature,
		cacheKey: `${catalog.scope.signature}:${fingerprint}`,
		technologies
	};
};

const buildResponseHeaders = () => ({
	'Cache-Control': 'private, no-store',
	Vary: 'Cookie'
});

const emptyResponse = (query: string): ResumeSearchResponse => ({
	query,
	scope: { orgIds: [], signature: 'default' },
	aiApplied: false,
	analyzedTerms: [],
	appliedTerms: [],
	items: [],
	generatedAt: new Date().toISOString()
});

const parseOrgIds = (
	orgParams: string[]
): { ok: true; orgIds: string[] } | { ok: false; message: string } => {
	if (orgParams.length === 0) return { ok: true, orgIds: [] };

	const uniqueOrgIds = Array.from(
		new Set(orgParams.map((value) => value.trim()).filter(Boolean))
	).sort();
	if (uniqueOrgIds.length === 0) return { ok: true, orgIds: [] };

	for (const orgId of uniqueOrgIds) {
		if (!UUID_REGEX.test(orgId)) {
			return { ok: false, message: `Invalid organisation id: ${orgId}` };
		}
	}

	return { ok: true, orgIds: uniqueOrgIds };
};

const sanitizeTermOverrides = (value: unknown): ResumeSearchFilterTerm[] | null => {
	if (!Array.isArray(value)) return null;

	const deduped = new Map<string, ResumeSearchFilterTerm>();

	for (const entry of value) {
		if (!entry || typeof entry !== 'object') continue;

		const label = typeof entry.label === 'string' ? entry.label.trim() : '';
		const kind = typeof entry.kind === 'string' ? entry.kind.trim() : '';
		if (!label || !SEARCH_FILTER_KINDS.has(kind as ResumeSearchFilterKind)) continue;

		const key =
			typeof entry.key === 'string' && entry.key.trim().length > 0
				? entry.key.trim().toLowerCase()
				: label.toLowerCase();

		deduped.set(key, {
			label,
			key,
			kind: kind as ResumeSearchFilterKind
		});
	}

	return Array.from(deduped.values());
};

const resolveScope = (actor: ActorAccessContext, requestedOrgIds: string[]) => {
	if (requestedOrgIds.length > 0) {
		if (!actor.isAdmin) {
			const allowed = new Set(actor.accessibleOrganisationIds);
			for (const orgId of requestedOrgIds) {
				if (!allowed.has(orgId)) {
					return {
						ok: false as const,
						status: 403,
						message: 'Requested organisation scope is not allowed.'
					};
				}
			}
		}

		return {
			ok: true as const,
			orgIds: requestedOrgIds,
			signature: `org:${requestedOrgIds.join(',')}`
		};
	}

	const defaultOrgIds = actor.isAdmin
		? []
		: Array.from(new Set(actor.accessibleOrganisationIds)).sort();

	return {
		ok: true as const,
		orgIds: defaultOrgIds,
		signature: defaultOrgIds.length > 0 ? `org:${defaultOrgIds.join(',')}` : 'default'
	};
};

const resolveScopedTalentIds = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
	scopeOrgIds: string[];
}) => {
	const { adminClient, actor, scopeOrgIds } = payload;

	if (scopeOrgIds.length === 0) {
		return getAccessibleTalentIds(adminClient, actor);
	}

	const orgTalentResult = await adminClient
		.from('organisation_talents')
		.select('talent_id')
		.in('organisation_id', scopeOrgIds);
	if (orgTalentResult.error) throw new Error(orgTalentResult.error.message);

	const scopedTalentIds = Array.from(
		new Set(
			(orgTalentResult.data ?? [])
				.map((row) => (typeof row.talent_id === 'string' ? row.talent_id : null))
				.filter((value): value is string => value !== null)
		)
	);

	if (actor.isAdmin) return scopedTalentIds;

	const accessibleTalentIds = await getAccessibleTalentIds(adminClient, actor);
	if (accessibleTalentIds === null) return scopedTalentIds;
	if (accessibleTalentIds.length === 0 || scopedTalentIds.length === 0) return [];

	const accessibleSet = new Set(accessibleTalentIds);
	return scopedTalentIds.filter((talentId) => accessibleSet.has(talentId));
};

const executeSearch = async (payload: {
	requestPayload: SearchRequestPayload;
	locals: App.Locals;
}) => {
	const { requestPayload, locals } = payload;
	const { query, orgIds, termOverrides, hasExplicitTermOverrides } = requestPayload;
	const requestContext = locals.requestContext;
	const adminClient = requestContext.getAdminClient();
	const actor = await requestContext.getActorContext();

	if (!actor.userId || !adminClient) {
		return json({ message: 'Unauthorized.' }, { status: 401, headers: buildResponseHeaders() });
	}

	if (!query) {
		return json(emptyResponse(''), { headers: buildResponseHeaders() });
	}

	if (query.length > MAX_RESUME_SEARCH_QUERY_LENGTH) {
		return json(
			{ message: `Query is too long. Max ${MAX_RESUME_SEARCH_QUERY_LENGTH} characters.` },
			{ status: 400, headers: buildResponseHeaders() }
		);
	}

	const parsedOrgIds = parseOrgIds(orgIds);
	if (!parsedOrgIds.ok) {
		return json(
			{ message: parsedOrgIds.message },
			{ status: 400, headers: buildResponseHeaders() }
		);
	}

	const scopeResult = resolveScope(actor, parsedOrgIds.orgIds);
	if (!scopeResult.ok) {
		return json(
			{ message: scopeResult.message },
			{ status: scopeResult.status, headers: buildResponseHeaders() }
		);
	}

	const cacheKey = `${actor.userId}:${scopeResult.signature}`;
	const now = Date.now();
	const cached = searchIndexCache.get(cacheKey);
	let entry = cached && cached.expiresAt > now ? cached : null;

	try {
		if (!entry) {
			const scopedTalentIds = await resolveScopedTalentIds({
				adminClient,
				actor,
				scopeOrgIds: scopeResult.orgIds
			});

			const documents = await buildResumeSearchIndex(adminClient, scopedTalentIds);
			entry = {
				expiresAt: now + CACHE_TTL_MS,
				generatedAt: new Date().toISOString(),
				scope: {
					orgIds: scopeResult.orgIds,
					signature: scopeResult.signature
				},
				documents
			};
			searchIndexCache.set(cacheKey, entry);
		}
	} catch (error) {
		console.error('[resume-search] failed to build search index', error);
		return json(
			{ message: 'Could not build resume search index.' },
			{ status: 500, headers: buildResponseHeaders() }
		);
	}

	if (!entry) {
		return json(
			{ message: 'Could not build resume search index.' },
			{ status: 500, headers: buildResponseHeaders() }
		);
	}

	let techCatalogContext: ResumeSearchQueryCatalogContext | null = null;
	try {
		techCatalogContext = await buildTechCatalogContext({ adminClient, actor });
	} catch (error) {
		console.warn('[resume-search] could not load tech catalog context for query analysis', error);
	}

	const analyzedQuery = await analyzeResumeSearchQuery(query, {
		catalogContext: techCatalogContext
	});
	const appliedQuery = hasExplicitTermOverrides
		? buildParsedResumeSearchQueryFromFilterTerms({
				raw: query,
				terms: termOverrides ?? [],
				aiApplied: analyzedQuery?.aiApplied ?? false
			})
		: analyzedQuery;

	const responseBody: ResumeSearchResponse = {
		query,
		scope: entry.scope,
		aiApplied: analyzedQuery?.aiApplied ?? false,
		analyzedTerms: analyzedQuery ? toResumeSearchFilterTerms(analyzedQuery.terms) : [],
		appliedTerms: appliedQuery ? toResumeSearchFilterTerms(appliedQuery.terms) : [],
		items:
			appliedQuery && appliedQuery.terms.length > 0
				? searchResumeIndex(entry.documents, appliedQuery)
				: [],
		generatedAt: entry.generatedAt
	};

	return json(responseBody, { headers: buildResponseHeaders() });
};

export const GET: RequestHandler = async ({ url, locals }) =>
	executeSearch({
		requestPayload: {
			query: (url.searchParams.get('q') ?? '').trim(),
			orgIds: url.searchParams.getAll('org'),
			termOverrides: null,
			hasExplicitTermOverrides: false
		},
		locals
	});

export const POST: RequestHandler = async ({ request, locals }) => {
	let body: unknown = null;

	try {
		body = await request.json();
	} catch {
		return json(
			{ message: 'Invalid JSON body.' },
			{ status: 400, headers: buildResponseHeaders() }
		);
	}

	if (!body || typeof body !== 'object') {
		return json(
			{ message: 'Invalid request body.' },
			{ status: 400, headers: buildResponseHeaders() }
		);
	}

	const requestBody = body as Record<string, unknown>;

	const query = typeof requestBody.q === 'string' ? requestBody.q.trim() : '';
	const orgIds = Array.isArray(requestBody.orgIds)
		? requestBody.orgIds.filter((value): value is string => typeof value === 'string')
		: [];
	const hasExplicitTermOverrides = Object.prototype.hasOwnProperty.call(requestBody, 'terms');
	const termOverrides = sanitizeTermOverrides(requestBody.terms);

	if (hasExplicitTermOverrides && termOverrides === null) {
		return json(
			{ message: 'Invalid search term overrides.' },
			{ status: 400, headers: buildResponseHeaders() }
		);
	}

	return executeSearch({
		requestPayload: {
			query,
			orgIds,
			termOverrides,
			hasExplicitTermOverrides
		},
		locals
	});
};
