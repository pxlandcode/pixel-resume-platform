import { createHash } from 'node:crypto';
import { json, type RequestHandler } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	getCachedOrganisationContext,
	setCachedOrganisationContext
} from '$lib/server/organisationContextCache';
import { normalizeRolesFromJoinRows } from '$lib/server/access';
import { loadOrganisationEmailDomains } from '$lib/server/organisationEmailDomains';
import { listOrganisationTalentLabelDefinitions } from '$lib/server/talentLabels';
import type { TalentLabelDefinition } from '$lib/types/talentLabels';

const CACHE_TTL_MS = 60_000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORGANISATION_IMAGES_BUCKET = 'organisation-images';
const TEMPLATE_BASE_SELECT =
	'id, organisation_id, template_key, template_json, template_version, main_logotype_path, accent_logo_path, end_logo_path';

type Role = 'admin' | 'organisation_admin' | 'broker' | 'talent' | 'employer';

type OrganisationContextResponse = {
	organisation: {
		id: string;
		name: string;
		slug: string;
		homepage_url: string | null;
		brand_settings: Record<string, unknown> | null;
		email_domains: string[];
	};
	template: {
		id: string;
		organisation_id: string;
		template_key: string;
		template_json: Record<string, unknown> | null;
		template_version: number;
		main_logotype_url: string | null;
		accent_logo_url: string | null;
		end_logo_url: string | null;
	} | null;
	membershipsUsers: Array<{ user_id: string }>;
	membershipsTalents: Array<{ talent_id: string }>;
	users: Array<{
		user_id: string;
		first_name: string;
		last_name: string;
		email: string | null;
		roles: Role[];
	}>;
	talents: Array<{
		id: string;
		user_id: string | null;
		first_name: string;
		last_name: string;
	}>;
	usersWithHomeOrgIds: string[];
	talentsWithHomeOrgIds: string[];
	talentLabelDefinitions: TalentLabelDefinition[];
	membershipContextLoaded: boolean;
	generatedAt: string;
};

type OrganisationTemplateContextRow = {
	id: string;
	organisation_id: string;
	template_key: string | null;
	template_json: unknown;
	template_version: number | null;
	main_logotype_path: string | null;
	accent_logo_path: string | null;
	end_logo_path: string | null;
};

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

const loadOrganisationTemplate = async (adminClient: SupabaseClient, orgId: string) => {
	return adminClient
		.from('organisation_templates')
		.select(TEMPLATE_BASE_SELECT)
		.eq('organisation_id', orgId)
		.maybeSingle();
};

export const GET: RequestHandler = async ({ url, request, locals }) => {
	const orgId = url.searchParams.get('org')?.trim() ?? '';
	if (!UUID_REGEX.test(orgId)) {
		return json({ message: 'Invalid organisation id.' }, { status: 400 });
	}
	const includeMembershipContext =
		url.searchParams.get('membership') === '1' || url.searchParams.get('scope') === 'membership';

	const requestContext = locals.requestContext;
	const adminClient = requestContext.getAdminClient();
	const actor = await requestContext.getActorContext();
	if (!adminClient || !actor.userId) {
		return json({ message: 'Unauthorized.' }, { status: 401 });
	}
	const canAccessTargetOrganisation =
		actor.isAdmin || (actor.isOrganisationAdmin && actor.homeOrganisationId === orgId);
	if (!canAccessTargetOrganisation) {
		return json({ message: 'Forbidden.' }, { status: 403 });
	}

	const cacheKey = `${actor.userId}:${orgId}:${includeMembershipContext ? 'membership' : 'base'}`;
	const now = Date.now();
	let entry = getCachedOrganisationContext<OrganisationContextResponse>(cacheKey, now);

	try {
		if (!entry) {
			const [
				organisationResult,
				templateResult,
				membershipsUsersResult,
				membershipsTalentsResult,
				usersResult,
				userRolesResult,
				talentsResult,
				allUserMembershipsResult,
				allTalentMembershipsResult,
				talentLabelDefinitions
			] = await Promise.all([
				adminClient
					.from('organisations')
					.select('id, name, slug, homepage_url, brand_settings')
					.eq('id', orgId)
					.maybeSingle(),
				loadOrganisationTemplate(adminClient, orgId),
				includeMembershipContext
					? adminClient.from('organisation_users').select('user_id').eq('organisation_id', orgId)
					: Promise.resolve({ data: [], error: null }),
				includeMembershipContext
					? adminClient
							.from('organisation_talents')
							.select('talent_id')
							.eq('organisation_id', orgId)
					: Promise.resolve({ data: [], error: null }),
				includeMembershipContext
					? adminClient
							.from('user_profiles')
							.select('user_id, first_name, last_name, email')
							.order('last_name', { ascending: true })
							.order('first_name', { ascending: true })
					: Promise.resolve({ data: [], error: null }),
				includeMembershipContext
					? adminClient.from('user_roles').select('user_id, roles(key)')
					: Promise.resolve({ data: [], error: null }),
				includeMembershipContext
					? adminClient
							.from('talents')
							.select('id, user_id, first_name, last_name')
							.order('last_name', { ascending: true })
							.order('first_name', { ascending: true })
					: Promise.resolve({ data: [], error: null }),
				includeMembershipContext
					? adminClient.from('organisation_users').select('user_id, organisation_id')
					: Promise.resolve({ data: [], error: null }),
				includeMembershipContext
					? adminClient.from('organisation_talents').select('talent_id, organisation_id')
					: Promise.resolve({ data: [], error: null }),
				listOrganisationTalentLabelDefinitions(adminClient, orgId)
			]);

			if (organisationResult.error) throw new Error(organisationResult.error.message);
			if (!organisationResult.data) {
				return json({ message: 'Organisation not found.' }, { status: 404 });
			}
			if (templateResult.error) throw new Error(templateResult.error.message);
			if (membershipsUsersResult.error) throw new Error(membershipsUsersResult.error.message);
			if (membershipsTalentsResult.error) throw new Error(membershipsTalentsResult.error.message);
			if (usersResult.error) throw new Error(usersResult.error.message);
			if (userRolesResult.error) throw new Error(userRolesResult.error.message);
			if (talentsResult.error) throw new Error(talentsResult.error.message);
			if (allUserMembershipsResult.error) throw new Error(allUserMembershipsResult.error.message);
			if (allTalentMembershipsResult.error)
				throw new Error(allTalentMembershipsResult.error.message);

			const emailDomainMap = await loadOrganisationEmailDomains(adminClient, [orgId]);
			const emailDomains = emailDomainMap.get(orgId) ?? [];

			const rolesByUserId = new Map<string, Role[]>();
			for (const row of (userRolesResult.data ?? []) as Array<{
				user_id: string;
				roles?: { key?: string | null } | Array<{ key?: string | null }> | null;
			}>) {
				rolesByUserId.set(
					row.user_id,
					normalizeRolesFromJoinRows([{ roles: row.roles }]) as Role[]
				);
			}

			const users = (usersResult.data ?? []).map((row) => ({
				user_id: row.user_id,
				first_name: row.first_name ?? '',
				last_name: row.last_name ?? '',
				email: row.email ?? null,
				roles: rolesByUserId.get(row.user_id) ?? ['talent']
			}));

			const usersWithHomeOrgIds = Array.from(
				new Set((allUserMembershipsResult.data ?? []).map((row) => row.user_id))
			);
			const talentsWithHomeOrgIds = Array.from(
				new Set((allTalentMembershipsResult.data ?? []).map((row) => row.talent_id))
			);

			const templateRow = templateResult.data as OrganisationTemplateContextRow | null;
			const template = templateRow
				? {
						id: templateRow.id,
						organisation_id: templateRow.organisation_id,
						template_key: templateRow.template_key ?? 'default',
						template_json:
							templateRow.template_json &&
							typeof templateRow.template_json === 'object' &&
							!Array.isArray(templateRow.template_json)
								? (templateRow.template_json as Record<string, unknown>)
								: null,
						template_version: templateRow.template_version ?? 1,
						main_logotype_url: resolveStoragePublicUrl(adminClient, templateRow.main_logotype_path),
						accent_logo_url: resolveStoragePublicUrl(adminClient, templateRow.accent_logo_path),
						end_logo_url: resolveStoragePublicUrl(adminClient, templateRow.end_logo_path)
					}
				: null;

			const payload: OrganisationContextResponse = {
				organisation: {
					id: organisationResult.data.id,
					name: organisationResult.data.name,
					slug: organisationResult.data.slug,
					homepage_url: organisationResult.data.homepage_url,
					brand_settings:
						organisationResult.data.brand_settings &&
						typeof organisationResult.data.brand_settings === 'object' &&
						!Array.isArray(organisationResult.data.brand_settings)
							? (organisationResult.data.brand_settings as Record<string, unknown>)
							: null,
					email_domains: emailDomains
				},
				template,
				membershipsUsers: (membershipsUsersResult.data ?? []).map((row) => ({
					user_id: row.user_id
				})),
				membershipsTalents: (membershipsTalentsResult.data ?? []).map((row) => ({
					talent_id: row.talent_id
				})),
				users,
				talents: (talentsResult.data ?? []).map((talent) => ({
					id: talent.id,
					user_id: talent.user_id ?? null,
					first_name: talent.first_name ?? '',
					last_name: talent.last_name ?? ''
				})),
				usersWithHomeOrgIds,
				talentsWithHomeOrgIds,
				talentLabelDefinitions,
				membershipContextLoaded: includeMembershipContext,
				generatedAt: new Date().toISOString()
			};

			const etag = `"${createHash('sha1').update(JSON.stringify(payload)).digest('hex')}"`;
			entry = {
				expiresAt: now + CACHE_TTL_MS,
				etag,
				payload
			};
			setCachedOrganisationContext(cacheKey, entry);
		}
	} catch (error) {
		console.error('[organisations context] failed to build context', error);
		return json({ message: 'Could not load organisation context.' }, { status: 500 });
	}

	if (!entry) {
		return json({ message: 'Could not load organisation context.' }, { status: 500 });
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
