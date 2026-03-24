import { json, type RequestHandler } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAccessibleTalentIds, type ActorAccessContext } from '$lib/server/access';
import {
	buildResumeSearchIndex,
	type ResumeSearchConsultantDocument,
	searchResumeIndex
} from '$lib/server/resumes/searchIndex';
import {
	analyzeResumeSearchQuery,
	MAX_RESUME_SEARCH_QUERY_LENGTH
} from '$lib/server/resumes/searchQueryAnalysis';
import type { ResumeSearchResponse } from '$lib/types/resumes';

const CACHE_TTL_MS = 60_000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SearchIndexCacheEntry = {
	expiresAt: number;
	generatedAt: string;
	scope: ResumeSearchResponse['scope'];
	documents: ResumeSearchConsultantDocument[];
};

const searchIndexCache = new Map<string, SearchIndexCacheEntry>();

const buildResponseHeaders = () => ({
	'Cache-Control': 'private, no-store',
	Vary: 'Cookie'
});

const parseOrgIds = (url: URL): { ok: true; orgIds: string[] } | { ok: false; message: string } => {
	const orgParams = url.searchParams.getAll('org');
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

export const GET: RequestHandler = async ({ url, locals }) => {
	const requestContext = locals.requestContext;
	const adminClient = requestContext.getAdminClient();
	const actor = await requestContext.getActorContext();

	if (!actor.userId || !adminClient) {
		return json({ message: 'Unauthorized.' }, { status: 401, headers: buildResponseHeaders() });
	}

	const query = (url.searchParams.get('q') ?? '').trim();
	if (!query) {
		const emptyResponse: ResumeSearchResponse = {
			query: '',
			scope: { orgIds: [], signature: 'default' },
			items: [],
			generatedAt: new Date().toISOString()
		};
		return json(emptyResponse, { headers: buildResponseHeaders() });
	}

	if (query.length > MAX_RESUME_SEARCH_QUERY_LENGTH) {
		return json(
			{ message: `Query is too long. Max ${MAX_RESUME_SEARCH_QUERY_LENGTH} characters.` },
			{ status: 400, headers: buildResponseHeaders() }
		);
	}

	const parsedOrgIds = parseOrgIds(url);
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

	const analyzedQuery = await analyzeResumeSearchQuery(query);

	const responseBody: ResumeSearchResponse = {
		query,
		scope: entry.scope,
		items: analyzedQuery ? searchResumeIndex(entry.documents, analyzedQuery) : [],
		generatedAt: entry.generatedAt
	};

	return json(responseBody, { headers: buildResponseHeaders() });
};
