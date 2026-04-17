import { getModel, openai } from '$lib/server/openai';
import { RESUME_AI_STYLE_GUIDE } from './resumeAiStyle';

export type ResumeAiLanguage = 'sv' | 'en';
export type ResumeAiSectionType = 'highlighted' | 'experience' | 'summary' | 'exampleSkills';
export type ResumeAiFieldKey =
	| 'company'
	| 'role'
	| 'location'
	| 'technologies'
	| 'startDate'
	| 'endDate';

export type GeneratedResumeProjectTextResult = {
	descriptionHtml: string;
	skills?: string[];
	company?: string;
	role?: string;
	location?: string;
	technologies?: string[];
	startDate?: string;
	endDate?: string | null;
};

export type GenerateResumeProjectTextInput = {
	prompt: string;
	language: ResumeAiLanguage;
	sectionType: ResumeAiSectionType;
	company?: string;
	role?: string;
	location?: string;
	technologies?: string[];
	startDate?: string;
	endDate?: string | null;
	unlockedFields?: ResumeAiFieldKey[];
	currentText?: string;
	consultantName?: string;
	resumeContext?: string;
};

const MAX_PROMPT_LENGTH = 4_000;
const MAX_CONTEXT_LENGTH = 2_000;
const MAX_RESUME_CONTEXT_LENGTH = 8_000;
const ALLOWED_FIELD_KEYS: ResumeAiFieldKey[] = [
	'company',
	'role',
	'location',
	'technologies',
	'startDate',
	'endDate'
];

const stripTags = (value: string) => value.replace(/<[^>]*>/g, ' ');

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();

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

const sanitizeField = (value: unknown, maxLength: number): string | undefined => {
	if (typeof value !== 'string') return undefined;
	const cleaned = normalize(value).slice(0, maxLength);
	return cleaned || undefined;
};

const sanitizeMultilineField = (value: unknown, maxLength: number): string | undefined => {
	if (typeof value !== 'string') return undefined;
	const normalizedLines = value
		.replace(/\r/g, '')
		.split('\n')
		.map((line) => normalize(line));

	const compactedLines: string[] = [];
	let previousWasEmpty = false;
	for (const line of normalizedLines) {
		if (!line) {
			if (!previousWasEmpty && compactedLines.length > 0) {
				compactedLines.push('');
			}
			previousWasEmpty = true;
			continue;
		}
		compactedLines.push(line);
		previousWasEmpty = false;
	}

	const cleaned = compactedLines.join('\n').trim().slice(0, maxLength);
	return cleaned || undefined;
};

const hasJsonShape = (value: string) => {
	const trimmed = value.trim();
	return trimmed.startsWith('{') && trimmed.endsWith('}');
};

const TECHNOLOGY_CASE_OVERRIDES = new Map<string, string>([
	['.net', '.NET'],
	['.net core', '.NET Core'],
	['asp.net', 'ASP.NET'],
	['asp.net core', 'ASP.NET Core'],
	['aws', 'AWS'],
	['gcp', 'GCP'],
	['sql', 'SQL'],
	['nosql', 'NoSQL'],
	['api', 'API'],
	['rest', 'REST'],
	['rest api', 'REST API'],
	['graphql', 'GraphQL'],
	['ci/cd', 'CI/CD'],
	['ci', 'CI'],
	['cd', 'CD'],
	['html', 'HTML'],
	['css', 'CSS'],
	['ui', 'UI'],
	['ux', 'UX'],
	['ai', 'AI'],
	['ml', 'ML'],
	['qa', 'QA'],
	['jwt', 'JWT'],
	['oauth', 'OAuth'],
	['ios', 'iOS'],
	['macos', 'macOS'],
	['javascript', 'JavaScript'],
	['typescript', 'TypeScript'],
	['node.js', 'Node.js'],
	['next.js', 'Next.js'],
	['nuxt.js', 'Nuxt.js'],
	['vue.js', 'Vue.js'],
	['react.js', 'React.js'],
	['sveltekit', 'SvelteKit']
]);

const UPPERCASE_TECH_WORDS = new Set([
	'api',
	'sdk',
	'sql',
	'ui',
	'ux',
	'ai',
	'ml',
	'qa',
	'ci',
	'cd',
	'jwt',
	'sso',
	'cdn',
	'etl'
]);

const toTitleWord = (word: string): string => {
	const normalizedWord = normalize(word);
	if (!normalizedWord) return '';

	const lowerWord = normalizedWord.toLowerCase();
	const override = TECHNOLOGY_CASE_OVERRIDES.get(lowerWord);
	if (override) return override;

	if (normalizedWord.startsWith('.')) {
		const bare = normalizedWord.slice(1);
		const bareLower = bare.toLowerCase();
		if (TECHNOLOGY_CASE_OVERRIDES.has(bareLower)) {
			return `.${TECHNOLOGY_CASE_OVERRIDES.get(bareLower)!}`;
		}
		if (UPPERCASE_TECH_WORDS.has(bareLower)) {
			return `.${bareLower.toUpperCase()}`;
		}
		return bare ? `.${bare.charAt(0).toUpperCase()}${bare.slice(1).toLowerCase()}` : normalizedWord;
	}

	// Keep mixed-case words (for example ReactNative) as-is.
	if (/[A-Z]/.test(normalizedWord.slice(1)) && /[a-z]/.test(normalizedWord)) {
		return normalizedWord;
	}

	if (UPPERCASE_TECH_WORDS.has(lowerWord)) {
		return lowerWord.toUpperCase();
	}

	return `${lowerWord.charAt(0).toUpperCase()}${lowerWord.slice(1)}`;
};

const toTechnologyTitleCase = (value: string): string => {
	const normalizedValue = normalize(value);
	if (!normalizedValue) return '';

	const override = TECHNOLOGY_CASE_OVERRIDES.get(normalizedValue.toLowerCase());
	if (override) return override;

	return normalizedValue
		.split(' ')
		.map((part) =>
			part
				.split('/')
				.map((chunk) =>
					chunk
						.split('-')
						.map((word) => toTitleWord(word))
						.filter(Boolean)
						.join('-')
				)
				.filter(Boolean)
				.join('/')
		)
		.filter(Boolean)
		.join(' ');
};

const sanitizeTechnologies = (value: unknown): string[] | undefined => {
	if (!Array.isArray(value)) return undefined;

	const byLowerValue = new Map<string, string>();
	for (const entry of value) {
		if (typeof entry !== 'string') continue;
		const formatted = toTechnologyTitleCase(entry);
		if (!formatted) continue;
		const dedupeKey = formatted.toLowerCase();
		if (!byLowerValue.has(dedupeKey)) {
			byLowerValue.set(dedupeKey, formatted);
		}
		if (byLowerValue.size >= 24) {
			break;
		}
	}
	const deduped = Array.from(byLowerValue.values());

	return deduped.length > 0 ? deduped : undefined;
};

const sanitizeTechnologiesFromText = (value: string): string[] | undefined => {
	const cleaned = stripTags(value);
	if (!cleaned.trim()) return undefined;

	const parts = cleaned
		.replace(/\r/g, '\n')
		.split(/\n|,|;|•|·|\|/g)
		.map((entry) => normalize(entry.replace(/^[-*]\s*/, '')))
		.filter(Boolean);

	return sanitizeTechnologies(parts);
};

const isIsoDate = (value: string): boolean => {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(value);
	return !Number.isNaN(date.getTime());
};

const sanitizeStartDate = (value: unknown): string | undefined => {
	if (typeof value !== 'string') return undefined;
	const cleaned = value.trim();
	return isIsoDate(cleaned) ? cleaned : undefined;
};

const sanitizeEndDate = (value: unknown): string | null | undefined => {
	if (typeof value !== 'string') return undefined;
	const cleaned = value.trim();
	if (!cleaned) return undefined;

	const normalizedLower = cleaned.toLowerCase();
	if (['present', 'ongoing', 'current', 'nuvarande', 'pågående'].includes(normalizedLower)) {
		return null;
	}

	return isIsoDate(cleaned) ? cleaned : undefined;
};

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
	if (compact.length <= 320) return [compact];

	const sentences =
		compact.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)?.map((part) => normalize(part)) ?? [];
	if (sentences.length <= 1) {
		return [compact];
	}

	const paragraphs: string[] = [];
	let currentSentences: string[] = [];

	for (const sentence of sentences) {
		if (!sentence) continue;
		const candidateSentences = [...currentSentences, sentence];
		const candidate = candidateSentences.join(' ');
		const shouldStartNewParagraph =
			currentSentences.length >= 2 && candidate.length > 380;

		if (!shouldStartNewParagraph) {
			currentSentences = candidateSentences;
			continue;
		}

		if (currentSentences.length > 0) {
			paragraphs.push(currentSentences.join(' '));
		}
		currentSentences = [sentence];
	}

	if (currentSentences.length > 0) {
		paragraphs.push(currentSentences.join(' '));
	}

	if (paragraphs.length > 1) {
		const tail = paragraphs[paragraphs.length - 1] ?? '';
		const previous = paragraphs[paragraphs.length - 2] ?? '';
		const tailSentenceCount =
			tail.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)?.filter(Boolean).length ?? 0;
		if (
			tailSentenceCount === 1 &&
			previous &&
			`${previous} ${tail}`.length <= 460
		) {
			paragraphs.splice(paragraphs.length - 2, 2, `${previous} ${tail}`);
		}
	}

	return paragraphs.length > 0 ? paragraphs : [compact];
};

const toQuillHtml = (rawText: string): string => {
	const cleaned = stripTags(rawText)
		.split(/\r?\n/)
		.map((line) => normalize(line));

	if (cleaned.every((line) => !line)) {
		return '';
	}

	const blocks: string[] = [];
	let proseLines: string[] = [];

	const flushProseLines = () => {
		if (proseLines.length === 0) return;
		const proseText = proseLines.map((line) => normalize(line)).filter(Boolean).join(' ');
		for (const paragraph of splitIntoParagraphs(proseText)) {
			blocks.push(`<p>${escapeHtml(paragraph)}</p>`);
		}
		proseLines = [];
	};

	for (let i = 0; i < cleaned.length; i += 1) {
		const line = cleaned[i]!;
		if (!line) {
			continue;
		}

		if (/^[-*•]\s+/.test(line)) {
			flushProseLines();
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

		proseLines.push(line);
	}

	flushProseLines();

	return blocks.join('<p><br></p>');
};

const languageInstruction = (language: ResumeAiLanguage) =>
	language === 'sv' ? 'Write in professional Swedish.' : 'Write in professional English.';

const sectionInstruction = (sectionType: ResumeAiSectionType) =>
	sectionType === 'summary'
		? 'This is a resume summary section. Prioritize concrete evidence from highlighted and previous experiences first. Use skills only as supporting context. Weight recent experiences highest and describe the current professional profile based on the last years. Mention earlier roles as background depth.'
		: sectionType === 'exampleSkills'
			? 'This is the "Examples of skills" sidebar list in a resume. Select a concise, relevant stack based on resume evidence. Prioritize highlighted experiences and recent previous experiences first, then use the profile skills/categories as supporting evidence.'
			: sectionType === 'highlighted'
				? 'This is a highlighted experience block. Prioritize company, role, key technologies, and a concise high-impact description.'
				: 'This is a previous experience block. Extract as many concrete fields as possible (dates, location, company, role, technologies, description).';

const outputRequirementsInstruction = (sectionType: ResumeAiSectionType) =>
	sectionType === 'summary'
		? `Output requirements:
- Return JSON only.
- Use this exact shape:
{
  "description": "string",
  "company": "",
  "role": "",
  "location": "",
  "technologies": [],
  "startDate": "",
  "endDate": ""
}
- Keep company/role/location/technologies/startDate/endDate empty for summary.
- Keep description as plain text (2-4 short paragraphs, optional bullets).
- Use a blank line between paragraphs.
- Do not put each sentence in its own paragraph.
- Each paragraph should usually contain 2-4 sentences.
- Always write in third person.
- Use consultant name references naturally: introduce with first name when needed, then vary with pronouns/the consultant to avoid repeating the name every sentence.
- Prioritize recent experiences first and treat older roles as background context.`
		: sectionType === 'exampleSkills'
			? `Output requirements:
- Return JSON only.
- Use this exact shape:
{
  "skills": ["string"],
  "description": ""
}
- Keep skills as short concrete technology/method names.
- Prefer resume-backed items (frameworks, languages, platforms, tools, cloud, databases).
- Avoid soft skills unless the user explicitly asks for them.
- Return a concise list (typically 8-18 items).
- Sort by relevance to the user prompt/context first, then by strength of evidence in the resume.`
			: `Output requirements:
- Return JSON only.
- Use this exact shape:
{
  "description": "string",
  "company": "string",
  "role": "string",
  "location": "string",
  "technologies": ["string"],
  "startDate": "YYYY-MM-DD or empty",
  "endDate": "YYYY-MM-DD or present or empty"
}
- Use empty string for unknown text/date fields.
- Keep technologies as short skill names.
- Keep description as plain text (2-4 short paragraphs, optional bullets).
- Use a blank line between paragraphs.
- Do not put each sentence in its own paragraph.
- Each paragraph should usually contain 2-4 sentences.
- Always write in third person.
- Use consultant name references naturally: introduce with first name when needed, then vary with pronouns/the consultant to avoid repeating the name every sentence.
- You may update structured fields only if they are listed as editable.
- For locked fields, preserve the provided context values exactly (or leave empty if context is empty).`;

export const generateResumeProjectText = async (
	input: GenerateResumeProjectTextInput
): Promise<GeneratedResumeProjectTextResult> => {
	const prompt = normalize(input.prompt).slice(0, MAX_PROMPT_LENGTH);
	if (!prompt) {
		throw new Error('Prompt is required.');
	}

	const company = normalize(input.company ?? '').slice(0, 120);
	const role = normalize(input.role ?? '').slice(0, 160);
	const location = normalize(input.location ?? '').slice(0, 120);
	const technologies = Array.isArray(input.technologies)
		? input.technologies
				.map((entry) => normalize(entry))
				.filter(Boolean)
				.slice(0, 24)
		: [];
	const startDate = normalize(input.startDate ?? '').slice(0, 20);
	const endDate =
		typeof input.endDate === 'string'
			? normalize(input.endDate).slice(0, 20)
			: input.endDate === null
				? 'present'
				: '';
	const currentText = normalize(stripTags(input.currentText ?? '')).slice(0, MAX_CONTEXT_LENGTH);
	const resumeContext = normalize(stripTags(input.resumeContext ?? '')).slice(
		0,
		MAX_RESUME_CONTEXT_LENGTH
	);
	const consultantName = normalize(stripTags(input.consultantName ?? '')).slice(0, 80);
	const consultantFirstName = consultantName.split(' ').filter(Boolean)[0] ?? '';
	const unlockedFields = Array.isArray(input.unlockedFields)
		? Array.from(
				new Set(
					input.unlockedFields.filter((field): field is ResumeAiFieldKey =>
						ALLOWED_FIELD_KEYS.includes(field)
					)
				)
			)
		: [];
	const unlockedFieldSet = new Set<ResumeAiFieldKey>(unlockedFields);
	const isUnlocked = (field: ResumeAiFieldKey) => unlockedFieldSet.has(field);
	const lockedFields = ALLOWED_FIELD_KEYS.filter((field) => !unlockedFieldSet.has(field));

	const model = getModel();
	const generationTaskInstruction =
		input.sectionType === 'exampleSkills'
			? 'Select and rank a relevant "Examples of skills" list for a resume.'
			: 'Create a polished resume project description.';
	const response = await openai.responses.create({
		model,
		temperature: 0.35,
		max_output_tokens: 700,
		input: [
			{
				role: 'system',
				content: `${RESUME_AI_STYLE_GUIDE}

${languageInstruction(input.language)}
${sectionInstruction(input.sectionType)}
${outputRequirementsInstruction(input.sectionType)}`
			},
			{
				role: 'user',
				content: `${generationTaskInstruction}

Context:
- Consultant profile name: ${consultantName || 'Unknown'}
- Consultant profile first name: ${consultantFirstName || 'Unknown'}
- Third-person naming rule: refer to the consultant in third person and vary naturally between first name and pronouns/the consultant. Avoid repeating the name in every sentence.
- Company: ${company || 'Unknown'}
- Role: ${role || 'Unknown'}
- Location: ${location || 'Unknown'}
- Existing technologies: ${technologies.join(', ') || 'None'}
- Existing start date: ${startDate || 'Unknown'}
- Existing end date: ${endDate || 'Unknown'}
- Section type: ${input.sectionType}
- Language: ${input.language}
- Existing text (optional): ${currentText || 'None'}
- Resume context: ${resumeContext || 'None'}
- Editable structured fields: ${unlockedFields.join(', ') || 'none'}
- Locked structured fields: ${lockedFields.join(', ') || 'none'}

Project notes from user:
${prompt}`
			}
		]
	});

	const rawOutput = response.output_text ?? '';
	const output = normalize(rawOutput);
	if (!output) {
		throw new Error('AI response was empty.');
	}

	const payload = extractJsonPayload(rawOutput);
	const extractedSkills =
		sanitizeTechnologies(payload.skills) ??
		sanitizeTechnologies(payload.exampleSkills) ??
		sanitizeTechnologies(payload.technologies);
	const descriptionText =
		sanitizeMultilineField(payload.description, 6_000) ??
		sanitizeMultilineField(payload.text, 6_000) ??
		sanitizeMultilineField(payload.summary, 6_000);
	const extractedCompany = sanitizeField(payload.company, 120);
	const extractedRole = sanitizeField(payload.role, 160);
	const extractedLocation = sanitizeField(payload.location, 120);
	const extractedTechnologies = sanitizeTechnologies(payload.technologies);
	const extractedStartDate = sanitizeStartDate(payload.startDate);
	const extractedEndDate = sanitizeEndDate(payload.endDate);

	const plainTextFallback = hasJsonShape(output) ? '' : output;
	const plainTextSkillsFallback = plainTextFallback
		? sanitizeTechnologiesFromText(plainTextFallback)
		: undefined;

	if (input.sectionType === 'exampleSkills') {
		const nextSkills = extractedSkills ?? plainTextSkillsFallback;
		if (nextSkills && nextSkills.length > 0) {
			return {
				descriptionHtml: '',
				skills: nextSkills
			};
		}

		if (technologies.length > 0) {
			return {
				descriptionHtml: '',
				skills: sanitizeTechnologies(technologies) ?? technologies
			};
		}

		throw new Error('AI response did not include any skills.');
	}

	const html = descriptionText
		? toQuillHtml(descriptionText)
		: plainTextFallback
			? toQuillHtml(plainTextFallback)
			: '';
	if (input.sectionType === 'summary') {
		if (!html) {
			if (input.currentText && normalize(stripTags(input.currentText)).length > 0) {
				return {
					descriptionHtml: input.currentText
				};
			}
			throw new Error('AI response could not be formatted.');
		}

		return {
			descriptionHtml: html
		};
	}

	if (!html) {
		if (input.currentText && normalize(stripTags(input.currentText)).length > 0) {
			return {
				descriptionHtml: input.currentText,
				...(isUnlocked('company') && extractedCompany ? { company: extractedCompany } : {}),
				...(isUnlocked('role') && extractedRole ? { role: extractedRole } : {}),
				...(input.sectionType === 'experience' && isUnlocked('location') && extractedLocation
					? { location: extractedLocation }
					: {}),
				...(isUnlocked('technologies') && extractedTechnologies
					? { technologies: extractedTechnologies }
					: {}),
				...(input.sectionType === 'experience' && isUnlocked('startDate') && extractedStartDate
					? { startDate: extractedStartDate }
					: {}),
				...(input.sectionType === 'experience' &&
				isUnlocked('endDate') &&
				extractedEndDate !== undefined
					? { endDate: extractedEndDate }
					: {})
			};
		}
		throw new Error('AI response could not be formatted.');
	}

	return {
		descriptionHtml: html,
		...(isUnlocked('company') && extractedCompany ? { company: extractedCompany } : {}),
		...(isUnlocked('role') && extractedRole ? { role: extractedRole } : {}),
		...(input.sectionType === 'experience' && isUnlocked('location') && extractedLocation
			? { location: extractedLocation }
			: {}),
		...(isUnlocked('technologies') && extractedTechnologies
			? { technologies: extractedTechnologies }
			: {}),
		...(input.sectionType === 'experience' && isUnlocked('startDate') && extractedStartDate
			? { startDate: extractedStartDate }
			: {}),
		...(input.sectionType === 'experience' &&
		isUnlocked('endDate') &&
		extractedEndDate !== undefined
			? { endDate: extractedEndDate }
			: {})
	};
};
