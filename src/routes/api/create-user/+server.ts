import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getSupabaseAdminClient } from '$lib/server/supabase';

type Role = 'admin' | 'cms_admin' | 'employee' | 'employer';

const randomPassword = (length = 32) =>
	Array.from(crypto.getRandomValues(new Uint8Array(length)))
		.map((n) => (n % 36).toString(36))
		.join('');

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
		? (body.roles.filter((r: unknown): r is Role => typeof r === 'string') as Role[])
		: (body.role ? [body.role as Role] : []);
	const normalizedRoles: Role[] = roles.length > 0 ? roles : ['employee'];
	const active = body.active !== false;
	const avatar_url_raw = (body.avatar_url as string | undefined) ?? null;
	const avatar_url = avatar_url_raw && typeof avatar_url_raw === 'string' && avatar_url_raw.trim().length > 0 ? avatar_url_raw : null;

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

	const { error: profileError } = await admin
		.from('profiles')
		.upsert({ id: userId, first_name, last_name, avatar_url }, { onConflict: 'id' });

	if (profileError) {
		console.error('[create-user] profile upsert error', profileError);
		throw error(500, 'User created but profile failed to save.');
	}

	// Replace role without relying on a unique constraint in the DB
	const { error: deleteRoleError } = await admin.from('user_roles').delete().eq('user_id', userId);
	if (deleteRoleError) {
		console.error('[create-user] role delete error', deleteRoleError);
		throw error(500, 'User created but role cleanup failed.');
	}
	const { error: insertRoleError } = await admin
		.from('user_roles')
		.insert(normalizedRoles.map((role) => ({ user_id: userId, role })));
	if (insertRoleError) {
		console.error('[create-user] role insert error', insertRoleError);
		throw error(500, 'User created but role assignment failed.');
	}

	return json({ ok: true, user_id: userId });
};
