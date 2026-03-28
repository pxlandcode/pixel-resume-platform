import type { Person, ResumeData } from '$lib/types/resume';

const REDACTION_CHAR = '█';
const MIN_REDACTION_LENGTH = 6;
const MAX_REDACTION_LENGTH = 18;

type NameSource = {
	fullName?: string | null;
	firstName?: string | null;
	lastName?: string | null;
};

type RedactionRule = {
	regex: RegExp;
	replacement: string;
	priority: number;
};

const normalizeWhitespace = (value: string | null | undefined) =>
	(value ?? '').replace(/\s+/g, ' ').trim();

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildRedactionBar = (value: string) => {
	const visibleChars = [...normalizeWhitespace(value).replace(/\s+/g, '')].length;
	const length = Math.max(
		MIN_REDACTION_LENGTH,
		Math.min(MAX_REDACTION_LENGTH, visibleChars || MIN_REDACTION_LENGTH)
	);
	return REDACTION_CHAR.repeat(length);
};

const shouldMatchIndividualName = (value: string) => [...value.replace(/\s+/g, '')].length >= 3;

const buildSwedishGenitive = (value: string) => {
	const normalized = normalizeWhitespace(value);
	if (!normalized) return '';
	return normalized.toLowerCase().endsWith('s') ? normalized : `${normalized}s`;
};

const createNameRule = (value: string): RedactionRule | null => {
	const normalized = normalizeWhitespace(value);
	if (!normalized) return null;

	const escapedParts = normalized.split(' ').map((part) => escapeRegExp(part));
	const body = escapedParts.join('\\s+');
	return {
		regex: new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu'),
		replacement: buildRedactionBar(normalized),
		priority: normalized.replace(/\s+/g, '').length
	};
};

const buildNameRedactionRules = ({ fullName, firstName, lastName }: NameSource): RedactionRule[] => {
	const candidates = new Map<string, string>();
	const addCandidate = (value: string, includeSwedishGenitive = false) => {
		const normalized = normalizeWhitespace(value);
		if (!normalized) return;
		candidates.set(normalized.toLowerCase(), normalized);
		if (!includeSwedishGenitive) return;
		const genitive = buildSwedishGenitive(normalized);
		if (genitive && genitive.toLowerCase() !== normalized.toLowerCase()) {
			candidates.set(genitive.toLowerCase(), genitive);
		}
	};

	const normalizedFullName = normalizeWhitespace(fullName);
	const normalizedFirstName = normalizeWhitespace(firstName);
	const normalizedLastName = normalizeWhitespace(lastName);

	if (normalizedFullName) {
		addCandidate(normalizedFullName, true);
	}
	if (normalizedFirstName && shouldMatchIndividualName(normalizedFirstName)) {
		addCandidate(normalizedFirstName, true);
	}
	if (normalizedLastName && shouldMatchIndividualName(normalizedLastName)) {
		addCandidate(normalizedLastName, true);
	}
	if (normalizedFirstName && normalizedLastName) {
		const reversed = `${normalizedLastName}, ${normalizedFirstName}`;
		addCandidate(reversed);
	}

	return [...candidates.values()]
		.map((candidate) => createNameRule(candidate))
		.filter((rule): rule is RedactionRule => Boolean(rule))
		.sort((left, right) => right.priority - left.priority);
};

const applyRedactionRules = (value: string, rules: RedactionRule[]) =>
	rules.reduce((result, rule) => result.replace(rule.regex, rule.replacement), value);

const redactDeep = <T>(value: T, rules: RedactionRule[]): T => {
	if (typeof value === 'string') {
		return applyRedactionRules(value, rules) as T;
	}
	if (Array.isArray(value)) {
		return value.map((entry) => redactDeep(entry, rules)) as T;
	}
	if (value && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
			key,
			redactDeep(entry, rules)
		]);
		return Object.fromEntries(entries) as T;
	}
	return value;
};

export const parseResumeAnonymizeFlag = (value: string | null | undefined) => {
	if (!value) return false;
	const normalized = value.trim().toLowerCase();
	return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

export const buildAnonymizedResumeFilename = (lang: 'sv' | 'en', extension: 'pdf' | 'doc') => {
	const base = lang === 'sv' ? 'anonymized-cv' : 'anonymized-resume';
	return `${base}.${extension}`;
};

export const anonymizeResumeExport = ({
	resumeData,
	person
}: {
	resumeData: ResumeData;
	person?: Person | null;
}) => {
	const fallbackName = normalizeWhitespace(person?.name ?? resumeData.name);
	const fallbackFirstName =
		normalizeWhitespace(person?.firstName) || fallbackName.split(' ')[0] || '';
	const fallbackLastName =
		normalizeWhitespace(person?.lastName) || fallbackName.split(' ').slice(1).join(' ') || '';

	const rules = buildNameRedactionRules({
		fullName: fallbackName,
		firstName: fallbackFirstName,
		lastName: fallbackLastName
	});
	const anonymizePortfolioLinks = (value: ResumeData['portfolio']) =>
		value?.map((entry) => buildRedactionBar(entry)) ?? value;

	if (rules.length === 0) {
		const clonedResumeData = structuredClone(resumeData);
		clonedResumeData.portfolio = anonymizePortfolioLinks(clonedResumeData.portfolio);
		return {
			resumeData: clonedResumeData,
			person: person ? { ...structuredClone(person), avatar_url: null } : null
		};
	}

	const anonymizedResumeData = redactDeep(structuredClone(resumeData), rules);
	anonymizedResumeData.portfolio = anonymizePortfolioLinks(anonymizedResumeData.portfolio);
	const anonymizedPerson = person ? redactDeep(structuredClone(person), rules) : null;

	if (anonymizedPerson) {
		anonymizedPerson.avatar_url = null;
	}

	return {
		resumeData: anonymizedResumeData,
		person: anonymizedPerson
	};
};
