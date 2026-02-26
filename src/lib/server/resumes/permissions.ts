import type { SupabaseClient } from '@supabase/supabase-js';

export type ResumeEditPermissions = {
	canEdit: boolean;
	canEditAll: boolean;
	isOwnProfile: boolean;
	userId: string | null;
};

const EDIT_ROLES = new Set(['admin', 'cms_admin', 'employer']);

export const getResumeEditPermissions = async (
	supabase: SupabaseClient | null,
	adminClient: SupabaseClient | null,
	targetUserId: string
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

	const { data: userRoles } = await adminClient
		.from('user_roles')
		.select('role')
		.eq('user_id', currentUserId);

	const roles = (userRoles ?? []).map((r) => r.role);
	const canEditAll = roles.some((role) => EDIT_ROLES.has(role));
	const isOwnProfile = currentUserId === targetUserId;

	return {
		canEdit: canEditAll || isOwnProfile,
		canEditAll,
		isOwnProfile,
		userId: currentUserId
	};
};
