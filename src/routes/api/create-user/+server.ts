import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { getActorAccessContext } from '$lib/server/access';

type Role = 'admin' | 'broker' | 'talent' | 'employer';
const KNOWN_ROLES = new Set<Role>(['admin', 'broker', 'talent', 'employer']);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const randomPassword = (length = 32) =>
	Array.from(crypto.getRandomValues(new Uint8Array(length)))
		.map((n) => (n % 36).toString(36))
		.join('');

const normalizeRoles = (roles: Role[]): Role[] =>
	Array.from(new Set(roles.filter((role) => KNOWN_ROLES.has(role))));

const normalizeOptionalUuid = (value: unknown) => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	return UUID_REGEX.test(trimmed) ? trimmed : '__invalid__';
};

const resolveRoleIds = async (
	admin: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
	roles: Role[]
): Promise<Map<Role, string>> => {
	const uniqueRoles = normalizeRoles(roles);
	const { data, error: rolesError } = await admin
		.from('roles')
		.select('id, key')
		.in('key', uniqueRoles);
	if (rolesError) {
		throw new Error(rolesError.message);
	}

	const roleIdMap = new Map<Role, string>();
	for (const row of data ?? []) {
		if (typeof row.id === 'string' && KNOWN_ROLES.has(row.key as Role)) {
			roleIdMap.set(row.key as Role, row.id);
		}
	}

	for (const role of uniqueRoles) {
		if (!roleIdMap.has(role)) {
			throw new Error(
				`Missing role key '${role}' in public.roles. Run foundation role migrations.`
			);
		}
	}

	return roleIdMap;
};

export const POST: RequestHandler = async ({ request, cookies }) => {
	const accessToken = cookies.get(AUTH_COOKIE_NAMES.access) ?? null;
	const supabase = createSupabaseServerClient(accessToken);
	const admin = getSupabaseAdminClient();
	if (!admin || !supabase) {
		throw error(500, 'Supabase service role client not available');
	}

	const actor = await getActorAccessContext(supabase, admin);
	if (!actor.userId) {
		throw error(401, 'You are not authenticated.');
	}

	if (!actor.isAdmin && !actor.isBroker && !actor.isEmployer) {
		throw error(403, 'Not authorized to create users.');
	}

	if ((actor.isBroker || actor.isEmployer) && !actor.homeOrganisationId) {
		throw error(
			400,
			'You must be connected to a home organisation before creating users.'
		);
	}

	const body = await request.json().catch(() => ({}));
	const email = body.email as string | undefined;
	const password = body.password as string | undefined;
	const first_name = body.first_name as string | undefined;
	const last_name = body.last_name as string | undefined;
	const roles = Array.isArray(body.roles)
		? (body.roles.filter((r: unknown): r is Role => KNOWN_ROLES.has(r as Role)) as Role[])
		: body.role && KNOWN_ROLES.has(body.role as Role)
			? [body.role as Role]
			: [];
	const normalizedRoles: Role[] = roles.length > 0 ? normalizeRoles(roles) : ['talent'];

	if (!actor.isAdmin) {
		const allowedRoles = new Set<Role>([
			'talent',
			...(actor.isBroker ? (['broker'] as const) : []),
			...(actor.isEmployer ? (['employer'] as const) : [])
		]);
		const disallowed = normalizedRoles.filter((role) => !allowedRoles.has(role));
		if (disallowed.length > 0) {
			throw error(
				403,
				`You can only assign roles: ${Array.from(allowedRoles).join(', ')}.`
			);
		}
	}
	const active = body.active !== false && body.active !== 'false';
	const avatar_url_raw = (body.avatar_url as string | undefined) ?? null;
	const avatar_url =
		avatar_url_raw && typeof avatar_url_raw === 'string' && avatar_url_raw.trim().length > 0
			? avatar_url_raw
			: null;
	const linkedTalentId = normalizeOptionalUuid(body.linked_talent_id);
	const requestedOrganisationId = normalizeOptionalUuid(body.organisation_id);

	if (linkedTalentId === '__invalid__') {
		throw error(400, 'Talent selection must be a valid UUID or empty.');
	}
	if (requestedOrganisationId === '__invalid__') {
		throw error(400, 'Organisation selection must be a valid UUID or empty.');
	}
	if (!actor.isAdmin && requestedOrganisationId && requestedOrganisationId !== actor.homeOrganisationId) {
		throw error(403, 'You can only assign users to your own organisation.');
	}

	if (!email) throw error(400, 'Email is required.');
	if (active && !password) throw error(400, 'Password is required for active accounts.');

	const targetOrganisationId = actor.isAdmin
		? requestedOrganisationId
		: actor.homeOrganisationId;

	if (targetOrganisationId) {
		const { data: organisationData, error: organisationLookupError } = await admin
			.from('organisations')
			.select('id')
			.eq('id', targetOrganisationId)
			.maybeSingle();

		if (organisationLookupError || !organisationData) {
			throw error(404, 'Selected organisation was not found.');
		}
	}

	let selectedTalent: { id: string; user_id: string | null; avatar_url: string | null } | null = null;
	if (linkedTalentId) {
		const { data: selectedTalentData, error: selectedTalentError } = await admin
			.from('talents')
			.select('id, user_id, avatar_url')
			.eq('id', linkedTalentId)
			.maybeSingle();

		if (selectedTalentError || !selectedTalentData) {
			throw error(404, 'Selected talent was not found.');
		}

		if (selectedTalentData.user_id) {
			throw error(409, 'Selected talent is already linked to another user.');
		}
		if (!actor.isAdmin) {
			const { data: talentMembershipRows, error: talentMembershipError } = await admin
				.from('organisation_talents')
				.select('organisation_id')
				.eq('talent_id', linkedTalentId);

			if (talentMembershipError) {
				throw error(500, talentMembershipError.message);
			}

			const belongsToHomeOrganisation = (
				(talentMembershipRows as Array<{ organisation_id?: string | null }> | null) ?? []
			).some((row) => row.organisation_id === actor.homeOrganisationId);

			if (!belongsToHomeOrganisation) {
				throw error(403, 'You can only link talents from your own organisation.');
			}
		}

		selectedTalent = selectedTalentData;
	}

	const effectivePassword = active ? password! : randomPassword(48);

	const { data, error: createError } = await admin.auth.admin.createUser({
		email,
		password: effectivePassword,
		email_confirm: true,
		user_metadata: { first_name, last_name },
		app_metadata: { role: normalizedRoles[0], roles: normalizedRoles, active }
	});

	if (createError || !data.user) {
		console.error('[create-user] create error', createError);
		throw error(500, createError?.message ?? 'Failed to create user');
	}

	const userId = data.user.id;
	const firstName = typeof first_name === 'string' ? first_name.trim() : '';
	const lastName = typeof last_name === 'string' ? last_name.trim() : '';
	let syncedAvatar = avatar_url;
	if (
		!syncedAvatar &&
		typeof selectedTalent?.avatar_url === 'string' &&
		selectedTalent.avatar_url.trim().length > 0
	) {
		syncedAvatar = selectedTalent.avatar_url;
	}

	const { error: profileError } = await admin.from('user_profiles').upsert(
		{
			user_id: userId,
			first_name: firstName,
			last_name: lastName,
			email,
			avatar_url: syncedAvatar
		},
		{ onConflict: 'user_id' }
	);

	if (profileError) {
		console.error('[create-user] profile upsert error', profileError);
		throw error(500, 'User created but profile failed to save.');
	}

	const { error: deleteRoleError } = await admin.from('user_roles').delete().eq('user_id', userId);
	if (deleteRoleError) {
		console.error('[create-user] role delete error', deleteRoleError);
		throw error(500, 'User created but role cleanup failed.');
	}

	let roleIdMap: Map<Role, string>;
	try {
		roleIdMap = await resolveRoleIds(admin, normalizedRoles);
	} catch (roleLookupError) {
		console.error('[create-user] role id lookup error', roleLookupError);
		throw error(500, 'User created but role lookup failed.');
	}

	const roleAssignments = normalizedRoles.map((role) => {
		const roleId = roleIdMap.get(role);
		if (!roleId) {
			throw error(500, `User created but role '${role}' could not be resolved to an ID.`);
		}
		return { user_id: userId, role_id: roleId };
	});

	const { error: insertRoleError } = await admin.from('user_roles').insert(roleAssignments);
	if (insertRoleError) {
		console.error('[create-user] role insert error', insertRoleError);
		throw error(500, 'User created but role assignment failed.');
	}

	if (targetOrganisationId) {
		const { error: membershipError } = await admin.from('organisation_users').insert({
			organisation_id: targetOrganisationId,
			user_id: userId
		});

		if (membershipError) {
			console.error('[create-user] organisation membership insert error', membershipError);
			await admin.auth.admin.deleteUser(userId);
			throw error(
				500,
				'User creation was rolled back because organisation linking failed.'
			);
		}
	}

	if (linkedTalentId) {
		const { error: linkTalentError } = await admin
			.from('talents')
			.update({ user_id: userId, avatar_url: syncedAvatar })
			.eq('id', linkedTalentId);

		if (linkTalentError) {
			console.error('[create-user] talent link error', linkTalentError);
			await admin.auth.admin.deleteUser(userId);
			if (linkTalentError.code === '23505') {
				throw error(409, 'Selected talent is already linked to another user.');
			}
			throw error(500, 'User creation was rolled back because talent linking failed.');
		}
	}

	return json({ ok: true, user_id: userId });
};
