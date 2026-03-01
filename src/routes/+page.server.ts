import type { PageServerLoad } from './$types';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
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

export const load: PageServerLoad = async ({ cookies }) => {
	const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
	const adminClient = getSupabaseAdminClient();

	if (!supabase || !adminClient) {
		return {
			stats: { totalTalents: 0, totalResumes: 0, availableNow: 0 },
			recentResumes: [],
			availableSoon: []
		};
	}

	const actor = await getActorAccessContext(supabase, adminClient);
	if (!actor.userId) {
		return {
			stats: { totalTalents: 0, totalResumes: 0, availableNow: 0 },
			recentResumes: [],
			availableSoon: []
		};
	}

	const accessibleTalentIds = await getAccessibleTalentIds(adminClient, actor);

	// Get talents
	const talentsResult =
		accessibleTalentIds === null
			? await adminClient
					.from('talents')
					.select('id, first_name, last_name, avatar_url')
					.order('last_name', { ascending: true })
			: accessibleTalentIds.length === 0
				? { data: [], error: null }
				: await adminClient
						.from('talents')
						.select('id, first_name, last_name, avatar_url')
						.in('id', accessibleTalentIds)
						.order('last_name', { ascending: true });

	const talentRows = talentsResult.data ?? [];
	const talentIds = talentRows.map((t) => t.id);
	const talentMap = new Map(talentRows.map((t) => [t.id, t]));

	// Get resumes with updated_at for recent resumes
	const resumesResult =
		talentIds.length === 0
			? { data: [], error: null }
			: await adminClient
					.from('resumes')
					.select('id, talent_id, version_name, updated_at, created_at')
					.in('talent_id', talentIds)
					.order('updated_at', { ascending: false, nullsFirst: false })
					.limit(5);

	const resumeRows = resumesResult.data ?? [];

	// Get total resumes count
	const resumeCountResult =
		talentIds.length === 0
			? { count: 0, error: null }
			: await adminClient
					.from('resumes')
					.select('id', { count: 'exact', head: true })
					.in('talent_id', talentIds);

	const totalResumes = resumeCountResult.count ?? 0;

	// Get availability data
	const availabilityResult =
		talentIds.length === 0
			? { data: [], error: null }
			: await adminClient
					.from('profile_availability')
					.select(PROFILE_AVAILABILITY_SELECT)
					.in('profile_id', talentIds);

	const availabilityByTalent = new Map<string, ReturnType<typeof normalizeAvailabilityRow>>();
	for (const row of availabilityResult.data ?? []) {
		const profileId = (row as { profile_id?: unknown }).profile_id;
		if (typeof profileId !== 'string' || !profileId) continue;
		availabilityByTalent.set(profileId, normalizeAvailabilityRow(row));
	}

	// Count available now (nowPercent > 0)
	let availableNow = 0;
	for (const availability of availabilityByTalent.values()) {
		if (availability.nowPercent && availability.nowPercent > 0) {
			availableNow++;
		}
	}

	// Get organisation data for talents
	const orgMembershipsResult =
		talentIds.length === 0
			? { data: [], error: null }
			: await adminClient
					.from('organisation_talents')
					.select('talent_id, organisation_id')
					.in('talent_id', talentIds);

	const orgIdByTalentId = new Map<string, string>();
	for (const row of orgMembershipsResult.data ?? []) {
		orgIdByTalentId.set(row.talent_id, row.organisation_id);
	}

	const orgIds = Array.from(new Set(orgIdByTalentId.values()));

	const [orgsResult, templatesResult] =
		orgIds.length === 0
			? [
					{ data: [], error: null },
					{ data: [], error: null }
				]
			: await Promise.all([
					adminClient.from('organisations').select('id, name').in('id', orgIds),
					adminClient
						.from('organisation_templates')
						.select('organisation_id, main_logotype_path')
						.in('organisation_id', orgIds)
				]);

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

	// Build recent resumes list
	const recentResumes = resumeRows.map((resume) => {
		const talent = talentMap.get(resume.talent_id);
		return {
			id: resume.id,
			talentId: resume.talent_id,
			versionName: resume.version_name,
			updatedAt: resume.updated_at ?? resume.created_at ?? null,
			talentName: talent
				? [talent.first_name, talent.last_name].filter(Boolean).join(' ') || 'Unnamed'
				: 'Unknown',
			talentAvatarUrl: talent?.avatar_url ?? null
		};
	});

	// Find consultants available within 30 days
	const now = new Date();
	const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
	const thirtyDaysIso = thirtyDaysFromNow.toISOString().slice(0, 10);

	const availableSoon: Array<{
		id: string;
		name: string;
		avatarUrl: string | null;
		availability: ReturnType<typeof normalizeAvailabilityRow>;
		organisationName: string | null;
		organisationLogoUrl: string | null;
	}> = [];

	for (const talent of talentRows) {
		const availability = availabilityByTalent.get(talent.id);
		if (!availability?.hasData) continue;

		// Skip if already available now with significant capacity
		if (availability.nowPercent && availability.nowPercent >= 50) continue;

		// Check if becoming available within 30 days
		const switchDate = availability.switchFromDate;
		const plannedDate = availability.plannedFromDate;
		const relevantDate = switchDate ?? plannedDate;

		if (relevantDate && relevantDate <= thirtyDaysIso) {
			const futurePercent = availability.futurePercent ?? 100;
			if (futurePercent > 0) {
				const orgId = orgIdByTalentId.get(talent.id);
				const org = orgId ? orgById.get(orgId) : null;

				availableSoon.push({
					id: talent.id,
					name: [talent.first_name, talent.last_name].filter(Boolean).join(' ') || 'Unnamed',
					avatarUrl: talent.avatar_url,
					availability,
					organisationName: org?.name ?? null,
					organisationLogoUrl: org?.logoUrl ?? null
				});
			}
		}
	}

	// Sort by date
	availableSoon.sort((a, b) => {
		const dateA = a.availability.switchFromDate ?? a.availability.plannedFromDate ?? '';
		const dateB = b.availability.switchFromDate ?? b.availability.plannedFromDate ?? '';
		return dateA.localeCompare(dateB);
	});

	return {
		stats: {
			totalTalents: talentRows.length,
			totalResumes,
			availableNow
		},
		recentResumes: recentResumes.slice(0, 5),
		availableSoon: availableSoon.slice(0, 5)
	};
};
