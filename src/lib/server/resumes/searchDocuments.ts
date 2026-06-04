import type { SupabaseClient } from '@supabase/supabase-js';
import type {
	ResumeSearchReason,
	ResumeSearchScope,
	ResumeSimpleSearchItem,
	ResumeSimpleSearchResponse
} from '$lib/types/resumes';
import {
	collapseWhitespace,
	getResumeSimpleSearchDisplayTerms,
	normalizeSearchText,
	stripTags,
	tokenizeNormalizedText
} from '$lib/server/resumes/searchQueryAnalysis';

const MAX_SIMPLE_SEARCH_QUERY_LENGTH = 500;
const DEFAULT_SIMPLE_SEARCH_LIMIT = 50;
const MAX_SIMPLE_SEARCH_LIMIT = 100;
const MAX_REASON_TEXT_LENGTH = 180;
const MAX_FIELD_SNIPPETS = 80;

type TalentRow = {
	id: string;
	first_name: string | null;
	last_name: string | null;
	title: string | null;
	bio: string | null;
	avatar_url: string | null;
	tech_stack: unknown;
};

type ResumeRow = {
	id: string;
	talent_id: string;
	version_name: string | null;
	is_main: boolean | null;
};

type ResumeBasicsRow = {
	resume_id: string;
	name: string | null;
	title_sv: string | null;
	title_en: string | null;
	summary_sv: string | null;
	summary_en: string | null;
	tech_stack: unknown;
	footer_note_sv: string | null;
	footer_note_en: string | null;
};

type ResumeExperienceRow = {
	id: string;
	resume_id: string;
	experience_id: string | null;
	company_override: string | null;
	location_sv_override: string | null;
	location_en_override: string | null;
	role_sv_override: string | null;
	role_en_override: string | null;
	description_sv_override: string | null;
	description_en_override: string | null;
	use_tech_override: boolean;
};

type ExperienceLibraryRow = {
	id: string;
	company: string | null;
	location_sv: string | null;
	location_en: string | null;
	role_sv: string | null;
	role_en: string | null;
	description_sv: string | null;
	description_en: string | null;
};

type SearchDocumentRpcRow = {
	talent_id: string;
	display_name: string | null;
	profile_title: string | null;
	avatar_url: string | null;
	organisation_ids: string[] | null;
	field_snippets: unknown;
	score: number | null;
};

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

const getSafeText = (value: unknown) =>
	typeof value === 'string' ? collapseWhitespace(stripTags(value)) : '';

const clampText = (value: string, maxLength = MAX_REASON_TEXT_LENGTH) => {
	const trimmed = collapseWhitespace(value);
	if (trimmed.length <= maxLength) return trimmed;
	return `${trimmed.slice(0, maxLength - 1).trimEnd()}...`;
};

const uniqueValues = (values: string[]) => {
	const seen = new Set<string>();
	const out: string[] = [];

	for (const value of values) {
		const trimmed = getSafeText(value);
		if (!trimmed) continue;
		const key = trimmed.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(trimmed);
	}

	return out;
};

const toStringArray = (value: unknown): string[] => {
	if (!Array.isArray(value)) return [];
	return value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean);
};

const extractTechStackValues = (value: unknown): string[] => {
	if (!Array.isArray(value)) return [];

	const values: string[] = [];
	for (const category of value) {
		if (!category || typeof category !== 'object') continue;
		const record = category as { name?: unknown; skills?: unknown };
		if (typeof record.name === 'string') values.push(record.name);
		values.push(...toStringArray(record.skills));
	}
	return uniqueValues(values);
};

const addReason = (
	reasons: ResumeSearchReason[],
	payload: {
		label: string;
		text: string;
		resumeId?: string | null;
		resumeTitle?: string | null;
	}
) => {
	const text = clampText(payload.text);
	if (!text) return;

	reasons.push({
		label: payload.label,
		text,
		resumeId: payload.resumeId ?? null,
		resumeTitle: payload.resumeTitle ?? null
	});
};

const getDisplayResumeTitle = (payload: {
	basics: ResumeBasicsRow | undefined;
	versionName: string | null;
	isMain: boolean;
}) =>
	getSafeText(payload.basics?.title_en) ||
	getSafeText(payload.basics?.title_sv) ||
	getSafeText(payload.versionName) ||
	(payload.isMain ? 'Main resume' : 'Resume');

const sanitizeReasonArray = (value: unknown): ResumeSearchReason[] => {
	if (!Array.isArray(value)) return [];

	return value
		.map((entry) => {
			if (!entry || typeof entry !== 'object') return null;
			const record = entry as Record<string, unknown>;
			const label = getSafeText(record.label);
			const text = getSafeText(record.text);
			if (!label || !text) return null;
			return {
				label,
				text,
				resumeId: normalizeId(record.resumeId),
				resumeTitle: getSafeText(record.resumeTitle) || null
			} satisfies ResumeSearchReason;
		})
		.filter((entry): entry is ResumeSearchReason => entry !== null);
};

const reasonMatchesQuery = (
	reason: ResumeSearchReason,
	normalizedQuery: string,
	tokens: string[]
) => {
	const text = normalizeSearchText(`${reason.label} ${reason.text} ${reason.resumeTitle ?? ''}`);
	if (!text) return false;
	if (normalizedQuery && text.includes(normalizedQuery)) return true;
	return tokens.some((token) => text.includes(token));
};

const selectReasonsForQuery = (
	reasons: ResumeSearchReason[],
	query: string,
	fallbackLabel: string
) => {
	const normalizedQuery = normalizeSearchText(query);
	const tokens = tokenizeNormalizedText(normalizedQuery);
	const selected = reasons
		.filter((reason) => reasonMatchesQuery(reason, normalizedQuery, tokens))
		.slice(0, 3);
	if (selected.length > 0) return selected;

	return [
		{
			label: 'Profile',
			text: fallbackLabel,
			resumeId: null,
			resumeTitle: null
		}
	];
};

export const refreshResumeSearchDocumentForTalent = async (
	adminClient: SupabaseClient,
	talentId: string
) => {
	const normalizedTalentId = normalizeId(talentId);
	if (!normalizedTalentId) return;

	const { data: talentRow, error: talentError } = await adminClient
		.from('talents')
		.select('id, first_name, last_name, title, bio, avatar_url, tech_stack')
		.eq('id', normalizedTalentId)
		.maybeSingle();

	if (talentError) throw new Error(talentError.message);
	if (!talentRow?.id) {
		const { error: deleteError } = await adminClient
			.from('resume_search_documents')
			.delete()
			.eq('talent_id', normalizedTalentId);
		if (deleteError) throw new Error(deleteError.message);
		return;
	}

	const talent = talentRow as TalentRow;
	const [organisationRowsResult, resumesResult] = await Promise.all([
		adminClient
			.from('organisation_talents')
			.select('organisation_id')
			.eq('talent_id', normalizedTalentId),
		adminClient
			.from('resumes')
			.select('id, talent_id, version_name, is_main')
			.eq('talent_id', normalizedTalentId)
	]);

	if (organisationRowsResult.error) throw new Error(organisationRowsResult.error.message);
	if (resumesResult.error) throw new Error(resumesResult.error.message);

	const organisationIds = Array.from(
		new Set(
			(organisationRowsResult.data ?? [])
				.map((row) => normalizeId((row as { organisation_id: unknown }).organisation_id))
				.filter((value): value is string => value !== null)
		)
	);
	const resumeRows = ((resumesResult.data ?? []) as ResumeRow[])
		.map((row) => ({
			id: normalizeId(row.id),
			versionName: getSafeText(row.version_name),
			isMain: Boolean(row.is_main)
		}))
		.filter((row): row is { id: string; versionName: string; isMain: boolean } => Boolean(row.id));
	const resumeIds = resumeRows.map((row) => row.id);

	const [basicsResult, skillsResult, labeledResult, experienceItemsResult] =
		resumeIds.length === 0
			? [
					{ data: [] as ResumeBasicsRow[], error: null },
					{ data: [] as Array<{ resume_id: string; value: string }>, error: null },
					{
						data: [] as Array<{
							resume_id: string;
							label_sv: string | null;
							label_en: string | null;
							value_sv: string | null;
							value_en: string | null;
						}>,
						error: null
					},
					{ data: [] as ResumeExperienceRow[], error: null }
				]
			: await Promise.all([
					adminClient
						.from('resume_basics')
						.select(
							'resume_id, name, title_sv, title_en, summary_sv, summary_en, tech_stack, footer_note_sv, footer_note_en'
						)
						.in('resume_id', resumeIds),
					adminClient
						.from('resume_skill_items')
						.select('resume_id, value')
						.in('resume_id', resumeIds),
					adminClient
						.from('resume_labeled_items')
						.select('resume_id, label_sv, label_en, value_sv, value_en')
						.in('resume_id', resumeIds),
					adminClient
						.from('resume_experience_items')
						.select(
							'id, resume_id, experience_id, company_override, location_sv_override, location_en_override, role_sv_override, role_en_override, description_sv_override, description_en_override, use_tech_override'
						)
						.in('resume_id', resumeIds)
				]);

	if (basicsResult.error) throw new Error(basicsResult.error.message);
	if (skillsResult.error) throw new Error(skillsResult.error.message);
	if (labeledResult.error) throw new Error(labeledResult.error.message);
	if (experienceItemsResult.error) throw new Error(experienceItemsResult.error.message);

	const basicsByResumeId = new Map<string, ResumeBasicsRow>();
	for (const row of (basicsResult.data ?? []) as ResumeBasicsRow[]) {
		const resumeId = normalizeId(row.resume_id);
		if (!resumeId) continue;
		basicsByResumeId.set(resumeId, row);
	}

	const experienceRows = (experienceItemsResult.data ?? []) as ResumeExperienceRow[];
	const experienceIds = Array.from(
		new Set(
			experienceRows
				.map((row) => normalizeId(row.experience_id))
				.filter((value): value is string => value !== null)
		)
	);
	const experienceItemIds = Array.from(
		new Set(
			experienceRows
				.map((row) => normalizeId(row.id))
				.filter((value): value is string => value !== null)
		)
	);

	const [libraryResult, libraryTechResult, overrideTechResult] = await Promise.all([
		experienceIds.length === 0
			? { data: [] as ExperienceLibraryRow[], error: null }
			: adminClient
					.from('experience_library')
					.select(
						'id, company, location_sv, location_en, role_sv, role_en, description_sv, description_en'
					)
					.in('id', experienceIds),
		experienceIds.length === 0
			? { data: [] as Array<{ experience_id: string; value: string }>, error: null }
			: adminClient
					.from('experience_library_technologies')
					.select('experience_id, value')
					.in('experience_id', experienceIds),
		experienceItemIds.length === 0
			? { data: [] as Array<{ resume_experience_item_id: string; value: string }>, error: null }
			: adminClient
					.from('resume_experience_tech_overrides')
					.select('resume_experience_item_id, value')
					.in('resume_experience_item_id', experienceItemIds)
	]);

	if (libraryResult.error) throw new Error(libraryResult.error.message);
	if (libraryTechResult.error) throw new Error(libraryTechResult.error.message);
	if (overrideTechResult.error) throw new Error(overrideTechResult.error.message);

	const libraryById = new Map<string, ExperienceLibraryRow>();
	for (const row of (libraryResult.data ?? []) as ExperienceLibraryRow[]) {
		const id = normalizeId(row.id);
		if (id) libraryById.set(id, row);
	}

	const libraryTechsByExperienceId = new Map<string, string[]>();
	for (const row of libraryTechResult.data ?? []) {
		const experienceId = normalizeId((row as { experience_id: unknown }).experience_id);
		const value = getSafeText((row as { value: unknown }).value);
		if (!experienceId || !value) continue;
		const values = libraryTechsByExperienceId.get(experienceId) ?? [];
		values.push(value);
		libraryTechsByExperienceId.set(experienceId, values);
	}

	const overrideTechsByItemId = new Map<string, string[]>();
	for (const row of overrideTechResult.data ?? []) {
		const itemId = normalizeId(
			(row as { resume_experience_item_id: unknown }).resume_experience_item_id
		);
		const value = getSafeText((row as { value: unknown }).value);
		if (!itemId || !value) continue;
		const values = overrideTechsByItemId.get(itemId) ?? [];
		values.push(value);
		overrideTechsByItemId.set(itemId, values);
	}

	const reasons: ResumeSearchReason[] = [];
	const searchParts: string[] = [];
	const displayName =
		[talent.first_name, talent.last_name].map(getSafeText).filter(Boolean).join(' ') ||
		'Unnamed talent';
	const profileTitle = getSafeText(talent.title);
	const profileBio = getSafeText(talent.bio);
	const profileTechs = extractTechStackValues(talent.tech_stack);

	addReason(reasons, { label: 'Name', text: displayName });
	addReason(reasons, { label: 'Profile title', text: profileTitle });
	addReason(reasons, { label: 'Profile bio', text: profileBio });
	addReason(reasons, { label: 'Profile tech stack', text: profileTechs.join(', ') });
	searchParts.push(displayName, profileTitle, profileBio, ...profileTechs);

	for (const resume of resumeRows) {
		const basics = basicsByResumeId.get(resume.id);
		const resumeTitle = getDisplayResumeTitle({
			basics,
			versionName: resume.versionName,
			isMain: resume.isMain
		});
		const resumeTextParts = [
			resume.versionName,
			basics?.name,
			basics?.title_sv,
			basics?.title_en,
			basics?.summary_sv,
			basics?.summary_en,
			basics?.footer_note_sv,
			basics?.footer_note_en,
			...extractTechStackValues(basics?.tech_stack)
		].map(getSafeText);

		addReason(reasons, {
			label: 'Resume',
			text: resumeTextParts.join(' '),
			resumeId: resume.id,
			resumeTitle
		});
		searchParts.push(...resumeTextParts);
	}

	for (const row of skillsResult.data ?? []) {
		const resumeId = normalizeId((row as { resume_id: unknown }).resume_id);
		const basics = resumeId ? basicsByResumeId.get(resumeId) : undefined;
		const value = getSafeText((row as { value: unknown }).value);
		addReason(reasons, {
			label: 'Skills',
			text: value,
			resumeId,
			resumeTitle:
				resumeId && basics
					? getDisplayResumeTitle({ basics, versionName: null, isMain: false })
					: null
		});
		searchParts.push(value);
	}

	for (const row of labeledResult.data ?? []) {
		const record = row as {
			resume_id?: unknown;
			label_sv?: unknown;
			label_en?: unknown;
			value_sv?: unknown;
			value_en?: unknown;
		};
		const resumeId = normalizeId(record.resume_id);
		const value = [record.label_sv, record.label_en, record.value_sv, record.value_en]
			.map(getSafeText)
			.filter(Boolean)
			.join(' ');
		addReason(reasons, {
			label: 'Resume details',
			text: value,
			resumeId,
			resumeTitle: null
		});
		searchParts.push(value);
	}

	for (const row of experienceRows) {
		const base = row.experience_id ? libraryById.get(row.experience_id) : null;
		const resumeId = normalizeId(row.resume_id);
		const basics = resumeId ? basicsByResumeId.get(resumeId) : undefined;
		const techs =
			row.use_tech_override || !row.experience_id
				? (overrideTechsByItemId.get(row.id) ?? [])
				: (libraryTechsByExperienceId.get(row.experience_id) ?? []);
		const value = [
			row.company_override ?? base?.company,
			row.location_sv_override ?? base?.location_sv,
			row.location_en_override ?? base?.location_en,
			row.role_sv_override ?? base?.role_sv,
			row.role_en_override ?? base?.role_en,
			row.description_sv_override ?? base?.description_sv,
			row.description_en_override ?? base?.description_en,
			...techs
		]
			.map(getSafeText)
			.filter(Boolean)
			.join(' ');
		addReason(reasons, {
			label: 'Experience',
			text: value,
			resumeId,
			resumeTitle:
				resumeId && basics
					? getDisplayResumeTitle({ basics, versionName: null, isMain: false })
					: null
		});
		searchParts.push(value);
	}

	const searchText = uniqueValues(searchParts).join('\n');
	const fieldSnippets = reasons.slice(0, MAX_FIELD_SNIPPETS);
	const now = new Date().toISOString();
	const { error } = await adminClient.from('resume_search_documents').upsert(
		{
			talent_id: normalizedTalentId,
			display_name: displayName,
			profile_title: profileTitle || null,
			avatar_url: talent.avatar_url ?? null,
			organisation_ids: organisationIds,
			search_text: searchText,
			search_text_normalized: normalizeSearchText(searchText),
			field_snippets: fieldSnippets,
			updated_at: now
		},
		{ onConflict: 'talent_id' }
	);
	if (error) throw new Error(error.message);
};

export const refreshResumeSearchDocumentForTalentQuietly = async (
	adminClient: SupabaseClient,
	talentId: string
) => {
	try {
		await refreshResumeSearchDocumentForTalent(adminClient, talentId);
	} catch (error) {
		console.warn('[resume-search-documents] failed to refresh document', {
			talentId,
			error
		});
	}
};

export const deleteResumeSearchDocumentForTalentQuietly = async (
	adminClient: SupabaseClient,
	talentId: string
) => {
	try {
		const { error } = await adminClient
			.from('resume_search_documents')
			.delete()
			.eq('talent_id', talentId);
		if (error) throw new Error(error.message);
	} catch (error) {
		console.warn('[resume-search-documents] failed to delete document', { talentId, error });
	}
};

export const searchResumeDocuments = async (payload: {
	adminClient: SupabaseClient;
	query: string;
	scope: ResumeSearchScope;
	accessibleTalentIds: string[] | null;
	limit?: number;
	offset?: number;
}): Promise<ResumeSimpleSearchResponse> => {
	const query = payload.query.trim();
	if (!query) {
		return {
			query: '',
			scope: payload.scope,
			items: [],
			hasMore: false,
			generatedAt: new Date().toISOString()
		};
	}

	if (query.length > MAX_SIMPLE_SEARCH_QUERY_LENGTH) {
		throw new Error(`Query is too long. Max ${MAX_SIMPLE_SEARCH_QUERY_LENGTH} characters.`);
	}

	const limit = Math.min(
		Math.max(
			Number.isInteger(payload.limit) ? Number(payload.limit) : DEFAULT_SIMPLE_SEARCH_LIMIT,
			1
		),
		MAX_SIMPLE_SEARCH_LIMIT
	);
	const offset = Math.max(Number.isInteger(payload.offset) ? Number(payload.offset) : 0, 0);
	const requestLimit = limit + 1;

	const { data, error } = await payload.adminClient.rpc('search_resume_documents', {
		p_query: query,
		p_org_ids: payload.scope.orgIds,
		p_talent_ids: payload.accessibleTalentIds,
		p_limit: requestLimit,
		p_offset: offset
	});

	if (error) throw new Error(error.message);

	const rows = ((data ?? []) as SearchDocumentRpcRow[]).slice(0, requestLimit);
	const hasMore = rows.length > limit;
	const matchedTerms = getResumeSimpleSearchDisplayTerms(query);

	const items: ResumeSimpleSearchItem[] = rows.slice(0, limit).map((row) => {
		const talentId = normalizeId(row.talent_id) ?? '';
		const displayName = getSafeText(row.display_name) || 'Unnamed talent';
		const reasons = selectReasonsForQuery(
			sanitizeReasonArray(row.field_snippets),
			query,
			displayName
		);
		return {
			talentId,
			score: typeof row.score === 'number' && Number.isFinite(row.score) ? row.score : 0,
			matchPercent: 100,
			matchedTerms,
			reasons
		};
	});

	return {
		query,
		scope: payload.scope,
		items,
		hasMore,
		generatedAt: new Date().toISOString()
	};
};
