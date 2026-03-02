import type { SupabaseClient } from '@supabase/supabase-js';
import { error } from '@sveltejs/kit';
import type { ResumeEditPermissions } from '$lib/server/resumes/permissions';
import { hasDataSharingPermission } from '$lib/server/legalService';

export type ExportTemplateUsed = 'org' | 'broker';

export type ResumeExportPolicy = {
	actorUserId: string;
	sourceOrganisationId: string | null;
	targetOrganisationId: string | null;
	crossOrganisation: boolean;
	templateUsed: ExportTemplateUsed;
};

const hasRole = (roles: string[], role: string) => roles.includes(role);

const ensureExportScope = async (
	adminClient: SupabaseClient,
	sourceOrganisationId: string | null,
	targetOrganisationId: string | null,
	scope: 'export_org_template' | 'export_broker_template'
) => {
	if (!sourceOrganisationId || !targetOrganisationId) return true;
	if (sourceOrganisationId === targetOrganisationId) return true;
	return hasDataSharingPermission(adminClient, sourceOrganisationId, targetOrganisationId, scope);
};

export const resolveResumeExportPolicy = async (
	adminClient: SupabaseClient,
	permissions: ResumeEditPermissions
): Promise<ResumeExportPolicy> => {
	if (!permissions.userId) {
		throw error(401, 'Unauthorized');
	}
	if (!permissions.canView) {
		throw error(403, 'Not authorized to view this resume.');
	}

	const isBroker = hasRole(permissions.roles, 'broker');
	const isEmployer = hasRole(permissions.roles, 'employer');
	const sourceOrganisationId = permissions.talentOrganisationId ?? null;
	const targetOrganisationId = permissions.homeOrganisationId ?? null;
	const crossOrganisation = Boolean(
		sourceOrganisationId && targetOrganisationId && sourceOrganisationId !== targetOrganisationId
	);

	let templateUsed: ExportTemplateUsed = 'org';

	if (isBroker) {
		const canUseBrokerTemplate = await ensureExportScope(
			adminClient,
			sourceOrganisationId,
			targetOrganisationId,
			'export_broker_template'
		);
		if (canUseBrokerTemplate) {
			templateUsed = 'broker';
		} else {
			const canUseOrgTemplate = await ensureExportScope(
				adminClient,
				sourceOrganisationId,
				targetOrganisationId,
				'export_org_template'
			);
			if (!canUseOrgTemplate) {
				throw error(403, 'Not authorized to export this resume for your organisation.');
			}
			templateUsed = 'org';
		}
	} else if (isEmployer) {
		const canUseOrgTemplate = await ensureExportScope(
			adminClient,
			sourceOrganisationId,
			targetOrganisationId,
			'export_org_template'
		);
		if (!canUseOrgTemplate) {
			throw error(403, 'Not authorized to export this resume for your organisation.');
		}
		templateUsed = 'org';
	}

	return {
		actorUserId: permissions.userId,
		sourceOrganisationId,
		targetOrganisationId,
		crossOrganisation,
		templateUsed
	};
};
