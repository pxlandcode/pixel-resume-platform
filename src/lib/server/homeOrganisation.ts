import type { SupabaseClient } from '@supabase/supabase-js';

const HOME_ORG_CACHE_TTL_MS = 60_000;

type HomeOrgCacheEntry = {
	expiresAt: number;
	organisationId: string | null;
};

const homeOrgByTalentCache = new Map<string, HomeOrgCacheEntry>();

const getCachedHomeOrganisationId = (talentId: string, now: number) => {
	const cached = homeOrgByTalentCache.get(talentId);
	if (!cached) return { hit: false as const, organisationId: null as string | null };
	if (cached.expiresAt <= now) {
		homeOrgByTalentCache.delete(talentId);
		return { hit: false as const, organisationId: null as string | null };
	}
	return { hit: true as const, organisationId: cached.organisationId };
};

export const resolveHomeOrganisationId = async (payload: {
	adminClient: SupabaseClient | null;
	homeOrganisationId: string | null;
	talentId: string | null;
}): Promise<string | null> => {
	if (payload.homeOrganisationId) return payload.homeOrganisationId;
	if (!payload.adminClient || !payload.talentId) return payload.homeOrganisationId ?? null;

	const now = Date.now();
	const cached = getCachedHomeOrganisationId(payload.talentId, now);
	if (cached.hit) return cached.organisationId;

	const { data, error } = await payload.adminClient
		.from('organisation_talents')
		.select('organisation_id')
		.eq('talent_id', payload.talentId)
		.order('updated_at', { ascending: false })
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();

	if (error) {
		console.warn(
			'[home organisation] could not resolve home organisation from talent membership',
			error
		);
		return payload.homeOrganisationId ?? null;
	}

	const organisationId = data?.organisation_id ?? null;
	homeOrgByTalentCache.set(payload.talentId, {
		expiresAt: now + HOME_ORG_CACHE_TTL_MS,
		organisationId
	});
	return organisationId;
};
