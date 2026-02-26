import { fail, type Actions, type PageServerLoad } from '@sveltejs/kit';
import type { PostgrestError } from '@supabase/supabase-js';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';

export const load: PageServerLoad = async ({ cookies }) => {
	const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);

	if (!supabase) {
		return { users: [] };
	}

	// Combine profile rows with role assignments until a database view is available.
	const adminClient = getSupabaseAdminClient();

	if (!adminClient) {
		return { users: [] };
	}

	const [{ data: profiles }, rolesResult, authUsersResult] = await Promise.all([
		adminClient
			.from('profiles')
			.select('id, first_name, last_name, avatar_url')
			.order('last_name', { ascending: true }),
		(async () => {
			if (!adminClient) {
				const fallbackError: PostgrestError = {
					message: 'Admin client unavailable',
					details: null,
					hint: null,
					code: 'PGRST'
				};
				return { data: null, error: fallbackError };
			}

			return adminClient.from('user_roles').select('user_id, role');
		})(),
		(async () => {
			if (!adminClient) return { data: null, error: new Error('Admin client unavailable') };
			const { data, error } = await adminClient.auth.admin.listUsers();
			return { data: data?.users ?? null, error };
		})()
	]);

	if (rolesResult.error) {
		console.error('[users load] role fetch error', rolesResult.error);
	}

	const roles = rolesResult.data ?? [];

	const roleMap = new Map<string, string[]>();
	for (const row of roles ?? []) {
		const existing = roleMap.get(row.user_id) ?? [];
		roleMap.set(row.user_id, [...existing, row.role]);
	}

	const authMap = new Map<string, { email?: string; active?: boolean; roles?: string[] }>();
	for (const user of authUsersResult.data ?? []) {
		const authRoles = Array.isArray(user.app_metadata?.roles)
			? (user.app_metadata?.roles as string[]).filter((r) => typeof r === 'string')
			: typeof user.app_metadata?.role === 'string'
				? [user.app_metadata.role as string]
				: [];
		authMap.set(user.id, {
			email: user.email ?? undefined,
			active: user.app_metadata?.active !== false,
			roles: authRoles
		});
	}

	const users = (profiles ?? []).map((profile) => {
		const rolesFromDb =
			(roleMap.get(profile.id) as
				| Array<'admin' | 'cms_admin' | 'employee' | 'employer'>
				| undefined) ?? [];
		const rolesFromAuth = (authMap.get(profile.id)?.roles ?? []) as Array<
			'admin' | 'cms_admin' | 'employee' | 'employer'
		>;
		const mergedRoles = Array.from(new Set([...rolesFromDb, ...rolesFromAuth])).filter(Boolean);

		return {
			id: profile.id,
			first_name: profile.first_name,
			last_name: profile.last_name,
			email: authMap.get(profile.id)?.email,
			avatar_url: profile.avatar_url ?? null,
			active: authMap.get(profile.id)?.active ?? true,
			roles: mergedRoles.length > 0 ? mergedRoles : (['employee'] as const)
		};
	});

	return { users };
};

export const actions: Actions = {
	updateRole: async ({ request, cookies }) => {
		const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);

		if (!supabase) {
			return fail(401, { type: 'updateRole', ok: false, message: 'You are not authenticated.' });
		}

		const formData = await request.formData();
		const userId = formData.get('user_id');
		const roles = formData.getAll('roles').filter((r): r is string => typeof r === 'string');

		if (typeof userId !== 'string' || roles.length === 0) {
			return fail(400, { type: 'updateRole', ok: false, message: 'Invalid form submission.' });
		}

		const adminClient = getSupabaseAdminClient();

		if (!adminClient) {
			return fail(500, {
				type: 'updateRole',
				ok: false,
				message: 'Server configuration missing Supabase service role key.'
			});
		}

		await adminClient.from('user_roles').delete().eq('user_id', userId);
		const { error } = await adminClient
			.from('user_roles')
			.insert(roles.map((role) => ({ user_id: userId, role })));

		if (error) {
			return fail(500, { type: 'updateRole', ok: false, message: error.message });
		}

		await adminClient.auth.admin.updateUserById(userId, {
			app_metadata: { roles, role: roles[0] ?? 'employee' }
		});

		return { type: 'updateRole', ok: true, message: 'Role updated successfully.' };
	},
	updateActive: async ({ request, cookies }) => {
		const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);

		if (!supabase) {
			return fail(401, { type: 'updateActive', ok: false, message: 'You are not authenticated.' });
		}

		const formData = await request.formData();
		const userId = formData.get('user_id');
		const activeValue = formData.get('active');

		if (typeof userId !== 'string' || (activeValue !== 'true' && activeValue !== 'false')) {
			return fail(400, { type: 'updateActive', ok: false, message: 'Invalid form submission.' });
		}

		const adminClient = getSupabaseAdminClient();

		if (!adminClient) {
			return fail(500, {
				type: 'updateActive',
				ok: false,
				message: 'Server configuration missing Supabase service role key.'
			});
		}

		const active = activeValue === 'true';

		const { error } = await adminClient.auth.admin.updateUserById(userId, {
			app_metadata: { active }
		});

		if (error) {
			return fail(500, { type: 'updateActive', ok: false, message: error.message });
		}

		return { type: 'updateActive', ok: true, message: 'Account status updated.' };
	},
	updateUser: async ({ request, cookies }) => {
		const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
		if (!supabase) {
			return fail(401, { type: 'updateUser', ok: false, message: 'You are not authenticated.' });
		}

		const formData = await request.formData();
		const userId = formData.get('user_id');
		const first_name = formData.get('first_name');
		const last_name = formData.get('last_name');
		const email = formData.get('email');
		const roles = formData.getAll('roles').filter((r): r is string => typeof r === 'string');
		const activeValue = formData.get('active');
		const password = formData.get('password');
		const avatar_url = formData.get('avatar_url');

		if (
			typeof userId !== 'string' ||
			typeof first_name !== 'string' ||
			typeof last_name !== 'string' ||
			typeof email !== 'string' ||
			roles.length === 0 ||
			(activeValue !== 'true' && activeValue !== 'false')
		) {
			return fail(400, { type: 'updateUser', ok: false, message: 'Invalid form submission.' });
		}

		const adminClient = getSupabaseAdminClient();

		if (!adminClient) {
			return fail(500, {
				type: 'updateUser',
				ok: false,
				message: 'Server configuration missing Supabase service role key.'
			});
		}

		const active = activeValue === 'true';

		const updates: Parameters<typeof adminClient.auth.admin.updateUserById>[1] = {
			app_metadata: { active, roles, role: roles[0] },
			user_metadata: { first_name, last_name },
			email
		};
		if (typeof password === 'string' && password.trim().length >= 6) {
			updates.password = password;
		}

		const { error: authError } = await adminClient.auth.admin.updateUserById(userId, updates);
		if (authError) {
			return fail(500, { type: 'updateUser', ok: false, message: authError.message });
		}

		const avatar =
			typeof avatar_url === 'string' && avatar_url.trim().length > 0 ? avatar_url : null;

		const { error: profileError } = await adminClient
			.from('profiles')
			.upsert({ id: userId, first_name, last_name, avatar_url: avatar }, { onConflict: 'id' });
		if (profileError) {
			return fail(500, { type: 'updateUser', ok: false, message: profileError.message });
		}

		await adminClient.from('user_roles').delete().eq('user_id', userId);
		const { error: roleError } = await adminClient
			.from('user_roles')
			.insert(roles.map((role) => ({ user_id: userId, role })));
		if (roleError) {
			return fail(500, { type: 'updateUser', ok: false, message: roleError.message });
		}

		return { type: 'updateUser', ok: true, message: 'User updated.' };
	}
};
