const AI_QUERY_ANALYSIS_CACHE_TTL_MS = 10 * 60_000;
const AI_QUERY_ANALYSIS_INPUT_MAX_LENGTH = 2_500;
const MAX_TERMS_PER_KIND = 12;
const SHORT_TOKEN_ALLOWLIST = new Set([
	'ai',
	'bi',
	'ci',
	'cd',
	'db',
	'etl',
	'go',
	'hr',
	'ios',
	'js',
	'ml',
	'qa',
	'sql',
	'ts',
	'ui',
	'ux'
]);

export const MAX_RESUME_SEARCH_QUERY_LENGTH = 4_000;

const STOP_WORDS = new Set([
	'a',
	'an',
	'and',
	'are',
	'ar',
	'as',
	'at',
	'att',
	'av',
	'be',
	'by',
	'de',
	'den',
	'det',
	'du',
	'en',
	'eller',
	'ett',
	'for',
	'fran',
	'from',
	'har',
	'hos',
	'i',
	'in',
	'innebar',
	'into',
	'is',
	'it',
	'kan',
	'kommer',
	'krav',
	'med',
	'nu',
	'och',
	'of',
	'om',
	'on',
	'or',
	'pa',
	'samt',
	'sig',
	'ska',
	'som',
	'tal',
	'the',
	'they',
	'this',
	'till',
	'till',
	'to',
	'vara',
	'vi',
	'with'
]);

const QUERY_ANALYSIS_KIND_PRIORITY: Record<ResumeSearchQueryTermKind, number> = {
	technology: 3,
	role: 2,
	concept: 1
};

const FALLBACK_DISPLAY_CASE_OVERRIDES = new Map<string, string>([
	['ai', 'AI'],
	['api', 'API'],
	['aws', 'AWS'],
	['azure', 'Azure'],
	['bi', 'BI'],
	['ci', 'CI'],
	['cd', 'CD'],
	['css', 'CSS'],
	['dbt', 'dbt'],
	['etl', 'ETL'],
	['figma', 'Figma'],
	['gcp', 'GCP'],
	['git', 'Git'],
	['html', 'HTML'],
	['ios', 'iOS'],
	['javascript', 'JavaScript'],
	['js', 'JavaScript'],
	['kotlin', 'Kotlin'],
	['ml', 'ML'],
	['mysql', 'MySQL'],
	['net', '.NET'],
	['node', 'Node.js'],
	['postgresql', 'PostgreSQL'],
	['python', 'Python'],
	['qa', 'QA'],
	['react', 'React'],
	['sql', 'SQL'],
	['swift', 'Swift'],
	['typescript', 'TypeScript'],
	['ts', 'TypeScript'],
	['ui', 'UI'],
	['ux', 'UX']
]);

const FALLBACK_TECH_TERMS = new Set([
	...FALLBACK_DISPLAY_CASE_OVERRIDES.keys(),
	'android',
	'angular',
	'c',
	'dataops',
	'dbt',
	'docker',
	'episerver',
	'firebase',
	'github',
	'graphql',
	'java',
	'kubernetes',
	'mongodb',
	'postgres',
	'redis',
	'rest',
	'sass',
	'snowflake',
	'supabase',
	'svelte',
	'tailwind',
	'typescript',
	'vue'
]);

const FALLBACK_ROLE_TERMS = new Set([
	'architect',
	'coach',
	'consultant',
	'designer',
	'developer',
	'engineer',
	'lead',
	'manager',
	'specialist'
]);

type QueryAnalysisCacheEntry = {
	expiresAt: number;
	value: ParsedResumeSearchQuery | null;
};

type QueryAnalysisPayload = {
	technologies?: unknown;
	roles?: unknown;
	concepts?: unknown;
	ignore?: unknown;
};

export type ResumeSearchQueryTermKind = 'technology' | 'role' | 'concept';

export type ResumeSearchQueryTerm = {
	display: string;
	normalized: string;
	tokens: string[];
	kind: ResumeSearchQueryTermKind;
	importance: number;
};

export type ParsedResumeSearchQuery = {
	raw: string;
	normalized: string;
	terms: ResumeSearchQueryTerm[];
	aiApplied: boolean;
};

const queryAnalysisCache = new Map<string, QueryAnalysisCacheEntry>();

export const stripTags = (value: string) => value.replace(/<[^>]*>/g, ' ');

export const collapseWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

export const normalizeSearchText = (value: string) =>
	collapseWhitespace(value)
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const uniqueValues = (values: string[]) => {
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

export const tokenizeNormalizedText = (value: string) =>
	uniqueValues(
		value
			.split(' ')
			.map((token) => token.trim())
			.filter(Boolean)
	);

const isSearchableToken = (token: string) =>
	token.length > 1 && (!STOP_WORDS.has(token) || SHORT_TOKEN_ALLOWLIST.has(token));

const tokenizeQuery = (value: string) =>
	tokenizeNormalizedText(value).filter((token) => isSearchableToken(token));

const formatFallbackDisplay = (normalized: string) =>
	FALLBACK_DISPLAY_CASE_OVERRIDES.get(normalized) ?? normalized;

const getFallbackTermKind = (normalized: string): ResumeSearchQueryTermKind => {
	if (FALLBACK_TECH_TERMS.has(normalized)) return 'technology';
	if (FALLBACK_ROLE_TERMS.has(normalized)) return 'role';
	return 'concept';
};

const sanitizeTermDisplay = (value: unknown, maxLength = 80) => {
	if (typeof value !== 'string') return '';
	return collapseWhitespace(stripTags(value)).slice(0, maxLength).trim();
};

const buildSearchTerm = (
	value: unknown,
	kind: ResumeSearchQueryTermKind,
	importance: number
): ResumeSearchQueryTerm | null => {
	const display = sanitizeTermDisplay(value);
	if (!display) return null;

	const normalized = normalizeSearchText(display);
	if (!normalized) return null;

	const tokens = tokenizeQuery(normalized);
	if (tokens.length === 0) return null;

	return {
		display,
		normalized,
		tokens,
		kind,
		importance
	};
};

const dedupeTerms = (terms: ResumeSearchQueryTerm[]) => {
	const deduped = new Map<string, ResumeSearchQueryTerm>();

	for (const term of terms) {
		const existing = deduped.get(term.normalized);
		if (!existing) {
			deduped.set(term.normalized, term);
			continue;
		}

		if (term.importance > existing.importance) {
			deduped.set(term.normalized, term);
			continue;
		}

		if (
			term.importance === existing.importance &&
			QUERY_ANALYSIS_KIND_PRIORITY[term.kind] > QUERY_ANALYSIS_KIND_PRIORITY[existing.kind]
		) {
			deduped.set(term.normalized, term);
		}
	}

	return Array.from(deduped.values());
};

const buildFallbackTerms = (normalized: string) =>
	tokenizeQuery(normalized).map((token) => {
		const kind = getFallbackTermKind(token);
		return {
			display: formatFallbackDisplay(token),
			normalized: token,
			tokens: [token],
			kind,
			importance: kind === 'technology' ? 1.2 : kind === 'role' ? 1.05 : 1
		};
	}) satisfies ResumeSearchQueryTerm[];

const buildParsedQuery = (payload: {
	raw: string;
	normalized: string;
	terms: ResumeSearchQueryTerm[];
	aiApplied: boolean;
}): ParsedResumeSearchQuery | null => {
	const terms = dedupeTerms(payload.terms).slice(0, MAX_TERMS_PER_KIND * 3);
	if (terms.length === 0) return null;

	return {
		raw: payload.raw,
		normalized: payload.normalized,
		terms,
		aiApplied: payload.aiApplied
	};
};

export const parseResumeSearchQueryFallback = (query: string): ParsedResumeSearchQuery | null => {
	const raw = query.trim().slice(0, MAX_RESUME_SEARCH_QUERY_LENGTH);
	if (!raw) return null;

	const normalized = normalizeSearchText(raw);
	if (!normalized) return null;

	return buildParsedQuery({
		raw,
		normalized,
		terms: buildFallbackTerms(normalized),
		aiApplied: false
	});
};

const shouldUseAiForQuery = (query: ParsedResumeSearchQuery) => {
	const hasMultipleLines = /\r?\n/.test(query.raw);
	const looksLikeAssignmentBrief =
		hasMultipleLines ||
		query.raw.length >= 80 ||
		query.terms.length >= 6 ||
		/[:;•]/.test(query.raw) ||
		/[.!?]\s/.test(query.raw);

	return looksLikeAssignmentBrief;
};

const sanitizeQueryAnalysisInput = (raw: string) =>
	raw
		.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
		.replace(/\+?\d[\d\s\-()]{6,}\d/g, '[phone]')
		.replace(/\bhttps?:\/\/\S+/gi, '[url]')
		.slice(0, AI_QUERY_ANALYSIS_INPUT_MAX_LENGTH)
		.trim();

const extractJsonPayload = (raw: string): QueryAnalysisPayload => {
	const trimmed = raw.trim();
	if (!trimmed) return {};

	const parseAttempt = (value: string) => {
		try {
			return JSON.parse(value) as QueryAnalysisPayload;
		} catch {
			return undefined;
		}
	};

	const direct = parseAttempt(trimmed);
	if (direct !== undefined) return direct;

	const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
	if (fencedMatch) {
		const fencedParsed = parseAttempt(fencedMatch[1] ?? '');
		if (fencedParsed !== undefined) return fencedParsed;
	}

	const start = trimmed.indexOf('{');
	if (start === -1) return {};
	let depth = 0;
	for (let i = start; i < trimmed.length; i += 1) {
		const char = trimmed[i];
		if (char === '{') depth += 1;
		else if (char === '}') {
			depth -= 1;
			if (depth === 0) {
				const candidate = trimmed.slice(start, i + 1);
				const parsed = parseAttempt(candidate);
				if (parsed !== undefined) return parsed;
				break;
			}
		}
	}

	return {};
};

const toStringArray = (value: unknown): string[] => {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === 'string');
};

const sanitizeAiTerms = (payload: QueryAnalysisPayload) => {
	const technologies = toStringArray(payload.technologies)
		.map((value) => buildSearchTerm(value, 'technology', 1.35))
		.filter((term): term is ResumeSearchQueryTerm => term !== null)
		.slice(0, MAX_TERMS_PER_KIND);
	const roles = toStringArray(payload.roles)
		.map((value) => buildSearchTerm(value, 'role', 1.15))
		.filter((term): term is ResumeSearchQueryTerm => term !== null)
		.slice(0, Math.min(MAX_TERMS_PER_KIND, 6));
	const concepts = toStringArray(payload.concepts)
		.map((value) => buildSearchTerm(value, 'concept', 1))
		.filter((term): term is ResumeSearchQueryTerm => term !== null)
		.slice(0, MAX_TERMS_PER_KIND);
	const ignored = new Set(
		toStringArray(payload.ignore)
			.map((value) => normalizeSearchText(value))
			.filter(Boolean)
	);

	return dedupeTerms([...technologies, ...roles, ...concepts]).filter(
		(term) => !ignored.has(term.normalized)
	);
};

const analyzeQueryWithAi = async (
	fallbackQuery: ParsedResumeSearchQuery
): Promise<ParsedResumeSearchQuery | null> => {
	if (!process.env.OPENAI_API_KEY?.trim()) return fallbackQuery;

	const sanitizedInput = sanitizeQueryAnalysisInput(fallbackQuery.raw);
	if (!sanitizedInput) return fallbackQuery;

	const cacheKey = fallbackQuery.normalized;
	const cached = queryAnalysisCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.value ?? fallbackQuery;
	}

	try {
		const { getModel, openai } = await import('$lib/server/openai');
		const model = process.env.LLM_MODEL_SEARCH_QUERY?.trim() || getModel();
		const response = await openai.responses.create({
			model,
			temperature: 0.1,
			max_output_tokens: 500,
			input: [
				{
					role: 'system',
					content: `You extract searchable hiring requirements from Swedish and English assignment text.

Return JSON only with this exact shape:
{
  "technologies": ["string"],
  "roles": ["string"],
  "concepts": ["string"],
  "ignore": ["string"]
}

Rules:
- technologies: only concrete technologies, programming languages, frameworks, databases, platforms, tools, cloud services, or named engineering methods with clear resume-search value.
- roles: only job titles or specialist role names.
- concepts: only short meaningful noun phrases for non-technology requirements, responsibilities, domains, or focus areas.
- ignore: words or phrases from the text that should not be used as searchable requirements.
- Never output generic verbs, adjectives, filler, locations, dates, percentages, contact details, company boilerplate, or language-fluency phrases unless they are directly technical.
- Never split a technology into fragments.
- Keep each item concise, usually 1-4 words.
- Prefer normalized searchable phrases over full sentences.
- Do not duplicate the same concept across categories.

Good technologies: Python, DataOps, dbt, Snowflake, SQL, Git, React Native, Swift.
Bad technologies: engineer, bygga, arbeta, tal, skrift, stark erfarenhet, modern.

Good concepts: data platform, data modeling, data quality, pipelines, mobile app maintenance.
Bad concepts: vår kund, spännande uppdrag, asap, stockholm, onsite.`
				},
				{
					role: 'user',
					content: `Extract the searchable requirements from this query:

${sanitizedInput}`
				}
			]
		});

		const rawOutput = response.output_text ?? '';
		const payload = extractJsonPayload(rawOutput);
		const aiTerms = sanitizeAiTerms(payload);
		const value =
			buildParsedQuery({
				raw: fallbackQuery.raw,
				normalized: fallbackQuery.normalized,
				terms: aiTerms.length > 0 ? aiTerms : fallbackQuery.terms,
				aiApplied: aiTerms.length > 0
			}) ?? fallbackQuery;

		queryAnalysisCache.set(cacheKey, {
			expiresAt: Date.now() + AI_QUERY_ANALYSIS_CACHE_TTL_MS,
			value
		});

		return value;
	} catch (error) {
		console.error('[resume-search] AI query analysis failed, using fallback parser', error);
		queryAnalysisCache.set(cacheKey, {
			expiresAt: Date.now() + 60_000,
			value: fallbackQuery
		});
		return fallbackQuery;
	}
};

export const analyzeResumeSearchQuery = async (
	query: string
): Promise<ParsedResumeSearchQuery | null> => {
	const fallbackQuery = parseResumeSearchQueryFallback(query);
	if (!fallbackQuery) return null;
	if (!shouldUseAiForQuery(fallbackQuery)) return fallbackQuery;
	return analyzeQueryWithAi(fallbackQuery);
};
