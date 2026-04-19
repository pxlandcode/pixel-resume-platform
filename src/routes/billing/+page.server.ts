import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCurrentBillingPeriodMonth, loadOrganisationBillingListRows } from '$lib/server/billing';

const requireAdminBillingContext = async (locals: App.Locals) => {
	const requestContext = locals.requestContext;
	const adminClient = requestContext.getAdminClient();
	const actor = await requestContext.getActorContext();

	if (!adminClient || !actor.userId) {
		throw error(401, 'Unauthorized');
	}
	if (actor.isOrganisationAdmin && actor.homeOrganisationId) {
		throw redirect(302, `/billing/${actor.homeOrganisationId}`);
	}
	if (!actor.isAdmin) {
		throw error(403, 'Forbidden');
	}

	return { adminClient };
};

export const load: PageServerLoad = async ({ locals }) => {
	const { adminClient } = await requireAdminBillingContext(locals);
	const rows = await loadOrganisationBillingListRows(adminClient);

	return {
		rows,
		currentMonth: getCurrentBillingPeriodMonth()
	};
};
