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
const RESUMES_INDEX_CACHE_TTL_MS = 60_000;

type OrganisationOption = { id: string; name: string };
type ResumesIndexCachePayload = {
	talents: ResumesTalentListItem[];
	organisationOptions: OrganisationOption[];
	homeOrganisationId: string | null;
};

type ResumesIndexCacheEntry = {
	expiresAt: number;
	payload: ResumesIndexCachePayload;
};

const resumesIndexCache = new Map<string, ResumesIndexCacheEntry>();

const buildActorScopeCacheKey = (actor: {
	userId: string;
	isAdmin: boolean;
	roles: string[];
	homeOrganisationId: string | null;
	accessibleOrganisationIds: string[];
	talentId: string | null;
}) => {
	const scope = actor.isAdmin
		? 'admin'
		: [
				`roles:${actor.roles.join(',')}`,
				`home:${actor.homeOrganisationId ?? ''}`,
				`talent:${actor.talentId ?? ''}`,
				`orgs:${[...actor.accessibleOrganisationIds].sort().join(',')}`
			].join('|');

	return `${actor.userId}:${scope}`;
};

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
	organisationOptions: [] as OrganisationOption[],
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
	const cacheKey = buildActorScopeCacheKey({
		userId: actor.userId,
		isAdmin: actor.isAdmin,
		roles: actor.roles,
		homeOrganisationId: actor.homeOrganisationId,
		accessibleOrganisationIds: actor.accessibleOrganisationIds,
		talentId: actor.talentId
	});
	const now = Date.now();
	const cached = resumesIndexCache.get(cacheKey);
	if (cached && cached.expiresAt > now) {
		return {
			...cached.payload,
			meta: {
				title: `${siteMeta.name} — Resumes`,
				description: 'Manage consultant resumes and export packages.',
				noindex: true,
				path: '/resumes'
			}
		};
	}
	if (cached) {
		resumesIndexCache.delete(cacheKey);
	}

	const accessibleOrgRowsPromise = actor.isAdmin
		? adminClient.from('organisations').select('id, name').order('name', { ascending: true })
		: actor.accessibleOrganisationIds.length === 0
			? Promise.resolve({ data: [] as OrganisationOption[], error: null })
			: adminClient
					.from('organisations')
					.select('id, name')
					.in('id', actor.accessibleOrganisationIds)
					.order('name', { ascending: true });

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

	const [availabilityResult, orgMembershipsResult] =
		talentIds.length === 0
			? [
					{
						data: [] as Array<{
							profile_id: string;
						}>,
						error: null
					},
					{ data: [] as Array<{ talent_id: string; organisation_id: string }>, error: null }
				]
			: await Promise.all([
					adminClient
						.from('profile_availability')
						.select(PROFILE_AVAILABILITY_SELECT)
						.in('profile_id', talentIds),
					adminClient
						.from('organisation_talents')
						.select('talent_id, organisation_id')
						.in('talent_id', talentIds)
				]);

	if (availabilityResult.error) {
		console.warn('[resumes index] profile_availability error', availabilityResult.error);
	}

	if (orgMembershipsResult.error) {
		console.warn('[resumes index] organisation_talents error', orgMembershipsResult.error);
	}

	const availabilityByTalentId = new Map<string, ReturnType<typeof normalizeAvailabilityRow>>();
	for (const row of availabilityResult.data ?? []) {
		const profileId = (row as { profile_id?: unknown }).profile_id;
		if (typeof profileId !== 'string' || profileId.length === 0) continue;
		availabilityByTalentId.set(profileId, normalizeAvailabilityRow(row));
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

	const accessibleOrgRowsResult = await accessibleOrgRowsPromise;

	if (accessibleOrgRowsResult.error) {
		console.warn('[resumes index] accessible organisations error', accessibleOrgRowsResult.error);
	}

	const organisationOptions = (accessibleOrgRowsResult.data ?? []).map((org) => ({
		id: org.id,
		name: org.name
	}));
	const payload: ResumesIndexCachePayload = {
		talents,
		organisationOptions,
		homeOrganisationId: actor.homeOrganisationId ?? null
	};
	resumesIndexCache.set(cacheKey, {
		expiresAt: now + RESUMES_INDEX_CACHE_TTL_MS,
		payload
	});

	return {
		...payload,
		meta: {
			title: `${siteMeta.name} — Resumes`,
			description: 'Manage consultant resumes and export packages.',
			noindex: true,
			path: '/resumes'
		}
	};
};
