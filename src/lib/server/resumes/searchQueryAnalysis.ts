import type { ResumeSearchFilterTerm } from '$lib/types/resumes';

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
	'analytical',
	'and',
	'are',
	'ar',
	'as',
	'at',
	'att',
	'audience',
	'audiences',
	'av',
	'avser',
	'be',
	'behov',
	'behover',
	'by',
	'communication',
	'communications',
	'de',
	'den',
	'denna',
	'det',
	'du',
	'en',
	'eller',
	'excellent',
	'ett',
	'efter',
	'for',
	'forsta',
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
	'kund',
	'kunden',
	'kundens',
	'krav',
	'kraver',
	'consultant',
	'med',
	'men',
	'nu',
	'och',
	'of',
	'om',
	'on',
	'or',
	'pa',
	'problem',
	'samt',
	'sig',
	'ska',
	'skall',
	'skill',
	'skills',
	'solving',
	'strong',
	'som',
	'tal',
	'the',
	'they',
	'this',
	'till',
	'till',
	'to',
	'uppdrag',
	'uppdraget',
	'uppdragets',
	'var',
	'varit',
	'vara',
	'vi',
	'with'
]);

const GENERIC_CONCEPT_TERMS = new Set([
	'ability',
	'avser',
	'avveckla',
	'bankens',
	'beskrivning',
	'beslutat',
	'communication',
	'communication skills',
	'consultant',
	'dar',
	'del',
	'denna',
	'efter',
	'erbjudande',
	'forandring',
	'forandringar',
	'fortsatt',
	'kund',
	'kunden',
	'kundens',
	'letar',
	'leverantoren',
	'losning',
	'losningen',
	'problem solving',
	'nodvandig',
	'nuvarande',
	'owner',
	'overga',
	'premises',
	'renodlat',
	'saaa',
	'sakerstalla',
	'stallet',
	'stod',
	'teknisk',
	'tjanst',
	'transformation',
	'uppdrag',
	'uppdraget',
	'var'
]);

const NON_TECH_REQUIREMENT_TERMS = new Set([
	'analytical',
	'analytical skills',
	'communication',
	'communication skills',
	'consultant',
	'consulting',
	'excellent communication',
	'excellent communication skills',
	'problem solving',
	'problem solving skills',
	'strong analytical skills',
	'strong problem solving',
	'strong problem solving skills',
	'technical and non technical audiences'
]);

const GENERIC_ROLE_TERMS = new Set(['consultant']);
const GENERIC_STANDALONE_ROLE_TERMS = new Set([
	'coach',
	'developer',
	'engineer',
	'lead',
	'manager',
	'specialist'
]);

const FALLBACK_HIGH_SIGNAL_CONCEPT_TERMS = new Set([
	'bank',
	'banking',
	'finans',
	'finance',
	'fintech',
	'forsakring',
	'forsakringsbolag',
	'gambling',
	'gaming',
	'healthcare',
	'igaming',
	'kommun',
	'medtech',
	'municipality',
	'offentlig',
	'offentlig sektor',
	'public sector',
	'sjukvard',
	'telecom'
]);

const QUERY_ANALYSIS_KIND_PRIORITY: Record<ResumeSearchQueryTermKind, number> = {
	technology: 3,
	role: 2,
	concept: 1
};

const FALLBACK_DISPLAY_CASE_OVERRIDES = new Map<string, string>([
	['ai', 'AI'],
	['api', 'API'],
	['artifactory', 'Artifactory'],
	['aws', 'AWS'],
	['azure', 'Azure'],
	['backstage', 'Backstage'],
	['bamboo', 'Bamboo'],
	['bi', 'BI'],
	['bitbucket', 'Bitbucket'],
	['ci', 'CI'],
	['cd', 'CD'],
	['css', 'CSS'],
	['datadog', 'Datadog'],
	['dbt', 'dbt'],
	['dynamodb', 'DynamoDB'],
	['etl', 'ETL'],
	['erp', 'ERP'],
	['epic', 'Epic'],
	['figma', 'Figma'],
	['gcp', 'GCP'],
	['git', 'Git'],
	['helix', 'Helix'],
	['html', 'HTML'],
	['ios', 'iOS'],
	['javascript', 'JavaScript'],
	['jenkins', 'Jenkins'],
	['jira', 'Jira'],
	['js', 'JavaScript'],
	['kafka', 'Kafka'],
	['kotlin', 'Kotlin'],
	['ml', 'ML'],
	['mysql', 'MySQL'],
	['net', '.NET'],
	['node', 'Node.js'],
	['postgresql', 'PostgreSQL'],
	['python', 'Python'],
	['qa', 'QA'],
	['qtest', 'qTest'],
	['react', 'React'],
	['s3', 'S3'],
	['saas', 'SaaS'],
	['sonarqube', 'SonarQube'],
	['sql', 'SQL'],
	['sqs', 'SQS'],
	['swagger', 'Swagger'],
	['swift', 'Swift'],
	['typescript', 'TypeScript'],
	['ts', 'TypeScript'],
	['ui', 'UI'],
	['unit4', 'Unit4'],
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
	'kafka',
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

const FALLBACK_PHRASE_TERMS: Array<{
	label: string;
	kind: ResumeSearchQueryTermKind;
	aliases?: string[];
	importance?: number;
}> = [
	{
		label: 'React Native',
		kind: 'technology',
		aliases: ['react-native']
	},
	{
		label: 'Node.js',
		kind: 'technology',
		aliases: ['node js', 'nodejs']
	},
	{
		label: 'TypeScript',
		kind: 'technology'
	},
	{
		label: 'PostgreSQL',
		kind: 'technology',
		aliases: ['postgres']
	},
	{
		label: 'DynamoDB',
		kind: 'technology',
		aliases: ['dynamo db']
	},
	{
		label: 'Kafka',
		kind: 'technology'
	},
	{
		label: 'SQS',
		kind: 'technology'
	},
	{
		label: 'AWS',
		kind: 'technology',
		aliases: ['aws services', 'amazon web services']
	},
	{
		label: 'S3',
		kind: 'technology',
		aliases: ['aws s3', 'amazon s3']
	},
	{
		label: 'Datadog',
		kind: 'technology'
	},
	{
		label: 'Fullstack Engineer',
		kind: 'role',
		aliases: [
			'full stack engineer',
			'full-stack engineer',
			'fullstack developer',
			'full stack developer',
			'full-stack developer',
			'full stack developer consultant',
			'full-stack developer consultant',
			'full stack consultant',
			'full-stack consultant'
		]
	},
	{
		label: 'SDLC Toolchain',
		kind: 'concept',
		aliases: ['sdlc tools', 'sdlc toolchain'],
		importance: 1.08
	},
	{
		label: 'API Engine',
		kind: 'concept',
		aliases: ['api engine application'],
		importance: 1.08
	},
	{
		label: 'Identity Mapping',
		kind: 'concept',
		aliases: ['identity mapping system', 'entity mapping'],
		importance: 1.08
	},
	{
		label: 'Internal Developer Platform',
		kind: 'concept',
		aliases: ['developer platform', 'idp'],
		importance: 1.08
	},
	{
		label: 'Backend Services',
		kind: 'concept',
		importance: 1.08
	},
	{
		label: 'Cloud Native',
		kind: 'concept',
		aliases: ['cloud-native'],
		importance: 1.08
	},
	{
		label: 'Data Intensive Applications',
		kind: 'concept',
		aliases: ['data-intensive applications', 'data intensive environment'],
		importance: 1.08
	},
	{
		label: 'Distributed Systems',
		kind: 'concept',
		importance: 1.08
	},
	{
		label: 'Event Driven Architecture',
		kind: 'concept',
		aliases: [
			'event-driven architecture',
			'event driven architectures',
			'event-driven architectures'
		],
		importance: 1.08
	},
	{
		label: 'Serverless Messaging',
		kind: 'concept',
		aliases: ['serverless messaging', 'cloud messaging', 'message queues', 'messaging services'],
		importance: 1.08
	},
	{
		label: 'Feature Flags',
		kind: 'concept',
		aliases: ['feature flagging'],
		importance: 1.08
	},
	{
		label: 'A/B Testing',
		kind: 'concept',
		aliases: ['ab testing', 'a b testing'],
		importance: 1.08
	},
	{
		label: 'Mobile Applications',
		kind: 'concept',
		aliases: ['mobile application', 'mobile app', 'mobile apps'],
		importance: 1.08
	},
	{
		label: 'Web Applications',
		kind: 'concept',
		aliases: ['web application', 'web app', 'web apps'],
		importance: 1.08
	},
	{
		label: 'Microservices',
		kind: 'concept',
		aliases: ['micro services', 'micro-services'],
		importance: 1.08
	},
	{
		label: 'Monitoring',
		kind: 'concept',
		importance: 1.08
	},
	{
		label: 'Observability',
		kind: 'concept',
		importance: 1.08
	},
	{
		label: 'High Transaction Volumes',
		kind: 'concept',
		importance: 1.08
	},
	{
		label: 'Complex Data Flows',
		kind: 'concept',
		importance: 1.08
	},
	{
		label: 'Fintech',
		kind: 'concept',
		importance: 1.08
	},
	{
		label: 'Regulated Industry',
		kind: 'concept',
		aliases: ['regulated industries'],
		importance: 1.08
	}
];

const FALLBACK_ROLE_TERMS = new Set([
	'architect',
	'coach',
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

export type ResumeSearchQueryCatalogTechnology = {
	label: string;
	aliases: string[];
	category: string | null;
};

export type ResumeSearchQueryCatalogContext = {
	scopeSignature: string;
	cacheKey: string;
	technologies: ResumeSearchQueryCatalogTechnology[];
};

export type ResumeSearchQueryTermKind = 'technology' | 'role' | 'concept';

export type ResumeSearchQueryTerm = {
	display: string;
	normalized: string;
	tokens: string[];
	kind: ResumeSearchQueryTermKind;
	importance: number;
	interpretedFrom?: string | null;
};

export type ParsedResumeSearchQuery = {
	raw: string;
	normalized: string;
	terms: ResumeSearchQueryTerm[];
	aiApplied: boolean;
};

const queryAnalysisCache = new Map<string, QueryAnalysisCacheEntry>();
const MAX_CATALOG_CONTEXT_CHARS = 10_000;
const MAX_CATALOG_ALIASES_PER_TECH = 6;

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

const isGenericConceptTerm = (term: Pick<ResumeSearchQueryTerm, 'kind' | 'normalized'>) =>
	term.kind === 'concept' && GENERIC_CONCEPT_TERMS.has(term.normalized);

const isConservativeFallbackTerm = (term: ResumeSearchQueryTerm) =>
	term.kind !== 'concept' ||
	term.importance > 1 ||
	FALLBACK_HIGH_SIGNAL_CONCEPT_TERMS.has(term.normalized);

const sanitizeTermDisplay = (value: unknown, maxLength = 80) => {
	if (typeof value !== 'string') return '';
	return collapseWhitespace(stripTags(value)).slice(0, maxLength).trim();
};

const toTitleCaseDisplay = (value: string) => {
	if (!value || value !== value.toLowerCase()) return value;

	return value.replace(/\p{L}[\p{L}\p{M}'’.-]*/gu, (word) => {
		const [first = '', ...rest] = Array.from(word);
		return `${first.toLocaleUpperCase()}${rest.join('')}`;
	});
};

const getCanonicalFallbackPhraseLabel = (normalized: string, kind: ResumeSearchQueryTermKind) => {
	const entry = FALLBACK_PHRASE_TERMS.find((candidate) => {
		if (candidate.kind !== kind) return false;
		return [candidate.label, ...(candidate.aliases ?? [])].some(
			(value) => normalizeSearchText(value) === normalized
		);
	});

	return entry?.label ?? null;
};

const isRejectedTechnologyTerm = (normalized: string) =>
	NON_TECH_REQUIREMENT_TERMS.has(normalized) ||
	/\b(communication|communicative|problem solving|analytical skills|soft skills)\b/.test(
		normalized
	);

const buildSearchTerm = (
	value: unknown,
	kind: ResumeSearchQueryTermKind,
	importance: number,
	interpretedFrom: string | null = null
): ResumeSearchQueryTerm | null => {
	const rawDisplay = sanitizeTermDisplay(value);
	const rawNormalized = normalizeSearchText(rawDisplay);
	if (!rawNormalized) return null;
	if (kind === 'technology' && isRejectedTechnologyTerm(rawNormalized)) return null;
	if (kind === 'role' && GENERIC_ROLE_TERMS.has(rawNormalized)) return null;

	const canonicalPhraseLabel = getCanonicalFallbackPhraseLabel(rawNormalized, kind);
	const display =
		kind === 'technology'
			? (canonicalPhraseLabel ?? rawDisplay)
			: toTitleCaseDisplay(canonicalPhraseLabel ?? rawDisplay);
	if (!display) return null;

	const normalized = normalizeSearchText(display);
	if (!normalized) return null;
	if (kind === 'concept' && GENERIC_CONCEPT_TERMS.has(normalized)) return null;
	if (kind === 'technology' && isRejectedTechnologyTerm(normalized)) return null;
	if (kind === 'role' && GENERIC_ROLE_TERMS.has(normalized)) return null;

	const tokens = tokenizeQuery(normalized);
	if (tokens.length === 0) return null;
	const resolvedInterpretedFrom =
		interpretedFrom ?? (canonicalPhraseLabel && rawNormalized !== normalized ? rawDisplay : null);

	return {
		display,
		normalized,
		tokens,
		kind,
		importance,
		...(resolvedInterpretedFrom ? { interpretedFrom: resolvedInterpretedFrom } : {})
	};
};

const normalizedTextIncludesPhrase = (normalizedText: string, normalizedPhrase: string) =>
	normalizedPhrase.length > 0 && ` ${normalizedText} `.includes(` ${normalizedPhrase} `);

const buildFallbackPhraseTerms = (normalized: string) =>
	FALLBACK_PHRASE_TERMS.flatMap((entry) => {
		const candidates = [entry.label, ...(entry.aliases ?? [])]
			.map((candidate) => ({ raw: candidate, normalized: normalizeSearchText(candidate) }))
			.filter((candidate) => Boolean(candidate.normalized));
		const matchedCandidate = candidates.find((candidate) =>
			normalizedTextIncludesPhrase(normalized, candidate.normalized)
		);
		if (!matchedCandidate) {
			return [];
		}

		const normalizedLabel = normalizeSearchText(entry.label);
		const interpretedFrom =
			matchedCandidate.normalized !== normalizedLabel ? matchedCandidate.raw : null;
		const importance =
			entry.importance ?? (entry.kind === 'technology' ? 1.45 : entry.kind === 'role' ? 1.2 : 1.08);
		const term = buildSearchTerm(entry.label, entry.kind, importance, interpretedFrom);
		return term ? [term] : [];
	});

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

const removeSubsumedTerms = (terms: ResumeSearchQueryTerm[]) =>
	terms.filter(
		(term) =>
			!terms.some(
				(candidate) =>
					candidate.kind === term.kind &&
					candidate.normalized !== term.normalized &&
					candidate.tokens.length > term.tokens.length &&
					candidate.importance >= term.importance &&
					term.tokens.every((token) => candidate.tokens.includes(token))
			)
	);

const removeGenericStandaloneRoles = (terms: ResumeSearchQueryTerm[]) => {
	const hasSpecificRole = terms.some(
		(term) =>
			term.kind === 'role' &&
			term.tokens.length > 1 &&
			!GENERIC_STANDALONE_ROLE_TERMS.has(term.normalized)
	);
	if (!hasSpecificRole) return terms;

	return terms.filter(
		(term) => term.kind !== 'role' || !GENERIC_STANDALONE_ROLE_TERMS.has(term.normalized)
	);
};

const buildFallbackTerms = (normalized: string) =>
	dedupeTerms([
		...buildFallbackPhraseTerms(normalized),
		...tokenizeQuery(normalized)
			.map((token) => {
				const kind = getFallbackTermKind(token);
				const display =
					kind === 'technology'
						? formatFallbackDisplay(token)
						: toTitleCaseDisplay(formatFallbackDisplay(token));
				return (
					buildSearchTerm(
						display,
						kind,
						kind === 'technology' ? 1.2 : kind === 'role' ? 1.05 : 1
					) ?? null
				);
			})
			.filter((term): term is ResumeSearchQueryTerm => term !== null)
	]);

const buildParsedQuery = (payload: {
	raw: string;
	normalized: string;
	terms: ResumeSearchQueryTerm[];
	aiApplied: boolean;
}): ParsedResumeSearchQuery | null => {
	const terms = removeGenericStandaloneRoles(removeSubsumedTerms(dedupeTerms(payload.terms))).slice(
		0,
		MAX_TERMS_PER_KIND * 3
	);
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

const buildConservativeFallbackQuery = (query: ParsedResumeSearchQuery) =>
	buildParsedQuery({
		raw: query.raw,
		normalized: query.normalized,
		terms: query.terms.filter(isConservativeFallbackTerm),
		aiApplied: false
	});

export const getResumeSimpleSearchDisplayTerms = (query: string) => {
	const normalized = normalizeSearchText(query);
	if (!normalized) return [];
	return buildFallbackTerms(normalized)
		.filter((term) => !isGenericConceptTerm(term))
		.slice(0, 12)
		.map((term) => term.display);
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
		(term) => !ignored.has(term.normalized) && !isGenericConceptTerm(term)
	);
};

const buildCatalogCanonicalLabelByMatchKey = (
	catalogContext: ResumeSearchQueryCatalogContext | null | undefined
) => {
	if (!catalogContext) return new Map<string, string>();

	const canonicalLabelByMatchKey = new Map<string, string>();

	for (const technology of catalogContext.technologies) {
		const canonicalLabel = sanitizeTermDisplay(technology.label);
		if (!canonicalLabel) continue;

		for (const candidate of [technology.label, ...technology.aliases]) {
			const normalized = normalizeSearchText(candidate);
			if (!normalized || canonicalLabelByMatchKey.has(normalized)) continue;
			canonicalLabelByMatchKey.set(normalized, canonicalLabel);
		}
	}

	return canonicalLabelByMatchKey;
};

const buildCatalogMatchedTerms = (
	normalized: string,
	catalogContext: ResumeSearchQueryCatalogContext | null | undefined
) => {
	if (!catalogContext) return [];

	const terms: ResumeSearchQueryTerm[] = [];
	const seen = new Set<string>();

	for (const technology of catalogContext.technologies) {
		const canonicalLabel = sanitizeTermDisplay(technology.label);
		if (!canonicalLabel) continue;
		const canonicalKey = normalizeSearchText(canonicalLabel);
		if (!canonicalKey || seen.has(canonicalKey)) continue;

		const candidates = uniqueValues([technology.label, ...technology.aliases])
			.map((candidate) => ({ raw: candidate, normalized: normalizeSearchText(candidate) }))
			.filter((candidate) => candidate.normalized.length > 0);
		const matchedCandidate = candidates.find((candidate) =>
			normalizedTextIncludesPhrase(normalized, candidate.normalized)
		);
		if (!matchedCandidate) {
			continue;
		}

		seen.add(canonicalKey);

		const interpretedFrom =
			matchedCandidate.normalized !== canonicalKey ? matchedCandidate.raw : null;
		const term = buildSearchTerm(canonicalLabel, 'technology', 1.5, interpretedFrom);
		if (term) terms.push(term);
	}

	return terms.slice(0, MAX_TERMS_PER_KIND);
};

const canonicalizeTermsWithCatalogContext = (
	terms: ResumeSearchQueryTerm[],
	catalogContext: ResumeSearchQueryCatalogContext | null | undefined
) => {
	const canonicalLabelByMatchKey = buildCatalogCanonicalLabelByMatchKey(catalogContext);
	if (canonicalLabelByMatchKey.size === 0) return terms;

	return dedupeTerms(
		terms.map((term) => {
			const canonicalLabel = canonicalLabelByMatchKey.get(term.normalized);
			if (!canonicalLabel || canonicalLabel === term.display) return term;

			return (
				buildSearchTerm(
					canonicalLabel,
					'technology',
					Math.max(term.importance, 1.35),
					term.interpretedFrom ?? term.display
				) ?? {
					...term,
					display: canonicalLabel,
					kind: 'technology',
					interpretedFrom: term.interpretedFrom ?? term.display
				}
			);
		})
	);
};

const buildCatalogContextPrompt = (
	catalogContext: ResumeSearchQueryCatalogContext | null | undefined
) => {
	if (!catalogContext || catalogContext.technologies.length === 0) return null;

	const lines: string[] = [];
	let totalLength = 0;

	for (const technology of catalogContext.technologies) {
		const aliases = uniqueValues(technology.aliases).slice(0, MAX_CATALOG_ALIASES_PER_TECH);
		const line = [
			`- ${technology.label}`,
			technology.category ? `[${technology.category}]` : null,
			aliases.length > 0 ? `(aliases: ${aliases.join(', ')})` : null
		]
			.filter(Boolean)
			.join(' ');

		if (totalLength + line.length + 1 > MAX_CATALOG_CONTEXT_CHARS) {
			const remaining = catalogContext.technologies.length - lines.length;
			if (remaining > 0) lines.push(`- ... ${remaining} more catalog technologies omitted`);
			break;
		}

		lines.push(line);
		totalLength += line.length + 1;
	}

	return lines.join('\n');
};

const getKindImportance = (kind: ResumeSearchQueryTermKind) => {
	if (kind === 'technology') return 1.35;
	if (kind === 'role') return 1.15;
	return 1;
};

export const toResumeSearchFilterTerms = (
	terms: ResumeSearchQueryTerm[]
): ResumeSearchFilterTerm[] =>
	terms.map((term) => ({
		label: term.display,
		key: term.normalized,
		kind: term.kind,
		...(term.interpretedFrom ? { interpretedFrom: term.interpretedFrom } : {})
	}));

export const buildParsedResumeSearchQueryFromFilterTerms = (payload: {
	raw: string;
	terms: ResumeSearchFilterTerm[];
	aiApplied?: boolean;
}): ParsedResumeSearchQuery | null => {
	const raw = payload.raw.trim().slice(0, MAX_RESUME_SEARCH_QUERY_LENGTH);
	const normalized = normalizeSearchText(raw);
	const terms = dedupeTerms(
		payload.terms
			.map((term) =>
				buildSearchTerm(
					term.label,
					term.kind,
					getKindImportance(term.kind),
					term.interpretedFrom ?? null
				)
			)
			.filter((term): term is ResumeSearchQueryTerm => term !== null)
	).slice(0, MAX_TERMS_PER_KIND * 3);

	if (terms.length === 0) {
		return {
			raw,
			normalized,
			terms: [],
			aiApplied: payload.aiApplied ?? false
		};
	}

	return {
		raw,
		normalized,
		terms,
		aiApplied: payload.aiApplied ?? false
	};
};

const analyzeQueryWithAi = async (
	fallbackQuery: ParsedResumeSearchQuery,
	catalogContext: ResumeSearchQueryCatalogContext | null = null,
	failureFallbackQuery: ParsedResumeSearchQuery | null = fallbackQuery
): Promise<ParsedResumeSearchQuery | null> => {
	const deterministicTerms = dedupeTerms([
		...buildFallbackPhraseTerms(fallbackQuery.normalized),
		...buildCatalogMatchedTerms(fallbackQuery.normalized, catalogContext),
		...(failureFallbackQuery?.terms ?? [])
	]);

	if (!process.env.OPENAI_API_KEY?.trim()) return failureFallbackQuery;

	const sanitizedInput = sanitizeQueryAnalysisInput(fallbackQuery.raw);
	if (!sanitizedInput) return failureFallbackQuery;

	const cacheKey = catalogContext
		? `${catalogContext.cacheKey}:${fallbackQuery.normalized}`
		: fallbackQuery.normalized;
	const cached = queryAnalysisCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.value ?? failureFallbackQuery;
	}

	try {
		const { getModel, openai } = await import('$lib/server/openai');
		const model = process.env.LLM_MODEL_SEARCH_QUERY?.trim() || getModel();
		const catalogContextPrompt = buildCatalogContextPrompt(catalogContext);
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
- roles: only job titles or specialist role names. Do not output staffing words like consultant unless attached to a specific role and then normalize to the role, e.g. "Full Stack Developer Consultant" -> "Fullstack Engineer".
- concepts: only short meaningful noun phrases for non-technology requirements, responsibilities, domains, industries, branches, or focus areas.
- ignore: words or phrases from the text that should not be used as searchable requirements.
- When a technology clearly matches the provided tech catalog or one of its aliases, prefer the exact catalog label.
- Do not expect industries or branch experience to be in the tech catalog. Keep those as concepts.
- Domain and industry experience are important concepts. Examples: medtech, medical devices, municipality, kommun, public sector, offentlig sektor, gaming, gambling, iGaming, fintech, telecom, banking, insurance, healthcare.
- Searches may be written in Swedish or English. If the query clearly refers to a domain or industry, keep it as a searchable concept even if the resume may phrase it differently.
- Still include technologies that are not in the catalog when they are clearly relevant.
- Never output generic verbs, adjectives, filler, locations, dates, percentages, contact details, company boilerplate, staffing words, soft skills, or language-fluency phrases unless they are directly technical.
- Put soft skills in ignore, never technologies/concepts/roles. Examples: problem solving, analytical skills, communication skills, excellent communication.
- Never split a technology into fragments.
- Keep each item concise, usually 1-4 words.
- Prefer normalized searchable phrases over full sentences.
- Do not duplicate the same concept across categories.

Good technologies: Python, DataOps, dbt, Snowflake, SQL, Git, React Native, Swift, Jira, Bitbucket, Jenkins, SonarQube, Backstage, Swagger.
Bad technologies: engineer, consultant, problem solving, analytical skills, communication skills, bygga, arbeta, tal, skrift, stark erfarenhet, modern.

Good roles: Fullstack Engineer, Backend Developer, Frontend Developer, Platform Engineer, Software Architect.
Bad roles: consultant, experienced consultant, problem solver.

Good concepts: API engine, identity mapping, SDLC toolchain, internal developer platform, data platform, data modeling, data quality, pipelines, medtech, municipality, public sector, gaming, gambling, fintech.
Bad concepts: problem solving, analytical skills, communication skills, vår kund, kund, efter, lösning, förändring, denna, del, säkerställa, fortsatt, stöd, spännande uppdrag, asap, stockholm, onsite.`
				},
				{
					role: 'user',
					content: `${catalogContextPrompt ? `Known technology catalog for this user scope:\n${catalogContextPrompt}\n\n` : ''}Extract the searchable requirements from this query:

${sanitizedInput}`
				}
			]
		});

		const rawOutput = response.output_text ?? '';
		const payload = extractJsonPayload(rawOutput);
		const aiTerms = canonicalizeTermsWithCatalogContext(sanitizeAiTerms(payload), catalogContext);
		const mergedTerms = dedupeTerms([...deterministicTerms, ...aiTerms]);
		const value =
			buildParsedQuery({
				raw: fallbackQuery.raw,
				normalized: fallbackQuery.normalized,
				terms: mergedTerms.length > 0 ? mergedTerms : (failureFallbackQuery?.terms ?? []),
				aiApplied: aiTerms.length > 0
			}) ?? failureFallbackQuery;

		queryAnalysisCache.set(cacheKey, {
			expiresAt: Date.now() + AI_QUERY_ANALYSIS_CACHE_TTL_MS,
			value
		});

		return value;
	} catch (error) {
		console.error('[resume-search] AI query analysis failed, using fallback parser', error);
		queryAnalysisCache.set(cacheKey, {
			expiresAt: Date.now() + 60_000,
			value: failureFallbackQuery
		});
		return failureFallbackQuery;
	}
};

export const analyzeResumeSearchQuery = async (
	query: string,
	options?: {
		catalogContext?: ResumeSearchQueryCatalogContext | null;
	}
): Promise<ParsedResumeSearchQuery | null> => {
	const fallbackQuery = parseResumeSearchQueryFallback(query);
	if (!fallbackQuery) return null;
	const catalogContext = options?.catalogContext ?? null;
	const canonicalFallbackQuery =
		buildParsedQuery({
			raw: fallbackQuery.raw,
			normalized: fallbackQuery.normalized,
			terms: dedupeTerms([
				...buildCatalogMatchedTerms(fallbackQuery.normalized, catalogContext),
				...canonicalizeTermsWithCatalogContext(fallbackQuery.terms, catalogContext)
			]),
			aiApplied: fallbackQuery.aiApplied
		}) ?? fallbackQuery;
	if (!shouldUseAiForQuery(canonicalFallbackQuery)) return canonicalFallbackQuery;
	return analyzeQueryWithAi(
		canonicalFallbackQuery,
		catalogContext,
		buildConservativeFallbackQuery(canonicalFallbackQuery)
	);
};
