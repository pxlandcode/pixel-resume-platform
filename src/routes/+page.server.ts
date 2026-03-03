import type { PageServerLoad } from './$types';
import { getAccessibleTalentIds } from '$lib/server/access';

const emptyStats = { totalTalents: 0, totalResumes: 0, availableNow: 0 };

export const load: PageServerLoad = async ({ locals }) => {
	const requestContext = locals.requestContext;
	const supabase = requestContext.getSupabaseClient();
	const adminClient = requestContext.getAdminClient();

	if (!supabase || !adminClient) {
		return { stats: emptyStats };
	}

	const actor = await requestContext.getActorContext();
	if (!actor.userId) {
		return { stats: emptyStats };
	}

	const accessibleTalentIds = await getAccessibleTalentIds(adminClient, actor);

	let totalTalents = 0;
	let totalResumes = 0;
	let availableNow = 0;

	if (accessibleTalentIds === null) {
		const [talentsCountResult, resumesCountResult, availabilityCountResult] = await Promise.all([
			adminClient.from('talents').select('id', { count: 'exact', head: true }),
			adminClient.from('resumes').select('id', { count: 'exact', head: true }),
			adminClient
				.from('profile_availability')
				.select('profile_id', { count: 'exact', head: true })
				.gt('availability_now_percent', 0)
		]);

		if (talentsCountResult.error) {
			console.warn('[dashboard] talents count failed', talentsCountResult.error);
		}
		if (resumesCountResult.error) {
			console.warn('[dashboard] resumes count failed', resumesCountResult.error);
		}
		if (availabilityCountResult.error) {
			console.warn('[dashboard] availability count failed', availabilityCountResult.error);
		}

		totalTalents = talentsCountResult.count ?? 0;
		totalResumes = resumesCountResult.count ?? 0;
		availableNow = availabilityCountResult.count ?? 0;
	} else {
		totalTalents = accessibleTalentIds.length;

		if (accessibleTalentIds.length > 0) {
			const [resumesCountResult, availabilityCountResult] = await Promise.all([
				adminClient
					.from('resumes')
					.select('id', { count: 'exact', head: true })
					.in('talent_id', accessibleTalentIds),
				adminClient
					.from('profile_availability')
					.select('profile_id', { count: 'exact', head: true })
					.in('profile_id', accessibleTalentIds)
					.gt('availability_now_percent', 0)
			]);

			if (resumesCountResult.error) {
				console.warn('[dashboard] scoped resumes count failed', resumesCountResult.error);
			}
			if (availabilityCountResult.error) {
				console.warn('[dashboard] scoped availability count failed', availabilityCountResult.error);
			}

			totalResumes = resumesCountResult.count ?? 0;
			availableNow = availabilityCountResult.count ?? 0;
		}
	}

	return {
		stats: {
			totalTalents,
			totalResumes,
			availableNow
		}
	};
};
