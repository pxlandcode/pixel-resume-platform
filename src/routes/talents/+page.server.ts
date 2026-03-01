import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { siteMeta } from '$lib/seo';
import { getActorAccessContext, getAccessibleTalentIds } from '$lib/server/access';

const canManageTalents = (actor: Awaited<ReturnType<typeof getActorAccessContext>>) =>
	actor.isAdmin || actor.isBroker || actor.isEmployer;

const getActorContext = async (cookies: { get(name: string): string | undefined }) => {
	const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
	const adminClient = getSupabaseAdminClient();
	const actor = await getActorAccessContext(supabase, adminClient);
	return { supabase, adminClient, actor };
};

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
	const { supabase, adminClient, actor } = await getActorContext(cookies);

	if (!supabase || !adminClient || !actor.userId) {
		return {
			talents: [],
			organisationOptions: [],
			homeOrganisationId: null,
			canManageTalents: false,
			meta: null
		};
	}

	const accessibleTalentIds = await getAccessibleTalentIds(adminClient, actor);

	const [talentsResult, authUsersResult] = await Promise.all([
		accessibleTalentIds === null
			? adminClient
					.from('talents')
					.select('id, user_id, first_name, last_name, avatar_url, title')
					.order('last_name', { ascending: true })
					.order('first_name', { ascending: true })
			: accessibleTalentIds.length === 0
				? Promise.resolve({
						data: [] as Array<{
							id: string;
							user_id: string | null;
							first_name: string | null;
							last_name: string | null;
							avatar_url: string | null;
							title: string | null;
						}>,
						error: null
					})
				: adminClient
						.from('talents')
						.select('id, user_id, first_name, last_name, avatar_url, title')
						.in('id', accessibleTalentIds)
						.order('last_name', { ascending: true })
						.order('first_name', { ascending: true }),
		adminClient.auth.admin.listUsers()
	]);

	if (talentsResult.error) {
		console.warn('[talents index] talents error', talentsResult.error);
	}

	const talentRows = talentsResult.data ?? [];
	const talentIds = talentRows.map((t) => t.id);

	// Fetch organisation memberships for talents
	const orgMembershipsResult =
		talentIds.length === 0
			? { data: [] as Array<{ talent_id: string; organisation_id: string }>, error: null }
			: await adminClient
					.from('organisation_talents')
					.select('talent_id, organisation_id')
					.in('talent_id', talentIds);

	if (orgMembershipsResult.error) {
		console.warn('[talents index] organisation_talents error', orgMembershipsResult.error);
	}

	const orgIdByTalentId = new Map<string, string>();
	for (const row of orgMembershipsResult.data ?? []) {
		orgIdByTalentId.set(row.talent_id, row.organisation_id);
	}

	const orgIds = Array.from(new Set(orgIdByTalentId.values()));

	// Fetch organisations and templates
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
		console.warn('[talents index] organisations error', orgsResult.error);
	}
	if (templatesResult.error) {
		console.warn('[talents index] organisation_templates error', templatesResult.error);
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

	const authUsers = authUsersResult.data?.users ?? [];
	const emailByUserId = new Map(authUsers.map((user) => [user.id, user.email ?? null]));

	const talents = talentRows.map((talent) => {
		const orgId = orgIdByTalentId.get(talent.id);
		const org = orgId ? orgById.get(orgId) : undefined;
		return {
			id: talent.id,
			user_id: talent.user_id,
			first_name: talent.first_name ?? '',
			last_name: talent.last_name ?? '',
			avatar_url: talent.avatar_url ?? null,
			title: talent.title ?? '',
			email: talent.user_id ? (emailByUserId.get(talent.user_id) ?? null) : null,
			organisation_id: orgId ?? null,
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
		console.warn('[talents index] accessible organisations error', accessibleOrgRowsResult.error);
	}

	const organisationOptions = (accessibleOrgRowsResult.data ?? []).map((org) => ({
		id: org.id,
		name: org.name
	}));

	return {
		talents,
		organisationOptions,
		homeOrganisationId: actor.homeOrganisationId ?? null,
		canManageTalents: canManageTalents(actor),
		meta: {
			title: `${siteMeta.name} — Talents`,
			description: 'Browse and manage talents.',
			noindex: true,
			path: '/talents'
		}
	};
};

export const actions: Actions = {
	createTalent: async ({ request, cookies }) => {
		const { adminClient, actor } = await getActorContext(cookies);
		if (!adminClient || !actor.userId) {
			return fail(401, { type: 'createTalent', ok: false, message: 'You are not authenticated.' });
		}
		if (!canManageTalents(actor)) {
			return fail(403, {
				type: 'createTalent',
				ok: false,
				message: 'Not authorized to manage talents.'
			});
		}

		if ((actor.isBroker || actor.isEmployer) && !actor.homeOrganisationId) {
			return fail(400, {
				type: 'createTalent',
				ok: false,
				message: 'Connect your account to a home organisation before creating talents.'
			});
		}

		const formData = await request.formData();
		const firstNameRaw = formData.get('first_name');
		const lastNameRaw = formData.get('last_name');
		const titleRaw = formData.get('title');
		const avatarRaw = formData.get('avatar_url');

		const first_name = typeof firstNameRaw === 'string' ? firstNameRaw.trim() : '';
		const last_name = typeof lastNameRaw === 'string' ? lastNameRaw.trim() : '';
		const title = typeof titleRaw === 'string' ? titleRaw.trim() : '';
		const avatar_url =
			typeof avatarRaw === 'string' && avatarRaw.trim().length > 0 ? avatarRaw.trim() : null;

		if (!first_name && !last_name) {
			return fail(400, {
				type: 'createTalent',
				ok: false,
				message: 'Provide at least first name or last name.'
			});
		}

		const { data: insertedTalent, error: insertError } = await adminClient
			.from('talents')
			.insert({
				user_id: null,
				first_name,
				last_name,
				title,
				bio: '',
				avatar_url
			})
			.select('id')
			.single();

		if (insertError || !insertedTalent?.id) {
			return fail(500, { type: 'createTalent', ok: false, message: insertError?.message });
		}

		if ((actor.isBroker || actor.isEmployer) && actor.homeOrganisationId) {
			const { error: membershipError } = await adminClient.from('organisation_talents').insert({
				organisation_id: actor.homeOrganisationId,
				talent_id: insertedTalent.id
			});

			if (membershipError) {
				await adminClient.from('talents').delete().eq('id', insertedTalent.id);
				return fail(500, {
					type: 'createTalent',
					ok: false,
					message: 'Talent creation was rolled back because home organisation linking failed.'
				});
			}
		}

		return {
			type: 'createTalent',
			ok: true,
			message: 'Talent created successfully.'
		};
	}
};
