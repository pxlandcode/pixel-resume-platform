import { browser } from '$app/environment';
import { cloneResumeDataValue } from '$lib/resumes/clone';
import type { ResumeData } from '$lib/types/resume';

const STORAGE_KEY_PREFIX = 'resume-draft:v1:';

type PersistedResumeDraft = {
	data?: unknown;
	sourceUpdatedAt?: unknown;
	savedAt?: unknown;
};

export type ResumeDraftRecord = {
	data: ResumeData;
	sourceUpdatedAt: string | null;
	savedAt: string | null;
};

const normalizeTimestamp = (value: unknown) =>
	typeof value === 'string' && value.trim().length > 0 ? value : null;

const stripInternalIds = (data: ResumeData): ResumeData => ({
	...cloneResumeDataValue(data),
	experiences: data.experiences.map(({ _id: _ignoredId, ...entry }) => ({ ...entry })),
	highlightedExperiences: data.highlightedExperiences.map(({ _id: _ignoredId, ...entry }) => ({
		...entry
	}))
});

export const normalizeResumeDraftData = (data: ResumeData): ResumeData => stripInternalIds(data);

export const getResumeDraftStorageKey = (resumeId: string, userId: string | null) =>
	`${STORAGE_KEY_PREFIX}${userId ?? 'anonymous'}:${resumeId}`;

export const readResumeDraft = (
	resumeId: string,
	userId: string | null
): ResumeDraftRecord | null => {
	if (!browser) return null;

	try {
		const raw = localStorage.getItem(getResumeDraftStorageKey(resumeId, userId));
		if (!raw) return null;

		const parsed = JSON.parse(raw) as PersistedResumeDraft;
		if (!parsed.data || typeof parsed.data !== 'object') return null;

		return {
			data: cloneResumeDataValue(parsed.data as ResumeData),
			sourceUpdatedAt: normalizeTimestamp(parsed.sourceUpdatedAt),
			savedAt: normalizeTimestamp(parsed.savedAt)
		};
	} catch {
		return null;
	}
};

export const writeResumeDraft = (
	resumeId: string,
	userId: string | null,
	data: ResumeData,
	sourceUpdatedAt: string | null
) => {
	if (!browser) return;

	try {
		localStorage.setItem(
			getResumeDraftStorageKey(resumeId, userId),
			JSON.stringify({
				data: stripInternalIds(data),
				sourceUpdatedAt,
				savedAt: new Date().toISOString()
			})
		);
	} catch {
		// Ignore local storage write errors.
	}
};

export const clearResumeDraft = (resumeId: string, userId: string | null) => {
	if (!browser) return;

	try {
		localStorage.removeItem(getResumeDraftStorageKey(resumeId, userId));
	} catch {
		// Ignore local storage delete errors.
	}
};
