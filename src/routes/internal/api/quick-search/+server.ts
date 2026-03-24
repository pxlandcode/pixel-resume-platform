import { json, type RequestHandler } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAccessibleTalentIds, type ActorAccessContext } from '$lib/server/access';
import { buildResumeTechIndex } from '$lib/server/resumes/techIndex';
import type { QuickSearchResponse, QuickSearchResult } from '$lib/types/quickSearch';

const CACHE_TTL_MS = 60_000;
const MAX_QUERY_LENGTH = 120;
const MAX_RESULTS_PER_SECTION = 6;

type SearchIndexProfileDocument = {
	id: string;
	name: string;
	nameSearch: string;
	title: string | null;
	titleSearch: string;
	email: string | null;
	emailSearch: string;
	avatarUrl: string | null;
	techs: string[];
	techSearch: string[];
	searchText: string;
};

type SearchIndexResumeDocument = {
	id: string;
	talentId: string;
	title: string;
	titleSearch: string;
	talentName: string;
	talentNameSearch: string;
	description: string | null;
	descriptionSearch: string;
	isMain: boolean;
	techs: string[];
	techSearch: string[];
	searchText: string;
};

type SearchIndexCacheEntry = {
	expiresAt: number;
	generatedAt: string;
	profiles: SearchIndexProfileDocument[];
	resumes: SearchIndexResumeDocument[];
};

const quickSearchCache = new Map<string, SearchIndexCacheEntry>();

const normalizeId = (value: unknown): string | null => {
	if (typeof value === 'string') {
		const normalized = value.trim();
		return normalized || null;
	}
	if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
		return String(value);
	}
	return null;
};

const getSafeText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const normalizeSearchText = (value: string) =>
	value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

const unique = (values: string[]) => {
	const seen = new Set<string>();
	const out: string[] = [];

	for (const value of values) {
		const trimmed = value.trim();
		if (!trimmed) continue;
		const key = trimmed.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(trimmed);
	}

	return out;
};

const isDefined = <T>(value: T | null | undefined): value is T => value != null;

const toStringArray = (value: unknown): string[] => {
	if (!Array.isArray(value)) return [];
	return value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean);
};

const extractTalentTechs = (techStack: unknown): string[] => {
	if (!Array.isArray(techStack)) return [];

	const skills: string[] = [];
	for (const category of techStack) {
		if (!category || typeof category !== 'object') continue;
		skills.push(...toStringArray((category as { skills?: unknown }).skills));
	}

	return unique(skills);
};

const tokenizeQuery = (query: string) =>
	unique(normalizeSearchText(query).split(' ').filter(Boolean));

const buildActorScopeCacheKey = (actor: ActorAccessContext) => {
	const scope = actor.isAdmin
		? 'admin'
		: [
				`roles:${actor.roles.join(',')}`,
				`home:${actor.homeOrganisationId ?? ''}`,
				`talent:${actor.talentId ?? ''}`,
				`orgs:${[...actor.accessibleOrganisationIds].sort().join(',')}`
			].join('|');

	return `${actor.userId}:${scope}`;
};

const fetchScopedTalents = async (
	adminClient: SupabaseClient,
	talentIds: string[] | null
): Promise<
	Array<{
		id: string;
		user_id: string | null;
		first_name: string | null;
		last_name: string | null;
		title: string | null;
		avatar_url: string | null;
		tech_stack: unknown;
	}>
> => {
	if (talentIds !== null && talentIds.length === 0) return [];

	const baseQuery = adminClient
		.from('talents')
		.select('id, user_id, first_name, last_name, title, avatar_url, tech_stack')
		.order('last_name', { ascending: true })
		.order('first_name', { ascending: true });
	const result = talentIds === null ? await baseQuery : await baseQuery.in('id', talentIds);

	if (result.error) {
		throw new Error(result.error.message);
	}

	return (result.data ?? []) as Array<{
		id: string;
		user_id: string | null;
		first_name: string | null;
		last_name: string | null;
		title: string | null;
		avatar_url: string | null;
		tech_stack: unknown;
	}>;
};

const buildSearchIndex = async (adminClient: SupabaseClient, actor: ActorAccessContext) => {
	const scopedTalentIds = await getAccessibleTalentIds(adminClient, actor);
	const talentRows = await fetchScopedTalents(adminClient, scopedTalentIds);
	if (talentRows.length === 0) {
		return { profiles: [], resumes: [] };
	}

	const talentIds = talentRows.map((row) => row.id);
	const techIndexItems = await buildResumeTechIndex(adminClient, scopedTalentIds);
	const techsByTalentId = new Map<string, string[]>(
		techIndexItems.map((item) => [item.talentId, unique(item.searchTechs ?? [])])
	);

	const userIds = unique(
		talentRows.map((row) => (typeof row.user_id === 'string' ? row.user_id : '')).filter(Boolean)
	);
	const profilesResult =
		userIds.length === 0
			? {
					data: [] as Array<{ user_id: string; email: string | null }>,
					error: null
				}
			: await adminClient.from('user_profiles').select('user_id, email').in('user_id', userIds);

	if (profilesResult.error) {
		throw new Error(profilesResult.error.message);
	}

	const emailByUserId = new Map<string, string | null>(
		(profilesResult.data ?? []).map((row) => [row.user_id, row.email ?? null])
	);

	const resumesResult = await adminClient
		.from('resumes')
		.select('id, talent_id, version_name, is_main')
		.in('talent_id', talentIds);

	if (resumesResult.error) {
		throw new Error(resumesResult.error.message);
	}

	const resumeRows = (resumesResult.data ?? [])
		.map((row) => ({
			id: normalizeId((row as { id: unknown }).id),
			talentId: normalizeId((row as { talent_id: unknown }).talent_id),
			versionName: getSafeText(row.version_name),
			isMain: Boolean(row.is_main)
		}))
		.filter((row): row is { id: string; talentId: string; versionName: string; isMain: boolean } =>
			Boolean(row.id && row.talentId)
		);

	const resumeIds = resumeRows.map((row) => row.id);
	const basicsResult =
		resumeIds.length === 0
			? {
					data: [] as Array<{
						resume_id: string;
						title_en: string | null;
						title_sv: string | null;
					}>,
					error: null
				}
			: await adminClient
					.from('resume_basics')
					.select('resume_id, title_en, title_sv')
					.in('resume_id', resumeIds);

	if (basicsResult.error) {
		throw new Error(basicsResult.error.message);
	}

	const basicsByResumeId = new Map<string, { title_en: string | null; title_sv: string | null }>();
	for (const row of basicsResult.data ?? []) {
		const resumeId = normalizeId((row as { resume_id: unknown }).resume_id);
		if (!resumeId) continue;
		basicsByResumeId.set(resumeId, {
			title_en: getSafeText(row.title_en) || null,
			title_sv: getSafeText(row.title_sv) || null
		});
	}

	const talentMetaById = new Map<
		string,
		{
			name: string;
			title: string | null;
			email: string | null;
			avatarUrl: string | null;
			techs: string[];
		}
	>();

	const profiles: SearchIndexProfileDocument[] = talentRows.map((row) => {
		const name =
			[row.first_name, row.last_name].filter(Boolean).join(' ').trim() || 'Unnamed talent';
		const title = getSafeText(row.title) || null;
		const email = typeof row.user_id === 'string' ? (emailByUserId.get(row.user_id) ?? null) : null;
		const techs = unique([
			...extractTalentTechs(row.tech_stack),
			...(techsByTalentId.get(row.id) ?? [])
		]).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
		const techSearch = techs.map((tech) => normalizeSearchText(tech)).filter(Boolean);
		const nameSearch = normalizeSearchText(name);
		const titleSearch = normalizeSearchText(title ?? '');
		const emailSearch = normalizeSearchText(email ?? '');

		talentMetaById.set(row.id, {
			name,
			title,
			email,
			avatarUrl: row.avatar_url ?? null,
			techs
		});

		return {
			id: row.id,
			name,
			nameSearch,
			title,
			titleSearch,
			email,
			emailSearch,
			avatarUrl: row.avatar_url ?? null,
			techs,
			techSearch,
			searchText: [nameSearch, titleSearch, emailSearch, ...techSearch].filter(Boolean).join(' ')
		};
	});

	const resumes: SearchIndexResumeDocument[] = resumeRows.map((row) => {
		const basics = basicsByResumeId.get(row.id);
		const displayTitle =
			basics?.title_en?.trim() ||
			basics?.title_sv?.trim() ||
			row.versionName ||
			(row.isMain ? 'Main resume' : 'Resume');
		const talentMeta = talentMetaById.get(row.talentId);
		const descriptionParts = [
			talentMeta?.name ?? null,
			talentMeta?.title ?? null,
			row.isMain ? 'Main resume' : null
		].filter(Boolean);
		const description = descriptionParts.length > 0 ? descriptionParts.join(' · ') : null;
		const techs = talentMeta?.techs ?? [];
		const techSearch = techs.map((tech) => normalizeSearchText(tech)).filter(Boolean);
		const titleSearch = normalizeSearchText(displayTitle);
		const talentNameSearch = normalizeSearchText(talentMeta?.name ?? '');
		const descriptionSearch = normalizeSearchText(description ?? '');

		return {
			id: row.id,
			talentId: row.talentId,
			title: displayTitle,
			titleSearch,
			talentName: talentMeta?.name ?? 'Unnamed talent',
			talentNameSearch,
			description,
			descriptionSearch,
			isMain: row.isMain,
			techs,
			techSearch,
			searchText: [titleSearch, talentNameSearch, descriptionSearch, ...techSearch]
				.filter(Boolean)
				.join(' ')
		};
	});

	return { profiles, resumes };
};

const scoreTextField = (
	value: string,
	query: string,
	tokens: string[],
	weights: {
		exact: number;
		prefix: number;
		contains: number;
		tokenPrefix: number;
		tokenContains: number;
	}
) => {
	if (!value) return 0;

	let score = 0;
	if (value === query) score += weights.exact;
	else if (value.startsWith(query)) score += weights.prefix;
	else if (value.includes(query)) score += weights.contains;

	for (const token of tokens) {
		if (token.length === 0) continue;
		if (value.startsWith(token)) score += weights.tokenPrefix;
		else if (value.includes(token)) score += weights.tokenContains;
	}

	return score;
};

const getMatchedTechs = (techs: string[], query: string, tokens: string[]) =>
	techs
		.filter((tech) => {
			const normalized = normalizeSearchText(tech);
			if (!normalized) return false;
			return normalized.includes(query) || tokens.some((token) => normalized.includes(token));
		})
		.slice(0, 3);

const rankProfile = (profile: SearchIndexProfileDocument, query: string, tokens: string[]) => {
	if (!tokens.every((token) => profile.searchText.includes(token))) return null;

	const matchedTechs = getMatchedTechs(profile.techs, query, tokens);
	const score =
		scoreTextField(profile.nameSearch, query, tokens, {
			exact: 240,
			prefix: 180,
			contains: 120,
			tokenPrefix: 36,
			tokenContains: 18
		}) +
		scoreTextField(profile.titleSearch, query, tokens, {
			exact: 120,
			prefix: 90,
			contains: 60,
			tokenPrefix: 18,
			tokenContains: 10
		}) +
		scoreTextField(profile.emailSearch, query, tokens, {
			exact: 100,
			prefix: 80,
			contains: 50,
			tokenPrefix: 12,
			tokenContains: 8
		}) +
		profile.techSearch.reduce(
			(sum, tech) =>
				sum +
				scoreTextField(tech, query, tokens, {
					exact: 60,
					prefix: 42,
					contains: 28,
					tokenPrefix: 10,
					tokenContains: 6
				}),
			0
		);

	return {
		score,
		result: {
			id: profile.id,
			kind: 'profile' as const,
			href: `/resumes/${encodeURIComponent(profile.id)}`,
			title: profile.name,
			description: [profile.title, profile.email].filter(Boolean).join(' · ') || null,
			matchedTechs
		}
	};
};

const rankResume = (resume: SearchIndexResumeDocument, query: string, tokens: string[]) => {
	if (!tokens.every((token) => resume.searchText.includes(token))) return null;

	const matchedTechs = getMatchedTechs(resume.techs, query, tokens);
	const score =
		scoreTextField(resume.titleSearch, query, tokens, {
			exact: 220,
			prefix: 160,
			contains: 110,
			tokenPrefix: 32,
			tokenContains: 16
		}) +
		scoreTextField(resume.talentNameSearch, query, tokens, {
			exact: 120,
			prefix: 90,
			contains: 70,
			tokenPrefix: 18,
			tokenContains: 10
		}) +
		scoreTextField(resume.descriptionSearch, query, tokens, {
			exact: 80,
			prefix: 60,
			contains: 40,
			tokenPrefix: 10,
			tokenContains: 6
		}) +
		resume.techSearch.reduce(
			(sum, tech) =>
				sum +
				scoreTextField(tech, query, tokens, {
					exact: 50,
					prefix: 36,
					contains: 24,
					tokenPrefix: 8,
					tokenContains: 4
				}),
			0
		) +
		(resume.isMain ? 12 : 0);

	return {
		score,
		result: {
			id: resume.id,
			kind: 'resume' as const,
			href: `/resumes/${encodeURIComponent(resume.talentId)}/resume/${encodeURIComponent(resume.id)}`,
			title: resume.title,
			description: resume.description,
			matchedTechs
		}
	};
};

const toSection = (
	id: 'profiles' | 'resumes',
	label: string,
	scored: Array<{ score: number; result: QuickSearchResult }>
) => {
	const sorted = scored
		.sort((left, right) => {
			if (right.score !== left.score) return right.score - left.score;
			return left.result.title.localeCompare(right.result.title, undefined, {
				sensitivity: 'base'
			});
		})
		.slice(0, MAX_RESULTS_PER_SECTION)
		.map((entry) => entry.result);

	if (sorted.length === 0) return null;

	return {
		id,
		label,
		results: sorted
	};
};

export const GET: RequestHandler = async ({ url, locals }) => {
	const requestContext = locals.requestContext;
	const adminClient = requestContext.getAdminClient();
	const actor = await requestContext.getActorContext();

	if (!actor.userId || !adminClient) {
		return json({ message: 'Unauthorized.' }, { status: 401 });
	}

	const rawQuery = url.searchParams.get('q') ?? '';
	const query = rawQuery.trim();
	if (!query) {
		const emptyResponse: QuickSearchResponse = {
			query: '',
			sections: [],
			total: 0,
			generatedAt: new Date().toISOString()
		};

		return json(emptyResponse, {
			headers: {
				'Cache-Control': 'private, no-store',
				Vary: 'Cookie'
			}
		});
	}

	if (query.length > MAX_QUERY_LENGTH) {
		return json(
			{ message: `Query is too long. Max ${MAX_QUERY_LENGTH} characters.` },
			{ status: 400 }
		);
	}

	const normalizedQuery = normalizeSearchText(query);
	const tokens = tokenizeQuery(query);
	if (!normalizedQuery || tokens.length === 0) {
		const emptyResponse: QuickSearchResponse = {
			query,
			sections: [],
			total: 0,
			generatedAt: new Date().toISOString()
		};

		return json(emptyResponse, {
			headers: {
				'Cache-Control': 'private, no-store',
				Vary: 'Cookie'
			}
		});
	}

	const cacheKey = buildActorScopeCacheKey(actor);
	const now = Date.now();
	const cached = quickSearchCache.get(cacheKey);
	let entry = cached && cached.expiresAt > now ? cached : null;

	try {
		if (!entry) {
			const index = await buildSearchIndex(adminClient, actor);
			entry = {
				expiresAt: now + CACHE_TTL_MS,
				generatedAt: new Date().toISOString(),
				profiles: index.profiles,
				resumes: index.resumes
			};
			quickSearchCache.set(cacheKey, entry);
		}
	} catch (error) {
		console.error('[quick-search] failed to build search index', error);
		return json({ message: 'Could not load quick search results.' }, { status: 500 });
	}

	if (!entry) {
		return json({ message: 'Could not load quick search results.' }, { status: 500 });
	}

	const scoredProfiles: Array<{ score: number; result: QuickSearchResult }> = entry.profiles
		.map((profile) => rankProfile(profile, normalizedQuery, tokens))
		.filter(isDefined);
	const scoredResumes: Array<{ score: number; result: QuickSearchResult }> = entry.resumes
		.map((resume) => rankResume(resume, normalizedQuery, tokens))
		.filter(isDefined);

	const sections = [
		toSection('profiles', 'Talent profiles', scoredProfiles),
		toSection('resumes', 'Resumes', scoredResumes)
	].filter(isDefined);

	const responseBody: QuickSearchResponse = {
		query,
		sections,
		total: scoredProfiles.length + scoredResumes.length,
		generatedAt: entry.generatedAt
	};

	return json(responseBody, {
		headers: {
			'Cache-Control': 'private, no-store',
			Vary: 'Cookie'
		}
	});
};
