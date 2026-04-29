import { error, fail, isRedirect, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	canAccessOrganisationBilling,
	getCurrentBillingPeriodMonth,
	listRecentBillingMonths,
	loadBillingAddonVersions,
	loadBillingPlanVersions,
	loadOrganisationBillingMonthView,
	normalizePeriodMonth,
	removeOrganisationBillingAssignmentForward,
	saveOrganisationBillingReview,
	upsertOrganisationBillingAddon,
	upsertOrganisationBillingAssignment,
	deleteOrganisationBillingAddon
} from '$lib/server/billing';
import type {
	BillingAddonVersion,
	BillingMetricKey,
	BillingPlanVersion,
	BillingReviewMetricDecision
} from '$lib/types/billing';

const NO_PLAN_OPTION_VALUE = '__no_plan__';

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

const getPlanVersionGroupKey = (planVersion: BillingPlanVersion) =>
	`${planVersion.planFamily}:${planVersion.planCode}`;

const getAddonVersionGroupKey = (addonVersion: BillingAddonVersion) => addonVersion.addonCode;

const getSelectablePlanVersions = (
	planVersions: BillingPlanVersion[],
	selectedPlanVersionId: string | null
) => {
	const groups = new Map<string, BillingPlanVersion[]>();
	const order: string[] = [];

	for (const planVersion of planVersions) {
		const key = getPlanVersionGroupKey(planVersion);
		if (!groups.has(key)) {
			groups.set(key, []);
			order.push(key);
		}
		groups.get(key)?.push(planVersion);
	}

	const selectable: BillingPlanVersion[] = [];

	for (const key of order) {
		const versions = groups.get(key) ?? [];
		const latestActiveVersion = versions.find((planVersion) => planVersion.isActive) ?? null;
		const selectedVersion = selectedPlanVersionId
			? (versions.find((planVersion) => planVersion.id === selectedPlanVersionId) ?? null)
			: null;

		if (latestActiveVersion) {
			selectable.push(latestActiveVersion);
		}

		if (
			selectedVersion &&
			(!latestActiveVersion || selectedVersion.id !== latestActiveVersion.id)
		) {
			selectable.push(selectedVersion);
		}
	}

	return selectable;
};

const getSelectableAddonVersions = (addonVersions: BillingAddonVersion[]) => {
	const groups = new Map<string, BillingAddonVersion[]>();
	const order: string[] = [];

	for (const addonVersion of addonVersions) {
		const key = getAddonVersionGroupKey(addonVersion);
		if (!groups.has(key)) {
			groups.set(key, []);
			order.push(key);
		}
		groups.get(key)?.push(addonVersion);
	}

	return order
		.map((key) => groups.get(key)?.find((addonVersion) => addonVersion.isActive) ?? null)
		.filter((addonVersion): addonVersion is BillingAddonVersion => addonVersion !== null);
};

const getAssignmentActionErrorMessage = (caught: unknown, fallback: string) => {
	if (!(caught instanceof Error)) return fallback;

	if (
		caught.message.includes('null value in column "plan_version_id"') &&
		caught.message.includes('organisation_billing_assignments')
	) {
		return 'Selecting "No plan" requires the billing migration 20260428113000_allow_billing_plan_removal.sql to be applied to the database.';
	}

	return caught.message;
};

const redirectToBillingMonth = (organisationId: string, periodMonth: string) => {
	const normalizedMonth = normalizePeriodMonth(periodMonth);
	if (!normalizedMonth) throw new Error('Invalid effective month.');
	throw redirect(
		303,
		`/billing/${encodeURIComponent(organisationId)}?month=${encodeURIComponent(normalizedMonth)}`
	);
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

	const selectablePlanVersions = getSelectablePlanVersions(
		planVersions,
		monthView.plan?.planVersionId ?? null
	);
	const selectableAddonVersions = getSelectableAddonVersions(addonVersions);

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
		planVersions: selectablePlanVersions,
		addonVersions: selectableAddonVersions
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
			const planVersionId = parseRequiredString(formData, 'plan_version_id');
			const effectiveMonth = parseRequiredString(formData, 'effective_month');

			if (planVersionId === NO_PLAN_OPTION_VALUE) {
				await removeOrganisationBillingAssignmentForward({
					adminClient,
					organisationId: params.organisationId,
					effectiveMonth,
					createdByUserId: actor.userId
				});

				redirectToBillingMonth(params.organisationId, effectiveMonth);
			}

			await upsertOrganisationBillingAssignment({
				adminClient,
				organisationId: params.organisationId,
				planVersionId,
				effectiveMonth,
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

			redirectToBillingMonth(params.organisationId, effectiveMonth);
		} catch (caught) {
			if (isRedirect(caught) || caught instanceof Response) throw caught;
			return fail(400, {
				type: 'upsertAssignment',
				ok: false,
				message: getAssignmentActionErrorMessage(caught, 'Could not update plan assignment.')
			});
		}
	},
	deleteAssignment: async ({ request, locals, params }) => {
		try {
			const { adminClient, actor } = await requireBillingContext(
				locals,
				params.organisationId,
				true
			);
			const formData = await request.formData();
			const effectiveMonth = parseRequiredString(formData, 'effective_month');

			await removeOrganisationBillingAssignmentForward({
				adminClient,
				organisationId: params.organisationId,
				effectiveMonth,
				createdByUserId: actor.userId
			});

			redirectToBillingMonth(params.organisationId, effectiveMonth);
		} catch (caught) {
			if (isRedirect(caught) || caught instanceof Response) throw caught;
			return fail(400, {
				type: 'deleteAssignment',
				ok: false,
				message: getAssignmentActionErrorMessage(caught, 'Could not remove plan assignment.')
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
