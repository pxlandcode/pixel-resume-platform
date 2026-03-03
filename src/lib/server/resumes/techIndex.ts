import type { SupabaseClient } from '@supabase/supabase-js';
import type { ResumeTechIndexItem } from '$lib/types/resumes';

const toStringArray = (value: unknown): string[] => {
	if (!Array.isArray(value)) return [];
	return value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean);
};

const uniqCaseInsensitive = (values: string[]) => {
	const seen = new Set<string>();
	const uniqueValues: string[] = [];

	for (const value of values) {
		const key = value.toLowerCase();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		uniqueValues.push(value);
	}

	return uniqueValues.sort((left, right) =>
		left.localeCompare(right, undefined, { sensitivity: 'base' })
	);
};

const extractTalentTechs = (techStack: unknown): string[] => {
	if (!Array.isArray(techStack)) return [];

	const skills: string[] = [];
	for (const category of techStack) {
		if (!category || typeof category !== 'object') continue;
		skills.push(...toStringArray((category as { skills?: unknown }).skills));
	}

	return uniqCaseInsensitive(skills);
};

const getSafeText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
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

const normalizeTechKey = (value: string) => value.trim().toLowerCase();
const ONGOING_END_DATE_KEYWORDS = new Set([
	'present',
	'current',
	'ongoing',
	'nuvarande',
	'pågående'
]);
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

const parseDateToMs = (value: string | null | undefined): number | null => {
	if (!value) return null;
	const trimmed = value.trim();
	if (!trimmed) return null;

	const isoDateMatch = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
	if (isoDateMatch) {
		const parsed = Date.parse(`${trimmed}T00:00:00Z`);
		return Number.isFinite(parsed) ? parsed : null;
	}

	const isoMonthMatch = /^\d{4}-\d{2}$/.test(trimmed);
	if (isoMonthMatch) {
		const parsed = Date.parse(`${trimmed}-01T00:00:00Z`);
		return Number.isFinite(parsed) ? parsed : null;
	}

	const parsed = Date.parse(trimmed);
	return Number.isFinite(parsed) ? parsed : null;
};

const parseEndDateToMs = (value: string | null | undefined, nowMs: number): number | null => {
	if (!value) return nowMs;
	const trimmed = value.trim();
	if (!trimmed) return nowMs;
	if (ONGOING_END_DATE_KEYWORDS.has(trimmed.toLowerCase())) return nowMs;
	return parseDateToMs(trimmed);
};

const fetchTalentRows = async (
	adminClient: SupabaseClient,
	talentIds: string[] | null
): Promise<Array<{ id: string; tech_stack: unknown }>> => {
	if (talentIds !== null && talentIds.length === 0) return [];

	const query = adminClient.from('talents').select('id, tech_stack');
	const result = talentIds === null ? await query : await query.in('id', talentIds);

	if (result.error) {
		throw new Error(result.error.message);
	}

	return (result.data ?? []) as Array<{ id: string; tech_stack: unknown }>;
};

export const buildResumeTechIndex = async (
	adminClient: SupabaseClient,
	talentIds: string[] | null
): Promise<ResumeTechIndexItem[]> => {
	const talentRows = await fetchTalentRows(adminClient, talentIds);
	if (talentRows.length === 0) return [];

	const scopedTalentIdSet = new Set(talentRows.map((row) => row.id));
	const scopedTalentIds = Array.from(scopedTalentIdSet);

	const resumesResult = await adminClient
		.from('resumes')
		.select('id, talent_id')
		.in('talent_id', scopedTalentIds);
	if (resumesResult.error) {
		throw new Error(resumesResult.error.message);
	}

	const resumeRows = resumesResult.data ?? [];
	const resumeMetadata = resumeRows
		.map((row) => ({
			id: normalizeId((row as { id: unknown }).id) ?? '',
			talentId: typeof row.talent_id === 'string' ? row.talent_id : ''
		}))
		.filter((row) => row.id.length > 0 && row.talentId.length > 0);
	const resumeIds = resumeMetadata.map((row) => row.id);
	const resumeIdToTalentId = new Map<string, string>(
		resumeMetadata.map((row) => [row.id, row.talentId])
	);

	const [resumeSkillRowsResult, resumeExperienceRowsResult] =
		resumeIds.length === 0
			? [
					{ data: [] as Array<{ resume_id: string; value: string }>, error: null },
					{
						data: [] as Array<{
							id: string;
							resume_id: string;
							experience_id: string | null;
							section: 'highlighted' | 'experience';
							use_tech_override: boolean;
							start_date_override: string | null;
							end_date_override: string | null;
						}>,
						error: null
					}
				]
			: await Promise.all([
					adminClient
						.from('resume_skill_items')
						.select('resume_id, value')
						.in('resume_id', resumeIds),
					adminClient
						.from('resume_experience_items')
						.select(
							'id, resume_id, experience_id, section, use_tech_override, start_date_override, end_date_override'
						)
						.in('resume_id', resumeIds)
				]);

	if (resumeSkillRowsResult.error) {
		throw new Error(resumeSkillRowsResult.error.message);
	}
	if (resumeExperienceRowsResult.error) {
		throw new Error(resumeExperienceRowsResult.error.message);
	}

	const resumeExperienceRows = resumeExperienceRowsResult.data ?? [];
	const experienceIds = Array.from(
		new Set(
			resumeExperienceRows
				.map((row) => normalizeId((row as { experience_id: unknown }).experience_id))
				.filter((id): id is string => Boolean(id))
		)
	);
	const resumeExperienceItemIds = resumeExperienceRows
		.map((row) => normalizeId((row as { id: unknown }).id))
		.filter((id): id is string => Boolean(id));

	const [libraryRowsResult, libraryTechRowsResult, overrideTechRowsResult] = await Promise.all([
		experienceIds.length === 0
			? {
					data: [] as Array<{
						id: string;
						company: string;
						role_sv: string;
						role_en: string;
						start_date: string;
						end_date: string | null;
					}>,
					error: null
				}
			: adminClient
					.from('experience_library')
					.select('id, company, role_sv, role_en, start_date, end_date')
					.in('id', experienceIds),
		experienceIds.length === 0
			? { data: [] as Array<{ experience_id: string; value: string }>, error: null }
			: adminClient
					.from('experience_library_technologies')
					.select('experience_id, value')
					.in('experience_id', experienceIds),
		resumeExperienceItemIds.length === 0
			? { data: [] as Array<{ resume_experience_item_id: string; value: string }>, error: null }
			: adminClient
					.from('resume_experience_tech_overrides')
					.select('resume_experience_item_id, value')
					.in('resume_experience_item_id', resumeExperienceItemIds)
	]);

	if (libraryRowsResult.error) {
		throw new Error(libraryRowsResult.error.message);
	}
	if (libraryTechRowsResult.error) {
		throw new Error(libraryTechRowsResult.error.message);
	}
	if (overrideTechRowsResult.error) {
		throw new Error(overrideTechRowsResult.error.message);
	}

	const libraryById = new Map<
		string,
		{
			company: string;
			role_sv: string;
			role_en: string;
			start_date: string;
			end_date: string | null;
		}
	>();
	for (const row of libraryRowsResult.data ?? []) {
		const libraryId = normalizeId((row as { id: unknown }).id);
		if (!libraryId) continue;
		libraryById.set(libraryId, {
			company: getSafeText(row.company),
			role_sv: getSafeText(row.role_sv),
			role_en: getSafeText(row.role_en),
			start_date: getSafeText(row.start_date),
			end_date: row.end_date === null ? null : getSafeText(row.end_date)
		});
	}

	const libraryTechByExperienceId = new Map<string, Set<string>>();
	for (const row of libraryTechRowsResult.data ?? []) {
		const experienceId = normalizeId((row as { experience_id: unknown }).experience_id);
		if (!experienceId) continue;
		const value = getSafeText(row.value);
		if (!value) continue;
		const set = libraryTechByExperienceId.get(experienceId) ?? new Set<string>();
		set.add(value);
		libraryTechByExperienceId.set(experienceId, set);
	}

	const overrideTechByItemId = new Map<string, Set<string>>();
	for (const row of overrideTechRowsResult.data ?? []) {
		const itemId = normalizeId(
			(row as { resume_experience_item_id: unknown }).resume_experience_item_id
		);
		if (!itemId) continue;
		const value = getSafeText(row.value);
		if (!value) continue;
		const set = overrideTechByItemId.get(itemId) ?? new Set<string>();
		set.add(value);
		overrideTechByItemId.set(itemId, set);
	}

	const resumeSearchMap = new Map<string, Set<string>>();
	for (const row of resumeSkillRowsResult.data ?? []) {
		const resumeId = normalizeId((row as { resume_id: unknown }).resume_id);
		if (!resumeId) continue;
		const value = getSafeText(row.value);
		if (!value) continue;
		const set = resumeSearchMap.get(resumeId) ?? new Set<string>();
		set.add(value);
		resumeSearchMap.set(resumeId, set);
	}

	for (const item of resumeExperienceRows) {
		const resumeId = normalizeId((item as { resume_id: unknown }).resume_id);
		const experienceId = normalizeId((item as { experience_id: unknown }).experience_id);
		const itemId = normalizeId((item as { id: unknown }).id);
		if (!resumeId || !experienceId || !itemId) continue;

		const set = resumeSearchMap.get(resumeId) ?? new Set<string>();
		const library = libraryById.get(experienceId);
		if (library) {
			if (library.company) set.add(library.company);
			if (library.role_sv) set.add(library.role_sv);
			if (library.role_en) set.add(library.role_en);
		}

		if (item.use_tech_override) {
			for (const tech of overrideTechByItemId.get(itemId) ?? []) {
				set.add(tech);
			}
		} else {
			for (const tech of libraryTechByExperienceId.get(experienceId) ?? []) {
				set.add(tech);
			}
		}

		resumeSearchMap.set(resumeId, set);
	}

	const resumeSearchByTalentId = new Map<string, Set<string>>();
	for (const [resumeId, set] of resumeSearchMap.entries()) {
		const talentId = resumeIdToTalentId.get(resumeId);
		if (!talentId) continue;
		const talentSet = resumeSearchByTalentId.get(talentId) ?? new Set<string>();
		for (const value of set) talentSet.add(value);
		resumeSearchByTalentId.set(talentId, talentSet);
	}

	type TechInterval = { startMs: number; endMs: number };
	const intervalsByTalentId = new Map<string, Map<string, Map<string, TechInterval>>>();
	const nowMs = Date.now();

	for (const item of resumeExperienceRows) {
		const section = getSafeText((item as { section: unknown }).section);
		if (section !== 'experience') continue;

		const resumeId = normalizeId((item as { resume_id: unknown }).resume_id);
		const itemId = normalizeId((item as { id: unknown }).id);
		if (!resumeId || !itemId) continue;

		const talentId = resumeIdToTalentId.get(resumeId);
		if (!talentId) continue;

		const experienceId = normalizeId((item as { experience_id: unknown }).experience_id);
		const library = experienceId ? libraryById.get(experienceId) : undefined;

		const overrideStartDate = getSafeText(
			(item as { start_date_override: unknown }).start_date_override
		);
		const startDateValue = overrideStartDate || library?.start_date || '';
		const startMs = parseDateToMs(startDateValue);
		if (startMs === null) continue;

		const endDateOverrideRaw = (item as { end_date_override: unknown }).end_date_override;
		const endDateOverride =
			typeof endDateOverrideRaw === 'string' ? getSafeText(endDateOverrideRaw) : null;
		const endDateValue =
			endDateOverrideRaw === null ? (library?.end_date ?? null) : (endDateOverride ?? null);
		const endMs = parseEndDateToMs(endDateValue, nowMs);
		if (endMs === null || endMs <= startMs) continue;

		const techValues =
			item.use_tech_override || !experienceId
				? (overrideTechByItemId.get(itemId) ?? new Set<string>())
				: (libraryTechByExperienceId.get(experienceId) ?? new Set<string>());
		if (techValues.size === 0) continue;

		let talentIntervals = intervalsByTalentId.get(talentId);
		if (!talentIntervals) {
			talentIntervals = new Map();
			intervalsByTalentId.set(talentId, talentIntervals);
		}

		for (const rawTech of techValues) {
			const techKey = normalizeTechKey(rawTech);
			if (!techKey) continue;

			let intervalMap = talentIntervals.get(techKey);
			if (!intervalMap) {
				intervalMap = new Map();
				talentIntervals.set(techKey, intervalMap);
			}

			intervalMap.set(`${startMs}:${endMs}`, { startMs, endMs });
		}
	}

	const techYearsByTalentId = new Map<string, Record<string, number>>();
	for (const [talentId, techMap] of intervalsByTalentId.entries()) {
		const yearsByKey: Record<string, number> = {};

		for (const [techKey, intervalMap] of techMap.entries()) {
			const sortedIntervals = Array.from(intervalMap.values()).sort((left, right) => {
				if (left.startMs !== right.startMs) return left.startMs - right.startMs;
				return left.endMs - right.endMs;
			});
			if (sortedIntervals.length === 0) continue;

			let totalMs = 0;
			let currentStart = sortedIntervals[0].startMs;
			let currentEnd = sortedIntervals[0].endMs;

			for (let index = 1; index < sortedIntervals.length; index += 1) {
				const interval = sortedIntervals[index];
				if (interval.startMs <= currentEnd) {
					currentEnd = Math.max(currentEnd, interval.endMs);
					continue;
				}

				totalMs += Math.max(0, currentEnd - currentStart);
				currentStart = interval.startMs;
				currentEnd = interval.endMs;
			}

			totalMs += Math.max(0, currentEnd - currentStart);
			if (totalMs <= 0) continue;

			yearsByKey[techKey] = totalMs / MS_PER_YEAR;
		}

		if (Object.keys(yearsByKey).length > 0) {
			techYearsByTalentId.set(talentId, yearsByKey);
		}
	}

	const items: ResumeTechIndexItem[] = talentRows
		.map((talent) => {
			const profileTechs = extractTalentTechs(talent.tech_stack);
			const resumeTechs = Array.from(resumeSearchByTalentId.get(talent.id) ?? []);
			return {
				talentId: talent.id,
				searchTechs: uniqCaseInsensitive([...profileTechs, ...resumeTechs]),
				techYearsByKey: techYearsByTalentId.get(talent.id) ?? {}
			};
		})
		.sort((left, right) => left.talentId.localeCompare(right.talentId));

	return items;
};
