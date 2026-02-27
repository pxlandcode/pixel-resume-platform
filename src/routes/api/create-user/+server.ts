import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getSupabaseAdminClient } from '$lib/server/supabase';

type Role = 'admin' | 'broker' | 'talent' | 'employer';
const KNOWN_ROLES = new Set<Role>(['admin', 'broker', 'talent', 'employer']);

const randomPassword = (length = 32) =>
	Array.from(crypto.getRandomValues(new Uint8Array(length)))
		.map((n) => (n % 36).toString(36))
		.join('');

const normalizeRoles = (roles: Role[]): Role[] =>
	Array.from(new Set(roles.filter((role) => KNOWN_ROLES.has(role))));

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

export const POST: RequestHandler = async ({ request }) => {
	const admin = getSupabaseAdminClient();
	if (!admin) {
		throw error(500, 'Supabase service role client not available');
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
	const active = body.active !== false;
	const avatar_url_raw = (body.avatar_url as string | undefined) ?? null;
	const avatar_url =
		avatar_url_raw && typeof avatar_url_raw === 'string' && avatar_url_raw.trim().length > 0
			? avatar_url_raw
			: null;

	if (!email) throw error(400, 'Email is required.');
	if (active && !password) throw error(400, 'Password is required for active accounts.');

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

	const { error: profileError } = await admin.from('user_profiles').upsert(
		{
			user_id: userId,
			first_name: firstName,
			last_name: lastName,
			email,
			avatar_url
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

	return json({ ok: true, user_id: userId });
};
