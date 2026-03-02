import type { Actions, PageServerLoad } from './$types';
import { ResumeService } from '$lib/services/resume';
import { siteMeta } from '$lib/seo';
import { error } from '@sveltejs/kit';
import {
	getSupabaseAdminClient,
	createSupabaseServerClient,
	AUTH_COOKIE_NAMES
} from '$lib/server/supabase';
import { fail } from '@sveltejs/kit';
import { getResumeEditPermissions } from '$lib/server/resumes/permissions';
import { listExperienceLibrary, saveResumeData } from '$lib/server/resumes/store';
import type { ResumeData } from '$lib/types/resume';
import { getActorAccessContext, resolvePrintTemplateContext } from '$lib/server/access';
import { assertAcceptedForSensitiveAction } from '$lib/server/legalGate';
import { writeAuditLog } from '$lib/server/legalService';

export const load: PageServerLoad = async ({ params, url, cookies }) => {
	const resumeId = params.resumeId;
	const talentId = params.personId;

	if (!resumeId || !talentId) {
		throw error(400, 'Invalid identifier');
	}

	const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
	const adminClient = getSupabaseAdminClient();

	const resume = await ResumeService.getResume(resumeId);
	const resumePerson = await ResumeService.getPerson(talentId);

	if (!resume || resume.personId !== talentId) {
		throw error(404, 'Resume not found');
	}

	const permissions = await getResumeEditPermissions(
		supabase,
		adminClient,
		resume.personId
	);
	const { canView, canEdit, canEditAll, isOwnProfile } = permissions;
	if (!canView) {
		throw error(403, 'Not authorized to view this resume.');
	}

	const actor = await getActorAccessContext(supabase, adminClient);
	const templateContext = await resolvePrintTemplateContext(adminClient, actor, resume.personId);
	const auditOrganisationId = permissions.talentOrganisationId ?? actor.homeOrganisationId ?? null;
	if (actor.userId && auditOrganisationId) {
		const auditResult = await writeAuditLog({
			actorUserId: actor.userId,
			organisationId: auditOrganisationId,
			actionType: 'RESUME_VIEW',
			resourceType: 'resume',
			resourceId: resumeId,
			metadata: {
				resume_id: resumeId,
				talent_id: resume.personId,
				source_org_id: permissions.talentOrganisationId,
				target_org_id: actor.homeOrganisationId,
				template_used: templateContext.source === 'broker_home_org' ? 'broker' : 'org'
			}
		});
		if (!auditResult.ok) {
			console.warn('[resume detail] could not write resume view audit log', auditResult.error);
		}
	}

	const experienceLibrary =
		adminClient && canEdit
			? await listExperienceLibrary(adminClient, talentId).catch(() => [])
			: [];

	const langParam = url.searchParams.get('lang');
	const language = langParam === 'en' ? 'en' : 'sv';

	return {
		resume,
		resumePerson,
		templateContext,
		experienceLibrary,
		avatarUrl: resumePerson?.avatar_url ?? null,
		language,
		isPdf: url.searchParams.get('pdf') === '1',
		canView,
		canEdit,
		canEditAll,
		isOwnProfile,
		meta: {
			title: `${siteMeta.name} — Resume ${resume.title}`,
			description: 'View and manage resume.',
			noindex: true,
			path: `/resumes/${talentId}/resume/${resumeId}`
		}
	};
};

export const actions: Actions = {
	saveResume: async ({ request, params, cookies }) => {
		const admin = getSupabaseAdminClient();
		const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
		if (!admin || !supabase) {
			return fail(401, { ok: false, message: 'Unauthorized' });
		}

		const resumeId = params.resumeId;
		if (!resumeId) {
			return fail(400, { ok: false, message: 'Invalid resume id' });
		}

		const formData = await request.formData();
		const contentRaw = formData.get('content');

		if (typeof contentRaw !== 'string') {
			return fail(400, { ok: false, message: 'Missing resume content' });
		}

		const { data: resumeOwner } = await admin
			.from('resumes')
			.select('talent_id')
			.eq('id', resumeId)
			.maybeSingle();

		if (!resumeOwner?.talent_id) {
			return fail(404, { ok: false, message: 'Resume not found' });
		}

		if (resumeOwner.talent_id !== params.personId) {
			return fail(400, { ok: false, message: 'Resume does not belong to this talent' });
		}

		const { canEdit } = await getResumeEditPermissions(supabase, admin, resumeOwner.talent_id);

		if (!canEdit) {
			return fail(403, { ok: false, message: 'Not authorized to edit this resume' });
		}

		const actor = await getActorAccessContext(supabase, admin);
		if (!actor.userId) {
			return fail(401, { ok: false, message: 'Unauthorized' });
		}
		try {
			await assertAcceptedForSensitiveAction({
				adminClient: admin,
				userId: actor.userId,
				homeOrganisationId: actor.homeOrganisationId
			});
		} catch (acceptanceError) {
			return fail(403, {
				ok: false,
				message:
					acceptanceError instanceof Error
						? acceptanceError.message
						: 'You must accept current legal documents before saving.'
			});
		}

		let content: ResumeData | null = null;
		try {
			content = JSON.parse(contentRaw) as ResumeData;
		} catch {
			return fail(400, { ok: false, message: 'Invalid resume content' });
		}

		if (!content || typeof content !== 'object') {
			return fail(400, { ok: false, message: 'Invalid resume content' });
		}

		try {
			await saveResumeData(admin, resumeId, resumeOwner.talent_id, content);
		} catch (saveError) {
			return fail(500, {
				ok: false,
				message: saveError instanceof Error ? saveError.message : 'Failed to save resume'
			});
		}

		return { ok: true };
	}
};
