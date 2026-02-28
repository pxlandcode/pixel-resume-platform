import { fail } from '@sveltejs/kit';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import type { Actions, PageServerLoad } from './$types';
import { getActorAccessContext } from '$lib/server/access';

type Role = 'admin' | 'broker' | 'talent' | 'employer';

const KNOWN_ROLES = new Set<Role>(['admin', 'broker', 'talent', 'employer']);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeRoles = (roles: string[]): Role[] => {
	const unique = new Set<Role>();
	for (const role of roles) {
		if (KNOWN_ROLES.has(role as Role)) {
			unique.add(role as Role);
		}
	}
	return Array.from(unique);
};

const getAllowedCreateRoles = (
	actor: Awaited<ReturnType<typeof getActorAccessContext>>
): Role[] => {
	if (actor.isAdmin) return ['admin', 'broker', 'talent', 'employer'];
	const roles: Role[] = ['talent'];
	if (actor.isBroker) roles.push('broker');
	if (actor.isEmployer) roles.push('employer');
	return normalizeRoles(roles);
};

const normalizeOptionalUuid = (value: FormDataEntryValue | null) => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	return UUID_REGEX.test(trimmed) ? trimmed : '__invalid__';
};

const normalizeRolesFromJoinRows = (
	rows: Array<{ roles?: { key?: string | null } | Array<{ key?: string | null }> | null }>
): Role[] =>
	rows
		.flatMap((row) => {
			if (Array.isArray(row.roles)) {
				return normalizeRoles(
					row.roles
						.map((roleRow) => (typeof roleRow?.key === 'string' ? roleRow.key : null))
						.filter((role): role is string => role !== null)
				);
			}
			return row.roles?.key ? normalizeRoles([row.roles.key]) : [];
		})
		.filter((value, index, all) => all.indexOf(value) === index);

const resolveRoleIds = async (
	adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
	roles: Role[]
): Promise<Map<Role, string>> => {
	const uniqueRoles = normalizeRoles(roles);
	const { data, error: rolesError } = await adminClient
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

export const load: PageServerLoad = async ({ cookies }) => {
	const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);

	if (!supabase) {
		return {
			users: [],
			talents: [],
			canCreateUsers: false,
			canEditUsers: false,
			allowedCreateRoles: ['talent'] as Role[]
		};
	}

	const adminClient = getSupabaseAdminClient();

	if (!adminClient) {
		return {
			users: [],
			talents: [],
			canCreateUsers: false,
			canEditUsers: false,
			allowedCreateRoles: ['talent'] as Role[]
		};
	}

	const actor = await getActorAccessContext(supabase, adminClient);
	if (!actor.userId || (!actor.isAdmin && !actor.isBroker && !actor.isEmployer)) {
		return {
			users: [],
			talents: [],
			canCreateUsers: false,
			canEditUsers: false,
			allowedCreateRoles: ['talent'] as Role[]
		};
	}

	const canCreateUsers = actor.isAdmin || actor.isBroker || actor.isEmployer;
	const canEditUsers = actor.isAdmin;
	const allowedCreateRoles = getAllowedCreateRoles(actor);

	const visibleUserIdsForNonAdmin = new Set<string>([actor.userId]);
	if (!actor.isAdmin && actor.accessibleOrganisationIds.length > 0) {
		const { data: scopedMembershipRows } = await adminClient
			.from('organisation_users')
			.select('user_id')
			.in('organisation_id', actor.accessibleOrganisationIds);
		for (const row of scopedMembershipRows ?? []) {
			if (typeof row.user_id === 'string' && row.user_id.length > 0) {
				visibleUserIdsForNonAdmin.add(row.user_id);
			}
		}
	}

	const [profilesResult, rolesResult, authUsersResult, talentsResult] = await Promise.all([
		adminClient
			.from('user_profiles')
			.select('user_id, first_name, last_name, avatar_url, email')
			.order('last_name', { ascending: true }),
		adminClient.from('user_roles').select('user_id, roles(key)'),
		adminClient.auth.admin.listUsers(),
		adminClient
			.from('talents')
			.select('id, user_id, first_name, last_name, avatar_url')
			.order('last_name', { ascending: true })
			.order('first_name', { ascending: true })
	]);

	if (rolesResult.error) {
		console.error('[users load] role fetch error', rolesResult.error);
	}
	if (talentsResult.error) {
		console.error('[users load] talent fetch error', talentsResult.error);
	}

	const profiles = profilesResult.data ?? [];
	const roleRows =
		(rolesResult.data as Array<{
			user_id: string;
			roles?: { key?: string | null } | Array<{ key?: string | null }> | null;
		}> | null) ?? [];
	const authUsers = authUsersResult.data?.users ?? [];
	const talentRows =
		(talentsResult.data as Array<{
			id: string;
			user_id: string | null;
			first_name: string | null;
			last_name: string | null;
			avatar_url: string | null;
		}> | null) ?? [];

	const roleMap = new Map<string, Role[]>();
	for (const row of roleRows) {
		const joinedRoles = normalizeRolesFromJoinRows([{ roles: row.roles }]);
		if (joinedRoles.length === 0) continue;
		const existing = roleMap.get(row.user_id) ?? [];
		roleMap.set(row.user_id, normalizeRoles([...existing, ...joinedRoles]));
	}

	const authMap = new Map<string, { email?: string; active?: boolean; roles?: Role[] }>();
	for (const user of authUsers) {
		const authRolesRaw = Array.isArray(user.app_metadata?.roles)
			? (user.app_metadata?.roles as string[])
			: typeof user.app_metadata?.role === 'string'
				? [user.app_metadata.role as string]
				: [];
		authMap.set(user.id, {
			email: user.email ?? undefined,
			active: user.app_metadata?.active !== false,
			roles: normalizeRoles(authRolesRaw)
		});
	}

	const profileMap = new Map(profiles.map((profile) => [profile.user_id, profile]));
	const linkedTalentByUserId = new Map<string, string>();
	const linkedTalentAvatarByUserId = new Map<string, string | null>();
	for (const talent of talentRows) {
		if (typeof talent.user_id === 'string' && talent.user_id.length > 0) {
			linkedTalentByUserId.set(talent.user_id, talent.id);
			linkedTalentAvatarByUserId.set(talent.user_id, talent.avatar_url ?? null);
		}
	}

	const userIds = new Set<string>();
	for (const profile of profiles) userIds.add(profile.user_id);
	for (const row of roleRows) userIds.add(row.user_id);
	for (const user of authUsers) userIds.add(user.id);

	const users = Array.from(userIds)
		.filter((userId) => actor.isAdmin || visibleUserIdsForNonAdmin.has(userId))
		.map((userId) => {
			const profile = profileMap.get(userId);
			const rolesFromDb = roleMap.get(userId) ?? [];
			const rolesFromAuth = authMap.get(userId)?.roles ?? [];
			const mergedRoles = normalizeRoles([...rolesFromDb, ...rolesFromAuth]);

			return {
				id: userId,
				first_name: profile?.first_name ?? '',
				last_name: profile?.last_name ?? '',
				email: authMap.get(userId)?.email ?? profile?.email ?? null,
				avatar_url: profile?.avatar_url ?? linkedTalentAvatarByUserId.get(userId) ?? null,
				active: authMap.get(userId)?.active ?? true,
				linked_talent_id: linkedTalentByUserId.get(userId) ?? null,
				roles: mergedRoles.length > 0 ? mergedRoles : ['talent']
			};
		})
		.sort((a, b) => {
			const nameA = `${a.last_name ?? ''} ${a.first_name ?? ''}`.trim().toLowerCase();
			const nameB = `${b.last_name ?? ''} ${b.first_name ?? ''}`.trim().toLowerCase();
			return nameA.localeCompare(nameB);
		});

	const talents = actor.isAdmin
		? talentRows.map((talent) => ({
				id: talent.id,
				user_id: talent.user_id ?? null,
				first_name: talent.first_name ?? '',
				last_name: talent.last_name ?? ''
			}))
		: [];

	return { users, talents, canCreateUsers, canEditUsers, allowedCreateRoles };
};

export const actions: Actions = {
	updateRole: async ({ request, cookies }) => {
		const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);

		if (!supabase) {
			return fail(401, { type: 'updateRole', ok: false, message: 'You are not authenticated.' });
		}

		const formData = await request.formData();
		const userId = formData.get('user_id');
		const rolesRaw = formData
			.getAll('roles')
			.filter((role): role is string => typeof role === 'string');
		const roles = normalizeRoles(rolesRaw);

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

		const actor = await getActorAccessContext(supabase, adminClient);
		if (!actor.isAdmin) {
			return fail(403, { type: 'updateRole', ok: false, message: 'Only admins can update roles.' });
		}

		await adminClient.from('user_roles').delete().eq('user_id', userId);

		let roleIdMap: Map<Role, string>;
		try {
			roleIdMap = await resolveRoleIds(adminClient, roles);
		} catch (roleLookupError) {
			return fail(500, {
				type: 'updateRole',
				ok: false,
				message:
					roleLookupError instanceof Error ? roleLookupError.message : 'Could not resolve role IDs.'
			});
		}

		let roleAssignments: Array<{ user_id: string; role_id: string }>;
		try {
			roleAssignments = roles.map((role) => {
				const roleId = roleIdMap.get(role);
				if (!roleId) {
					throw new Error(`Missing role ID for '${role}'.`);
				}
				return { user_id: userId, role_id: roleId };
			});
		} catch (roleMappingError) {
			return fail(500, {
				type: 'updateRole',
				ok: false,
				message:
					roleMappingError instanceof Error
						? roleMappingError.message
						: 'Could not map roles to IDs.'
			});
		}

		const { error: roleInsertError } = await adminClient.from('user_roles').insert(roleAssignments);

		if (roleInsertError) {
			return fail(500, { type: 'updateRole', ok: false, message: roleInsertError.message });
		}

		await adminClient.auth.admin.updateUserById(userId, {
			app_metadata: { roles, role: roles[0] ?? 'talent' }
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

		const actor = await getActorAccessContext(supabase, adminClient);
		if (!actor.isAdmin) {
			return fail(403, {
				type: 'updateActive',
				ok: false,
				message: 'Only admins can update account status.'
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
		const rolesRaw = formData
			.getAll('roles')
			.filter((role): role is string => typeof role === 'string');
		const roles = normalizeRoles(rolesRaw);
		const activeValue = formData.get('active');
		const password = formData.get('password');
		const avatar_url = formData.get('avatar_url');
		const linkedTalentRaw = formData.get('linked_talent_id');
		const linkedTalentId = normalizeOptionalUuid(linkedTalentRaw);

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
		if (linkedTalentId === '__invalid__') {
			return fail(400, {
				type: 'updateUser',
				ok: false,
				message: 'Talent selection must be a valid UUID or empty.'
			});
		}

		const adminClient = getSupabaseAdminClient();

		if (!adminClient) {
			return fail(500, {
				type: 'updateUser',
				ok: false,
				message: 'Server configuration missing Supabase service role key.'
			});
		}

		const actor = await getActorAccessContext(supabase, adminClient);
		if (!actor.isAdmin) {
			return fail(403, {
				type: 'updateUser',
				ok: false,
				message: 'Only admins can edit existing users.'
			});
		}

		const active = activeValue === 'true';
		const avatar =
			typeof avatar_url === 'string' && avatar_url.trim().length > 0 ? avatar_url.trim() : null;
		let syncedAvatar = avatar;
		const { data: existingUserProfile } = await adminClient
			.from('user_profiles')
			.select('avatar_url')
			.eq('user_id', userId)
			.maybeSingle();
		const hadExistingUserAvatar =
			typeof existingUserProfile?.avatar_url === 'string' &&
			existingUserProfile.avatar_url.trim().length > 0;
		let selectedTalent: {
			id: string;
			user_id: string | null;
			avatar_url: string | null;
		} | null = null;

		if (linkedTalentRaw !== null && linkedTalentId) {
			const { data, error: selectedTalentError } = await adminClient
				.from('talents')
				.select('id, user_id, avatar_url')
				.eq('id', linkedTalentId)
				.maybeSingle();

			if (selectedTalentError || !data) {
				return fail(404, {
					type: 'updateUser',
					ok: false,
					message: 'Selected talent was not found.'
				});
			}

			if (data.user_id && data.user_id !== userId) {
				return fail(409, {
					type: 'updateUser',
					ok: false,
					message: 'Selected talent is already linked to another user.'
				});
			}

			selectedTalent = data;
			if (
				!syncedAvatar &&
				!hadExistingUserAvatar &&
				typeof data.avatar_url === 'string' &&
				data.avatar_url.trim().length > 0
			) {
				syncedAvatar = data.avatar_url;
			}
		}

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

		const { error: profileError } = await adminClient.from('user_profiles').upsert(
			{
				user_id: userId,
				first_name,
				last_name,
				email,
				avatar_url: syncedAvatar
			},
			{ onConflict: 'user_id' }
		);
		if (profileError) {
			return fail(500, { type: 'updateUser', ok: false, message: profileError.message });
		}

		await adminClient.from('user_roles').delete().eq('user_id', userId);

		let roleIdMap: Map<Role, string>;
		try {
			roleIdMap = await resolveRoleIds(adminClient, roles);
		} catch (roleLookupError) {
			return fail(500, {
				type: 'updateUser',
				ok: false,
				message:
					roleLookupError instanceof Error ? roleLookupError.message : 'Could not resolve role IDs.'
			});
		}

		let roleAssignments: Array<{ user_id: string; role_id: string }>;
		try {
			roleAssignments = roles.map((role) => {
				const roleId = roleIdMap.get(role);
				if (!roleId) {
					throw new Error(`Missing role ID for '${role}'.`);
				}
				return { user_id: userId, role_id: roleId };
			});
		} catch (roleMappingError) {
			return fail(500, {
				type: 'updateUser',
				ok: false,
				message:
					roleMappingError instanceof Error
						? roleMappingError.message
						: 'Could not map roles to IDs.'
			});
		}

		const { error: roleError } = await adminClient.from('user_roles').insert(roleAssignments);
		if (roleError) {
			return fail(500, { type: 'updateUser', ok: false, message: roleError.message });
		}

		if (linkedTalentRaw !== null) {
			if (linkedTalentId) {
				if (!selectedTalent) {
					return fail(404, {
						type: 'updateUser',
						ok: false,
						message: 'Selected talent was not found.'
					});
				}

				const { error: clearPreviousLinkError } = await adminClient
					.from('talents')
					.update({ user_id: null })
					.eq('user_id', userId)
					.neq('id', linkedTalentId);

				if (clearPreviousLinkError) {
					return fail(500, {
						type: 'updateUser',
						ok: false,
						message: clearPreviousLinkError.message
					});
				}

				const { error: linkTalentError } = await adminClient
					.from('talents')
					.update({ user_id: userId, avatar_url: syncedAvatar })
					.eq('id', linkedTalentId);

				if (linkTalentError) {
					if (linkTalentError.code === '23505') {
						return fail(409, {
							type: 'updateUser',
							ok: false,
							message: 'Selected talent is already linked to another user.'
						});
					}
					return fail(500, { type: 'updateUser', ok: false, message: linkTalentError.message });
				}
			} else {
				const { error: unlinkTalentError } = await adminClient
					.from('talents')
					.update({ user_id: null })
					.eq('user_id', userId);

				if (unlinkTalentError) {
					return fail(500, { type: 'updateUser', ok: false, message: unlinkTalentError.message });
				}
			}
		}

		return { type: 'updateUser', ok: true, message: 'User updated.' };
	}
};
