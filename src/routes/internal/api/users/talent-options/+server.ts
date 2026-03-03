import { createHash } from 'node:crypto';
import { json, type RequestHandler } from '@sveltejs/kit';

const CACHE_TTL_MS = 60_000;

type TalentOptionItem = {
	id: string;
	user_id: string | null;
	first_name: string;
	last_name: string;
};

type TalentOptionsCacheEntry = {
	expiresAt: number;
	etag: string;
	generatedAt: string;
	items: TalentOptionItem[];
};

const talentOptionsCache = new Map<string, TalentOptionsCacheEntry>();

const buildCacheHeaders = (etag: string) => ({
	'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
	ETag: etag,
	Vary: 'Cookie'
});

const hasMatchingIfNoneMatch = (rawHeader: string | null, etag: string) => {
	if (!rawHeader) return false;
	if (rawHeader.trim() === '*') return true;
	return rawHeader
		.split(',')
		.map((value) => value.trim())
		.some((candidate) => candidate === etag);
};

export const GET: RequestHandler = async ({ locals, request }) => {
	const requestContext = locals.requestContext;
	const adminClient = requestContext.getAdminClient();
	const actor = await requestContext.getActorContext();

	if (!adminClient || !actor.userId) {
		return json({ message: 'Unauthorized.' }, { status: 401 });
	}
	if (!actor.isAdmin) {
		return json({ message: 'Forbidden.' }, { status: 403 });
	}

	const cacheKey = actor.userId;
	const now = Date.now();
	const cached = talentOptionsCache.get(cacheKey);
	let entry = cached && cached.expiresAt > now ? cached : null;

	try {
		if (!entry) {
			const talentsResult = await adminClient
				.from('talents')
				.select('id, user_id, first_name, last_name')
				.order('last_name', { ascending: true })
				.order('first_name', { ascending: true });

			if (talentsResult.error) {
				throw new Error(talentsResult.error.message);
			}

			const items: TalentOptionItem[] = (talentsResult.data ?? []).map((talent) => ({
				id: talent.id,
				user_id: talent.user_id ?? null,
				first_name: talent.first_name ?? '',
				last_name: talent.last_name ?? ''
			}));

			const generatedAt = new Date().toISOString();
			const hashInput = JSON.stringify({ items, generatedAt });
			const etag = `"${createHash('sha1').update(hashInput).digest('hex')}"`;

			entry = {
				expiresAt: now + CACHE_TTL_MS,
				etag,
				generatedAt,
				items
			};

			talentOptionsCache.set(cacheKey, entry);
		}
	} catch (error) {
		console.error('[users talent-options] failed to build response', error);
		return json({ message: 'Could not load talent options.' }, { status: 500 });
	}

	if (!entry) {
		return json({ message: 'Could not load talent options.' }, { status: 500 });
	}

	const ifNoneMatch = request.headers.get('if-none-match');
	if (hasMatchingIfNoneMatch(ifNoneMatch, entry.etag)) {
		return new Response(null, {
			status: 304,
			headers: buildCacheHeaders(entry.etag)
		});
	}

	return json(
		{
			items: entry.items,
			generatedAt: entry.generatedAt
		},
		{ headers: buildCacheHeaders(entry.etag) }
	);
};
