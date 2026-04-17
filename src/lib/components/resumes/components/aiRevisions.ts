export type ResumeAiRevisionEntry<T> = {
	id: number;
	label: string;
	snapshot: T;
};

export type ResumeAiRevisionState<T> = {
	entries: ResumeAiRevisionEntry<T>[];
	index: number;
	nextEntryId: number;
};

export type ResumeAiDiffFieldMode = 'text' | 'html' | 'list';

export type ResumeAiDiffField = {
	key: string;
	label: string;
	mode?: ResumeAiDiffFieldMode;
	before: string | string[] | null | undefined;
	after: string | string[] | null | undefined;
};

export type ResumeAiTextDiffOperation = {
	type: 'equal' | 'removed' | 'added';
	value: string;
};

const cloneSnapshot = <T>(snapshot: T): T => structuredClone(snapshot);

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const decodeHtmlEntities = (value: string): string =>
	value
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'");

const htmlToDiffText = (value: string): string =>
	decodeHtmlEntities(value)
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|section|article|li|ul|ol|h[1-6])>/gi, '\n')
		.replace(/<li[^>]*>/gi, '• ')
		.replace(/<[^>]*>/g, ' ')
		.replace(/\u00a0/g, ' ')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();

export const createResumeAiRevisionState = <T>(
	snapshot: T,
	label = 'Original'
): ResumeAiRevisionState<T> => ({
	entries: [
		{
			id: 1,
			label,
			snapshot: cloneSnapshot(snapshot)
		}
	],
	index: 0,
	nextEntryId: 2
});

export const replaceCurrentResumeAiRevisionSnapshot = <T>(
	state: ResumeAiRevisionState<T>,
	snapshot: T
): ResumeAiRevisionState<T> => {
	const nextEntries = [...state.entries];
	nextEntries[state.index] = {
		...nextEntries[state.index],
		snapshot: cloneSnapshot(snapshot)
	};
	return {
		...state,
		entries: nextEntries
	};
};

export const pushResumeAiRevisionSnapshot = <T>(
	state: ResumeAiRevisionState<T>,
	snapshot: T,
	label: string
): ResumeAiRevisionState<T> => {
	const nextEntries = state.entries.slice(0, state.index + 1);
	nextEntries.push({
		id: state.nextEntryId,
		label,
		snapshot: cloneSnapshot(snapshot)
	});
	return {
		entries: nextEntries,
		index: nextEntries.length - 1,
		nextEntryId: state.nextEntryId + 1
	};
};

export const getResumeAiRevisionSnapshot = <T>(
	state: ResumeAiRevisionState<T>,
	index = state.index
): T | null => {
	const entry = state.entries[index];
	return entry ? cloneSnapshot(entry.snapshot) : null;
};

export const nextResumeAiRevisionLabel = <T>(
	state: ResumeAiRevisionState<T>,
	baseLabel: string
): string => {
	const count = state.entries.filter(
		(entry) => entry.label === baseLabel || entry.label.startsWith(`${baseLabel} `)
	).length;
	return count === 0 ? baseLabel : `${baseLabel} ${count + 1}`;
};

export const normalizeResumeAiDiffTextValue = (
	value: string | string[] | null | undefined,
	mode: ResumeAiDiffFieldMode = 'text'
): string => {
	if (Array.isArray(value)) {
		return value
			.map((entry) => collapseWhitespace(entry))
			.filter(Boolean)
			.join('\n');
	}
	const raw = value ?? '';
	if (!raw) return '';
	return mode === 'html' ? htmlToDiffText(raw) : raw.trim();
};

export const normalizeResumeAiDiffListValue = (
	value: string | string[] | null | undefined
): string[] => {
	const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split('\n') : [];
	const next: string[] = [];
	const seen = new Set<string>();
	for (const item of source) {
		const cleaned = collapseWhitespace(item);
		if (!cleaned) continue;
		const key = cleaned.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		next.push(cleaned);
	}
	return next;
};

export const hasResumeAiDiffFieldChanges = (field: ResumeAiDiffField): boolean => {
	if (field.mode === 'list') {
		return (
			normalizeResumeAiDiffListValue(field.before).join('|') !==
			normalizeResumeAiDiffListValue(field.after).join('|')
		);
	}
	return (
		collapseWhitespace(normalizeResumeAiDiffTextValue(field.before, field.mode ?? 'text')) !==
		collapseWhitespace(normalizeResumeAiDiffTextValue(field.after, field.mode ?? 'text'))
	);
};

const tokenizeForDiff = (value: string): string[] => value.match(/(\s+|[^\s]+)/g) ?? [];

export const buildResumeAiTextDiffOperations = (
	before: string,
	after: string
): ResumeAiTextDiffOperation[] => {
	const beforeTokens = tokenizeForDiff(before);
	const afterTokens = tokenizeForDiff(after);
	const rows = beforeTokens.length + 1;
	const cols = afterTokens.length + 1;
	const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

	for (let beforeIndex = beforeTokens.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
		for (let afterIndex = afterTokens.length - 1; afterIndex >= 0; afterIndex -= 1) {
			if (beforeTokens[beforeIndex] === afterTokens[afterIndex]) {
				matrix[beforeIndex][afterIndex] = matrix[beforeIndex + 1][afterIndex + 1] + 1;
			} else {
				matrix[beforeIndex][afterIndex] = Math.max(
					matrix[beforeIndex + 1][afterIndex],
					matrix[beforeIndex][afterIndex + 1]
				);
			}
		}
	}

	const operations: ResumeAiTextDiffOperation[] = [];
	let beforeIndex = 0;
	let afterIndex = 0;
	while (beforeIndex < beforeTokens.length && afterIndex < afterTokens.length) {
		if (beforeTokens[beforeIndex] === afterTokens[afterIndex]) {
			operations.push({ type: 'equal', value: beforeTokens[beforeIndex] });
			beforeIndex += 1;
			afterIndex += 1;
			continue;
		}
		if (matrix[beforeIndex + 1][afterIndex] >= matrix[beforeIndex][afterIndex + 1]) {
			operations.push({ type: 'removed', value: beforeTokens[beforeIndex] });
			beforeIndex += 1;
			continue;
		}
		operations.push({ type: 'added', value: afterTokens[afterIndex] });
		afterIndex += 1;
	}

	while (beforeIndex < beforeTokens.length) {
		operations.push({ type: 'removed', value: beforeTokens[beforeIndex] });
		beforeIndex += 1;
	}
	while (afterIndex < afterTokens.length) {
		operations.push({ type: 'added', value: afterTokens[afterIndex] });
		afterIndex += 1;
	}

	const compacted: ResumeAiTextDiffOperation[] = [];
	for (const operation of operations) {
		const previous = compacted[compacted.length - 1];
		if (previous && previous.type === operation.type) {
			previous.value += operation.value;
			continue;
		}
		compacted.push({ ...operation });
	}
	return compacted;
};
