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

	const normalizedFullName = normalizeWhitespace(fullName);
	const normalizedFirstName = normalizeWhitespace(firstName);
	const normalizedLastName = normalizeWhitespace(lastName);

	if (normalizedFullName) {
		candidates.set(normalizedFullName.toLowerCase(), normalizedFullName);
	}
	if (normalizedFirstName && shouldMatchIndividualName(normalizedFirstName)) {
		candidates.set(normalizedFirstName.toLowerCase(), normalizedFirstName);
	}
	if (normalizedLastName && shouldMatchIndividualName(normalizedLastName)) {
		candidates.set(normalizedLastName.toLowerCase(), normalizedLastName);
	}
	if (normalizedFirstName && normalizedLastName) {
		const reversed = `${normalizedLastName}, ${normalizedFirstName}`;
		candidates.set(reversed.toLowerCase(), reversed);
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

	if (rules.length === 0) {
		return {
			resumeData: structuredClone(resumeData),
			person: person ? { ...structuredClone(person), avatar_url: null } : null
		};
	}

	const anonymizedResumeData = redactDeep(structuredClone(resumeData), rules);
	const anonymizedPerson = person ? redactDeep(structuredClone(person), rules) : null;

	if (anonymizedPerson) {
		anonymizedPerson.avatar_url = null;
	}

	return {
		resumeData: anonymizedResumeData,
		person: anonymizedPerson
	};
};
