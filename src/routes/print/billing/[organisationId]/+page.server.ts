import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	canAccessOrganisationBilling,
	getCurrentBillingPeriodMonth,
	loadOrganisationBillingMonthView,
	normalizePeriodMonth
} from '$lib/server/billing';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const requestContext = locals.requestContext;
	const adminClient = requestContext.getAdminClient();
	const actor = await requestContext.getActorContext();

	if (!adminClient || !actor.userId) {
		throw error(401, 'Unauthorized');
	}

	const organisationId = params.organisationId;
	if (!canAccessOrganisationBilling(actor, organisationId)) {
		throw error(403, 'Forbidden');
	}

	const selectedMonth =
		normalizePeriodMonth(url.searchParams.get('month')) ?? getCurrentBillingPeriodMonth();

	const [organisationResult, monthView] = await Promise.all([
		adminClient
			.from('organisations')
			.select('id, name, slug')
			.eq('id', organisationId)
			.maybeSingle(),
		loadOrganisationBillingMonthView(adminClient, organisationId, selectedMonth)
	]);

	if (organisationResult.error) throw error(500, organisationResult.error.message);
	if (!organisationResult.data) throw error(404, 'Organisation not found.');

	return {
		organisation: organisationResult.data,
		monthView
	};
};
