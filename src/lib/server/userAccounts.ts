import type { SupabaseClient, User } from '@supabase/supabase-js';

const AUTH_USERS_PER_PAGE = 200;

export const listAllAuthUsers = async (adminClient: SupabaseClient): Promise<User[]> => {
	const users: User[] = [];
	let page = 1;

	while (true) {
		const { data, error } = await adminClient.auth.admin.listUsers({
			page,
			perPage: AUTH_USERS_PER_PAGE
		});
		if (error) throw new Error(error.message);

		const pageUsers = data.users ?? [];
		users.push(...pageUsers);

		if (pageUsers.length < AUTH_USERS_PER_PAGE) break;
		page += 1;
	}

	return users;
};

export const getUserHomeOrganisationId = async (
	adminClient: SupabaseClient,
	userId: string
): Promise<string | null> => {
	const { data, error } = await adminClient
		.from('organisation_users')
		.select('organisation_id')
		.eq('user_id', userId)
		.maybeSingle();

	if (error) throw new Error(error.message);
	return data?.organisation_id ?? null;
};

export const getLinkedTalentIdForUser = async (
	adminClient: SupabaseClient,
	userId: string
): Promise<string | null> => {
	const { data, error } = await adminClient
		.from('talents')
		.select('id')
		.eq('user_id', userId)
		.maybeSingle();

	if (error) throw new Error(error.message);
	return data?.id ?? null;
};

export const syncUserAndLinkedTalentHomeOrganisation = async (
	adminClient: SupabaseClient,
	payload: {
		userId: string;
		organisationId: string | null;
		linkedTalentId?: string | null;
	}
) => {
	const { userId, organisationId, linkedTalentId } = payload;

	if (organisationId) {
		const { error } = await adminClient.from('organisation_users').upsert(
			{
				organisation_id: organisationId,
				user_id: userId
			},
			{ onConflict: 'user_id' }
		);
		if (error) throw new Error(error.message);
	} else {
		const { error } = await adminClient.from('organisation_users').delete().eq('user_id', userId);
		if (error) throw new Error(error.message);
	}

	if (!linkedTalentId) return;

	if (organisationId) {
		const { error } = await adminClient.from('organisation_talents').upsert(
			{
				organisation_id: organisationId,
				talent_id: linkedTalentId
			},
			{ onConflict: 'talent_id' }
		);
		if (error) throw new Error(error.message);
	} else {
		const { error } = await adminClient
			.from('organisation_talents')
			.delete()
			.eq('talent_id', linkedTalentId);
		if (error) throw new Error(error.message);
	}
};
