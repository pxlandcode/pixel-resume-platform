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
import { saveResumeData } from '$lib/server/resumes/store';
import type { ResumeData } from '$lib/types/resume';
import {
	getActorAccessContext,
	resolvePrintTemplateContext,
	type ActorAccessContext
} from '$lib/server/access';
import { resolveHomeOrganisationId } from '$lib/server/homeOrganisation';
import { assertAcceptedForSensitiveAction } from '$lib/server/legalGate';
import { writeAuditLog } from '$lib/server/legalService';
import {
	createResumeShareLink,
	parseResumeShareForm,
	ResumeShareAccessError
} from '$lib/server/resumeShares';

const actorContextFromPermissions = (
	permissions: Awaited<ReturnType<typeof getResumeEditPermissions>>
): ActorAccessContext => {
	const roles = permissions.roles ?? [];
	return {
		userId: permissions.userId,
		roles,
		primaryRole: roles[0] ?? null,
		isAdmin: roles.includes('admin'),
		isBroker: roles.includes('broker'),
		isEmployer: roles.includes('employer'),
		isTalent: roles.includes('talent'),
		homeOrganisationId: permissions.homeOrganisationId,
		accessibleOrganisationIds: permissions.accessibleOrganisationIds,
		talentId: null
	};
};

export const load: PageServerLoad = async ({ params, url, cookies }) => {
	const resumeId = params.resumeId;
	const talentId = params.personId;

	if (!resumeId || !talentId) {
		throw error(400, 'Invalid identifier');
	}

	const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
	const adminClient = getSupabaseAdminClient();
	const [resume, resumePerson, permissions] = await Promise.all([
		ResumeService.getResume(resumeId),
		ResumeService.getPerson(talentId),
		getResumeEditPermissions(supabase, adminClient, talentId)
	]);

	if (!resume || resume.personId !== talentId) {
		throw error(404, 'Resume not found');
	}

	const { canView, canEdit, canEditAll, isOwnProfile } = permissions;
	if (!canView) {
		throw error(403, 'Not authorized to view this resume.');
	}

	const actor = actorContextFromPermissions(permissions);
	const templateContext = await resolvePrintTemplateContext(adminClient, actor, resume.personId, {
		templateMode: 'source'
	});
	const auditOrganisationId = permissions.talentOrganisationId ?? actor.homeOrganisationId ?? null;
	if (actor.userId && auditOrganisationId) {
		void writeAuditLog({
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
				template_used: templateContext.source === 'target_org' ? 'target' : 'source'
			}
		}).then((auditResult) => {
			if (!auditResult.ok) {
				console.warn('[resume detail] could not write resume view audit log', auditResult.error);
			}
		});
	}

	const langParam = url.searchParams.get('lang');
	const language = langParam === 'en' ? 'en' : 'sv';

	return {
		resume,
		resumePerson,
		templateContext,
		experienceLibrary: [],
		experienceLibraryLoaded: false,
		avatarUrl: resumePerson?.avatar_url ?? null,
		language,
		isPdf: url.searchParams.get('pdf') === '1',
		talentOrganisationId: permissions.talentOrganisationId ?? null,
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
		const resolvedHomeOrganisationId = await resolveHomeOrganisationId({
			adminClient: admin,
			homeOrganisationId: actor.homeOrganisationId,
			talentId: actor.talentId
		});
		try {
			await assertAcceptedForSensitiveAction({
				adminClient: admin,
				userId: actor.userId,
				homeOrganisationId: resolvedHomeOrganisationId
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

		return { ok: true, message: 'Resume saved.' };
	},
	createResumeShareLink: async ({ request, params, cookies, url }) => {
		const admin = getSupabaseAdminClient();
		const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
		if (!admin || !supabase) {
			return fail(401, { ok: false, message: 'Unauthorized' });
		}

		const resumeId = params.resumeId;
		if (!resumeId) {
			return fail(400, { ok: false, message: 'Invalid resume id' });
		}

		const actor = await getActorAccessContext(supabase, admin);
		if (!actor.userId) {
			return fail(401, { ok: false, message: 'Unauthorized' });
		}
		const resolvedHomeOrganisationId = await resolveHomeOrganisationId({
			adminClient: admin,
			homeOrganisationId: actor.homeOrganisationId,
			talentId: actor.talentId
		});

		try {
			await assertAcceptedForSensitiveAction({
				adminClient: admin,
				userId: actor.userId,
				homeOrganisationId: resolvedHomeOrganisationId
			});
		} catch (acceptanceError) {
			return fail(403, {
				ok: false,
				message:
					acceptanceError instanceof Error
						? acceptanceError.message
						: 'You must accept current legal documents before sharing.'
			});
		}

		const formData = await request.formData();
		const parsed = parseResumeShareForm(formData);

		try {
			const result = await createResumeShareLink({
				adminClient: admin,
				actor,
				resumeId,
				label: parsed.label,
				isAnonymized: parsed.isAnonymized,
				accessMode: parsed.accessMode,
				languageMode: parsed.languageMode,
				password: parsed.password,
				neverExpires: parsed.neverExpires,
				expiresInDays: parsed.expiresInDays,
				allowDownload: parsed.allowDownload,
				contactName: parsed.contactName,
				contactEmail: parsed.contactEmail,
				contactPhone: parsed.contactPhone,
				contactNote: parsed.contactNote,
				origin: url.origin
			});

			return {
				ok: true,
				shareUrl: result.shareUrl,
				linkId: result.linkId,
				message: 'Share link created.'
			};
		} catch (shareError) {
			if (shareError instanceof ResumeShareAccessError) {
				return fail(shareError.status, {
					ok: false,
					message: shareError.message
				});
			}

			return fail(500, {
				ok: false,
				message: shareError instanceof Error ? shareError.message : 'Could not create share link.'
			});
		}
	}
};
