import { createHash } from 'node:crypto';
import { json, type RequestHandler } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAccessibleTalentIds, type ActorAccessContext } from '$lib/server/access';
import { buildResumeTechIndex } from '$lib/server/resumes/techIndex';
import type { ResumeTechIndexItem, ResumeTechIndexResponse } from '$lib/types/resumes';

const CACHE_TTL_MS = 60_000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type TechIndexCacheEntry = {
	expiresAt: number;
	etag: string;
	generatedAt: string;
	scope: ResumeTechIndexResponse['scope'];
	items: ResumeTechIndexItem[];
};

const techIndexCache = new Map<string, TechIndexCacheEntry>();

const buildCacheHeaders = (etag: string) => ({
	'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
	ETag: etag,
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
	if (orgTalentResult.error) {
		throw new Error(orgTalentResult.error.message);
	}

	const scopedTalentIds = Array.from(
		new Set(
			(orgTalentResult.data ?? [])
				.map((row) => (typeof row.talent_id === 'string' ? row.talent_id : null))
				.filter((value): value is string => value !== null)
		)
	);

	if (actor.isAdmin) {
		return scopedTalentIds;
	}

	const accessibleTalentIds = await getAccessibleTalentIds(adminClient, actor);
	if (accessibleTalentIds === null) {
		return scopedTalentIds;
	}

	if (accessibleTalentIds.length === 0 || scopedTalentIds.length === 0) {
		return [];
	}

	const accessibleSet = new Set(accessibleTalentIds);
	return scopedTalentIds.filter((talentId) => accessibleSet.has(talentId));
};

const hasMatchingIfNoneMatch = (rawHeader: string | null, etag: string) => {
	if (!rawHeader) return false;
	if (rawHeader.trim() === '*') return true;
	return rawHeader
		.split(',')
		.map((value) => value.trim())
		.some((candidate) => candidate === etag);
};

const payloadFromLocals = (locals: App.Locals) => {
	const requestContext = locals.requestContext;
	const adminClient = requestContext.getAdminClient();
	return { requestContext, adminClient };
};

export const GET: RequestHandler = async ({ url, request, locals }) => {
	const { requestContext, adminClient } = payloadFromLocals(locals);
	const actor = await requestContext.getActorContext();

	if (!actor.userId || !adminClient) {
		return json({ message: 'Unauthorized.' }, { status: 401 });
	}

	const parsedOrgIds = parseOrgIds(url);
	if (!parsedOrgIds.ok) {
		return json({ message: parsedOrgIds.message }, { status: 400 });
	}

	const scopeResult = resolveScope(actor, parsedOrgIds.orgIds);
	if (!scopeResult.ok) {
		return json({ message: scopeResult.message }, { status: scopeResult.status });
	}

	const cacheKey = `${actor.userId}:${scopeResult.signature}`;
	const now = Date.now();
	const cached = techIndexCache.get(cacheKey);
	let entry = cached && cached.expiresAt > now ? cached : null;

	try {
		if (!entry) {
			const scopedTalentIds = await resolveScopedTalentIds({
				adminClient,
				actor,
				scopeOrgIds: scopeResult.orgIds
			});

			const items = await buildResumeTechIndex(adminClient, scopedTalentIds);
			const generatedAt = new Date().toISOString();
			const scope: ResumeTechIndexResponse['scope'] = {
				orgIds: scopeResult.orgIds,
				signature: scopeResult.signature
			};
			const hashInput = JSON.stringify({ scope, items, generatedAt });
			const etag = `"${createHash('sha1').update(hashInput).digest('hex')}"`;

			entry = {
				expiresAt: now + CACHE_TTL_MS,
				etag,
				generatedAt,
				scope,
				items
			};

			techIndexCache.set(cacheKey, entry);
		}
	} catch (error) {
		console.error('[tech-index] failed to compute tech index', error);
		return json({ message: 'Could not build technology index.' }, { status: 500 });
	}
	if (!entry) {
		return json({ message: 'Could not build technology index.' }, { status: 500 });
	}

	const ifNoneMatch = request.headers.get('if-none-match');
	if (hasMatchingIfNoneMatch(ifNoneMatch, entry.etag)) {
		return new Response(null, {
			status: 304,
			headers: buildCacheHeaders(entry.etag)
		});
	}

	const responseBody: ResumeTechIndexResponse = {
		scope: entry.scope,
		items: entry.items,
		generatedAt: entry.generatedAt
	};

	return json(responseBody, {
		headers: buildCacheHeaders(entry.etag)
	});
};
