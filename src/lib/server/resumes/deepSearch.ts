import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActorAccessContext } from '$lib/server/access';
import { loadEffectiveTechCatalog } from '$lib/server/techCatalog';
import {
	buildResumeSearchIndex,
	type ResumeSearchConsultantDocument,
	searchResumeIndex
} from '$lib/server/resumes/searchIndex';
import { searchResumeDocumentsSemantically } from '$lib/server/resumes/semanticSearch';
import {
	analyzeResumeSearchQuery,
	buildParsedResumeSearchQueryFromFilterTerms,
	MAX_RESUME_SEARCH_QUERY_LENGTH,
	type ResumeSearchQueryCatalogContext,
	toResumeSearchFilterTerms
} from '$lib/server/resumes/searchQueryAnalysis';
import type {
	ResumeSearchFilterTerm,
	ResumeSearchItem,
	ResumeSearchResponse
} from '$lib/types/resumes';
import { resolveScopedResumeSearchTalentIds } from './searchScope';

const CACHE_TTL_MS = 60_000;
const MAX_DEEP_SEARCH_RESULTS = 200;
const MAX_SEARCH_TITLE_LENGTH = 72;
const SEMANTIC_SCORE_BOOST_WEIGHT = 0.35;
const NON_CONCRETE_RANK_TERMS = new Set(['semantic match']);

type SearchIndexCacheEntry = {
	expiresAt: number;
	generatedAt: string;
	scope: ResumeSearchResponse['scope'];
	documents: ResumeSearchConsultantDocument[];
};

const searchIndexCache = new Map<string, SearchIndexCacheEntry>();

const clampSearchTitle = (value: string) => {
	const normalized = value.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
	if (!normalized) return '';
	if (normalized.length <= MAX_SEARCH_TITLE_LENGTH) return normalized;
	return `${normalized.slice(0, MAX_SEARCH_TITLE_LENGTH - 1).trimEnd()}…`;
};

const uniqueTermLabels = (
	terms: ResumeSearchFilterTerm[],
	kind: ResumeSearchFilterTerm['kind']
) => {
	const seen = new Set<string>();
	const output: string[] = [];
	for (const term of terms) {
		if (term.kind !== kind) continue;
		const label = term.label.trim();
		const key = (term.key || label).trim().toLowerCase();
		if (!label || !key || seen.has(key)) continue;
		seen.add(key);
		output.push(label);
	}
	return output;
};

export const buildResumeSearchTitleFallback = (payload: {
	query: string;
	terms?: ResumeSearchFilterTerm[] | null;
}) => {
	const terms = payload.terms ?? [];
	const roles = uniqueTermLabels(terms, 'role');
	const technologies = uniqueTermLabels(terms, 'technology');
	const concepts = uniqueTermLabels(terms, 'concept');

	const role = roles[0] ?? null;
	const techText = technologies.slice(0, role ? 3 : 4).join(', ');
	const conceptText = concepts.slice(0, role || techText ? 2 : 4).join(', ');
	const detailText = [techText, conceptText].filter(Boolean).join(' · ');

	if (role && detailText) return clampSearchTitle(`${role}: ${detailText}`);
	if (role) return clampSearchTitle(role);
	if (techText && conceptText) return clampSearchTitle(`${techText} · ${conceptText}`);
	if (techText) return clampSearchTitle(`${techText} search`);
	if (conceptText) return clampSearchTitle(`${conceptText} search`);

	const query = payload.query.replace(/\s+/g, ' ').trim();
	if (!query) return 'Deep search';
	const firstSentence = query.split(/[.!?\n]/)[0]?.trim() || query;
	const words = firstSentence.split(/\s+/).slice(0, 8).join(' ');
	return clampSearchTitle(words || 'Deep search');
};

const extractSearchTitleJson = (raw: string) => {
	const trimmed = raw.trim();
	if (!trimmed) return '';
	try {
		const parsed = JSON.parse(trimmed) as { title?: unknown };
		return typeof parsed.title === 'string' ? parsed.title : '';
	} catch {
		const match = trimmed.match(/\{[\s\S]*\}/);
		if (!match) return trimmed;
		try {
			const parsed = JSON.parse(match[0]) as { title?: unknown };
			return typeof parsed.title === 'string' ? parsed.title : '';
		} catch {
			return trimmed;
		}
	}
};

const generateResumeSearchTitle = async (payload: {
	query: string;
	terms: ResumeSearchFilterTerm[];
}) => {
	const fallbackTitle = buildResumeSearchTitleFallback(payload);
	if (!process.env.OPENAI_API_KEY?.trim()) return fallbackTitle;

	try {
		const { getModel, openai } = await import('$lib/server/openai');
		const model = process.env.LLM_MODEL_SEARCH_QUERY?.trim() || getModel();
		const termText = payload.terms
			.slice(0, 18)
			.map((term) => `${term.kind}: ${term.label}`)
			.join('\n');
		const response = await openai.responses.create({
			model,
			temperature: 0.1,
			max_output_tokens: 80,
			input: [
				{
					role: 'system',
					content: `Create a short saved-search header for a resume talent search.

Return JSON only: {"title":"string"}

Rules:
- 3-7 words when possible.
- Preserve important role and technology names.
- Do not include dates, location, company boilerplate, or filler.
- Do not return the full query.
- No trailing punctuation.`
				},
				{
					role: 'user',
					content: `Raw search:
${payload.query.trim()}

Extracted search terms:
${termText || 'None'}`
				}
			]
		});

		return clampSearchTitle(extractSearchTitleJson(response.output_text ?? '')) || fallbackTitle;
	} catch (error) {
		console.warn('[resume-search] could not generate search title, using fallback', error);
		return fallbackTitle;
	}
};

const mergeUniqueStrings = (left: string[], right: string[]) => {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of [...left, ...right]) {
		const key = value.trim().toLowerCase();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(value);
	}
	return out;
};

const normalizeRankTerm = (value: string) =>
	value
		.trim()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const getConcreteMatchCount = (item: ResumeSearchItem) => {
	const terms = new Set<string>();
	for (const value of [...item.matchedTerms, ...item.matchedQueryTechs, ...item.matchedTechs]) {
		const normalized = normalizeRankTerm(value);
		if (!normalized || NON_CONCRETE_RANK_TERMS.has(normalized)) continue;
		terms.add(normalized);
	}
	return terms.size;
};

const compareHybridSearchItems = (left: ResumeSearchItem, right: ResumeSearchItem) => {
	const leftConcreteMatchCount = getConcreteMatchCount(left);
	const rightConcreteMatchCount = getConcreteMatchCount(right);
	const leftHasConcreteMatches = leftConcreteMatchCount > 0;
	const rightHasConcreteMatches = rightConcreteMatchCount > 0;

	if (rightHasConcreteMatches !== leftHasConcreteMatches) {
		return Number(rightHasConcreteMatches) - Number(leftHasConcreteMatches);
	}
	if (right.matchPercent !== left.matchPercent) return right.matchPercent - left.matchPercent;
	if (rightConcreteMatchCount !== leftConcreteMatchCount) {
		return rightConcreteMatchCount - leftConcreteMatchCount;
	}
	if (right.score !== left.score) return right.score - left.score;
	return left.talentId.localeCompare(right.talentId);
};

const mergeSearchReasons = (
	left: ResumeSearchItem['reasons'],
	right: ResumeSearchItem['reasons']
) => {
	const seen = new Set<string>();
	const out: ResumeSearchItem['reasons'] = [];
	for (const reason of [...left, ...right]) {
		const key = `${reason.label}:${reason.resumeId ?? 'profile'}:${reason.text}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(reason);
		if (out.length >= 3) break;
	}
	return out;
};

const mergeInterpretedMatches = (
	left: ResumeSearchItem['interpretedMatches'] = [],
	right: ResumeSearchItem['interpretedMatches'] = []
) => {
	const matchesByKey = new Map<
		string,
		NonNullable<ResumeSearchItem['interpretedMatches']>[number]
	>();

	for (const match of [...left, ...right]) {
		const key = match.key.trim().toLowerCase();
		if (!key) continue;
		const existing = matchesByKey.get(key);
		if (!existing) {
			matchesByKey.set(key, {
				label: match.label,
				key: match.key,
				evidence: mergeUniqueStrings([], match.evidence)
			});
			continue;
		}

		matchesByKey.set(key, {
			...existing,
			evidence: mergeUniqueStrings(existing.evidence, match.evidence)
		});
	}

	return Array.from(matchesByKey.values());
};

const mergeHybridSearchItems = (
	exactItems: ResumeSearchItem[],
	semanticItems: ResumeSearchItem[],
	limit: number
) => {
	const itemsByTalentId = new Map<string, ResumeSearchItem>();

	for (const item of exactItems) {
		itemsByTalentId.set(item.talentId, item);
	}

	for (const semanticItem of semanticItems) {
		const existing = itemsByTalentId.get(semanticItem.talentId);
		if (!existing) {
			itemsByTalentId.set(semanticItem.talentId, semanticItem);
			continue;
		}

		itemsByTalentId.set(semanticItem.talentId, {
			...existing,
			score: existing.score + semanticItem.score * SEMANTIC_SCORE_BOOST_WEIGHT,
			matchPercent: Math.max(existing.matchPercent, semanticItem.matchPercent),
			matchedTerms: mergeUniqueStrings(existing.matchedTerms, semanticItem.matchedTerms),
			missingTerms: existing.missingTerms,
			matchedQueryTechs: mergeUniqueStrings(
				existing.matchedQueryTechs,
				semanticItem.matchedQueryTechs
			),
			missingQueryTechs: existing.missingQueryTechs,
			matchedTechs: mergeUniqueStrings(existing.matchedTechs, semanticItem.matchedTechs),
			interpretedMatches: mergeInterpretedMatches(
				existing.interpretedMatches,
				semanticItem.interpretedMatches
			),
			reasons: mergeSearchReasons(existing.reasons, semanticItem.reasons),
			bestResumeId: existing.bestResumeId ?? semanticItem.bestResumeId,
			bestResumeTitle: existing.bestResumeTitle ?? semanticItem.bestResumeTitle,
			semanticSimilarity: semanticItem.semanticSimilarity ?? existing.semanticSimilarity ?? null,
			semanticMatchPercent:
				semanticItem.semanticMatchPercent ?? existing.semanticMatchPercent ?? null
		});
	}

	return Array.from(itemsByTalentId.values()).sort(compareHybridSearchItems).slice(0, limit);
};

const buildHash = (value: string) => {
	let hash = 5381;
	for (let index = 0; index < value.length; index += 1) {
		hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
	}
	return hash.toString(36);
};

export const buildResumeSearchTechCatalogContext = async (payload: {
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

export const emptyDeepResumeSearchResponse = (
	query: string,
	scope: ResumeSearchResponse['scope'] = { orgIds: [], signature: 'default' }
): ResumeSearchResponse => ({
	title: buildResumeSearchTitleFallback({ query }),
	query,
	scope,
	aiApplied: false,
	analyzedTerms: [],
	appliedTerms: [],
	items: [],
	generatedAt: new Date().toISOString()
});

export const executeDeepResumeSearch = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
	query: string;
	scope: ResumeSearchResponse['scope'];
	termOverrides?: ResumeSearchFilterTerm[] | null;
	hasExplicitTermOverrides?: boolean;
	resultLimit?: number;
}): Promise<ResumeSearchResponse> => {
	const query = payload.query.trim();
	if (!query) return emptyDeepResumeSearchResponse('', payload.scope);

	if (query.length > MAX_RESUME_SEARCH_QUERY_LENGTH) {
		throw new Error(`Query is too long. Max ${MAX_RESUME_SEARCH_QUERY_LENGTH} characters.`);
	}

	const cacheKey = `${payload.actor.userId}:${payload.scope.signature}`;
	const now = Date.now();
	const cached = searchIndexCache.get(cacheKey);
	let entry = cached && cached.expiresAt > now ? cached : null;

	if (!entry) {
		const scopedTalentIds = await resolveScopedResumeSearchTalentIds({
			adminClient: payload.adminClient,
			actor: payload.actor,
			scopeOrgIds: payload.scope.orgIds
		});

		const documents = await buildResumeSearchIndex(payload.adminClient, scopedTalentIds);
		entry = {
			expiresAt: now + CACHE_TTL_MS,
			generatedAt: new Date().toISOString(),
			scope: payload.scope,
			documents
		};
		searchIndexCache.set(cacheKey, entry);
	}

	let techCatalogContext: ResumeSearchQueryCatalogContext | null = null;
	try {
		techCatalogContext = await buildResumeSearchTechCatalogContext({
			adminClient: payload.adminClient,
			actor: payload.actor
		});
	} catch (error) {
		console.warn('[resume-search] could not load tech catalog context for query analysis', error);
	}

	const analyzedQuery = await analyzeResumeSearchQuery(query, {
		catalogContext: techCatalogContext
	});
	const appliedQuery = payload.hasExplicitTermOverrides
		? buildParsedResumeSearchQueryFromFilterTerms({
				raw: query,
				terms: payload.termOverrides ?? [],
				aiApplied: analyzedQuery?.aiApplied ?? false
			})
		: analyzedQuery;
	const appliedTerms = payload.hasExplicitTermOverrides
		? (payload.termOverrides ?? [])
		: appliedQuery
			? toResumeSearchFilterTerms(appliedQuery.terms)
			: [];
	const title = await generateResumeSearchTitle({ query, terms: appliedTerms });
	const resultLimit = Math.max(1, payload.resultLimit ?? MAX_DEEP_SEARCH_RESULTS);
	const exactItems =
		appliedQuery && appliedQuery.terms.length > 0
			? searchResumeIndex(entry.documents, appliedQuery)
			: [];
	let semanticItems: ResumeSearchItem[] = [];
	try {
		semanticItems = await searchResumeDocumentsSemantically({
			adminClient: payload.adminClient,
			query,
			terms: appliedTerms,
			scopeOrgIds: entry.scope.orgIds,
			accessibleTalentIds: null,
			limit: resultLimit * 2
		});
	} catch (error) {
		console.warn('[resume-search] semantic search failed, using term ranking only', error);
	}

	return {
		title,
		query,
		scope: entry.scope,
		aiApplied: analyzedQuery?.aiApplied ?? false,
		analyzedTerms: analyzedQuery ? toResumeSearchFilterTerms(analyzedQuery.terms) : [],
		appliedTerms,
		items: mergeHybridSearchItems(exactItems, semanticItems, resultLimit),
		generatedAt: entry.generatedAt
	};
};

export { MAX_RESUME_SEARCH_QUERY_LENGTH };
