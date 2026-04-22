type ResumesIndexCacheEntry<TPayload> = {
	expiresAt: number;
	payload: TPayload;
};

const resumesIndexCache = new Map<string, ResumesIndexCacheEntry<unknown>>();

export const buildResumesIndexCacheKey = (actor: {
	userId: string;
	isAdmin: boolean;
	roles: string[];
	homeOrganisationId: string | null;
	accessibleOrganisationIds: string[];
	talentId: string | null;
}) => {
	const scope = actor.isAdmin
		? ['admin', `home:${actor.homeOrganisationId ?? ''}`, `talent:${actor.talentId ?? ''}`].join('|')
		: [
				`roles:${actor.roles.join(',')}`,
				`home:${actor.homeOrganisationId ?? ''}`,
				`talent:${actor.talentId ?? ''}`,
				`orgs:${[...actor.accessibleOrganisationIds].sort().join(',')}`
			].join('|');

	return `${actor.userId}:${scope}`;
};

export const getCachedResumesIndex = <TPayload>(cacheKey: string, now: number) => {
	const cached = resumesIndexCache.get(cacheKey);
	if (!cached) return null;
	if (cached.expiresAt <= now) {
		resumesIndexCache.delete(cacheKey);
		return null;
	}
	return cached as ResumesIndexCacheEntry<TPayload>;
};

export const setCachedResumesIndex = <TPayload>(
	cacheKey: string,
	entry: ResumesIndexCacheEntry<TPayload>
) => {
	resumesIndexCache.set(cacheKey, entry as ResumesIndexCacheEntry<unknown>);
};

export const invalidateResumesIndexCache = (organisationId: string | null | undefined) => {
	if (!organisationId) return;

	const orgFragment = `home:${organisationId}`;
	for (const cacheKey of resumesIndexCache.keys()) {
		if (cacheKey.includes(orgFragment)) {
			resumesIndexCache.delete(cacheKey);
		}
	}
};

