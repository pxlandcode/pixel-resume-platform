import type { PageServerLoad } from './$types';
import { AUTH_COOKIE_NAMES, createSupabaseServerClient } from '$lib/server/supabase';
import { ResumeService } from '$lib/services/resume';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, url, cookies }) => {
	const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
	if (!supabase) {
		throw error(401, 'Unauthorized');
	}

	const langParam = url.searchParams.get('lang');
	const language = langParam === 'en' ? 'en' : 'sv';

	const resumeId = params.id;

	if (!resumeId) {
		throw error(400, 'Invalid resume id');
	}

	const resume = await ResumeService.getResume(resumeId);
	const resumePerson = await ResumeService.getPerson(resume?.personId ?? '');

	if (!resume) {
		throw error(404, 'Resume not found');
	}

	return {
		resume,
		resumePerson,
		language,
		meta: {
			title: `Resume ${resume.title}`,
			description: 'Printable resume',
			noindex: true,
			path: `/print/resumes/${resumeId}`
		}
	};
};
