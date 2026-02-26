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

export const load: PageServerLoad = async ({ params, url, cookies }) => {
	const resumeId = params.resumeId;
	const personId = params.personId;

	if (!resumeId || !personId) {
		throw error(400, 'Invalid identifier');
	}

	const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
	const adminClient = getSupabaseAdminClient();

	const resume = await ResumeService.getResume(resumeId);
	const resumePerson = await ResumeService.getPerson(personId);

	if (!resume || resume.personId !== personId) {
		throw error(404, 'Resume not found');
	}

	const { canEdit, canEditAll, isOwnProfile } = await getResumeEditPermissions(
		supabase,
		adminClient,
		resume.personId
	);

	const langParam = url.searchParams.get('lang');
	const language = langParam === 'en' ? 'en' : 'sv';

	return {
		resume,
		resumePerson,
		avatarUrl: resumePerson?.avatar_url ?? null,
		language,
		isPdf: url.searchParams.get('pdf') === '1',
		canEdit,
		canEditAll,
		isOwnProfile,
		meta: {
			title: `${siteMeta.name} — Resume ${resume.title}`,
			description: 'View and manage resume.',
			noindex: true,
			path: `/resumes/${personId}/resume/${resumeId}`
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
			.select('user_id')
			.eq('id', resumeId)
			.maybeSingle();

		if (!resumeOwner?.user_id) {
			return fail(404, { ok: false, message: 'Resume not found' });
		}

		if (resumeOwner.user_id !== params.personId) {
			return fail(400, { ok: false, message: 'Resume does not belong to this person' });
		}

		const { canEdit } = await getResumeEditPermissions(supabase, admin, resumeOwner.user_id);

		if (!canEdit) {
			return fail(403, { ok: false, message: 'Not authorized to edit this resume' });
		}

		let content: unknown = null;
		try {
			content = JSON.parse(contentRaw);
		} catch (err) {
			return fail(400, { ok: false, message: 'Invalid resume content' });
		}

		const { error: updateError } = await admin
			.from('resumes')
			.update({
				content,
				updated_at: new Date().toISOString()
			})
			.eq('id', resumeId);

		if (updateError) {
			return fail(500, { ok: false, message: updateError.message });
		}

		return { ok: true };
	}
};
