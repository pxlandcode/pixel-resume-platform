import { createHash } from 'node:crypto';
import { json, type RequestHandler } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	PROFILE_AVAILABILITY_SELECT,
	normalizeAvailabilityRow
} from '$lib/server/consultantAvailability';
import { getEarliestAvailabilityDate } from '$lib/utils/availability';
import { getAccessibleTalentIds } from '$lib/server/access';

const CACHE_TTL_MS = 60_000;
const ORGANISATION_IMAGES_BUCKET = 'organisation-images';

type AvailableTalent = {
	id: string;
	name: string;
	avatarUrl: string | null;
	availability: ReturnType<typeof normalizeAvailabilityRow>;
	organisationName: string | null;
	organisationLogoUrl: string | null;
};

type DashboardPanelsResponse = {
	recentResumes: Array<{
		id: string;
		talentId: string;
		versionName: string | null;
		updatedAt: string | null;
		talentName: string;
		talentAvatarUrl: string | null;
	}>;
	availableNow: AvailableTalent[];
	availableSoon: AvailableTalent[];
	generatedAt: string;
};

type DashboardPanelsCacheEntry = {
	expiresAt: number;
	etag: string;
	payload: DashboardPanelsResponse;
};

const panelsCache = new Map<string, DashboardPanelsCacheEntry>();

const buildCacheHeaders = (etag: string) => ({
	'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
	ETag: etag,
	Vary: 'Cookie'
});

const hasMatchingIfNoneMatch = (rawHeader: string | null, etag: string) => {
	if (!rawHeader) return false;
	if (rawHeader.trim() === '*') return true;
	return rawHeader
		.split(',')
		.map((value) => value.trim())
		.some((candidate) => candidate === etag);
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

export const GET: RequestHandler = async ({ locals, request }) => {
	const requestContext = locals.requestContext;
	const adminClient = requestContext.getAdminClient();
	const actor = await requestContext.getActorContext();

	if (!adminClient || !actor.userId) {
		return json({ message: 'Unauthorized.' }, { status: 401 });
	}

	const cacheKey = actor.userId;
	const now = Date.now();
	const cached = panelsCache.get(cacheKey);
	let entry = cached && cached.expiresAt > now ? cached : null;

	try {
		if (!entry) {
			const accessibleTalentIds = await getAccessibleTalentIds(adminClient, actor);

			const talentsResult =
				accessibleTalentIds === null
					? await adminClient
							.from('talents')
							.select('id, first_name, last_name, avatar_url')
							.order('last_name', { ascending: true })
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
								.order('last_name', { ascending: true });

			if (talentsResult.error) {
				throw new Error(talentsResult.error.message);
			}

			const talentRows = talentsResult.data ?? [];
			const talentIds = talentRows.map((talent) => talent.id);
			const talentById = new Map(talentRows.map((talent) => [talent.id, talent]));

			const [resumesResult, availabilityResult, orgMembershipsResult] = await Promise.all([
				talentIds.length === 0
					? {
							data: [] as Array<{
								id: string;
								talent_id: string;
								version_name: string | null;
								updated_at: string | null;
								created_at: string | null;
							}>,
							error: null
						}
					: adminClient
							.from('resumes')
							.select('id, talent_id, version_name, updated_at, created_at')
							.in('talent_id', talentIds)
							.order('updated_at', { ascending: false, nullsFirst: false })
							.limit(5),
				talentIds.length === 0
					? { data: [] as Array<unknown>, error: null }
					: adminClient
							.from('profile_availability')
							.select(PROFILE_AVAILABILITY_SELECT)
							.in('profile_id', talentIds),
				talentIds.length === 0
					? {
							data: [] as Array<{ talent_id: string; organisation_id: string }>,
							error: null
						}
					: adminClient
							.from('organisation_talents')
							.select('talent_id, organisation_id')
							.in('talent_id', talentIds)
			]);

			if (resumesResult.error) throw new Error(resumesResult.error.message);
			if (availabilityResult.error) throw new Error(availabilityResult.error.message);
			if (orgMembershipsResult.error) throw new Error(orgMembershipsResult.error.message);

			const availabilityByTalentId = new Map<string, ReturnType<typeof normalizeAvailabilityRow>>();
			for (const row of availabilityResult.data ?? []) {
				const profileId = (row as { profile_id?: unknown }).profile_id;
				if (typeof profileId !== 'string' || profileId.length === 0) continue;
				availabilityByTalentId.set(profileId, normalizeAvailabilityRow(row));
			}

			const orgIdByTalentId = new Map<string, string>();
			for (const membership of orgMembershipsResult.data ?? []) {
				orgIdByTalentId.set(membership.talent_id, membership.organisation_id);
			}

			const orgIds = Array.from(new Set(orgIdByTalentId.values()));
			const [orgsResult, templatesResult] =
				orgIds.length === 0
					? [
							{ data: [] as Array<{ id: string; name: string }>, error: null },
							{
								data: [] as Array<{
									organisation_id: string;
									main_logotype_path: string | null;
								}>,
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

			if (orgsResult.error) throw new Error(orgsResult.error.message);
			if (templatesResult.error) throw new Error(templatesResult.error.message);

			const orgById = new Map<string, { name: string; logoUrl: string | null }>();
			for (const org of orgsResult.data ?? []) {
				orgById.set(org.id, { name: org.name, logoUrl: null });
			}
			for (const template of templatesResult.data ?? []) {
				const existing = orgById.get(template.organisation_id);
				if (!existing) continue;
				existing.logoUrl = resolveStoragePublicUrl(adminClient, template.main_logotype_path);
			}

			const recentResumes = (resumesResult.data ?? []).map((resume) => {
				const talent = talentById.get(resume.talent_id);
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

			const nowUtc = new Date();
			const thirtyDaysFromNow = new Date(nowUtc.getTime() + 30 * 24 * 60 * 60 * 1000);
			const thirtyDaysIso = thirtyDaysFromNow.toISOString().slice(0, 10);
			const availableNow: AvailableTalent[] = [];
			const availableSoon: AvailableTalent[] = [];

			for (const talent of talentRows) {
				const availability = availabilityByTalentId.get(talent.id);
				if (!availability?.hasData) continue;

				const orgId = orgIdByTalentId.get(talent.id);
				const org = orgId ? orgById.get(orgId) : null;
				const entry: AvailableTalent = {
					id: talent.id,
					name: [talent.first_name, talent.last_name].filter(Boolean).join(' ') || 'Unnamed',
					avatarUrl: talent.avatar_url ?? null,
					availability,
					organisationName: org?.name ?? null,
					organisationLogoUrl: org?.logoUrl ?? null
				};

				if (availability.nowPercent && availability.nowPercent >= 50) {
					availableNow.push(entry);
					continue;
				}

				const relevantDate = getEarliestAvailabilityDate(availability);
				if (!relevantDate || relevantDate > thirtyDaysIso) continue;

				const futurePercent = availability.futurePercent ?? 100;
				if (futurePercent <= 0) continue;

				availableSoon.push(entry);
			}

			availableNow.sort((left, right) => {
				const leftPct = left.availability.nowPercent ?? 0;
				const rightPct = right.availability.nowPercent ?? 0;
				return rightPct - leftPct;
			});

			availableSoon.sort((left, right) => {
				const leftDate = getEarliestAvailabilityDate(left.availability) ?? '';
				const rightDate = getEarliestAvailabilityDate(right.availability) ?? '';
				return leftDate.localeCompare(rightDate);
			});

			const payload: DashboardPanelsResponse = {
				recentResumes: recentResumes.slice(0, 5),
				availableNow: availableNow.slice(0, 5),
				availableSoon: availableSoon.slice(0, 5),
				generatedAt: new Date().toISOString()
			};

			const etag = `"${createHash('sha1').update(JSON.stringify(payload)).digest('hex')}"`;
			entry = {
				expiresAt: now + CACHE_TTL_MS,
				etag,
				payload
			};
			panelsCache.set(cacheKey, entry);
		}
	} catch (error) {
		console.error('[dashboard panels] failed to build payload', error);
		return json({ message: 'Could not load dashboard panels.' }, { status: 500 });
	}

	if (!entry) {
		return json({ message: 'Could not load dashboard panels.' }, { status: 500 });
	}

	const ifNoneMatch = request.headers.get('if-none-match');
	if (hasMatchingIfNoneMatch(ifNoneMatch, entry.etag)) {
		return new Response(null, {
			status: 304,
			headers: buildCacheHeaders(entry.etag)
		});
	}

	return json(entry.payload, {
		headers: buildCacheHeaders(entry.etag)
	});
};
