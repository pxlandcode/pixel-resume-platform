import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
	ResumeSearchFilterTerm,
	ResumeSearchItem,
	ResumeSearchReason
} from '$lib/types/resumes';
import { collapseWhitespace, stripTags } from '$lib/server/resumes/searchQueryAnalysis';

const EMBEDDING_DIMENSIONS = 1536;
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_INPUT_MAX_CHARS = 10_000;
const EMBEDDING_DOCUMENT_PAGE_SIZE = 500;
const EMBEDDING_INPUT_BATCH_SIZE = 48;
const DEFAULT_REFRESH_LIMIT = 600;
const MAX_REFRESH_LIMIT = 2_000;
const DEFAULT_SEMANTIC_LIMIT = 250;
const MAX_SEMANTIC_LIMIT = 500;
const DEFAULT_MIN_SIMILARITY = 0.2;

type SearchDocumentRow = {
	talent_id: string;
	display_name: string | null;
	profile_title: string | null;
	search_text: string | null;
	field_snippets: unknown;
};

type SearchDocumentEmbeddingRow = {
	talent_id: string;
	model: string | null;
	content_hash: string | null;
};

type SemanticMatchRpcRow = {
	talent_id: string;
	display_name: string | null;
	profile_title: string | null;
	field_snippets: unknown;
	similarity: number | null;
};

const parsePositiveInteger = (value: string | undefined, fallback: number, max: number) => {
	const parsed = Number.parseInt(value ?? '', 10);
	if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
	return Math.min(parsed, max);
};

export const getResumeSearchEmbeddingModel = () =>
	process.env.OPENAI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;

const shouldSendEmbeddingDimensions = (model: string) => model.startsWith('text-embedding-3');

const buildEmbeddingContentHash = (content: string, model: string) =>
	crypto
		.createHash('sha256')
		.update(model)
		.update('\0')
		.update(String(EMBEDDING_DIMENSIONS))
		.update('\0')
		.update(content)
		.digest('hex');

const normalizeEmbeddingInput = (value: string) =>
	collapseWhitespace(stripTags(value)).slice(0, EMBEDDING_INPUT_MAX_CHARS).trim();

const chunkValues = <T>(values: T[], size: number) => {
	const chunks: T[][] = [];
	for (let index = 0; index < values.length; index += size) {
		chunks.push(values.slice(index, index + size));
	}
	return chunks;
};

const toSafeReasonText = (value: unknown) =>
	typeof value === 'string' ? collapseWhitespace(stripTags(value)).slice(0, 180).trim() : '';

const sanitizeReasonArray = (value: unknown): ResumeSearchReason[] => {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => {
			if (!entry || typeof entry !== 'object') return null;
			const record = entry as Record<string, unknown>;
			const label = toSafeReasonText(record.label);
			const text = toSafeReasonText(record.text);
			if (!label || !text) return null;
			return {
				label,
				text,
				resumeId: typeof record.resumeId === 'string' ? record.resumeId : null,
				resumeTitle: toSafeReasonText(record.resumeTitle) || null
			} satisfies ResumeSearchReason;
		})
		.filter((entry): entry is ResumeSearchReason => entry !== null);
};

const buildSemanticQueryInput = (query: string, terms: ResumeSearchFilterTerm[]) => {
	const termText = terms
		.map((term) => `${term.kind}: ${term.label}`)
		.filter(Boolean)
		.join(', ');
	return normalizeEmbeddingInput(
		[`Search assignment`, query.trim(), termText ? `Key extracted requirements: ${termText}` : null]
			.filter(Boolean)
			.join('\n\n')
	);
};

const createEmbeddings = async (inputs: string[], model: string) => {
	if (!process.env.OPENAI_API_KEY?.trim()) return null;
	const sanitizedInputs = inputs.map(normalizeEmbeddingInput).filter(Boolean);
	if (sanitizedInputs.length === 0) return [];

	const { openai } = await import('$lib/server/openai');
	const response = await openai.embeddings.create({
		model,
		input: sanitizedInputs,
		...(shouldSendEmbeddingDimensions(model) ? { dimensions: EMBEDDING_DIMENSIONS } : {})
	});

	return response.data
		.slice()
		.sort((left, right) => left.index - right.index)
		.map((item) => item.embedding);
};

const fetchExistingEmbeddingsByTalentId = async (
	adminClient: SupabaseClient,
	talentIds: string[]
) => {
	const embeddingsByTalentId = new Map<string, SearchDocumentEmbeddingRow>();
	for (const batch of chunkValues(talentIds, 200)) {
		const { data, error } = await adminClient
			.from('resume_search_document_embeddings')
			.select('talent_id, model, content_hash')
			.in('talent_id', batch);
		if (error) throw new Error(error.message);
		for (const row of (data ?? []) as SearchDocumentEmbeddingRow[]) {
			if (typeof row.talent_id === 'string') embeddingsByTalentId.set(row.talent_id, row);
		}
	}
	return embeddingsByTalentId;
};

const fetchSearchDocumentPage = async (payload: {
	adminClient: SupabaseClient;
	scopeOrgIds: string[];
	accessibleTalentIds: string[] | null;
	from: number;
	to: number;
}) => {
	let query = payload.adminClient
		.from('resume_search_documents')
		.select('talent_id, display_name, profile_title, search_text, field_snippets')
		.order('updated_at', { ascending: false })
		.range(payload.from, payload.to);

	if (payload.scopeOrgIds.length > 0) {
		query = query.overlaps('organisation_ids', payload.scopeOrgIds);
	}

	if (payload.accessibleTalentIds && payload.accessibleTalentIds.length > 0) {
		query = query.in('talent_id', payload.accessibleTalentIds);
	}

	const { data, error } = await query;
	if (error) throw new Error(error.message);
	return (data ?? []) as SearchDocumentRow[];
};

export const ensureResumeSearchDocumentEmbeddings = async (payload: {
	adminClient: SupabaseClient;
	scopeOrgIds: string[];
	accessibleTalentIds: string[] | null;
	model?: string;
	refreshLimit?: number;
}) => {
	const model = payload.model ?? getResumeSearchEmbeddingModel();
	const refreshLimit = Math.min(
		Math.max(
			payload.refreshLimit ??
				parsePositiveInteger(
					process.env.RESUME_SEARCH_EMBEDDING_REFRESH_LIMIT,
					DEFAULT_REFRESH_LIMIT,
					MAX_REFRESH_LIMIT
				),
			0
		),
		MAX_REFRESH_LIMIT
	);
	if (refreshLimit <= 0 || !process.env.OPENAI_API_KEY?.trim()) return { refreshed: 0 };

	let refreshed = 0;
	let offset = 0;

	while (refreshed < refreshLimit) {
		const rows = await fetchSearchDocumentPage({
			adminClient: payload.adminClient,
			scopeOrgIds: payload.scopeOrgIds,
			accessibleTalentIds: payload.accessibleTalentIds,
			from: offset,
			to: offset + EMBEDDING_DOCUMENT_PAGE_SIZE - 1
		});
		if (rows.length === 0) break;

		const existingByTalentId = await fetchExistingEmbeddingsByTalentId(
			payload.adminClient,
			rows.map((row) => row.talent_id).filter(Boolean)
		);
		const staleRows = rows
			.map((row) => {
				const content = normalizeEmbeddingInput(row.search_text ?? '');
				if (!row.talent_id || !content) return null;
				const contentHash = buildEmbeddingContentHash(content, model);
				const existing = existingByTalentId.get(row.talent_id);
				if (existing?.model === model && existing.content_hash === contentHash) return null;
				return { talentId: row.talent_id, content, contentHash };
			})
			.filter(
				(row): row is { talentId: string; content: string; contentHash: string } => row !== null
			)
			.slice(0, refreshLimit - refreshed);

		for (const batch of chunkValues(staleRows, EMBEDDING_INPUT_BATCH_SIZE)) {
			const embeddings = await createEmbeddings(
				batch.map((row) => row.content),
				model
			);
			if (!embeddings || embeddings.length === 0) return { refreshed };

			const now = new Date().toISOString();
			const upsertRows = batch.map((row, index) => ({
				talent_id: row.talentId,
				model,
				content_hash: row.contentHash,
				embedding: embeddings[index],
				generated_at: now,
				updated_at: now
			}));

			const { error } = await payload.adminClient
				.from('resume_search_document_embeddings')
				.upsert(upsertRows, { onConflict: 'talent_id' });
			if (error) throw new Error(error.message);
			refreshed += upsertRows.length;
			if (refreshed >= refreshLimit) break;
		}

		if (rows.length < EMBEDDING_DOCUMENT_PAGE_SIZE) break;
		offset += EMBEDDING_DOCUMENT_PAGE_SIZE;
	}

	return { refreshed };
};

const semanticSimilarityToMatchPercent = (similarity: number) => {
	const normalized = (similarity - 0.2) / 0.6;
	return Math.max(1, Math.min(100, Math.round(normalized * 100)));
};

export const searchResumeDocumentsSemantically = async (payload: {
	adminClient: SupabaseClient;
	query: string;
	terms: ResumeSearchFilterTerm[];
	scopeOrgIds: string[];
	accessibleTalentIds: string[] | null;
	limit?: number;
	minSimilarity?: number;
}): Promise<ResumeSearchItem[]> => {
	const queryInput = buildSemanticQueryInput(payload.query, payload.terms);
	if (!queryInput || !process.env.OPENAI_API_KEY?.trim()) return [];

	const model = getResumeSearchEmbeddingModel();
	await ensureResumeSearchDocumentEmbeddings({
		adminClient: payload.adminClient,
		scopeOrgIds: payload.scopeOrgIds,
		accessibleTalentIds: payload.accessibleTalentIds,
		model
	});

	const [queryEmbedding] = (await createEmbeddings([queryInput], model)) ?? [];
	if (!queryEmbedding) return [];

	const limit = Math.min(Math.max(payload.limit ?? DEFAULT_SEMANTIC_LIMIT, 1), MAX_SEMANTIC_LIMIT);
	const minSimilarity = Math.max(0, Math.min(payload.minSimilarity ?? DEFAULT_MIN_SIMILARITY, 1));
	const { data, error } = await payload.adminClient.rpc('match_resume_search_document_embeddings', {
		p_query_embedding: queryEmbedding,
		p_org_ids: payload.scopeOrgIds,
		p_talent_ids: payload.accessibleTalentIds,
		p_model: model,
		p_limit: limit,
		p_min_similarity: minSimilarity
	});

	if (error) throw new Error(error.message);

	const items: ResumeSearchItem[] = [];
	for (const row of (data ?? []) as SemanticMatchRpcRow[]) {
		const talentId = typeof row.talent_id === 'string' ? row.talent_id : '';
		const similarity =
			typeof row.similarity === 'number' && Number.isFinite(row.similarity) ? row.similarity : 0;
		if (!talentId || similarity <= 0) continue;

		const reasons = sanitizeReasonArray(row.field_snippets).slice(0, 2);
		const displayName =
			typeof row.display_name === 'string' && row.display_name.trim()
				? row.display_name.trim()
				: 'Resume profile';
		const semanticReason: ResumeSearchReason = {
			label: 'Semantic match',
			text:
				reasons[0]?.text ||
				(typeof row.profile_title === 'string' && row.profile_title.trim()
					? row.profile_title.trim()
					: displayName),
			resumeId: reasons[0]?.resumeId ?? null,
			resumeTitle: reasons[0]?.resumeTitle ?? null
		};
		const matchPercent = semanticSimilarityToMatchPercent(similarity);
		items.push({
			talentId,
			score: similarity * 120,
			matchPercent,
			matchedTerms: ['Semantic match'],
			missingTerms: [],
			matchedQueryTechs: [],
			missingQueryTechs: [],
			matchedTechs: [],
			reasons: [semanticReason, ...reasons].slice(0, 3),
			bestResumeId: semanticReason.resumeId,
			bestResumeTitle: semanticReason.resumeTitle,
			semanticSimilarity: similarity,
			semanticMatchPercent: matchPercent
		});
	}

	return items;
};
