import type { SupabaseClient } from '@supabase/supabase-js';
import type { ResumeSearchItem, ResumeSearchReason } from '$lib/types/resumes';
import {
	collapseWhitespace,
	normalizeSearchText,
	parseResumeSearchQueryFallback,
	stripTags,
	tokenizeNormalizedText,
	type ParsedResumeSearchQuery,
	type ResumeSearchQueryTerm
} from './searchQueryAnalysis';

export { MAX_RESUME_SEARCH_QUERY_LENGTH } from './searchQueryAnalysis';

const MAX_FIELD_WEIGHT = 10;
const MAX_MATCHED_TECHS = 5;
const MAX_REASONS = 3;
const MAX_SNIPPET_LENGTH = 160;
const MIN_VISIBLE_TERM_COVERAGE = 0.55;

const TECH_FIELD_KINDS = new Set<SearchFieldKind>([
	'profile-tech',
	'resume-skills',
	'experience-tech'
]);
const ROLE_FIELD_KINDS = new Set<SearchFieldKind>([
	'profile-title',
	'resume-title',
	'experience-role'
]);

type SearchFieldKind =
	| 'profile-title'
	| 'profile-bio'
	| 'profile-tech'
	| 'resume-title'
	| 'resume-summary'
	| 'resume-skills'
	| 'experience-company'
	| 'experience-role'
	| 'experience-description'
	| 'experience-tech';

type SearchField = {
	kind: SearchFieldKind;
	label: string;
	text: string;
	normalizedText: string;
	tokens: string[];
	tokenSet: Set<string>;
	weight: number;
	resumeId: string | null;
	resumeTitle: string | null;
};

type ResumeSearchResumeDocument = {
	resumeId: string;
	title: string;
	isMain: boolean;
	fields: SearchField[];
	techs: string[];
};

export type ResumeSearchConsultantDocument = {
	talentId: string;
	profileFields: SearchField[];
	resumes: ResumeSearchResumeDocument[];
	allTechs: string[];
};

type TalentRow = {
	id: string;
	tech_stack: unknown;
	title: string | null;
	bio: string | null;
};

type ResumeRow = {
	id: string;
	talent_id: string;
	version_name: string | null;
	is_main: boolean | null;
};

type ResumeBasicsRow = {
	resume_id: string;
	title_sv: string | null;
	title_en: string | null;
	summary_sv: string | null;
	summary_en: string | null;
};

type ResumeSkillRow = {
	resume_id: string;
	value: string;
};

type ResumeExperienceRow = {
	id: string;
	resume_id: string;
	experience_id: string | null;
	section: 'highlighted' | 'experience';
	company_override: string | null;
	role_sv_override: string | null;
	role_en_override: string | null;
	description_sv_override: string | null;
	description_en_override: string | null;
	use_tech_override: boolean;
};

type ExperienceLibraryRow = {
	id: string;
	company: string;
	role_sv: string;
	role_en: string;
	description_sv: string;
	description_en: string;
};

type FieldMatchResult = {
	score: number;
	coverageByToken: Map<string, number>;
	reason: ResumeSearchReason | null;
};

type ResumeMatchResult = {
	resumeId: string;
	resumeTitle: string;
	isMain: boolean;
	score: number;
	coverageByToken: Map<string, number>;
	reasons: ResumeSearchReason[];
};

const toPlainText = (value: unknown) =>
	typeof value === 'string' ? collapseWhitespace(stripTags(value)) : '';

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

	return uniqueValues(skills);
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

const getSafeText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const joinPlainSegments = (values: Array<string | null | undefined>) => {
	const parts = uniqueValues(values.map((value) => toPlainText(value)).filter(Boolean));
	return parts.join(' ');
};

const getDisplayResumeTitle = (payload: {
	basics: ResumeBasicsRow | undefined;
	versionName: string | null;
	isMain: boolean;
}) => {
	const fromBasicsEn = getSafeText(payload.basics?.title_en);
	if (fromBasicsEn) return fromBasicsEn;
	const fromBasicsSv = getSafeText(payload.basics?.title_sv);
	if (fromBasicsSv) return fromBasicsSv;
	const fromVersionName = getSafeText(payload.versionName);
	if (fromVersionName) return fromVersionName;
	return payload.isMain ? 'Main resume' : 'Resume';
};

const createField = (payload: {
	kind: SearchFieldKind;
	label: string;
	text: string;
	weight: number;
	resumeId?: string | null;
	resumeTitle?: string | null;
}) => {
	const plainText = toPlainText(payload.text);
	if (!plainText) return null;

	const normalizedText = normalizeSearchText(plainText);
	if (!normalizedText) return null;

	const tokens = tokenizeNormalizedText(normalizedText);
	if (tokens.length === 0) return null;

	return {
		kind: payload.kind,
		label: payload.label,
		text: plainText,
		normalizedText,
		tokens,
		tokenSet: new Set(tokens),
		weight: payload.weight,
		resumeId: payload.resumeId ?? null,
		resumeTitle: payload.resumeTitle ?? null
	} satisfies SearchField;
};

const mergeCoverage = (target: Map<string, number>, source: Map<string, number>) => {
	for (const [token, weight] of source.entries()) {
		target.set(token, Math.max(target.get(token) ?? 0, weight));
	}
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const clampText = (value: string, maxLength: number) => {
	const trimmed = value.trim();
	if (trimmed.length <= maxLength) return trimmed;
	return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
};

const termMatchesNormalizedText = (term: ResumeSearchQueryTerm, normalizedText: string) => {
	if (!normalizedText) return false;
	if (normalizedText.includes(term.normalized)) return true;
	if (term.tokens.every((token) => normalizedText.includes(token))) return true;
	return false;
};

const extractSnippet = (text: string, parsedQuery: ParsedResumeSearchQuery) => {
	const plainText = toPlainText(text);
	if (!plainText) return '';

	const sentenceCandidates = plainText
		.split(/(?<=[.!?])\s+|\n+/)
		.map((candidate) => candidate.trim())
		.filter(Boolean);

	for (const sentence of sentenceCandidates) {
		const normalizedSentence = normalizeSearchText(sentence);
		if (!normalizedSentence) continue;
		if (parsedQuery.terms.some((term) => termMatchesNormalizedText(term, normalizedSentence))) {
			return clampText(sentence, MAX_SNIPPET_LENGTH);
		}
	}

	return clampText(plainText, MAX_SNIPPET_LENGTH);
};

const getMatchedTechs = (techs: string[], parsedQuery: ParsedResumeSearchQuery) => {
	const technologyTerms = parsedQuery.terms.filter((term) => term.kind === 'technology');
	if (technologyTerms.length === 0) return [];

	return uniqueValues(
		techs.filter((tech) => {
			const normalizedTech = normalizeSearchText(tech);
			if (!normalizedTech) return false;
			return technologyTerms.some(
				(term) =>
					normalizedTech === term.normalized ||
					normalizedTech.includes(term.normalized) ||
					term.normalized.includes(normalizedTech)
			);
		})
	).slice(0, MAX_MATCHED_TECHS);
};

const getQueryTechTerms = (parsedQuery: ParsedResumeSearchQuery) =>
	parsedQuery.terms.filter((term) => term.kind === 'technology');

const evaluateQueryTermAgainstField = (field: SearchField, term: ResumeSearchQueryTerm) => {
	const matchedTokens = new Set<string>();
	let exactMatches = 0;
	let prefixMatches = 0;
	let partialMatches = 0;

	for (const token of term.tokens) {
		if (field.tokenSet.has(token)) {
			exactMatches += 1;
			matchedTokens.add(token);
			continue;
		}

		if (field.tokens.some((fieldToken) => fieldToken.startsWith(token))) {
			prefixMatches += 1;
			matchedTokens.add(token);
			continue;
		}

		if (field.normalizedText.includes(token)) {
			partialMatches += 1;
			matchedTokens.add(token);
		}
	}

	const fullPhraseMatch = field.normalizedText.includes(term.normalized);
	const coverageRatio =
		term.tokens.length > 0 ? Math.min(1, matchedTokens.size / term.tokens.length) : 0;
	if (matchedTokens.size === 0 && !fullPhraseMatch) {
		return { score: 0, coverage: 0 };
	}

	let coverage = 0;
	if (fullPhraseMatch) {
		coverage = 1;
	} else if (matchedTokens.size === term.tokens.length) {
		coverage = 0.84;
	} else if (coverageRatio >= 0.75) {
		coverage = 0.68;
	} else if (coverageRatio >= 0.5) {
		coverage = 0.5;
	} else {
		coverage = 0.34;
	}

	let score = 0;
	if (fullPhraseMatch) score += field.weight * 8;
	score += exactMatches * field.weight * 3.4;
	score += prefixMatches * field.weight * 2.2;
	score += partialMatches * field.weight * 1.4;
	if (TECH_FIELD_KINDS.has(field.kind) && term.kind === 'technology') {
		score += exactMatches * field.weight * 1.8;
	}
	if (ROLE_FIELD_KINDS.has(field.kind) && term.kind === 'role') {
		score += field.weight * (fullPhraseMatch ? 1.6 : 0.9);
	}
	if (matchedTokens.size === term.tokens.length && term.tokens.length > 1) {
		score += field.weight * 1.6;
	}

	return {
		score: score * term.importance,
		coverage
	};
};

const evaluateFieldMatch = (field: SearchField, parsedQuery: ParsedResumeSearchQuery) => {
	const coverageByToken = new Map<string, number>();
	let score = 0;

	for (const term of parsedQuery.terms) {
		const termMatch = evaluateQueryTermAgainstField(field, term);
		if (termMatch.score <= 0) continue;
		score += termMatch.score;
		coverageByToken.set(
			term.normalized,
			Math.max(coverageByToken.get(term.normalized) ?? 0, termMatch.coverage)
		);
	}

	if (score <= 0) {
		return {
			score: 0,
			coverageByToken,
			reason: null
		} satisfies FieldMatchResult;
	}

	return {
		score,
		coverageByToken,
		reason: {
			label: field.label,
			text: extractSnippet(field.text, parsedQuery),
			resumeId: field.resumeId,
			resumeTitle: field.resumeTitle
		}
	} satisfies FieldMatchResult;
};

const evaluateResumeMatch = (
	resume: ResumeSearchResumeDocument,
	parsedQuery: ParsedResumeSearchQuery
) => {
	const coverageByToken = new Map<string, number>();
	const reasons: Array<{ score: number; reason: ResumeSearchReason }> = [];
	let score = 0;

	for (const field of resume.fields) {
		const fieldMatch = evaluateFieldMatch(field, parsedQuery);
		if (fieldMatch.score <= 0) continue;
		score += fieldMatch.score;
		mergeCoverage(coverageByToken, fieldMatch.coverageByToken);
		if (fieldMatch.reason) {
			reasons.push({
				score: fieldMatch.score,
				reason: fieldMatch.reason
			});
		}
	}

	const seenReasons = new Set<string>();
	const topReasons = reasons
		.sort((left, right) => right.score - left.score)
		.map((entry) => entry.reason)
		.filter((reason) => {
			const key = `${reason.label}:${reason.resumeId ?? 'profile'}:${reason.text}`;
			if (seenReasons.has(key)) return false;
			seenReasons.add(key);
			return true;
		})
		.slice(0, MAX_REASONS);

	return {
		resumeId: resume.resumeId,
		resumeTitle: resume.title,
		isMain: resume.isMain,
		score,
		coverageByToken,
		reasons: topReasons
	} satisfies ResumeMatchResult;
};

const computeMatchPercent = (
	coverageByToken: Map<string, number>,
	parsedQuery: ParsedResumeSearchQuery
) => {
	if (parsedQuery.terms.length === 0) return 0;

	const matchedCount = parsedQuery.terms.filter(
		(term) => (coverageByToken.get(term.normalized) ?? 0) >= MIN_VISIBLE_TERM_COVERAGE
	).length;
	return clampPercent((matchedCount / parsedQuery.terms.length) * 100);
};

const compareResumeMatches = (left: ResumeMatchResult, right: ResumeMatchResult) => {
	if (right.score !== left.score) return right.score - left.score;
	if (right.isMain !== left.isMain) return Number(right.isMain) - Number(left.isMain);
	return left.resumeTitle.localeCompare(right.resumeTitle, undefined, { sensitivity: 'base' });
};

const compareSearchItems = (left: ResumeSearchItem, right: ResumeSearchItem) => {
	if (right.matchPercent !== left.matchPercent) return right.matchPercent - left.matchPercent;
	if (right.score !== left.score) return right.score - left.score;
	const leftResumeTitle = left.bestResumeTitle ?? '';
	const rightResumeTitle = right.bestResumeTitle ?? '';
	return leftResumeTitle.localeCompare(rightResumeTitle, undefined, { sensitivity: 'base' });
};

const buildProfileFields = (talent: TalentRow) => {
	const profileFields: SearchField[] = [];
	const profileTechs = extractTalentTechs(talent.tech_stack);

	const profileTitleField = createField({
		kind: 'profile-title',
		label: 'Profile title',
		text: getSafeText(talent.title),
		weight: 6
	});
	if (profileTitleField) profileFields.push(profileTitleField);

	const profileBioField = createField({
		kind: 'profile-bio',
		label: 'Profile bio',
		text: getSafeText(talent.bio),
		weight: 3
	});
	if (profileBioField) profileFields.push(profileBioField);

	const profileTechField = createField({
		kind: 'profile-tech',
		label: 'Profile tech stack',
		text: profileTechs.join(', '),
		weight: 10
	});
	if (profileTechField) profileFields.push(profileTechField);

	return { profileFields, profileTechs };
};

export const buildResumeSearchIndex = async (
	adminClient: SupabaseClient,
	talentIds: string[] | null
): Promise<ResumeSearchConsultantDocument[]> => {
	if (talentIds !== null && talentIds.length === 0) return [];

	const talentQuery = adminClient.from('talents').select('id, tech_stack, title, bio');
	const talentsResult =
		talentIds === null ? await talentQuery : await talentQuery.in('id', talentIds);
	if (talentsResult.error) throw new Error(talentsResult.error.message);

	const talentRows = (talentsResult.data ?? []) as TalentRow[];
	if (talentRows.length === 0) return [];

	const scopedTalentIds = talentRows.map((row) => row.id);
	const resumesResult = await adminClient
		.from('resumes')
		.select('id, talent_id, version_name, is_main')
		.in('talent_id', scopedTalentIds);
	if (resumesResult.error) throw new Error(resumesResult.error.message);

	const resumeRows = (resumesResult.data ?? [])
		.map((row) => ({
			id: normalizeId((row as { id: unknown }).id),
			talentId: normalizeId((row as { talent_id: unknown }).talent_id),
			versionName: getSafeText((row as { version_name: unknown }).version_name),
			isMain: Boolean((row as { is_main: unknown }).is_main)
		}))
		.filter((row): row is { id: string; talentId: string; versionName: string; isMain: boolean } =>
			Boolean(row.id && row.talentId)
		);

	const resumeIds = resumeRows.map((row) => row.id);
	const [basicsResult, resumeSkillsResult, resumeExperienceItemsResult] = await Promise.all([
		resumeIds.length === 0
			? {
					data: [] as ResumeBasicsRow[],
					error: null
				}
			: adminClient
					.from('resume_basics')
					.select('resume_id, title_sv, title_en, summary_sv, summary_en')
					.in('resume_id', resumeIds),
		resumeIds.length === 0
			? {
					data: [] as ResumeSkillRow[],
					error: null
				}
			: adminClient
					.from('resume_skill_items')
					.select('resume_id, value')
					.in('resume_id', resumeIds),
		resumeIds.length === 0
			? {
					data: [] as ResumeExperienceRow[],
					error: null
				}
			: adminClient
					.from('resume_experience_items')
					.select(
						'id, resume_id, experience_id, section, company_override, role_sv_override, role_en_override, description_sv_override, description_en_override, use_tech_override'
					)
					.in('resume_id', resumeIds)
	]);

	if (basicsResult.error) throw new Error(basicsResult.error.message);
	if (resumeSkillsResult.error) throw new Error(resumeSkillsResult.error.message);
	if (resumeExperienceItemsResult.error) throw new Error(resumeExperienceItemsResult.error.message);

	const resumeExperienceRows = (resumeExperienceItemsResult.data ?? []) as ResumeExperienceRow[];
	const experienceIds = Array.from(
		new Set(
			resumeExperienceRows
				.map((row) => normalizeId((row as { experience_id: unknown }).experience_id))
				.filter((value): value is string => value !== null)
		)
	);
	const resumeExperienceItemIds = Array.from(
		new Set(
			resumeExperienceRows
				.map((row) => normalizeId((row as { id: unknown }).id))
				.filter((value): value is string => value !== null)
		)
	);

	const [experienceLibraryResult, libraryTechsResult, overrideTechsResult] = await Promise.all([
		experienceIds.length === 0
			? {
					data: [] as ExperienceLibraryRow[],
					error: null
				}
			: adminClient
					.from('experience_library')
					.select('id, company, role_sv, role_en, description_sv, description_en')
					.in('id', experienceIds),
		experienceIds.length === 0
			? {
					data: [] as Array<{ experience_id: string; value: string }>,
					error: null
				}
			: adminClient
					.from('experience_library_technologies')
					.select('experience_id, value')
					.in('experience_id', experienceIds),
		resumeExperienceItemIds.length === 0
			? {
					data: [] as Array<{ resume_experience_item_id: string; value: string }>,
					error: null
				}
			: adminClient
					.from('resume_experience_tech_overrides')
					.select('resume_experience_item_id, value')
					.in('resume_experience_item_id', resumeExperienceItemIds)
	]);

	if (experienceLibraryResult.error) throw new Error(experienceLibraryResult.error.message);
	if (libraryTechsResult.error) throw new Error(libraryTechsResult.error.message);
	if (overrideTechsResult.error) throw new Error(overrideTechsResult.error.message);

	const basicsByResumeId = new Map<string, ResumeBasicsRow>();
	for (const row of basicsResult.data ?? []) {
		const resumeId = normalizeId((row as { resume_id: unknown }).resume_id);
		if (!resumeId) continue;
		basicsByResumeId.set(resumeId, row as ResumeBasicsRow);
	}

	const resumeSkillsByResumeId = new Map<string, string[]>();
	for (const row of resumeSkillsResult.data ?? []) {
		const resumeId = normalizeId((row as { resume_id: unknown }).resume_id);
		const value = getSafeText((row as { value: unknown }).value);
		if (!resumeId || !value) continue;
		const existing = resumeSkillsByResumeId.get(resumeId) ?? [];
		existing.push(value);
		resumeSkillsByResumeId.set(resumeId, existing);
	}

	const experienceLibraryById = new Map<string, ExperienceLibraryRow>();
	for (const row of experienceLibraryResult.data ?? []) {
		const experienceId = normalizeId((row as { id: unknown }).id);
		if (!experienceId) continue;
		experienceLibraryById.set(experienceId, row as ExperienceLibraryRow);
	}

	const libraryTechsByExperienceId = new Map<string, string[]>();
	for (const row of libraryTechsResult.data ?? []) {
		const experienceId = normalizeId((row as { experience_id: unknown }).experience_id);
		const value = getSafeText((row as { value: unknown }).value);
		if (!experienceId || !value) continue;
		const existing = libraryTechsByExperienceId.get(experienceId) ?? [];
		existing.push(value);
		libraryTechsByExperienceId.set(experienceId, existing);
	}

	const overrideTechsByItemId = new Map<string, string[]>();
	for (const row of overrideTechsResult.data ?? []) {
		const itemId = normalizeId(
			(row as { resume_experience_item_id: unknown }).resume_experience_item_id
		);
		const value = getSafeText((row as { value: unknown }).value);
		if (!itemId || !value) continue;
		const existing = overrideTechsByItemId.get(itemId) ?? [];
		existing.push(value);
		overrideTechsByItemId.set(itemId, existing);
	}

	const resumeDocumentsByTalentId = new Map<string, ResumeSearchResumeDocument[]>();
	for (const resumeRow of resumeRows) {
		const basics = basicsByResumeId.get(resumeRow.id);
		const resumeTitle = getDisplayResumeTitle({
			basics,
			versionName: resumeRow.versionName || null,
			isMain: resumeRow.isMain
		});
		const resumeFields: SearchField[] = [];
		const resumeSkills = uniqueValues(resumeSkillsByResumeId.get(resumeRow.id) ?? []);
		const resumeTechs = [...resumeSkills];

		const resumeTitleField = createField({
			kind: 'resume-title',
			label: 'Resume title',
			text: joinPlainSegments([
				basics?.title_en,
				basics?.title_sv,
				resumeRow.versionName,
				resumeTitle
			]),
			weight: 5,
			resumeId: resumeRow.id,
			resumeTitle
		});
		if (resumeTitleField) resumeFields.push(resumeTitleField);

		const resumeSummaryField = createField({
			kind: 'resume-summary',
			label: 'Resume summary',
			text: joinPlainSegments([basics?.summary_en, basics?.summary_sv]),
			weight: 6,
			resumeId: resumeRow.id,
			resumeTitle
		});
		if (resumeSummaryField) resumeFields.push(resumeSummaryField);

		const resumeSkillsField = createField({
			kind: 'resume-skills',
			label: 'Resume skills',
			text: resumeSkills.join(', '),
			weight: 9,
			resumeId: resumeRow.id,
			resumeTitle
		});
		if (resumeSkillsField) resumeFields.push(resumeSkillsField);

		for (const experienceItem of resumeExperienceRows.filter(
			(row) => row.resume_id === resumeRow.id
		)) {
			const experienceId = normalizeId(
				(experienceItem as { experience_id: unknown }).experience_id
			);
			const itemId = normalizeId((experienceItem as { id: unknown }).id);
			if (!itemId) continue;

			const library = experienceId ? experienceLibraryById.get(experienceId) : undefined;
			const experienceLabelPrefix =
				experienceItem.section === 'highlighted' ? 'Highlighted assignment' : 'Assignment';

			const company = getSafeText(experienceItem.company_override ?? library?.company ?? '');
			const roleText = joinPlainSegments([
				experienceItem.role_en_override ?? library?.role_en,
				experienceItem.role_sv_override ?? library?.role_sv
			]);
			const descriptionText = joinPlainSegments([
				experienceItem.description_en_override ?? library?.description_en,
				experienceItem.description_sv_override ?? library?.description_sv
			]);
			const experienceTechs = uniqueValues(
				experienceItem.use_tech_override || !experienceId
					? (overrideTechsByItemId.get(itemId) ?? [])
					: (libraryTechsByExperienceId.get(experienceId) ?? [])
			);

			const companyField = createField({
				kind: 'experience-company',
				label: `${experienceLabelPrefix} company`,
				text: company,
				weight: 6,
				resumeId: resumeRow.id,
				resumeTitle
			});
			if (companyField) resumeFields.push(companyField);

			const roleField = createField({
				kind: 'experience-role',
				label: `${experienceLabelPrefix} role`,
				text: roleText,
				weight: 7,
				resumeId: resumeRow.id,
				resumeTitle
			});
			if (roleField) resumeFields.push(roleField);

			const descriptionField = createField({
				kind: 'experience-description',
				label: `${experienceLabelPrefix} description`,
				text: descriptionText,
				weight: 3,
				resumeId: resumeRow.id,
				resumeTitle
			});
			if (descriptionField) resumeFields.push(descriptionField);

			const techField = createField({
				kind: 'experience-tech',
				label: `${experienceLabelPrefix} technologies`,
				text: experienceTechs.join(', '),
				weight: 10,
				resumeId: resumeRow.id,
				resumeTitle
			});
			if (techField) resumeFields.push(techField);

			resumeTechs.push(...experienceTechs);
		}

		const talentResumeDocuments = resumeDocumentsByTalentId.get(resumeRow.talentId) ?? [];
		talentResumeDocuments.push({
			resumeId: resumeRow.id,
			title: resumeTitle,
			isMain: resumeRow.isMain,
			fields: resumeFields,
			techs: uniqueValues(resumeTechs)
		});
		resumeDocumentsByTalentId.set(resumeRow.talentId, talentResumeDocuments);
	}

	return talentRows
		.map((talent) => {
			const { profileFields, profileTechs } = buildProfileFields(talent);
			const resumes = (resumeDocumentsByTalentId.get(talent.id) ?? []).sort((left, right) => {
				if (right.isMain !== left.isMain) return Number(right.isMain) - Number(left.isMain);
				return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
			});
			const allTechs = uniqueValues([
				...profileTechs,
				...resumes.flatMap((resume) => resume.techs)
			]);

			return {
				talentId: talent.id,
				profileFields,
				resumes,
				allTechs
			} satisfies ResumeSearchConsultantDocument;
		})
		.sort((left, right) => left.talentId.localeCompare(right.talentId));
};

export const searchResumeIndex = (
	documents: ResumeSearchConsultantDocument[],
	query: string | ParsedResumeSearchQuery
): ResumeSearchItem[] => {
	const parsedQuery = typeof query === 'string' ? parseResumeSearchQueryFallback(query) : query;
	if (!parsedQuery) return [];

	const items: ResumeSearchItem[] = [];

	for (const document of documents) {
		const profileCoverage = new Map<string, number>();
		const profileReasons: Array<{ score: number; reason: ResumeSearchReason }> = [];
		let profileScore = 0;

		for (const field of document.profileFields) {
			const fieldMatch = evaluateFieldMatch(field, parsedQuery);
			if (fieldMatch.score <= 0) continue;
			profileScore += fieldMatch.score;
			mergeCoverage(profileCoverage, fieldMatch.coverageByToken);
			if (fieldMatch.reason) {
				profileReasons.push({
					score: fieldMatch.score,
					reason: fieldMatch.reason
				});
			}
		}

		const profileTopReasons = profileReasons
			.sort((left, right) => right.score - left.score)
			.map((entry) => entry.reason)
			.slice(0, MAX_REASONS);

		const resumeMatches = document.resumes
			.map((resume) => evaluateResumeMatch(resume, parsedQuery))
			.filter((match) => match.score > 0)
			.sort(compareResumeMatches);

		const bestResumeMatch = resumeMatches[0] ?? null;
		const coverageByToken = new Map<string, number>();
		mergeCoverage(coverageByToken, profileCoverage);
		for (const resumeMatch of resumeMatches) {
			mergeCoverage(coverageByToken, resumeMatch.coverageByToken);
		}

		const multiResumeBonus = Math.min(Math.max(resumeMatches.length - 1, 0) * 8, 24);
		const score = profileScore + (bestResumeMatch?.score ?? 0) + multiResumeBonus;
		if (score <= 0) continue;

		const reasons = [...profileTopReasons, ...(bestResumeMatch?.reasons ?? [])]
			.filter((reason) => Boolean(reason.text))
			.filter((reason, index, all) => {
				const key = `${reason.label}:${reason.resumeId ?? 'profile'}:${reason.text}`;
				return (
					all.findIndex((candidate) => {
						const candidateKey = `${candidate.label}:${candidate.resumeId ?? 'profile'}:${candidate.text}`;
						return candidateKey === key;
					}) === index
				);
			})
			.slice(0, MAX_REASONS);
		const matchedTerms = parsedQuery.terms
			.filter((term) => (coverageByToken.get(term.normalized) ?? 0) >= MIN_VISIBLE_TERM_COVERAGE)
			.sort(
				(left, right) =>
					(coverageByToken.get(right.normalized) ?? 0) - (coverageByToken.get(left.normalized) ?? 0)
			)
			.map((term) => term.display);
		const missingTerms = parsedQuery.terms
			.filter((term) => (coverageByToken.get(term.normalized) ?? 0) < MIN_VISIBLE_TERM_COVERAGE)
			.map((term) => term.display);
		const queryTechTerms = getQueryTechTerms(parsedQuery);
		const matchedQueryTechs = queryTechTerms
			.filter((term) => (coverageByToken.get(term.normalized) ?? 0) >= MIN_VISIBLE_TERM_COVERAGE)
			.map((term) => term.display)
			.slice(0, MAX_MATCHED_TECHS);
		const missingQueryTechs = queryTechTerms
			.filter((term) => (coverageByToken.get(term.normalized) ?? 0) < MIN_VISIBLE_TERM_COVERAGE)
			.map((term) => term.display)
			.slice(0, MAX_MATCHED_TECHS);

		items.push({
			talentId: document.talentId,
			score,
			matchPercent: computeMatchPercent(coverageByToken, parsedQuery),
			matchedTerms,
			missingTerms,
			matchedQueryTechs,
			missingQueryTechs,
			matchedTechs: getMatchedTechs(document.allTechs, parsedQuery),
			reasons,
			bestResumeId: bestResumeMatch?.resumeId ?? null,
			bestResumeTitle: bestResumeMatch?.resumeTitle ?? null
		});
	}

	items.sort(compareSearchItems);

	return items;
};
