import type { SupabaseClient } from '@supabase/supabase-js';
import {
	getActorAccessContext,
	getTalentAccess,
	type AppRole,
	type ShareAccessLevel
} from '$lib/server/access';

export type ResumeEditPermissions = {
	canView: boolean;
	canEdit: boolean;
	canEditAll: boolean;
	isOwnProfile: boolean;
	effectiveAccessLevel: ShareAccessLevel;
	allowTargetLogoExport: boolean;
	userId: string | null;
	roles: AppRole[];
	homeOrganisationId: string | null;
	accessibleOrganisationIds: string[];
	talentOrganisationId: string | null;
};

export const getResumeEditPermissions = async (
	supabase: SupabaseClient | null,
	adminClient: SupabaseClient | null,
	targetTalentId: string
): Promise<ResumeEditPermissions> => {
	if (!supabase || !adminClient) {
		return {
			canView: false,
			canEdit: false,
			canEditAll: false,
			isOwnProfile: false,
			effectiveAccessLevel: 'none',
			allowTargetLogoExport: false,
			userId: null,
			roles: [],
			homeOrganisationId: null,
			accessibleOrganisationIds: [],
			talentOrganisationId: null
		};
	}

	const actor = await getActorAccessContext(supabase, adminClient);
	if (!actor.userId) {
		return {
			canView: false,
			canEdit: false,
			canEditAll: false,
			isOwnProfile: false,
			effectiveAccessLevel: 'none',
			allowTargetLogoExport: false,
			userId: null,
			roles: [],
			homeOrganisationId: null,
			accessibleOrganisationIds: [],
			talentOrganisationId: null
		};
	}

	const talentAccess = await getTalentAccess(adminClient, actor, targetTalentId);

	return {
		canView: talentAccess.canView,
		canEdit: talentAccess.canEdit,
		canEditAll: talentAccess.canEditAll,
		isOwnProfile: talentAccess.isOwnProfile,
		effectiveAccessLevel: talentAccess.effectiveAccessLevel,
		allowTargetLogoExport: talentAccess.allowTargetLogoExport,
		userId: actor.userId,
		roles: actor.roles,
		homeOrganisationId: actor.homeOrganisationId,
		accessibleOrganisationIds: actor.accessibleOrganisationIds,
		talentOrganisationId: talentAccess.talentOrganisationId
	};
};
