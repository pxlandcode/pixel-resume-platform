import type { PageServerLoad } from './$types';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { ResumeService } from '$lib/services/resume';
import { error } from '@sveltejs/kit';
import { getResumeEditPermissions } from '$lib/server/resumes/permissions';
import { getActorAccessContext, resolvePrintTemplateContext } from '$lib/server/access';

export const load: PageServerLoad = async ({ params, url, cookies }) => {
	const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
	const adminClient = getSupabaseAdminClient();
	if (!supabase || !adminClient) {
		throw error(401, 'Unauthorized');
	}

	const langParam = url.searchParams.get('lang');
	const language = langParam === 'en' ? 'en' : 'sv';

	const resumeId = params.id;

	if (!resumeId) {
		throw error(400, 'Invalid resume id');
	}

	const resume = await ResumeService.getResume(resumeId);

	if (!resume) {
		throw error(404, 'Resume not found');
	}

	const permissions = await getResumeEditPermissions(supabase, adminClient, resume.personId);
	if (!permissions.canView) {
		throw error(403, 'Not authorized to view this resume.');
	}

	const actor = await getActorAccessContext(supabase, adminClient);
	const templateContext = await resolvePrintTemplateContext(adminClient, actor, resume.personId);
	const resumePerson = await ResumeService.getPerson(resume.personId);

	return {
		resume,
		resumePerson,
		templateContext,
		language,
		meta: {
			title: `Resume ${resume.title}`,
			description: 'Printable resume',
			noindex: true,
			path: `/print/resumes/${resumeId}`
		}
	};
};
