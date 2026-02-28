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
import { getActorAccessContext, getAccessibleTalentIds } from '$lib/server/access';

const ORGANISATION_IMAGES_BUCKET = 'organisation-images';

const resolveStoragePublicUrl = (
	adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
	value: string | null | undefined
) => {
	if (!value || typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (/^https?:\/\//i.test(trimmed)) return trimmed;
	const normalizedPath = trimmed.replace(/^\/+/, '').replace(/^organisation-images\//, '');
	const { data } = adminClient.storage
		.from(ORGANISATION_IMAGES_BUCKET)
		.getPublicUrl(normalizedPath);
	return data.publicUrl ?? null;
};

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

export const load: PageServerLoad = async ({ cookies }) => {
	const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);

	if (!supabase) {
		return { talents: [], meta: null };
	}

	const adminClient = getSupabaseAdminClient();

	if (!adminClient) {
		return { talents: [], meta: null };
	}

	const actor = await getActorAccessContext(supabase, adminClient);
	if (!actor.userId) {
		return { talents: [], meta: null };
	}

	const accessibleTalentIds = await getAccessibleTalentIds(adminClient, actor);

	const [{ data: talents }, authUsersResult] = await Promise.all([
		accessibleTalentIds === null
			? adminClient
					.from('talents')
					.select('id, user_id, first_name, last_name, avatar_url, tech_stack')
					.order('last_name', { ascending: true })
			: accessibleTalentIds.length === 0
				? Promise.resolve({
						data: [] as Array<{
							id: string;
							user_id: string | null;
							first_name: string | null;
							last_name: string | null;
							avatar_url: string | null;
							tech_stack: unknown;
						}>,
						error: null
					})
				: adminClient
						.from('talents')
						.select('id, user_id, first_name, last_name, avatar_url, tech_stack')
						.in('id', accessibleTalentIds)
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

	// Fetch organisation memberships for talents
	const orgMembershipsResult =
		talentIds.length === 0
			? { data: [] as Array<{ talent_id: string; organisation_id: string }>, error: null }
			: await adminClient
					.from('organisation_talents')
					.select('talent_id, organisation_id')
					.in('talent_id', talentIds);

	if (orgMembershipsResult.error) {
		console.warn('[resumes index] organisation_talents error', orgMembershipsResult.error);
	}

	const orgIdByTalentId = new Map<string, string>();
	for (const row of orgMembershipsResult.data ?? []) {
		orgIdByTalentId.set(row.talent_id, row.organisation_id);
	}

	const orgIds = Array.from(new Set(orgIdByTalentId.values()));

	// Fetch organisations and templates for logos
	const [orgsResult, templatesResult] =
		orgIds.length === 0
			? [
					{ data: [] as Array<{ id: string; name: string }>, error: null },
					{
						data: [] as Array<{ organisation_id: string; main_logotype_path: string | null }>,
						error: null
					}
				]
			: await Promise.all([
					adminClient.from('organisations').select('id, name').in('id', orgIds),
					adminClient
						.from('organisation_templates')
						.select('organisation_id, main_logotype_path')
						.in('organisation_id', orgIds)
				]);

	if (orgsResult.error) {
		console.warn('[resumes index] organisations error', orgsResult.error);
	}
	if (templatesResult.error) {
		console.warn('[resumes index] organisation_templates error', templatesResult.error);
	}

	const orgById = new Map<string, { name: string; logoUrl: string | null }>();
	for (const org of orgsResult.data ?? []) {
		orgById.set(org.id, { name: org.name, logoUrl: null });
	}
	for (const template of templatesResult.data ?? []) {
		const existing = orgById.get(template.organisation_id);
		if (existing) {
			existing.logoUrl = resolveStoragePublicUrl(adminClient, template.main_logotype_path);
		}
	}

	const authMap = new Map<string, { email?: string }>();
	for (const user of authUsersResult.data?.users ?? []) {
		authMap.set(user.id, { email: user.email ?? undefined });
	}

	const resumesResult =
		talentIds.length === 0
			? { data: [] as Array<{ id: string; talent_id: string }>, error: null }
			: await adminClient.from('resumes').select('id, talent_id').in('talent_id', talentIds);

	if (resumesResult.error) {
		console.warn('[resumes index] resumes error', resumesResult.error);
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
					data: [] as Array<{ id: string; company: string; role_sv: string; role_en: string }>,
					error: null
				}
			: adminClient
					.from('experience_library')
					.select('id, company, role_sv, role_en')
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

	const libraryById = new Map<string, { company: string; role_sv: string; role_en: string }>();
	for (const row of libraryRowsResult.data ?? []) {
		const libraryId = normalizeId((row as { id: unknown }).id);
		if (!libraryId) continue;
		libraryById.set(libraryId, {
			company: getSafeText(row.company),
			role_sv: getSafeText(row.role_sv),
			role_en: getSafeText(row.role_en)
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
		const itemId = normalizeId((row as { resume_experience_item_id: unknown }).resume_experience_item_id);
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

	const talentsWithSearch = talentRows.map((talent) => {
		const profileTechs = extractTalentTechs(talent.tech_stack);
		const resumeTechs = Array.from(resumeSearchByTalentId.get(talent.id) ?? []);
		const orgId = orgIdByTalentId.get(talent.id);
		const org = orgId ? orgById.get(orgId) : undefined;

		return {
			id: talent.id,
			first_name: talent.first_name ?? '',
			last_name: talent.last_name ?? '',
			avatar_url: talent.avatar_url ?? null,
			email: talent.user_id ? (authMap.get(talent.user_id)?.email ?? null) : null,
			availability: availabilityByTalentId.get(talent.id) ?? normalizeAvailabilityRow(null),
			search_techs: uniq([...profileTechs, ...resumeTechs]),
			organisation_name: org?.name ?? null,
			organisation_logo_url: org?.logoUrl ?? null
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
