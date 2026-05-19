import type {
	ExperienceItem,
	HighlightedExperience,
	LabeledItem,
	LocalizedText,
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
const MAX_MODEL_OUTPUT_TOKENS = 24_000;
const MAX_EXTRACTED_PDF_TEXT_CHARS = 60_000;
const MIN_EXTRACTED_TEXT_ONLY_CHARS = 1_500;

const PDF_IMPORT_SYSTEM_PROMPT = `You extract and normalize consultant resumes from PDF files.

Primary objective:
- Build a faithful, complete resume draft from the PDF.
- Preserve facts over style.
- Do not omit roles/experiences that are present in the PDF.
- Preserve the substance and depth of assignment descriptions when the PDF already contains good text.
- Adapt to any resume layout. Use section headings, dates, repeated role/company patterns, and narrative blocks to infer structure, but do not assume a specific template.

Hard rules:
- Return ONLY valid JSON that matches the provided schema exactly.
- Never invent facts, dates, companies, titles, locations, or technologies.
- If a value is unknown, use an empty string, empty array, or null only where schema allows null.
- Preserve company names, product names, and technology names exactly (do not translate brand names).
- Preserve full websites, domains, and email addresses exactly. Never reduce a website like pixelcode.se or svenskasjo.se to only ".se".
- Keep role and experience granularity: each distinct role/time period should be its own experience item.
- Include all professional experiences you can identify (highlighted + previous).
- Do not place most experiences only in highlightedExperiences.
- Highlighted experiences often omit dates. Do not create undated duplicate previous-experience rows for highlights when the same company already exists in the previous experience section.
- Highlighted experiences should be focused summaries derived from one of the strongest experience entries, not full copies of the previous-experience text.
- Fill exampleSkills with a useful resume sidebar skill list when the PDF contains skills, technologies, tools, methods, platforms, or repeated technologies in assignments.
- contacts must always be an empty array.

Language rules:
- Populate BOTH sv and en fields.
- If source is Swedish, keep sv faithful to source wording and translate to en.
- If source is English, keep en faithful to source wording and translate to sv.
- Translation must be faithful and professional, not rewritten into marketing language.
- Both language versions must preserve the same concrete detail; translated descriptions must not become shorter summaries.

Date rules:
- Prefer YYYY-MM-DD when identifiable.
- If only month+year are known, use day 01.
- If only year is known, use month 01 and day 01.
- If truly unknown, use empty string.
- Use null endDate only for current/present roles.
- Never use present/current/ongoing for both startDate and endDate. If a highlighted item has no date range, do not turn it into a dated previous experience.

Style rules for summary and description fields:
${RESUME_AI_STYLE_GUIDE}

Style constraints:
- Apply this style guide only to summary and description text.
- Keep factual meaning, scope, responsibilities, and technology facts intact.
- Do not invent outcomes, metrics, or achievements.
- experiences.description is the full assignment body, not a teaser. Do not summarize rich previous-experience text into a short abstract. If a source assignment contains several sentences or paragraphs, experiences.description must keep comparable detail while rewriting into the target style and third person.
- When a previous-experience source has multiple paragraphs, keep a multi-paragraph description with the same main information groups. Omit only duplicated filler, first-person phrasing, or unsupported claims.
- If a source assignment has little or no description, write a shorter factual description from the available role, scope, company, dates, and technologies only. Do not pad with unsupported claims.
- Exception for highlightedExperiences: highlights are intentionally shorter and more honed in than previous experiences. Keep the best scope, role, technology, and impact points only.
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
- Build each highlighted experience from a real experience in the PDF, preferably one of the strongest/recent assignments.
- Highlighted descriptions should be concise and focused:
  - This shortening applies ONLY to highlightedExperiences, never to experiences.
  - If the corresponding previous experience is long, write a shorter highlighted version that selects the strongest 1-2 focused paragraphs from that assignment.
  - Usually use 3-6 sentences total.
  - Focus on role, scope, key technical direction, and concrete product/delivery value.
  - Do not copy the whole previous-experience description into highlightedExperiences.
- Put all remaining identified roles in experiences.
- For experiences, use the previous/full work history section as the source of truth for dates, locations, role rows, and long assignment descriptions.
- Use the extracted PDF text as the primary source for exact previous-experience descriptions and exact websites/domains. Use the PDF file itself only to resolve layout or extraction ambiguity.
- Do not use highlighted summaries as substitutes for previous experience descriptions. If the same company appears in previous experience, keep the detailed previous-experience text.
- Do not add highlighted-only testimonial/summary cards as extra previous experiences unless the PDF provides a real date range for that same role.
- Keep descriptions factual and close to source meaning.
- Previous experience detail contract:
  - This contract is generic and applies to any imported resume, regardless of template, language, domain, company, or consultant.
  - Rich previous-experience source text must stay rich. Preserve most concrete responsibilities, scope, architecture, collaboration, delivery, product/domain details, and technology details.
  - Rephrase into the target style, but keep the source density. Do not compress 10-20 source sentences into 2-3 sentences.
  - If the source has multiple paragraphs, experiences.description should usually have multiple paragraphs too, with each paragraph carrying the corresponding source ideas.
  - Long source assignments should become polished full descriptions, not compact summaries. A rich imported previous experience should normally read like a detailed assignment description after import.
  - If the source describes specific systems, workflows, components, integrations, stakeholders, user groups, or delivery responsibilities, keep those details.
  - Do not drop secondary but factual details such as architecture decisions, component libraries, content platforms, booking flows, administrative tooling, stakeholder collaboration, team ceremonies, or delivery ownership when they are present in the source.
  - For any previous-experience source block with substantial narrative detail, preserve comparable information density. The imported text can be cleaner and better structured, but it must not become a high-level abstract.
  - If the source has roughly 6+ sentences or 2+ paragraphs for an assignment, the generated experiences.description should normally be 2+ paragraphs and cover the same major factual points.
  - If the source has roughly 10+ sentences or 3+ paragraphs, the generated experiences.description should normally be a detailed multi-paragraph description, not a short summary.
  - Medium source text should keep the same core points and roughly similar density.
  - Sparse source text should remain shorter and factual, using only evidence from the PDF.
  - Never shorten experiences.description just to make the overall resume concise; shorten summary and highlightedExperiences first.
- Keep technologies as concrete tool/platform names.
- Keep websites/domains complete. If source text contains a domain split across lines, such as "pixelcode." followed by "se", reconstruct it as "pixelcode.se".
- Fill exampleSkills with concrete resume-backed skills:
  - Prioritize explicit "skills", "examples of skills", technology stack, method, role, and tooling sections from the PDF.
  - Then add important repeated technologies/tools/methods from highlighted and recent experiences.
  - Use short names only, for example "React", "SvelteKit", "Azure", "Scrum", "REST API".
  - Prefer 10-24 items when enough evidence exists; use fewer if the PDF contains less evidence.
- Put certifications and certificates in certificates, not education.
- title must be a professional resume headline (role-focused), never a person's name.
- Always write summary and description in third person.
- Previous experience descriptions are more important than highlighted descriptions. If you need to be concise, shorten summary/highlights first, not previous assignment descriptions.
- Use this profile first name for consultant references when needed: ${personFirstName}.
- Do not use other personal names from the PDF as the consultant identity.
- Do not repeat the first name in every sentence; alternate naturally with pronouns or "the consultant".
- versionNameEn should be a short English title for this imported resume.

Coverage checklist before finalizing JSON:
1. Did you include all identifiable experience entries from the PDF?
2. Did you keep company/role/date/location details intact where present?
3. Did every experience date range come from a real date range in the work-history section?
4. Did you avoid duplicate previous-experience rows created from highlighted cards?
5. Are highlighted experiences shorter and more focused than the corresponding previous experience?
6. Are rich previous-experience descriptions still rich, multi-point, and comparable in density to the source text?
7. Did you fill both sv and en for localized fields?
8. Did you populate exampleSkills from the resume-backed skills and technologies?
9. Did you avoid inventing missing information?`;

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
const stripTags = (value: string) => value.replace(/<[^>]*>/g, ' ');
const DOMAIN_TLDS = [
	'se',
	'com',
	'nu',
	'net',
	'org',
	'io',
	'dev',
	'co',
	'ai',
	'app',
	'dk',
	'no',
	'fi'
];
const DOMAIN_TLD_PATTERN = DOMAIN_TLDS.join('|');

type PreviousExperienceSourceRecord = {
	dateRange: string;
	company: string;
	location: string;
	role: string;
	description: string;
	technologies: string[];
};

type SourceDomain = {
	value: string;
	rootKey: string;
	tld: string;
};

const normalizeExtractedPdfText = (value: string): string => {
	const withoutNulls = value.replace(/\0/g, '');
	const joinedDomains = withoutNulls.replace(
		new RegExp(
			`([\\p{L}\\p{N}_%+-][\\p{L}\\p{N}._%+-]*)\\.\\s*\\r?\\n\\s*(${DOMAIN_TLD_PATTERN})\\b`,
			'giu'
		),
		'$1.$2'
	);

	return joinedDomains
		.split(/\r?\n/)
		.map((line) => line.replace(/[ \t]+/g, ' ').trim())
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
		.slice(0, MAX_EXTRACTED_PDF_TEXT_CHARS);
};

const MONTH_PATTERN =
	'(?:jan\\.?|january|feb\\.?|february|mar\\.?|march|apr\\.?|april|may|jun\\.?|june|jul\\.?|july|aug\\.?|august|sep\\.?|sept\\.?|september|oct\\.?|october|nov\\.?|november|dec\\.?|december|jan\\.?|januari|feb\\.?|februari|mars|apr\\.?|april|maj|juni|juli|aug\\.?|augusti|sep\\.?|sept\\.?|september|okt\\.?|oktober|nov\\.?|november|dec\\.?|december)';
const DATE_RANGE_PATTERN = new RegExp(
	`^${MONTH_PATTERN}\\s+\\d{4}\\s+-\\s+(?:${MONTH_PATTERN}\\s+\\d{4}|ongoing|present|current|pågående|nuvarande)$`,
	'i'
);
const PAGE_MARKER_PATTERN = /^--\s*\d+\s+of\s+\d+\s+--$/i;
const SECTION_STOP_PATTERN =
	/^(skills|kompetenser|languages|språk|education|utbildning|certificates|certifikat|portfolio|contact|kontakt|examples of skills|exempel på färdigheter)$/i;
const PREVIOUS_SECTION_PATTERN =
	/^(previous\s+experience|previous|tidigare\s+erfarenheter|tidigare)$/i;
const HIGHLIGHTED_SECTION_PATTERN =
	/^(highlighted\s+experience|utvald\s+erfarenhet|key\s+technologies|nyckeltekniker)$/i;
const TECHNOLOGY_WORDS = new Set(
	[
		'react',
		'svelte',
		'sveltekit',
		'angular',
		'typescript',
		'javascript',
		'html',
		'css',
		'tailwind',
		'sass',
		'node.js',
		'nodejs',
		'c#',
		'.net',
		'postgresql',
		'sql',
		'azure',
		'git',
		'rest api',
		'figma',
		'ui/ux',
		'contentful',
		'hosting',
		'netlify',
		'auth',
		'supabase',
		'cms',
		'responsive design',
		'ruby',
		'ruby on rails',
		'system architecture',
		'scrum',
		'ci/cd',
		'heroku',
		'adobe illustrator',
		'next.js',
		'mysql',
		'graphql',
		'kanban',
		'agile'
	].map((value) => value.toLowerCase())
);

const compactLines = (text: string): string[] =>
	text
		.split(/\r?\n/)
		.map((line) => normalize(line))
		.filter(Boolean);

const isTechnologyLine = (line: string): boolean => {
	const normalizedLine = normalize(line).toLowerCase();
	if (!normalizedLine) return false;
	if (DATE_RANGE_PATTERN.test(normalizedLine)) return false;
	if (/[.!?]$/.test(normalizedLine)) return false;

	const parts = normalizedLine
		.split(/\s{2,}|\t| {1,}(?=[A-ZÅÄÖa-zåäö0-9.#/+]+(?:\s{2,}|\t|$))/)
		.map((part) => normalize(part).toLowerCase())
		.filter(Boolean);
	const fallbackParts = parts.length > 1 ? parts : normalizedLine.split(/\t+/).filter(Boolean);
	const tokens =
		fallbackParts.length > 1 ? fallbackParts : normalizedLine.split(/\s{2,}/).filter(Boolean);
	const candidates = tokens.length > 1 ? tokens : normalizedLine.split(/\s{1,}/).filter(Boolean);

	const knownMatches = candidates.filter((part) => TECHNOLOGY_WORDS.has(part.toLowerCase())).length;
	return knownMatches >= Math.min(2, candidates.length) || knownMatches >= 3;
};

const extractTechnologiesFromLine = (line: string): string[] =>
	line
		.split(/\t+|\s{2,}/)
		.flatMap((part) => part.split(/\s{3,}/))
		.map((part) => normalize(part))
		.filter(Boolean);

const findPreviousSectionStart = (lines: string[]): number => {
	for (let index = 0; index < lines.length; index += 1) {
		const current = lines[index] ?? '';
		const next = lines[index + 1] ?? '';
		const joined = `${current} ${next}`;
		if (PREVIOUS_SECTION_PATTERN.test(current) || PREVIOUS_SECTION_PATTERN.test(joined)) {
			return (
				index +
				(PREVIOUS_SECTION_PATTERN.test(joined) && !PREVIOUS_SECTION_PATTERN.test(current) ? 2 : 1)
			);
		}
	}
	return -1;
};

const buildPreviousExperienceSourceRecords = (text: string): PreviousExperienceSourceRecord[] => {
	const lines = compactLines(text).filter((line) => !PAGE_MARKER_PATTERN.test(line));
	const start = findPreviousSectionStart(lines);
	if (start === -1) return [];

	const records: PreviousExperienceSourceRecord[] = [];
	let index = start;

	while (index < lines.length) {
		const line = lines[index] ?? '';
		if (SECTION_STOP_PATTERN.test(line)) break;
		if (!DATE_RANGE_PATTERN.test(line)) {
			index += 1;
			continue;
		}

		const dateRange = line;
		const company = lines[index + 1] ?? '';
		const location = lines[index + 2] ?? '';
		const role = lines[index + 3] ?? '';
		index += 4;

		const descriptionLines: string[] = [];
		const technologies: string[] = [];

		while (index < lines.length) {
			const current = lines[index] ?? '';
			if (
				DATE_RANGE_PATTERN.test(current) ||
				SECTION_STOP_PATTERN.test(current) ||
				PREVIOUS_SECTION_PATTERN.test(current) ||
				HIGHLIGHTED_SECTION_PATTERN.test(current)
			) {
				break;
			}

			if (isTechnologyLine(current)) {
				technologies.push(...extractTechnologiesFromLine(current));
			} else {
				descriptionLines.push(current);
			}
			index += 1;
		}

		records.push({
			dateRange,
			company,
			location,
			role,
			description: descriptionLines.join('\n'),
			technologies: mergeTechnologies([], technologies)
		});
	}

	return records.filter((record) => record.company || record.role || record.description);
};

const buildPreviousExperienceRecordsPrompt = (text: string): string => {
	const records = buildPreviousExperienceSourceRecords(text);
	if (records.length === 0) {
		return 'No structured previous-experience source records could be extracted. Use the normalized PDF text directly.';
	}

	const rendered = records
		.map((record, index) =>
			[
				`Record ${index + 1}`,
				`Date range: ${record.dateRange}`,
				`Company: ${record.company}`,
				`Location: ${record.location}`,
				`Role: ${record.role}`,
				`Description source text:`,
				record.description,
				record.technologies.length > 0
					? `Technologies: ${record.technologies.join(', ')}`
					: 'Technologies:'
			].join('\n')
		)
		.join('\n\n---\n\n');

	return `Structured previous-experience source records extracted from the previous/full work-history section.

These records are an optional structural aid extracted from the uploaded resume text. They are generic and may come from any resume template or language. Use them to preserve source depth, not to impose a fixed template.

Hard requirement: create one experiences item from each record below unless the full PDF text clearly proves it is not a real work-history entry. For experiences.description, preserve the record's Description source text in rich detail. Do not replace it with highlighted-experience summaries. Do not reduce a multi-paragraph record to 1-2 sentences. Preserve full domains such as example.com, company.se, or any other source domain exactly.

${rendered}`;
};

const ensurePdfJsDomGlobals = async () => {
	const globals = globalThis as unknown as Record<'DOMMatrix' | 'ImageData' | 'Path2D', unknown>;

	if (globals.DOMMatrix && globals.ImageData && globals.Path2D) {
		return;
	}

	const { DOMMatrix, ImageData, Path2D } = await import('@napi-rs/canvas');
	globals.DOMMatrix ??= DOMMatrix;
	globals.ImageData ??= ImageData;
	globals.Path2D ??= Path2D;
};

const extractPdfText = async (pdfBytes: Uint8Array): Promise<string> => {
	let parser: {
		getText: () => Promise<{ text?: string | null }>;
		destroy: () => Promise<void>;
	} | null = null;
	const startedAt = Date.now();

	try {
		console.info('[resume-pdf-import] pdf:text:start', { size_bytes: pdfBytes.byteLength });
		await ensurePdfJsDomGlobals();
		console.info('[resume-pdf-import] pdf:text:globals-ready');
		const [{ PDFParse }, { CanvasFactory, getData }] = await Promise.all([
			import('pdf-parse'),
			import('pdf-parse/worker')
		]);
		PDFParse.setWorker(getData());
		console.info('[resume-pdf-import] pdf:text:parser-loaded');
		parser = new PDFParse({
			data: Buffer.from(pdfBytes),
			CanvasFactory
		});
		const result = await parser.getText();
		const normalizedText = normalizeExtractedPdfText(result.text ?? '');
		console.info('[resume-pdf-import] pdf:text:done', {
			size_bytes: pdfBytes.byteLength,
			text_chars: normalizedText.length,
			duration_ms: Date.now() - startedAt
		});
		return normalizedText;
	} catch (error) {
		console.warn('[resume-pdf-import] Failed to extract PDF text', error);
		return '';
	} finally {
		await parser?.destroy().catch(() => undefined);
	}
};

const buildExtractedPdfTextPrompt = (text: string): string =>
	text
		? `Extracted PDF text, normalized from the uploaded file.

Treat this text as the authoritative source for exact wording, long previous-experience sections, dates, company names, technologies, websites, domains, and email addresses. Use the attached PDF file to resolve layout or extraction ambiguity.

${text}`
		: `No reliable extracted PDF text was available. Use the attached PDF file directly.`;

const shouldAttachPdfFile = (extractedPdfText: string): boolean =>
	normalize(extractedPdfText).length < MIN_EXTRACTED_TEXT_ONLY_CHARS;

const normalizeDomainComparable = (value: string): string =>
	normalize(value)
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/å/g, 'a')
		.replace(/ä/g, 'a')
		.replace(/ö/g, 'o')
		.replace(/[^a-z0-9]+/g, '');

const extractSourceDomains = (text: string): SourceDomain[] => {
	const matches = text.matchAll(
		/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)\b/gi
	);
	const deduped = new Map<string, SourceDomain>();

	for (const match of matches) {
		const value = normalize(match[1] ?? '').toLowerCase();
		if (!value || !value.includes('.')) continue;
		const parts = value.split('.').filter(Boolean);
		const root = parts.length >= 2 ? parts[parts.length - 2]! : parts[0]!;
		const tld = parts.at(-1) ?? '';
		if (!root || !tld || !DOMAIN_TLDS.includes(tld)) continue;
		if (!deduped.has(value)) {
			deduped.set(value, {
				value,
				rootKey: normalizeDomainComparable(root),
				tld
			});
		}
	}

	return Array.from(deduped.values());
};

const buildSourceDomainsPrompt = (text: string): string => {
	const domains = extractSourceDomains(text).map((domain) => domain.value);
	if (domains.length === 0) {
		return 'No source websites/domains were detected in extracted PDF text.';
	}

	return `Source websites/domains detected in the PDF:
${domains.map((domain) => `- ${domain}`).join('\n')}

Hard requirement: when referring to a detected website/domain, copy the full domain exactly. Never write only the top-level domain such as "se", "com", "io", or "dev" as a substitute for the full source domain.`;
};

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
		'certificates',
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
		certificates: {
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

const toLocalizedObject = (
	value: LocalizedText | null | undefined,
	maxLength: number
): { sv: string; en: string } => sanitizeLocalized(value ?? '', maxLength);

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

const findDomainForCompany = (
	company: string,
	sourceDomains: SourceDomain[]
): SourceDomain | null => {
	const companyKey = normalizeDomainComparable(company);
	if (!companyKey) return null;

	const directMatch = sourceDomains.find(
		(domain) =>
			domain.rootKey.length >= 4 &&
			(companyKey.includes(domain.rootKey) || domain.rootKey.includes(companyKey))
	);
	if (directMatch) return directMatch;

	const compactCompanyKey = companyKey.replace(/ab$|inc$|llc$|ltd$|group$/g, '');
	if (compactCompanyKey !== companyKey) {
		return (
			sourceDomains.find(
				(domain) =>
					domain.rootKey.length >= 4 &&
					(compactCompanyKey.includes(domain.rootKey) || domain.rootKey.includes(compactCompanyKey))
			) ?? null
		);
	}

	return null;
};

const repairOrphanDomainTld = (
	value: string,
	company: string,
	sourceDomains: SourceDomain[]
): string => {
	if (!value || sourceDomains.length === 0) return value;
	const domain = findDomainForCompany(company, sourceDomains);
	if (!domain) return value;
	if (new RegExp(`\\b${domain.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(value)) {
		return value;
	}

	const escapedTld = domain.tld.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return value.replace(
		new RegExp(`(^|[.!?]\\s+|\\n\\s*)${escapedTld}(?=\\s*[,.;:])`, 'gi'),
		(match, prefix: string) => `${prefix}${domain.value}`
	);
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

const sanitizeHighlightedExperiences = (
	value: unknown,
	sourceDomains: SourceDomain[]
): HighlightedExperience[] => {
	if (!Array.isArray(value)) return [];

	const list: HighlightedExperience[] = [];
	for (const entry of value) {
		const record = asRecord(entry);
		const company = sanitizeOptionalText(record.company, 140);
		const role = sanitizeLocalized(record.role, 180);
		const descriptionRaw = sanitizeLocalized(record.description, 8_000);
		const repairedDescriptionRaw = {
			sv: repairOrphanDomainTld(descriptionRaw.sv, company, sourceDomains),
			en: repairOrphanDomainTld(descriptionRaw.en, company, sourceDomains)
		};
		const technologies = sanitizeStringArray(record.technologies, 24, 80);

		const descriptionSv = repairedDescriptionRaw.sv ? toQuillHtml(repairedDescriptionRaw.sv) : '';
		const descriptionEn = repairedDescriptionRaw.en ? toQuillHtml(repairedDescriptionRaw.en) : '';

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

const sanitizeExperienceItems = (
	value: unknown,
	sourceDomains: SourceDomain[]
): ExperienceItem[] => {
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
		const repairedDescriptionRaw = {
			sv: repairOrphanDomainTld(descriptionRaw.sv, company, sourceDomains),
			en: repairOrphanDomainTld(descriptionRaw.en, company, sourceDomains)
		};
		const technologies = sanitizeStringArray(record.technologies, 24, 80);

		const descriptionSv = repairedDescriptionRaw.sv ? toQuillHtml(repairedDescriptionRaw.sv) : '';
		const descriptionEn = repairedDescriptionRaw.en ? toQuillHtml(repairedDescriptionRaw.en) : '';

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

const normalizeLocalizedKey = (value: LocalizedText): string => {
	const localized = toLocalizedObject(value, 8_000);
	return `${normalizeKeyPart(localized.sv)}|${normalizeKeyPart(localized.en)}`;
};

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

const buildExampleSkills = (
	payload: Record<string, unknown>,
	highlightedExperiences: HighlightedExperience[],
	experiences: ExperienceItem[]
): string[] => {
	const explicitSkills = sanitizeStringArray(payload.exampleSkills, 40, 80);
	const techniques = sanitizeStringArray(payload.techniques, 80, 80);
	const methods = sanitizeStringArray(payload.methods, 80, 80);
	const highlightedTechnologies = highlightedExperiences.flatMap((entry) => entry.technologies);
	const experienceTechnologies = experiences.flatMap((entry) => entry.technologies);

	const merged = mergeTechnologies(
		mergeTechnologies(explicitSkills, highlightedTechnologies),
		mergeTechnologies(experienceTechnologies, [...techniques, ...methods])
	);

	return merged.slice(0, 40);
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
): ExperienceItem => {
	const baseDescription = toLocalizedObject(base.description, 8_000);
	const highlightDescription = toLocalizedObject(fromHighlight.description, 8_000);

	return {
		...base,
		description: {
			sv: baseDescription.sv || highlightDescription.sv,
			en: baseDescription.en || highlightDescription.en
		},
		technologies: mergeTechnologies(base.technologies, fromHighlight.technologies)
	};
};

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
			const companyKey = normalizeKeyPart(highlightedAsExperience.company);
			const companyMatchIndex = companyKey
				? merged.findIndex((entry) => normalizeKeyPart(entry.company) === companyKey)
				: -1;

			if (companyMatchIndex === -1) {
				merged.push(highlightedAsExperience);
				continue;
			}

			merged[companyMatchIndex] = mergeHighlightIntoExperience(
				merged[companyMatchIndex]!,
				highlightedAsExperience
			);
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
	candidate: LocalizedText,
	personName: string
): { sv: string; en: string } | null => {
	const localized = toLocalizedObject(candidate, 180);
	const sv = sanitizeOptionalText(localized.sv, 180);
	const en = sanitizeOptionalText(localized.en, 180);

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
	personName: string,
	extractedPdfText: string
): { versionNameEn: string; content: ResumeData } => {
	const sourceDomains = extractSourceDomains(extractedPdfText);
	const importedTitle = sanitizeLocalized(payload.title, 180);
	const summaryRaw = sanitizeLocalized(payload.summary, 8_000);
	const summary = {
		sv: summaryRaw.sv ? toQuillHtml(summaryRaw.sv) : '',
		en: summaryRaw.en ? toQuillHtml(summaryRaw.en) : ''
	};

	const highlightedExperiences = sanitizeHighlightedExperiences(
		payload.highlightedExperiences,
		sourceDomains
	);
	const experiences = sanitizeExperienceItems(payload.experiences, sourceDomains);

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
		exampleSkills: buildExampleSkills(payload, cappedHighlighted, mergedExperiences),
		highlightedExperiences: cappedHighlighted,
		experiences: mergedExperiences,
		techniques: sanitizeStringArray(payload.techniques, 80, 80),
		methods: sanitizeStringArray(payload.methods, 80, 80),
		languages: sanitizeLabeledItems(payload.languages),
		education: sanitizeLabeledItems(payload.education),
		certificates: sanitizeLabeledItems(payload.certificates),
		portfolio: sanitizeStringArray(payload.portfolio, 20, 260),
		footerNote: sanitizeLocalized(payload.footerNote, 2_000)
	};
	const normalizedSummary = toLocalizedObject(content.summary, 8_000);

	const hasCriticalContent =
		normalize(stripTags(normalizedSummary.sv)).length > 0 ||
		normalize(stripTags(normalizedSummary.en)).length > 0 ||
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
	const extractedPdfText = await extractPdfText(input.pdfBytes);
	const attachPdfFile = shouldAttachPdfFile(extractedPdfText);
	const fileData = attachPdfFile
		? `data:application/pdf;base64,${Buffer.from(input.pdfBytes).toString('base64')}`
		: null;
	const userContent: Array<
		| { type: 'input_text'; text: string }
		| { type: 'input_file'; file_data: string; filename: string }
	> = [
		{
			type: 'input_text',
			text: PDF_IMPORT_USER_PROMPT(personName, personFirstName)
		},
		{
			type: 'input_text',
			text: buildExtractedPdfTextPrompt(extractedPdfText)
		},
		{
			type: 'input_text',
			text: buildSourceDomainsPrompt(extractedPdfText)
		},
		{
			type: 'input_text',
			text: buildPreviousExperienceRecordsPrompt(extractedPdfText)
		}
	];

	if (fileData) {
		userContent.push({
			type: 'input_file',
			file_data: fileData,
			filename
		});
	}

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
					content: userContent
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

	const { versionNameEn, content } = sanitizeImportedPayload(payload, personName, extractedPdfText);

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
