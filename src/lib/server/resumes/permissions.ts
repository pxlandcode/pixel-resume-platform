import type { SupabaseClient } from '@supabase/supabase-js';

export type ResumeEditPermissions = {
	canEdit: boolean;
	canEditAll: boolean;
	isOwnProfile: boolean;
	userId: string | null;
};

const EDIT_ROLES = new Set(['admin', 'broker', 'employer']);

const extractRoleKeys = (
	rows: Array<{ roles?: { key?: string | null } | Array<{ key?: string | null }> | null }>
): string[] =>
	rows
		.flatMap((row) => {
			if (Array.isArray(row.roles)) {
				return row.roles
					.map((roleRow) => (typeof roleRow?.key === 'string' ? roleRow.key : null))
					.filter((role): role is string => role !== null);
			}
			return typeof row.roles?.key === 'string' ? [row.roles.key] : [];
		})
		.filter((value, index, all) => all.indexOf(value) === index);

export const getResumeEditPermissions = async (
	supabase: SupabaseClient | null,
	adminClient: SupabaseClient | null,
	targetTalentId: string
): Promise<ResumeEditPermissions> => {
	if (!supabase || !adminClient) {
		return { canEdit: false, canEditAll: false, isOwnProfile: false, userId: null };
	}

	const {
		data: { user }
	} = await supabase.auth.getUser();

	const currentUserId = user?.id ?? null;

	if (!currentUserId) {
		return { canEdit: false, canEditAll: false, isOwnProfile: false, userId: null };
	}

	const [{ data: userRoles }, ownTalentResult] = await Promise.all([
		adminClient.from('user_roles').select('roles(key)').eq('user_id', currentUserId),
		adminClient
			.from('talents')
			.select('id')
			.eq('id', targetTalentId)
			.eq('user_id', currentUserId)
			.maybeSingle()
	]);

	const roles = extractRoleKeys(
		(userRoles as Array<{
			roles?: { key?: string | null } | Array<{ key?: string | null }> | null;
		}>) ?? []
	);
	const canEditAll = roles.some((role) => EDIT_ROLES.has(role));
	const isOwnProfile = Boolean(ownTalentResult.data?.id);

	return {
		canEdit: canEditAll || isOwnProfile,
		canEditAll,
		isOwnProfile,
		userId: currentUserId
	};
};
