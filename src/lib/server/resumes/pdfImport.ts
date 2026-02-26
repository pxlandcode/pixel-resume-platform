import type {
	ExperienceItem,
	HighlightedExperience,
	LabeledItem,
	ResumeData
} from '../../types/resume';
import { getPdfImportModel, openai } from '../openai';
import { RESUME_AI_STYLE_GUIDE } from './resumeAiStyle';

type ResumeImportUsage = {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
};

export type ImportResumeFromPdfInput = {
	pdfBytes: Uint8Array;
	filename: string;
	personName: string;
};

export type ImportResumeFromPdfResult = {
	versionNameEn: string;
	content: ResumeData;
	usage?: ResumeImportUsage;
};

export class ResumePdfImportError extends Error {
	status: number;
	code?: string;

	constructor(status: number, message: string, code?: string) {
		super(message);
		this.name = 'ResumePdfImportError';
		this.status = status;
		this.code = code;
	}
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_MODEL_OUTPUT_TOKENS = 12_000;

const PDF_IMPORT_SYSTEM_PROMPT = `You extract and normalize consultant resumes from PDF files.

Primary objective:
- Build a faithful, complete resume draft from the PDF.
- Preserve facts over style.
- Do not omit roles/experiences that are present in the PDF.

Hard rules:
- Return ONLY valid JSON that matches the provided schema exactly.
- Never invent facts, dates, companies, titles, locations, or technologies.
- If a value is unknown, use an empty string, empty array, or null only where schema allows null.
- Preserve company names, product names, and technology names exactly (do not translate brand names).
- Keep role and experience granularity: each distinct role/time period should be its own experience item.
- Include all professional experiences you can identify (highlighted + previous).
- Do not place most experiences only in highlightedExperiences.
- Every highlighted experience should also exist as a corresponding item in experiences.
- contacts must always be an empty array.

Language rules:
- Populate BOTH sv and en fields.
- If source is Swedish, keep sv faithful to source wording and translate to en.
- If source is English, keep en faithful to source wording and translate to sv.
- Translation must be faithful and professional, not rewritten into marketing language.

Date rules:
- Prefer YYYY-MM-DD when identifiable.
- If only month+year are known, use day 01.
- If only year is known, use month 01 and day 01.
- If truly unknown, use empty string.
- Use null endDate only for current/present roles.

Style rules for summary and description fields:
${RESUME_AI_STYLE_GUIDE}

Style constraints:
- Apply this style guide only to summary and description text.
- Keep factual meaning, scope, responsibilities, and technology facts intact.
- Do not invent outcomes, metrics, or achievements.
- Use paragraph breaks in longer texts to improve readability (avoid one large text block).
- Always write in third person (never first person).
- If the consultant is mentioned, use the provided profile first name for initial mention.
- Then vary naturally with pronouns or "the consultant" so the first name is not repeated in every sentence.`;

const PDF_IMPORT_USER_PROMPT = (
	personName: string,
	personFirstName: string
) => `Create a complete ResumeData draft for ${personName}.

Output quality requirements:
- Capture the full work history visible in the PDF, not only selected highlights.
- Choose up to 2 highlighted experiences for strongest relevance.
- Put all remaining identified roles in experiences.
- Make sure the highlighted roles are also represented in experiences.
- Keep descriptions factual and close to source meaning.
- Keep technologies as concrete tool/platform names.
- title must be a professional resume headline (role-focused), never a person's name.
- Always write summary and description in third person.
- Use this profile first name for consultant references when needed: ${personFirstName}.
- Do not use other personal names from the PDF as the consultant identity.
- Do not repeat the first name in every sentence; alternate naturally with pronouns or "the consultant".
- versionNameEn should be a short English title for this imported resume.

Coverage checklist before finalizing JSON:
1. Did you include all identifiable experience entries from the PDF?
2. Did you keep company/role/date/location details intact where present?
3. Did you fill both sv and en for localized fields?
4. Did you avoid inventing missing information?`;

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
const stripTags = (value: string) => value.replace(/<[^>]*>/g, ' ');
const toWordKey = (value: string) =>
	normalize(value)
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s-]+/gu, '')
		.trim();

const escapeHtml = (value: string) =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');

const splitIntoParagraphs = (line: string): string[] => {
	const compact = normalize(line);
	if (!compact) return [];
	if (compact.length <= 220) return [compact];

	const sentences =
		compact.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)?.map((part) => normalize(part)) ?? [];
	if (sentences.length <= 1) {
		return [compact];
	}

	const paragraphs: string[] = [];
	let current = '';

	for (const sentence of sentences) {
		if (!sentence) continue;
		const candidate = current ? `${current} ${sentence}` : sentence;
		if (candidate.length <= 260) {
			current = candidate;
			continue;
		}

		if (current) {
			paragraphs.push(current);
		}
		current = sentence;
	}

	if (current) {
		paragraphs.push(current);
	}

	return paragraphs.length > 0 ? paragraphs : [compact];
};

const toQuillHtml = (rawText: string): string => {
	const cleaned = stripTags(rawText)
		.split(/\r?\n/)
		.map((line) => normalize(line))
		.filter(Boolean);

	if (cleaned.length === 0) {
		return '';
	}

	const blocks: string[] = [];
	for (let i = 0; i < cleaned.length; i += 1) {
		const line = cleaned[i]!;
		if (/^[-*•]\s+/.test(line)) {
			const items: string[] = [];
			let j = i;
			while (j < cleaned.length && /^[-*•]\s+/.test(cleaned[j]!)) {
				const item = cleaned[j]!.replace(/^[-*•]\s+/, '');
				if (item) {
					items.push(`<li>${escapeHtml(item)}</li>`);
				}
				j += 1;
			}
			if (items.length > 0) {
				blocks.push(`<ul>${items.join('')}</ul>`);
			}
			i = j - 1;
			continue;
		}

		const paragraphs = splitIntoParagraphs(line);
		for (const paragraph of paragraphs) {
			blocks.push(`<p>${escapeHtml(paragraph)}</p>`);
		}
	}

	return blocks.join('<p><br></p>');
};

const localizedSchema = {
	type: 'object',
	additionalProperties: false,
	required: ['sv', 'en'],
	properties: {
		sv: { type: 'string' },
		en: { type: 'string' }
	}
} as const;

const labeledItemSchema = {
	type: 'object',
	additionalProperties: false,
	required: ['label', 'value'],
	properties: {
		label: localizedSchema,
		value: localizedSchema
	}
} as const;

const resumeImportSchema = {
	type: 'object',
	additionalProperties: false,
	required: [
		'versionNameEn',
		'title',
		'summary',
		'contacts',
		'exampleSkills',
		'highlightedExperiences',
		'experiences',
		'techniques',
		'methods',
		'languages',
		'education',
		'portfolio',
		'footerNote'
	],
	properties: {
		versionNameEn: { type: 'string' },
		title: localizedSchema,
		summary: localizedSchema,
		contacts: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['name', 'phone', 'email'],
				properties: {
					name: { type: 'string' },
					phone: { type: 'string' },
					email: { type: 'string' }
				}
			}
		},
		exampleSkills: {
			type: 'array',
			items: { type: 'string' }
		},
		highlightedExperiences: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['company', 'role', 'description', 'technologies'],
				properties: {
					company: { type: 'string' },
					role: localizedSchema,
					description: localizedSchema,
					technologies: {
						type: 'array',
						items: { type: 'string' }
					}
				}
			}
		},
		experiences: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: [
					'startDate',
					'endDate',
					'company',
					'location',
					'role',
					'description',
					'technologies'
				],
				properties: {
					startDate: { type: 'string' },
					endDate: {
						anyOf: [{ type: 'string' }, { type: 'null' }]
					},
					company: { type: 'string' },
					location: localizedSchema,
					role: localizedSchema,
					description: localizedSchema,
					technologies: {
						type: 'array',
						items: { type: 'string' }
					}
				}
			}
		},
		techniques: {
			type: 'array',
			items: { type: 'string' }
		},
		methods: {
			type: 'array',
			items: { type: 'string' }
		},
		languages: {
			type: 'array',
			items: labeledItemSchema
		},
		education: {
			type: 'array',
			items: labeledItemSchema
		},
		portfolio: {
			type: 'array',
			items: { type: 'string' }
		},
		footerNote: localizedSchema
	}
} as const;

const asString = (value: unknown) => (typeof value === 'string' ? value : '');

const asRecord = (value: unknown): Record<string, unknown> =>
	value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const sanitizeText = (value: unknown, maxLength: number) =>
	normalize(asString(value)).slice(0, maxLength);

const sanitizeOptionalText = (value: unknown, maxLength: number) => {
	const cleaned = sanitizeText(value, maxLength);
	return cleaned || '';
};

const sanitizeLocalized = (value: unknown, maxLength: number): { sv: string; en: string } => {
	if (typeof value === 'string') {
		const cleaned = sanitizeText(value, maxLength);
		return { sv: cleaned, en: cleaned };
	}

	const record = asRecord(value);
	const svRaw = sanitizeText(record.sv, maxLength);
	const enRaw = sanitizeText(record.en, maxLength);
	const fallback = svRaw || enRaw;

	return {
		sv: svRaw || fallback,
		en: enRaw || fallback
	};
};

const sanitizeStringArray = (value: unknown, maxItems: number, maxLength: number): string[] => {
	if (!Array.isArray(value)) return [];

	const deduped = new Map<string, string>();
	for (const entry of value) {
		const cleaned = sanitizeText(entry, maxLength);
		if (!cleaned) continue;
		const key = cleaned.toLowerCase();
		if (!deduped.has(key)) {
			deduped.set(key, cleaned);
		}
		if (deduped.size >= maxItems) break;
	}

	return Array.from(deduped.values());
};

const getFirstName = (personName: string): string => {
	const parts = normalize(personName).split(' ').filter(Boolean);
	return parts[0] || 'Consultant';
};

const isIsoDate = (value: string): boolean => {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(value);
	return !Number.isNaN(date.getTime());
};

const toIsoDate = (value: unknown): string => {
	const raw = sanitizeText(value, 40);
	if (!raw) return '';
	if (isIsoDate(raw)) return raw;

	const parsed = Date.parse(raw);
	if (Number.isNaN(parsed)) return '';
	return new Date(parsed).toISOString().slice(0, 10);
};

const toEndDate = (value: unknown): string | null => {
	if (value === null) return null;
	const raw = sanitizeText(value, 40);
	if (!raw) return '';

	const lowered = raw.toLowerCase();
	if (['present', 'current', 'ongoing', 'nuvarande', 'pågående'].includes(lowered)) {
		return null;
	}

	const iso = toIsoDate(raw);
	return iso || '';
};

const sanitizeContacts = (): ResumeData['contacts'] => [];

const sanitizeHighlightedExperiences = (value: unknown): HighlightedExperience[] => {
	if (!Array.isArray(value)) return [];

	const list: HighlightedExperience[] = [];
	for (const entry of value) {
		const record = asRecord(entry);
		const company = sanitizeOptionalText(record.company, 140);
		const role = sanitizeLocalized(record.role, 180);
		const descriptionRaw = sanitizeLocalized(record.description, 8_000);
		const technologies = sanitizeStringArray(record.technologies, 24, 80);

		const descriptionSv = descriptionRaw.sv ? toQuillHtml(descriptionRaw.sv) : '';
		const descriptionEn = descriptionRaw.en ? toQuillHtml(descriptionRaw.en) : '';

		if (!company && !role.sv && !role.en && !descriptionSv && !descriptionEn) continue;

		list.push({
			company,
			role,
			description: {
				sv: descriptionSv,
				en: descriptionEn
			},
			technologies
		});
		if (list.length >= 40) break;
	}

	return list;
};

const sanitizeExperienceItems = (value: unknown): ExperienceItem[] => {
	if (!Array.isArray(value)) return [];

	const list: ExperienceItem[] = [];
	for (const entry of value) {
		const record = asRecord(entry);
		const startDate = toIsoDate(record.startDate);
		const endDate = toEndDate(record.endDate);
		const company = sanitizeOptionalText(record.company, 140);
		const location = sanitizeLocalized(record.location, 140);
		const role = sanitizeLocalized(record.role, 180);
		const descriptionRaw = sanitizeLocalized(record.description, 8_000);
		const technologies = sanitizeStringArray(record.technologies, 24, 80);

		const descriptionSv = descriptionRaw.sv ? toQuillHtml(descriptionRaw.sv) : '';
		const descriptionEn = descriptionRaw.en ? toQuillHtml(descriptionRaw.en) : '';

		if (!company && !role.sv && !role.en && !descriptionSv && !descriptionEn) continue;

		list.push({
			startDate,
			endDate,
			company,
			location,
			role,
			description: {
				sv: descriptionSv,
				en: descriptionEn
			},
			technologies
		});
		if (list.length >= 60) break;
	}

	const scoreDate = (value: string | null | undefined) => {
		if (!value) return 0;
		const parsed = Date.parse(value);
		return Number.isNaN(parsed) ? 0 : parsed;
	};

	list.sort((a, b) => {
		const endA = a.endDate === null ? Date.now() : scoreDate(a.endDate);
		const endB = b.endDate === null ? Date.now() : scoreDate(b.endDate);
		if (endA !== endB) return endB - endA;
		const startA = scoreDate(a.startDate);
		const startB = scoreDate(b.startDate);
		return startB - startA;
	});

	return list;
};

const sanitizeLabeledItems = (value: unknown): LabeledItem[] => {
	if (!Array.isArray(value)) return [];

	const list: LabeledItem[] = [];
	for (const entry of value) {
		const record = asRecord(entry);
		const label = sanitizeLocalized(record.label, 140);
		const itemValue = sanitizeLocalized(record.value, 220);
		if (!label.sv && !label.en && !itemValue.sv && !itemValue.en) continue;
		list.push({ label, value: itemValue });
		if (list.length >= 20) break;
	}

	return list;
};

const normalizeKeyPart = (value: string): string => normalize(stripTags(value)).toLowerCase();

const normalizeLocalizedKey = (value: { sv: string; en: string }): string =>
	`${normalizeKeyPart(value.sv)}|${normalizeKeyPart(value.en)}`;

const mapHighlightedToExperience = (entry: HighlightedExperience): ExperienceItem => ({
	startDate: '',
	endDate: '',
	company: entry.company,
	location: { sv: '', en: '' },
	role: entry.role,
	description: entry.description,
	technologies: entry.technologies
});

const mergeTechnologies = (left: string[], right: string[]): string[] => {
	const deduped = new Map<string, string>();
	for (const value of [...left, ...right]) {
		const cleaned = sanitizeText(value, 80);
		if (!cleaned) continue;
		const key = cleaned.toLowerCase();
		if (!deduped.has(key)) {
			deduped.set(key, cleaned);
		}
		if (deduped.size >= 24) break;
	}
	return Array.from(deduped.values());
};

const isSameExperience = (left: ExperienceItem, right: ExperienceItem): boolean => {
	const companyLeft = normalizeKeyPart(left.company);
	const companyRight = normalizeKeyPart(right.company);
	const roleLeft = normalizeLocalizedKey(left.role);
	const roleRight = normalizeLocalizedKey(right.role);
	const descriptionLeft = normalizeLocalizedKey(left.description);
	const descriptionRight = normalizeLocalizedKey(right.description);

	if (companyLeft && companyRight && roleLeft && roleRight && companyLeft === companyRight) {
		return roleLeft === roleRight;
	}

	if (
		companyLeft &&
		companyRight &&
		descriptionLeft &&
		descriptionRight &&
		companyLeft === companyRight
	) {
		return descriptionLeft === descriptionRight;
	}

	return false;
};

const mergeHighlightIntoExperience = (
	base: ExperienceItem,
	fromHighlight: ExperienceItem
): ExperienceItem => ({
	...base,
	description: {
		sv: base.description.sv || fromHighlight.description.sv,
		en: base.description.en || fromHighlight.description.en
	},
	technologies: mergeTechnologies(base.technologies, fromHighlight.technologies)
});

const ensureHighlightedIncludedInExperiences = (
	experiences: ExperienceItem[],
	highlightedExperiences: HighlightedExperience[]
): ExperienceItem[] => {
	const merged = [...experiences];

	for (const highlighted of highlightedExperiences) {
		const highlightedAsExperience = mapHighlightedToExperience(highlighted);
		const existingIndex = merged.findIndex((entry) =>
			isSameExperience(entry, highlightedAsExperience)
		);

		if (existingIndex === -1) {
			merged.push(highlightedAsExperience);
			continue;
		}

		merged[existingIndex] = mergeHighlightIntoExperience(
			merged[existingIndex]!,
			highlightedAsExperience
		);
	}

	return merged;
};

const DEFAULT_RESUME_TITLE = { sv: 'IT-konsult', en: 'IT Consultant' };

const isLikelyPersonName = (value: string, personName: string): boolean => {
	const candidateKey = toWordKey(value);
	const personKey = toWordKey(personName);
	if (!candidateKey || !personKey) return false;
	if (candidateKey === personKey) return true;

	const personParts = personKey.split(' ').filter(Boolean);
	if (personParts.length >= 2 && personParts.every((part) => candidateKey.includes(part))) {
		return true;
	}

	return false;
};

const isUsableTitleText = (value: string, personName: string): boolean => {
	const cleaned = sanitizeOptionalText(value, 180);
	if (!cleaned) return false;
	if (isLikelyPersonName(cleaned, personName)) return false;

	const wordCount = toWordKey(cleaned).split(' ').filter(Boolean).length;
	if (wordCount < 1 || wordCount > 8) return false;

	return true;
};

const normalizeTitleCandidate = (
	candidate: { sv: string; en: string },
	personName: string
): { sv: string; en: string } | null => {
	const sv = sanitizeOptionalText(candidate.sv, 180);
	const en = sanitizeOptionalText(candidate.en, 180);

	const hasValidSv = isUsableTitleText(sv, personName);
	const hasValidEn = isUsableTitleText(en, personName);
	if (!hasValidSv && !hasValidEn) return null;

	const normalizedSv = hasValidSv ? sv : hasValidEn ? en : DEFAULT_RESUME_TITLE.sv;
	const normalizedEn = hasValidEn ? en : hasValidSv ? sv : DEFAULT_RESUME_TITLE.en;
	return { sv: normalizedSv, en: normalizedEn };
};

const deriveTitleFromExperiences = (
	personName: string,
	highlightedExperiences: HighlightedExperience[],
	experiences: ExperienceItem[]
): { sv: string; en: string } => {
	const roleCandidates = [
		...highlightedExperiences.map((entry) => entry.role),
		...experiences.map((entry) => entry.role)
	];

	for (const role of roleCandidates) {
		const normalized = normalizeTitleCandidate(role, personName);
		if (normalized) {
			return normalized;
		}
	}

	return DEFAULT_RESUME_TITLE;
};

const extractJsonPayload = (raw: string): Record<string, unknown> => {
	const trimmed = raw.trim();
	if (!trimmed) return {};

	const parseAttempt = (value: string) => {
		try {
			return JSON.parse(value) as Record<string, unknown>;
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

const mapOpenAiImportError = (error: unknown): ResumePdfImportError => {
	if (!error || typeof error !== 'object') {
		return new ResumePdfImportError(502, 'Could not import resume from PDF right now.');
	}

	const record = error as Record<string, unknown>;
	const status = typeof record.status === 'number' ? record.status : 502;
	const code = typeof record.code === 'string' ? record.code : undefined;
	const message = typeof record.message === 'string' ? normalize(record.message) : '';

	if (status === 429 || code === 'insufficient_quota') {
		return new ResumePdfImportError(
			429,
			'OpenAI quota exceeded. Please check billing and usage limits.',
			code
		);
	}

	if (status === 401 || status === 403) {
		return new ResumePdfImportError(
			status,
			'OpenAI authentication failed. Check API key and project access.',
			code
		);
	}

	if (status === 404 && message.toLowerCase().includes('model')) {
		return new ResumePdfImportError(
			404,
			'Configured OpenAI model is unavailable. Update LLM_MODEL.',
			code
		);
	}

	return new ResumePdfImportError(
		status,
		message || 'Could not import resume from PDF right now.',
		code
	);
};

const sanitizeImportedPayload = (
	payload: Record<string, unknown>,
	personName: string
): { versionNameEn: string; content: ResumeData } => {
	const importedTitle = sanitizeLocalized(payload.title, 180);
	const summaryRaw = sanitizeLocalized(payload.summary, 8_000);
	const summary = {
		sv: summaryRaw.sv ? toQuillHtml(summaryRaw.sv) : '',
		en: summaryRaw.en ? toQuillHtml(summaryRaw.en) : ''
	};

	const highlightedExperiences = sanitizeHighlightedExperiences(payload.highlightedExperiences);
	const experiences = sanitizeExperienceItems(payload.experiences);

	const cappedHighlighted = highlightedExperiences.slice(0, 2);
	const mergedExperiences = ensureHighlightedIncludedInExperiences(
		experiences,
		highlightedExperiences
	);
	const normalizedTitle =
		normalizeTitleCandidate(importedTitle, personName) ??
		deriveTitleFromExperiences(personName, highlightedExperiences, mergedExperiences);

	let versionNameEn = sanitizeText(payload.versionNameEn, 100);
	if (!versionNameEn) {
		versionNameEn = `${personName || 'Consultant'} Resume`;
	}

	const content: ResumeData = {
		name: personName,
		title: normalizedTitle,
		summary,
		contacts: sanitizeContacts(),
		exampleSkills: sanitizeStringArray(payload.exampleSkills, 40, 80),
		highlightedExperiences: cappedHighlighted,
		experiences: mergedExperiences,
		techniques: sanitizeStringArray(payload.techniques, 80, 80),
		methods: sanitizeStringArray(payload.methods, 80, 80),
		languages: sanitizeLabeledItems(payload.languages),
		education: sanitizeLabeledItems(payload.education),
		portfolio: sanitizeStringArray(payload.portfolio, 20, 260),
		footerNote: sanitizeLocalized(payload.footerNote, 2_000)
	};

	const hasCriticalContent =
		normalize(stripTags(content.summary.sv)).length > 0 ||
		normalize(stripTags(content.summary.en)).length > 0 ||
		content.highlightedExperiences.length > 0 ||
		content.experiences.length > 0 ||
		normalize(normalizedTitle.sv).length > 0 ||
		normalize(normalizedTitle.en).length > 0;

	if (!hasCriticalContent) {
		throw new ResumePdfImportError(
			422,
			'Could not extract enough resume content from this PDF. Try another PDF or edit manually.'
		);
	}

	return { versionNameEn, content };
};

export const importResumeFromPdf = async (
	input: ImportResumeFromPdfInput
): Promise<ImportResumeFromPdfResult> => {
	if (!input.pdfBytes || input.pdfBytes.byteLength === 0) {
		throw new ResumePdfImportError(400, 'PDF file is empty.');
	}

	if (input.pdfBytes.byteLength > MAX_FILE_BYTES) {
		throw new ResumePdfImportError(400, 'PDF file is too large. Max size is 10MB.');
	}

	const filename = sanitizeOptionalText(input.filename, 160) || 'resume.pdf';
	const personName = sanitizeOptionalText(input.personName, 140) || 'Consultant';
	const personFirstName = getFirstName(personName);
	const model = getPdfImportModel();
	const fileDataBase64 = Buffer.from(input.pdfBytes).toString('base64');
	const fileData = `data:application/pdf;base64,${fileDataBase64}`;

	let response: Awaited<ReturnType<typeof openai.responses.create>>;
	try {
		response = await openai.responses.create({
			model,
			temperature: 0.1,
			max_output_tokens: MAX_MODEL_OUTPUT_TOKENS,
			text: {
				format: {
					type: 'json_schema',
					name: 'resume_pdf_import',
					strict: true,
					schema: resumeImportSchema
				}
			},
			input: [
				{
					role: 'system',
					content: PDF_IMPORT_SYSTEM_PROMPT
				},
				{
					role: 'user',
					content: [
						{
							type: 'input_text',
							text: PDF_IMPORT_USER_PROMPT(personName, personFirstName)
						},
						{
							type: 'input_file',
							file_data: fileData,
							filename
						}
					]
				}
			]
		});
	} catch (error) {
		throw mapOpenAiImportError(error);
	}

	const rawOutput = response.output_text ?? '';
	const payload = extractJsonPayload(rawOutput);
	if (Object.keys(payload).length === 0) {
		throw new ResumePdfImportError(
			502,
			'OpenAI returned an empty or invalid response while importing this PDF.'
		);
	}

	const { versionNameEn, content } = sanitizeImportedPayload(payload, personName);

	return {
		versionNameEn,
		content,
		usage: response.usage
			? {
					inputTokens: response.usage.input_tokens ?? 0,
					outputTokens: response.usage.output_tokens ?? 0,
					totalTokens: response.usage.total_tokens ?? 0
				}
			: undefined
	};
};
