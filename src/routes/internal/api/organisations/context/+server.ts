import { createHash } from 'node:crypto';
import { json, type RequestHandler } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeRolesFromJoinRows } from '$lib/server/access';

const CACHE_TTL_MS = 60_000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORGANISATION_IMAGES_BUCKET = 'organisation-images';

type Role = 'admin' | 'broker' | 'talent' | 'employer';

type OrganisationContextResponse = {
	organisation: {
		id: string;
		name: string;
		slug: string;
		homepage_url: string | null;
		brand_settings: Record<string, unknown> | null;
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
	accessGrants: Array<{
		id: string;
		grantee_user_id: string;
		created_at: string | null;
		created_by_user_id: string | null;
	}>;
	dataSharingPermissions: Array<{
		id: string;
		source_organisation_id: string;
		target_organisation_id: string;
		sharing_scope: 'view' | 'export_org_template' | 'export_broker_template';
		approved_by_admin_id: string;
		approved_at: string | null;
	}>;
	organisations: Array<{ id: string; name: string }>;
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
	userHomeOrgNames: Record<string, string>;
	generatedAt: string;
};

type ContextCacheEntry = {
	expiresAt: number;
	etag: string;
	payload: OrganisationContextResponse;
};

const contextCache = new Map<string, ContextCacheEntry>();

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

export const GET: RequestHandler = async ({ url, request, locals }) => {
	const orgId = url.searchParams.get('org')?.trim() ?? '';
	if (!UUID_REGEX.test(orgId)) {
		return json({ message: 'Invalid organisation id.' }, { status: 400 });
	}

	const requestContext = locals.requestContext;
	const adminClient = requestContext.getAdminClient();
	const actor = await requestContext.getActorContext();
	if (!adminClient || !actor.userId) {
		return json({ message: 'Unauthorized.' }, { status: 401 });
	}
	if (!actor.isAdmin) {
		return json({ message: 'Forbidden.' }, { status: 403 });
	}

	const cacheKey = `${actor.userId}:${orgId}`;
	const now = Date.now();
	const cached = contextCache.get(cacheKey);
	let entry = cached && cached.expiresAt > now ? cached : null;

	try {
		if (!entry) {
			const [
				organisationResult,
				templateResult,
				membershipsUsersResult,
				membershipsTalentsResult,
				accessGrantsResult,
				dataSharingPermissionsResult,
				organisationsResult,
				usersResult,
				userRolesResult,
				talentsResult,
				allUserMembershipsResult,
				allTalentMembershipsResult
			] = await Promise.all([
				adminClient
					.from('organisations')
					.select('id, name, slug, homepage_url, brand_settings')
					.eq('id', orgId)
					.maybeSingle(),
				adminClient
					.from('organisation_templates')
					.select(
						'id, organisation_id, template_key, template_json, template_version, main_logotype_path, accent_logo_path, end_logo_path'
					)
					.eq('organisation_id', orgId)
					.maybeSingle(),
				adminClient.from('organisation_users').select('user_id').eq('organisation_id', orgId),
				adminClient.from('organisation_talents').select('talent_id').eq('organisation_id', orgId),
				adminClient
					.from('organisation_access_grants')
					.select('id, grantee_user_id, created_at, created_by_user_id')
					.eq('organisation_id', orgId),
				adminClient
					.from('data_sharing_permissions')
					.select(
						'id, source_organisation_id, target_organisation_id, sharing_scope, approved_by_admin_id, approved_at'
					)
					.eq('source_organisation_id', orgId),
				adminClient.from('organisations').select('id, name').order('name', { ascending: true }),
				adminClient
					.from('user_profiles')
					.select('user_id, first_name, last_name, email')
					.order('last_name', { ascending: true })
					.order('first_name', { ascending: true }),
				adminClient.from('user_roles').select('user_id, roles(key)'),
				adminClient
					.from('talents')
					.select('id, user_id, first_name, last_name')
					.order('last_name', { ascending: true })
					.order('first_name', { ascending: true }),
				adminClient.from('organisation_users').select('user_id, organisation_id'),
				adminClient.from('organisation_talents').select('talent_id, organisation_id')
			]);

			if (organisationResult.error) throw new Error(organisationResult.error.message);
			if (!organisationResult.data) {
				return json({ message: 'Organisation not found.' }, { status: 404 });
			}
			if (templateResult.error) throw new Error(templateResult.error.message);
			if (membershipsUsersResult.error) throw new Error(membershipsUsersResult.error.message);
			if (membershipsTalentsResult.error) throw new Error(membershipsTalentsResult.error.message);
			if (accessGrantsResult.error) throw new Error(accessGrantsResult.error.message);
			if (dataSharingPermissionsResult.error)
				throw new Error(dataSharingPermissionsResult.error.message);
			if (organisationsResult.error) throw new Error(organisationsResult.error.message);
			if (usersResult.error) throw new Error(usersResult.error.message);
			if (userRolesResult.error) throw new Error(userRolesResult.error.message);
			if (talentsResult.error) throw new Error(talentsResult.error.message);
			if (allUserMembershipsResult.error) throw new Error(allUserMembershipsResult.error.message);
			if (allTalentMembershipsResult.error)
				throw new Error(allTalentMembershipsResult.error.message);

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
			const organisationNameById = new Map(
				(organisationsResult.data ?? []).map((org) => [org.id, org.name] as const)
			);
			const userHomeOrgNames = Object.fromEntries(
				(allUserMembershipsResult.data ?? [])
					.map((row) => {
						const orgName = organisationNameById.get(row.organisation_id);
						if (!orgName) return null;
						return [row.user_id, orgName] as const;
					})
					.filter((entry): entry is readonly [string, string] => entry !== null)
			);

			const template = templateResult.data
				? {
						id: templateResult.data.id,
						organisation_id: templateResult.data.organisation_id,
						template_key: templateResult.data.template_key ?? 'default',
						template_json:
							templateResult.data.template_json &&
							typeof templateResult.data.template_json === 'object' &&
							!Array.isArray(templateResult.data.template_json)
								? (templateResult.data.template_json as Record<string, unknown>)
								: null,
						template_version: templateResult.data.template_version ?? 1,
						main_logotype_url: resolveStoragePublicUrl(
							adminClient,
							templateResult.data.main_logotype_path
						),
						accent_logo_url: resolveStoragePublicUrl(
							adminClient,
							templateResult.data.accent_logo_path
						),
						end_logo_url: resolveStoragePublicUrl(adminClient, templateResult.data.end_logo_path)
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
							: null
				},
				template,
				membershipsUsers: (membershipsUsersResult.data ?? []).map((row) => ({
					user_id: row.user_id
				})),
				membershipsTalents: (membershipsTalentsResult.data ?? []).map((row) => ({
					talent_id: row.talent_id
				})),
				accessGrants: (accessGrantsResult.data ?? []).map((row) => ({
					id: row.id,
					grantee_user_id: row.grantee_user_id,
					created_at: row.created_at ?? null,
					created_by_user_id: row.created_by_user_id ?? null
				})),
				dataSharingPermissions: (dataSharingPermissionsResult.data ?? []).map((row) => ({
					id: row.id,
					source_organisation_id: row.source_organisation_id,
					target_organisation_id: row.target_organisation_id,
					sharing_scope: row.sharing_scope,
					approved_by_admin_id: row.approved_by_admin_id,
					approved_at: row.approved_at ?? null
				})),
				organisations: (organisationsResult.data ?? []).map((org) => ({
					id: org.id,
					name: org.name
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
				userHomeOrgNames,
				generatedAt: new Date().toISOString()
			};

			const etag = `"${createHash('sha1').update(JSON.stringify(payload)).digest('hex')}"`;
			entry = {
				expiresAt: now + CACHE_TTL_MS,
				etag,
				payload
			};
			contextCache.set(cacheKey, entry);
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
