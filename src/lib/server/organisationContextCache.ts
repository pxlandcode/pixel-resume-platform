export type OrganisationContextCacheEntry<TPayload> = {
	expiresAt: number;
	etag: string;
	payload: TPayload;
};

const organisationContextCache = new Map<string, OrganisationContextCacheEntry<unknown>>();

export const getCachedOrganisationContext = <TPayload>(
	cacheKey: string,
	now: number
): OrganisationContextCacheEntry<TPayload> | null => {
	const cached = organisationContextCache.get(cacheKey);
	if (!cached) return null;
	if (cached.expiresAt <= now) {
		organisationContextCache.delete(cacheKey);
		return null;
	}
	return cached as OrganisationContextCacheEntry<TPayload>;
};

export const setCachedOrganisationContext = <TPayload>(
	cacheKey: string,
	entry: OrganisationContextCacheEntry<TPayload>
) => {
	organisationContextCache.set(cacheKey, entry as OrganisationContextCacheEntry<unknown>);
};

export const invalidateOrganisationContextCache = (organisationId: string | null | undefined) => {
	if (!organisationId) return;

	const suffix = `:${organisationId}`;
	for (const cacheKey of organisationContextCache.keys()) {
		if (cacheKey.endsWith(suffix)) {
			organisationContextCache.delete(cacheKey);
		}
	}
};
