import type { PageServerLoad } from './$types';
import { getAccessibleTalentIds } from '$lib/server/access';
import {
	PROFILE_AVAILABILITY_SELECT,
	normalizeAvailabilityRow
} from '$lib/server/consultantAvailability';
import { getEarliestAvailabilityDate } from '$lib/utils/availability';

const AVAILABLE_SOON_DAYS = 30;

const emptyStats = { totalTalents: 0, totalResumes: 0, availableNow: 0, availableSoon: 0 };

const countAvailableNow = (rows: Array<unknown> | null | undefined) =>
	(rows ?? []).reduce<number>((count, row) => {
		const availability = normalizeAvailabilityRow(row);
		return availability.nowPercent && availability.nowPercent > 0 ? count + 1 : count;
	}, 0);

const countAvailableSoon = (rows: Array<unknown> | null | undefined) => {
	const now = Date.now();
	const cutoff = AVAILABLE_SOON_DAYS * 24 * 60 * 60 * 1000;
	return (rows ?? []).reduce<number>((count, row) => {
		const availability = normalizeAvailabilityRow(row);
		if (availability.nowPercent != null && availability.nowPercent >= 50) return count;
		const earliest = getEarliestAvailabilityDate(availability);
		if (!earliest) return count;
		const daysMs = new Date(earliest).getTime() - now;
		return daysMs >= 0 && daysMs <= cutoff ? count + 1 : count;
	}, 0);
};

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
	let availableSoon = 0;

	if (accessibleTalentIds === null) {
		const [talentsCountResult, resumesCountResult, availabilityCountResult] = await Promise.all([
			adminClient.from('talents').select('id', { count: 'exact', head: true }),
			adminClient.from('resumes').select('id', { count: 'exact', head: true }),
			adminClient.from('profile_availability').select(PROFILE_AVAILABILITY_SELECT)
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

		totalTalents = Number(talentsCountResult.count ?? 0);
		totalResumes = Number(resumesCountResult.count ?? 0);
		availableNow = countAvailableNow(availabilityCountResult.data);
		availableSoon = countAvailableSoon(availabilityCountResult.data);
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
					.select(PROFILE_AVAILABILITY_SELECT)
					.in('profile_id', accessibleTalentIds)
			]);

			if (resumesCountResult.error) {
				console.warn('[dashboard] scoped resumes count failed', resumesCountResult.error);
			}
			if (availabilityCountResult.error) {
				console.warn('[dashboard] scoped availability count failed', availabilityCountResult.error);
			}

			totalResumes = Number(resumesCountResult.count ?? 0);
			availableNow = countAvailableNow(availabilityCountResult.data);
			availableSoon = countAvailableSoon(availabilityCountResult.data);
		}
	}

	return {
		stats: {
			totalTalents,
			totalResumes,
			availableNow,
			availableSoon
		}
	};
};
