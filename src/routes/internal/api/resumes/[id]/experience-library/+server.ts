import { json, type RequestHandler } from '@sveltejs/kit';
import { getTalentAccess } from '$lib/server/access';
import { listExperienceLibrary } from '$lib/server/resumes/store';

export const GET: RequestHandler = async ({ params, locals }) => {
	const resumeId = params.id?.trim() ?? '';
	if (!resumeId) {
		return json({ message: 'Invalid resume id.' }, { status: 400 });
	}

	const requestContext = locals.requestContext;
	const adminClient = requestContext.getAdminClient();
	const actor = await requestContext.getActorContext();
	if (!adminClient || !actor.userId) {
		return json({ message: 'Unauthorized.' }, { status: 401 });
	}

	const { data: resumeRow, error: resumeError } = await adminClient
		.from('resumes')
		.select('talent_id')
		.eq('id', resumeId)
		.maybeSingle();
	if (resumeError) {
		console.warn('[experience-library] failed to resolve resume owner', {
			resumeId,
			error: resumeError.message
		});
		return json({ message: 'Could not resolve resume owner.' }, { status: 500 });
	}

	const talentId =
		typeof resumeRow?.talent_id === 'string' && resumeRow.talent_id.trim().length > 0
			? resumeRow.talent_id
			: null;
	if (!talentId) {
		return json({ message: 'Resume not found.' }, { status: 404 });
	}

	const access = await getTalentAccess(adminClient, actor, talentId);
	if (!access.canEdit) {
		return json({ message: 'Not authorized to edit this resume.' }, { status: 403 });
	}

	try {
		const items = await listExperienceLibrary(adminClient, talentId);
		return json({ items });
	} catch (error) {
		console.error('[experience-library] failed to list items', { resumeId, talentId, error });
		return json({ message: 'Could not load experience library.' }, { status: 500 });
	}
};
