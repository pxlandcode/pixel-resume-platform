import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	canAccessOrganisationBilling,
	getCurrentBillingPeriodMonth,
	listRecentBillingMonths,
	loadBillingAddonVersions,
	loadBillingPlanVersions,
	loadOrganisationBillingMonthView,
	normalizePeriodMonth,
	saveOrganisationBillingReview,
	upsertOrganisationBillingAddon,
	upsertOrganisationBillingAssignment,
	deleteOrganisationBillingAddon
} from '$lib/server/billing';
import type { BillingMetricKey, BillingReviewMetricDecision } from '$lib/types/billing';

const parseRequiredString = (formData: FormData, key: string) => {
	const value = formData.get(key);
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`Missing ${key.replace(/_/g, ' ')}.`);
	}
	return value.trim();
};

const parseOptionalString = (formData: FormData, key: string) => {
	const value = formData.get(key);
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
};

const parseNullableInteger = (value: string | null) => {
	if (!value) return null;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error('Value must be a whole number or empty.');
	}
	return parsed;
};

const parseMoneyOre = (value: string | null) => {
	if (!value) return null;
	const normalized = value.replace(',', '.').trim();
	const parsed = Number(normalized);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error('Price must be a positive number.');
	}
	return Math.round(parsed * 100);
};

const parsePositiveInteger = (value: string | null, fallback = 1) => {
	if (!value) return fallback;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < 1) {
		throw new Error('Quantity must be at least 1.');
	}
	return parsed;
};

const requireBillingContext = async (
	locals: App.Locals,
	organisationId: string,
	requireAdmin = false
) => {
	const requestContext = locals.requestContext;
	const adminClient = requestContext.getAdminClient();
	const actor = await requestContext.getActorContext();

	if (!adminClient || !actor.userId) {
		throw error(401, 'Unauthorized');
	}
	if (!canAccessOrganisationBilling(actor, organisationId)) {
		throw error(403, 'Forbidden');
	}
	if (requireAdmin && !actor.isAdmin) {
		throw error(403, 'Only admins can update billing.');
	}

	return { adminClient, actor };
};

const buildReviewFlags = (formData: FormData) => {
	const decisionFlags: Partial<Record<BillingMetricKey, BillingReviewMetricDecision>> = {};

	for (const metricKey of ['talent_profiles', 'talent_user_seats', 'admin_seats'] as const) {
		const decision = parseOptionalString(formData, `decision_${metricKey}`);
		const note = parseOptionalString(formData, `note_${metricKey}`);
		decisionFlags[metricKey] = {
			decision:
				decision === 'ignore' ||
				decision === 'warning' ||
				decision === 'billable' ||
				decision === 'upgrade_recommended' ||
				decision === 'unlimited' ||
				decision === 'manual_override'
					? decision
					: null,
			note
		};
	}

	return decisionFlags;
};

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const organisationId = params.organisationId;
	const { adminClient, actor } = await requireBillingContext(locals, organisationId);
	const selectedMonth =
		normalizePeriodMonth(url.searchParams.get('month')) ?? getCurrentBillingPeriodMonth();

	const [organisationResult, monthView, planVersions, addonVersions] = await Promise.all([
		adminClient
			.from('organisations')
			.select('id, name, slug')
			.eq('id', organisationId)
			.maybeSingle(),
		loadOrganisationBillingMonthView(adminClient, organisationId, selectedMonth),
		actor.isAdmin ? loadBillingPlanVersions(adminClient) : Promise.resolve([]),
		actor.isAdmin ? loadBillingAddonVersions(adminClient) : Promise.resolve([])
	]);

	if (organisationResult.error) throw error(500, organisationResult.error.message);
	if (!organisationResult.data) throw error(404, 'Organisation not found.');

	const recentMonths = Array.from(
		new Set(
			[...listRecentBillingMonths(12), selectedMonth].sort((left, right) =>
				right.localeCompare(left)
			)
		)
	);

	return {
		organisation: organisationResult.data,
		monthView,
		selectedMonth,
		recentMonths,
		canManageBilling: actor.isAdmin,
		planVersions,
		addonVersions
	};
};

export const actions: Actions = {
	saveReview: async ({ request, locals, params }) => {
		try {
			const { adminClient, actor } = await requireBillingContext(
				locals,
				params.organisationId,
				true
			);
			const formData = await request.formData();
			const periodMonth =
				normalizePeriodMonth(parseOptionalString(formData, 'period_month')) ??
				getCurrentBillingPeriodMonth();

			await saveOrganisationBillingReview({
				adminClient,
				organisationId: params.organisationId,
				periodMonth,
				updatedByUserId: actor.userId,
				decisionFlags: buildReviewFlags(formData),
				notes: parseOptionalString(formData, 'review_notes')
			});

			return { type: 'saveReview', ok: true, message: 'Billing review saved.' };
		} catch (caught) {
			if (caught instanceof Response) throw caught;
			return fail(400, {
				type: 'saveReview',
				ok: false,
				message: caught instanceof Error ? caught.message : 'Could not save billing review.'
			});
		}
	},
	upsertAssignment: async ({ request, locals, params }) => {
		try {
			const { adminClient, actor } = await requireBillingContext(
				locals,
				params.organisationId,
				true
			);
			const formData = await request.formData();

			await upsertOrganisationBillingAssignment({
				adminClient,
				organisationId: params.organisationId,
				planVersionId: parseRequiredString(formData, 'plan_version_id'),
				effectiveMonth: parseRequiredString(formData, 'effective_month'),
				priceOverrideOre: parseMoneyOre(parseOptionalString(formData, 'price_override')),
				includedTalentProfilesOverride: parseNullableInteger(
					parseOptionalString(formData, 'included_talent_profiles_override')
				),
				includedTalentUserSeatsOverride: parseNullableInteger(
					parseOptionalString(formData, 'included_talent_user_seats_override')
				),
				includedAdminSeatsOverride: parseNullableInteger(
					parseOptionalString(formData, 'included_admin_seats_override')
				),
				notes: parseOptionalString(formData, 'assignment_notes'),
				createdByUserId: actor.userId
			});

			return { type: 'upsertAssignment', ok: true, message: 'Plan assignment updated.' };
		} catch (caught) {
			if (caught instanceof Response) throw caught;
			return fail(400, {
				type: 'upsertAssignment',
				ok: false,
				message: caught instanceof Error ? caught.message : 'Could not update plan assignment.'
			});
		}
	},
	upsertAddon: async ({ request, locals, params }) => {
		try {
			const { adminClient, actor } = await requireBillingContext(
				locals,
				params.organisationId,
				true
			);
			const formData = await request.formData();

			await upsertOrganisationBillingAddon({
				adminClient,
				organisationId: params.organisationId,
				addonId: parseOptionalString(formData, 'addon_id'),
				addonVersionId: parseRequiredString(formData, 'addon_version_id'),
				effectiveMonth: parseRequiredString(formData, 'effective_month'),
				endMonth: parseOptionalString(formData, 'end_month'),
				quantity: parsePositiveInteger(parseOptionalString(formData, 'quantity')),
				priceOverrideOre: parseMoneyOre(parseOptionalString(formData, 'price_override')),
				notes: parseOptionalString(formData, 'addon_notes'),
				createdByUserId: actor.userId
			});

			return { type: 'upsertAddon', ok: true, message: 'Add-on saved.' };
		} catch (caught) {
			if (caught instanceof Response) throw caught;
			return fail(400, {
				type: 'upsertAddon',
				ok: false,
				message: caught instanceof Error ? caught.message : 'Could not save add-on.'
			});
		}
	},
	deleteAddon: async ({ request, locals, params }) => {
		try {
			const { adminClient } = await requireBillingContext(locals, params.organisationId, true);
			const formData = await request.formData();

			await deleteOrganisationBillingAddon({
				adminClient,
				organisationId: params.organisationId,
				addonId: parseRequiredString(formData, 'addon_id')
			});

			return { type: 'deleteAddon', ok: true, message: 'Add-on removed.' };
		} catch (caught) {
			if (caught instanceof Response) throw caught;
			return fail(400, {
				type: 'deleteAddon',
				ok: false,
				message: caught instanceof Error ? caught.message : 'Could not remove add-on.'
			});
		}
	}
};
