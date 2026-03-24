import type { SupabaseClient } from '@supabase/supabase-js';
import { error } from '@sveltejs/kit';
import type { ResumeEditPermissions } from '$lib/server/resumes/permissions';

export type ExportTemplateUsed = 'source' | 'target';

export type ResumeExportPolicy = {
	actorUserId: string;
	sourceOrganisationId: string | null;
	targetOrganisationId: string | null;
	crossOrganisation: boolean;
	templateUsed: ExportTemplateUsed;
};

export const resolveResumeExportPolicy = async (
	_adminClient: SupabaseClient,
	permissions: ResumeEditPermissions
): Promise<ResumeExportPolicy> => {
	if (!permissions.userId) {
		throw error(401, 'Unauthorized');
	}
	if (!permissions.canView) {
		throw error(403, 'Not authorized to view this resume.');
	}

	const sourceOrganisationId = permissions.talentOrganisationId ?? null;
	const targetOrganisationId = permissions.homeOrganisationId ?? null;
	const crossOrganisation = Boolean(
		sourceOrganisationId && targetOrganisationId && sourceOrganisationId !== targetOrganisationId
	);

	return {
		actorUserId: permissions.userId,
		sourceOrganisationId,
		targetOrganisationId,
		crossOrganisation,
		templateUsed: crossOrganisation && permissions.allowTargetLogoExport ? 'target' : 'source'
	};
};
