import type { PageServerLoad } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { siteMeta } from '$lib/seo';
import {
	PROFILE_AVAILABILITY_SELECT,
	normalizeAvailabilityRow
} from '$lib/server/consultantAvailability';
import { getAccessibleTalentIds } from '$lib/server/access';
import type { ResumesTalentListItem } from '$lib/types/resumes';

const ORGANISATION_IMAGES_BUCKET = 'organisation-images';

const resolveStoragePublicUrl = (adminClient: SupabaseClient, value: string | null | undefined) => {
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

const emptyResult = {
	talents: [] as ResumesTalentListItem[],
	organisationOptions: [] as Array<{ id: string; name: string }>,
	homeOrganisationId: null as string | null,
	meta: null as {
		title: string;
		description: string;
		noindex: true;
		path: '/resumes';
	} | null
};

export const load: PageServerLoad = async ({ locals }) => {
	const requestContext = locals.requestContext;
	const supabase = requestContext.getSupabaseClient();
	const adminClient = requestContext.getAdminClient();

	if (!supabase || !adminClient) {
		return emptyResult;
	}

	const actor = await requestContext.getActorContext();
	if (!actor.userId) {
		return emptyResult;
	}

	const accessibleTalentIds = await getAccessibleTalentIds(adminClient, actor);

	const talentsResult =
		accessibleTalentIds === null
			? await adminClient
					.from('talents')
					.select('id, first_name, last_name, avatar_url')
					.order('last_name', { ascending: true })
					.order('first_name', { ascending: true })
			: accessibleTalentIds.length === 0
				? {
						data: [] as Array<{
							id: string;
							first_name: string | null;
							last_name: string | null;
							avatar_url: string | null;
						}>,
						error: null
					}
				: await adminClient
						.from('talents')
						.select('id, first_name, last_name, avatar_url')
						.in('id', accessibleTalentIds)
						.order('last_name', { ascending: true })
						.order('first_name', { ascending: true });

	if (talentsResult.error) {
		console.warn('[resumes index] talents error', talentsResult.error);
	}

	const talentRows =
		(talentsResult.data as Array<{
			id: string;
			first_name: string | null;
			last_name: string | null;
			avatar_url: string | null;
		}> | null) ?? [];
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
		if (!existing) continue;
		existing.logoUrl = resolveStoragePublicUrl(adminClient, template.main_logotype_path);
	}

	const talents: ResumesTalentListItem[] = talentRows.map((talent) => {
		const orgId = orgIdByTalentId.get(talent.id) ?? null;
		const org = orgId ? orgById.get(orgId) : null;
		return {
			id: talent.id,
			first_name: talent.first_name ?? '',
			last_name: talent.last_name ?? '',
			avatar_url: talent.avatar_url ?? null,
			availability: availabilityByTalentId.get(talent.id) ?? normalizeAvailabilityRow(null),
			organisation_id: orgId,
			organisation_name: org?.name ?? null,
			organisation_logo_url: org?.logoUrl ?? null
		};
	});

	const accessibleOrgRowsResult = actor.isAdmin
		? await adminClient.from('organisations').select('id, name').order('name', { ascending: true })
		: actor.accessibleOrganisationIds.length === 0
			? { data: [] as Array<{ id: string; name: string }>, error: null }
			: await adminClient
					.from('organisations')
					.select('id, name')
					.in('id', actor.accessibleOrganisationIds)
					.order('name', { ascending: true });

	if (accessibleOrgRowsResult.error) {
		console.warn('[resumes index] accessible organisations error', accessibleOrgRowsResult.error);
	}

	const organisationOptions = (accessibleOrgRowsResult.data ?? []).map((org) => ({
		id: org.id,
		name: org.name
	}));

	return {
		talents,
		organisationOptions,
		homeOrganisationId: actor.homeOrganisationId ?? null,
		meta: {
			title: `${siteMeta.name} — Resumes`,
			description: 'Manage consultant resumes and export packages.',
			noindex: true,
			path: '/resumes'
		}
	};
};
