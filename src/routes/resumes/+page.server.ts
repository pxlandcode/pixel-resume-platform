import type { PageServerLoad } from './$types';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { siteMeta } from '$lib/seo';
import {
	PROFILE_AVAILABILITY_SELECT,
	normalizeAvailabilityRow
} from '$lib/server/consultantAvailability';

const toStringArray = (value: unknown): string[] => {
	if (!Array.isArray(value)) return [];
	return value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean);
};

const uniq = (values: string[]) => {
	const seen = new Set<string>();
	const uniqueValues: string[] = [];

	for (const value of values) {
		const key = value.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		uniqueValues.push(value);
	}

	return uniqueValues;
};

const extractTalentTechs = (techStack: unknown): string[] => {
	if (!Array.isArray(techStack)) return [];

	const skills: string[] = [];
	for (const category of techStack) {
		if (!category || typeof category !== 'object') continue;
		skills.push(...toStringArray((category as { skills?: unknown }).skills));
	}

	return uniq(skills);
};

const getSafeText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export const load: PageServerLoad = async ({ cookies }) => {
	const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);

	if (!supabase) {
		return { talents: [], meta: null };
	}

	const adminClient = getSupabaseAdminClient();

	if (!adminClient) {
		return { talents: [], meta: null };
	}

	const [{ data: talents }, authUsersResult] = await Promise.all([
		adminClient
			.from('talents')
			.select('id, user_id, first_name, last_name, avatar_url, tech_stack')
			.order('last_name', { ascending: true }),
		adminClient.auth.admin.listUsers()
	]);

	const talentRows = talents ?? [];
	const talentIds = talentRows.map((row) => row.id);

	const availabilityByTalentId = new Map<string, ReturnType<typeof normalizeAvailabilityRow>>();
	if (talentIds.length > 0) {
		const { data: availabilityRows, error: availabilityError } = await adminClient
			.from('profile_availability')
			.select(PROFILE_AVAILABILITY_SELECT)
			.in('profile_id', talentIds);

		if (availabilityError) {
			console.warn('[resumes index] profile_availability error', availabilityError);
		}

		for (const row of availabilityRows ?? []) {
			const profileId = (row as { profile_id?: unknown }).profile_id;
			if (typeof profileId !== 'string' || profileId.length === 0) continue;
			availabilityByTalentId.set(profileId, normalizeAvailabilityRow(row));
		}
	}

	const authMap = new Map<string, { email?: string }>();
	for (const user of authUsersResult.data?.users ?? []) {
		authMap.set(user.id, { email: user.email ?? undefined });
	}

	const resumesResult =
		talentIds.length === 0
			? { data: [] as Array<{ id: number; talent_id: string }>, error: null }
			: await adminClient.from('resumes').select('id, talent_id').in('talent_id', talentIds);

	if (resumesResult.error) {
		console.warn('[resumes index] resumes error', resumesResult.error);
	}

	const resumeRows = resumesResult.data ?? [];
	const resumeMetadata = resumeRows
		.map((row) => ({
			id: Number(row.id),
			talentId: typeof row.talent_id === 'string' ? row.talent_id : ''
		}))
		.filter((row) => Number.isInteger(row.id) && row.id > 0 && row.talentId.length > 0);
	const resumeIds = resumeMetadata.map((row) => row.id);
	const resumeIdToTalentId = new Map<number, string>(
		resumeMetadata.map((row) => [row.id, row.talentId])
	);

	const [resumeSkillRowsResult, resumeExperienceRowsResult] =
		resumeIds.length === 0
			? [
					{ data: [] as Array<{ resume_id: number; value: string }>, error: null },
					{
						data: [] as Array<{
							id: number;
							resume_id: number;
							experience_id: number;
							use_tech_override: boolean;
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
						.select('id, resume_id, experience_id, use_tech_override')
						.in('resume_id', resumeIds)
				]);

	if (resumeSkillRowsResult.error) {
		console.warn('[resumes index] resume_skill_items error', resumeSkillRowsResult.error);
	}
	if (resumeExperienceRowsResult.error) {
		console.warn('[resumes index] resume_experience_items error', resumeExperienceRowsResult.error);
	}

	const resumeExperienceRows = resumeExperienceRowsResult.data ?? [];
	const experienceIds = Array.from(new Set(resumeExperienceRows.map((row) => row.experience_id)));
	const resumeExperienceItemIds = resumeExperienceRows.map((row) => row.id);

	const [libraryRowsResult, libraryTechRowsResult, overrideTechRowsResult] = await Promise.all([
		experienceIds.length === 0
			? {
					data: [] as Array<{ id: number; company: string; role_sv: string; role_en: string }>,
					error: null
				}
			: adminClient
					.from('experience_library')
					.select('id, company, role_sv, role_en')
					.in('id', experienceIds),
		experienceIds.length === 0
			? { data: [] as Array<{ experience_id: number; value: string }>, error: null }
			: adminClient
					.from('experience_library_technologies')
					.select('experience_id, value')
					.in('experience_id', experienceIds),
		resumeExperienceItemIds.length === 0
			? { data: [] as Array<{ resume_experience_item_id: number; value: string }>, error: null }
			: adminClient
					.from('resume_experience_tech_overrides')
					.select('resume_experience_item_id, value')
					.in('resume_experience_item_id', resumeExperienceItemIds)
	]);

	if (libraryRowsResult.error) {
		console.warn('[resumes index] experience_library error', libraryRowsResult.error);
	}
	if (libraryTechRowsResult.error) {
		console.warn(
			'[resumes index] experience_library_technologies error',
			libraryTechRowsResult.error
		);
	}
	if (overrideTechRowsResult.error) {
		console.warn(
			'[resumes index] resume_experience_tech_overrides error',
			overrideTechRowsResult.error
		);
	}

	const libraryById = new Map<number, { company: string; role_sv: string; role_en: string }>();
	for (const row of libraryRowsResult.data ?? []) {
		const libraryId = Number(row.id);
		if (!Number.isInteger(libraryId) || libraryId <= 0) continue;
		libraryById.set(libraryId, {
			company: getSafeText(row.company),
			role_sv: getSafeText(row.role_sv),
			role_en: getSafeText(row.role_en)
		});
	}

	const libraryTechByExperienceId = new Map<number, Set<string>>();
	for (const row of libraryTechRowsResult.data ?? []) {
		const experienceId = Number(row.experience_id);
		if (!Number.isInteger(experienceId) || experienceId <= 0) continue;
		const value = getSafeText(row.value);
		if (!value) continue;
		const set = libraryTechByExperienceId.get(experienceId) ?? new Set<string>();
		set.add(value);
		libraryTechByExperienceId.set(experienceId, set);
	}

	const overrideTechByItemId = new Map<number, Set<string>>();
	for (const row of overrideTechRowsResult.data ?? []) {
		const itemId = Number(row.resume_experience_item_id);
		if (!Number.isInteger(itemId) || itemId <= 0) continue;
		const value = getSafeText(row.value);
		if (!value) continue;
		const set = overrideTechByItemId.get(itemId) ?? new Set<string>();
		set.add(value);
		overrideTechByItemId.set(itemId, set);
	}

	const resumeSearchMap = new Map<number, Set<string>>();
	for (const row of resumeSkillRowsResult.data ?? []) {
		const resumeId = Number(row.resume_id);
		if (!Number.isInteger(resumeId) || resumeId <= 0) continue;
		const value = getSafeText(row.value);
		if (!value) continue;
		const set = resumeSearchMap.get(resumeId) ?? new Set<string>();
		set.add(value);
		resumeSearchMap.set(resumeId, set);
	}

	for (const item of resumeExperienceRows) {
		const resumeId = Number(item.resume_id);
		const experienceId = Number(item.experience_id);
		const itemId = Number(item.id);
		if (!Number.isInteger(resumeId) || resumeId <= 0) continue;
		if (!Number.isInteger(experienceId) || experienceId <= 0) continue;
		if (!Number.isInteger(itemId) || itemId <= 0) continue;

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

	const talentsWithSearch = talentRows.map((talent) => {
		const profileTechs = extractTalentTechs(talent.tech_stack);
		const resumeTechs = Array.from(resumeSearchByTalentId.get(talent.id) ?? []);

		return {
			id: talent.id,
			first_name: talent.first_name ?? '',
			last_name: talent.last_name ?? '',
			avatar_url: talent.avatar_url ?? null,
			email: talent.user_id ? (authMap.get(talent.user_id)?.email ?? null) : null,
			availability: availabilityByTalentId.get(talent.id) ?? normalizeAvailabilityRow(null),
			search_techs: uniq([...profileTechs, ...resumeTechs])
		};
	});

	return {
		talents: talentsWithSearch,
		meta: {
			title: `${siteMeta.name} — Resumes`,
			description: 'Manage consultant resumes and export packages.',
			noindex: true,
			path: '/resumes'
		}
	};
};
