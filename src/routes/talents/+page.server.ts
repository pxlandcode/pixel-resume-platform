import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { siteMeta } from '$lib/seo';

type Role = 'admin' | 'broker' | 'talent' | 'employer';

const KNOWN_ROLES = new Set<Role>(['admin', 'broker', 'talent', 'employer']);

const normalizeRolesFromJoinRows = (
	rows: Array<{ roles?: { key?: string | null } | Array<{ key?: string | null }> | null }>
): Role[] =>
	rows
		.flatMap((row) => {
			if (Array.isArray(row.roles)) {
				return row.roles
					.map((roleRow) => (typeof roleRow?.key === 'string' ? roleRow.key : null))
					.filter((key): key is string => key !== null);
			}
			return typeof row.roles?.key === 'string' ? [row.roles.key] : [];
		})
		.filter((key, index, all) => all.indexOf(key) === index)
		.filter((key): key is Role => KNOWN_ROLES.has(key as Role));

const canManageTalents = (roles: Role[]) => roles.includes('admin') || roles.includes('broker');

const getActorContext = async (cookies: { get(name: string): string | undefined }) => {
	const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
	const adminClient = getSupabaseAdminClient();

	if (!supabase || !adminClient) {
		return { supabase: null, adminClient: null, userId: null, roles: [] as Role[] };
	}

	const { data: userData } = await supabase.auth.getUser();
	const userId = userData.user?.id ?? null;
	if (!userId) {
		return { supabase, adminClient, userId: null, roles: [] as Role[] };
	}

	const { data: roleRows } = await adminClient
		.from('user_roles')
		.select('roles(key)')
		.eq('user_id', userId);

	const roles = normalizeRolesFromJoinRows(
		(roleRows as Array<{
			roles?: { key?: string | null } | Array<{ key?: string | null }> | null;
		}> | null) ?? []
	);

	return { supabase, adminClient, userId, roles };
};

export const load: PageServerLoad = async ({ cookies }) => {
	const actor = await getActorContext(cookies);
	const supabase = actor.supabase;
	const adminClient = actor.adminClient;

	if (!supabase || !adminClient) {
		return { talents: [], canManageTalents: false, meta: null };
	}

	const [talentsResult, authUsersResult] = await Promise.all([
		adminClient
			.from('talents')
			.select('id, user_id, first_name, last_name, avatar_url, title')
			.order('last_name', { ascending: true })
			.order('first_name', { ascending: true }),
		adminClient.auth.admin.listUsers()
	]);

	const canManage = canManageTalents(actor.roles);

	if (talentsResult.error) {
		console.warn('[talents index] talents error', talentsResult.error);
	}

	const authUsers = authUsersResult.data?.users ?? [];
	const emailByUserId = new Map(authUsers.map((user) => [user.id, user.email ?? null]));

	const talents = (talentsResult.data ?? []).map((talent) => ({
		id: talent.id,
		user_id: talent.user_id,
		first_name: talent.first_name ?? '',
		last_name: talent.last_name ?? '',
		avatar_url: talent.avatar_url ?? null,
		title: talent.title ?? '',
		email: talent.user_id ? (emailByUserId.get(talent.user_id) ?? null) : null
	}));

	return {
		talents,
		canManageTalents: canManage,
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
		const { adminClient, userId, roles } = await getActorContext(cookies);
		if (!adminClient || !userId) {
			return fail(401, { type: 'createTalent', ok: false, message: 'You are not authenticated.' });
		}
		if (!canManageTalents(roles)) {
			return fail(403, {
				type: 'createTalent',
				ok: false,
				message: 'Not authorized to manage talents.'
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

		const { error: insertError } = await adminClient.from('talents').insert({
			user_id: null,
			first_name,
			last_name,
			title,
			bio: '',
			avatar_url
		});

		if (insertError) {
			return fail(500, { type: 'createTalent', ok: false, message: insertError.message });
		}

		return {
			type: 'createTalent',
			ok: true,
			message: 'Talent created. Link it to a user under Users > Edit user.'
		};
	}
};
