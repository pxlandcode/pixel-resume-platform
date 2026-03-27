import type { TechCatalogApiResponse, TechCatalogScopeMode } from '$lib/types/techCatalog';

type TechCatalogRequest = {
	scope?: TechCatalogScopeMode;
	organisationId?: string | null;
	includeManagement?: boolean;
};

type CacheEntry = {
	data: TechCatalogApiResponse | null;
	error: string | null;
	promise: Promise<TechCatalogApiResponse> | null;
};

const cache = new Map<string, CacheEntry>();

const buildCacheKey = (request: TechCatalogRequest) =>
	[
		request.scope ?? 'auto',
		request.organisationId?.trim() ?? '',
		request.includeManagement ? 'management' : 'catalog'
	].join('::');

const getOrCreateEntry = (key: string) => {
	const existing = cache.get(key);
	if (existing) return existing;
	const created: CacheEntry = {
		data: null,
		error: null,
		promise: null
	};
	cache.set(key, created);
	return created;
};

const buildEndpoint = (request: TechCatalogRequest) => {
	const params = new URLSearchParams();
	params.set('scope', request.scope ?? 'auto');
	if (request.organisationId?.trim()) {
		params.set('organisationId', request.organisationId.trim());
	}
	if (request.includeManagement) {
		params.set('includeManagement', '1');
	}
	return `/internal/api/tech-catalog?${params.toString()}`;
};

export const peekTechCatalogCache = (request: TechCatalogRequest) => {
	const entry = cache.get(buildCacheKey(request));
	return entry?.data ?? null;
};

export const loadTechCatalog = async (
	request: TechCatalogRequest,
	fetcher: typeof fetch,
	force = false
) => {
	const key = buildCacheKey(request);
	const entry = getOrCreateEntry(key);
	if (!force && entry.data) return entry.data;
	if (!force && entry.promise) return entry.promise;

	entry.promise = (async () => {
		const response = await fetcher(buildEndpoint(request), {
			method: 'GET',
			credentials: 'include'
		});
		if (!response.ok) {
			const message = await response.text().catch(() => '');
			throw new Error(message || 'Could not load technology catalog.');
		}

		const payload = (await response.json()) as TechCatalogApiResponse;
		entry.data = payload;
		entry.error = null;
		entry.promise = null;
		return payload;
	})().catch((error) => {
		entry.data = null;
		entry.error = error instanceof Error ? error.message : 'Could not load technology catalog.';
		entry.promise = null;
		throw error;
	});

	return entry.promise;
};

export const invalidateTechCatalogCache = (request?: TechCatalogRequest) => {
	if (!request) {
		cache.clear();
		return;
	}
	cache.delete(buildCacheKey(request));
};
