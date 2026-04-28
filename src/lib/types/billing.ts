export type BillingPlanFamily = 'standard' | 'broker';

export type BillingAddonBillingType = 'monthly' | 'one_time';

export type BillingMetricKey = 'talent_profiles' | 'talent_user_seats' | 'admin_seats';

export type BillingMetricStatus =
	| 'ignore'
	| 'warning'
	| 'billable'
	| 'upgrade_recommended'
	| 'unlimited';

export type BillingDisplayStatus = BillingMetricStatus | 'within_plan';

const BILLING_STATUS_SEVERITY: Record<BillingMetricStatus, number> = {
	ignore: 0,
	warning: 1,
	billable: 2,
	upgrade_recommended: 3,
	unlimited: -1
};

const BILLING_DISPLAY_STATUS_SEVERITY: Record<
	Exclude<BillingDisplayStatus, 'unlimited'>,
	number
> = {
	within_plan: 0,
	ignore: 1,
	warning: 2,
	billable: 3,
	upgrade_recommended: 4
};

export type BillingCurrencyCode = 'SEK' | string;

const getMetadataString = (metadata: Record<string, unknown> | null | undefined, key: string) => {
	const value = metadata?.[key];
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
};

export type BillingPlanVersion = {
	id: string;
	planFamily: BillingPlanFamily;
	planCode: string;
	versionNumber: number;
	planName: string;
	currencyCode: BillingCurrencyCode;
	monthlyPriceOre: number;
	includedTalentProfiles: number | null;
	includedTalentUserSeats: number | null;
	includedAdminSeats: number | null;
	sortOrder: number;
	features: string[];
	metadata: Record<string, unknown>;
	isActive: boolean;
	createdAt: string;
	updatedAt: string;
};

export type BillingAddonVersion = {
	id: string;
	addonCode: string;
	versionNumber: number;
	addonName: string;
	billingType: BillingAddonBillingType;
	currencyCode: BillingCurrencyCode;
	unitPriceOre: number;
	packageQuantity: number | null;
	appliesToMetric: BillingMetricKey | null;
	sortOrder: number;
	metadata: Record<string, unknown>;
	isActive: boolean;
	createdAt: string;
	updatedAt: string;
};

export type BillingLineItem = {
	kind: 'plan' | 'addon';
	code: string;
	name: string;
	quantity: number;
	unitPriceOre: number;
	totalPriceOre: number;
	billingType: BillingAddonBillingType | 'monthly';
	notes: string | null;
	metadata?: Record<string, unknown>;
};

export type ResolvedBillingPlan = {
	planVersionId: string;
	planFamily: BillingPlanFamily;
	planCode: string;
	versionNumber: number;
	planName: string;
	currencyCode: BillingCurrencyCode;
	monthlyPriceOre: number;
	includedTalentProfiles: number | null;
	includedTalentUserSeats: number | null;
	includedAdminSeats: number | null;
	notes: string | null;
	features: string[];
	metadata: Record<string, unknown>;
};

export type ResolvedOrganisationBillingAddon = {
	id: string;
	addonVersionId: string;
	addonCode: string;
	addonName: string;
	billingType: BillingAddonBillingType;
	currencyCode: BillingCurrencyCode;
	unitPriceOre: number;
	quantity: number;
	totalPriceOre: number;
	packageQuantity: number | null;
	appliesToMetric: BillingMetricKey | null;
	effectiveMonth: string;
	endMonth: string | null;
	notes: string | null;
	metadata: Record<string, unknown>;
};

export type BillingUsageMetric = {
	key: BillingMetricKey;
	label: string;
	limit: number | null;
	currentUsage: number;
	maxUsage: number;
	averageUsage: number;
	durationAboveLimitMs: number;
	durationAboveLimitHours: number;
	status: BillingMetricStatus;
};

export type BillingReviewMetricDecision = {
	decision: BillingMetricStatus | 'manual_override' | null;
	note: string | null;
};

export type BillingReview = {
	id: string;
	organisationId: string;
	periodMonth: string;
	billingPeriodId: string | null;
	decisionFlags: Partial<Record<BillingMetricKey, BillingReviewMetricDecision>>;
	notes: string | null;
	updatedByUserId: string | null;
	updatedAt: string;
	createdAt: string;
};

export type BillingTotals = {
	currencyCode: BillingCurrencyCode;
	subtotalOre: number;
	totalOre: number;
};

export type OrganisationBillingMonthView = {
	organisationId: string;
	periodMonth: string;
	periodLabel: string;
	isCurrentMonth: boolean;
	isClosedMonth: boolean;
	isFrozen: boolean;
	isPartialPeriod: boolean;
	usageAsOf: string;
	plan: ResolvedBillingPlan | null;
	addOns: ResolvedOrganisationBillingAddon[];
	lineItems: BillingLineItem[];
	metrics: BillingUsageMetric[];
	totals: BillingTotals;
	review: BillingReview | null;
	frozenAt: string | null;
	sourceGeneratedAt: string | null;
};

export type OrganisationBillingListRow = {
	organisationId: string;
	organisationName: string;
	organisationLogoUrl: string | null;
	planName: string | null;
	planFamily: BillingPlanFamily | null;
	periodMonth: string;
	metrics: BillingUsageMetric[];
	totals: BillingTotals;
};

export const getOverallBillingStatus = (metrics: BillingUsageMetric[]) =>
	metrics.reduce((current: BillingMetricStatus, metric: BillingUsageMetric) => {
		return BILLING_STATUS_SEVERITY[metric.status] > BILLING_STATUS_SEVERITY[current]
			? metric.status
			: current;
	}, 'ignore' as BillingMetricStatus);

export const getBillingPricePrefix = (metadata: Record<string, unknown> | null | undefined) =>
	metadata?.minimum_price === true ? 'från ' : '';

export const getBillingPriceSuffix = (metadata: Record<string, unknown> | null | undefined) =>
	getMetadataString(metadata, 'price_suffix');

export const getBillingQuantityUnitLabel = (metadata: Record<string, unknown> | null | undefined) =>
	getMetadataString(metadata, 'unit_label');

export const hasBillingMetricOverage = (metric: BillingUsageMetric) =>
	metric.limit !== null && metric.maxUsage > metric.limit;

export const getBillingMetricDisplayStatus = (metric: BillingUsageMetric): BillingDisplayStatus => {
	if (metric.limit === null) return 'unlimited';
	if (!hasBillingMetricOverage(metric)) return 'within_plan';
	return metric.status;
};

export const getBillingDisplayStatusLabel = (status: BillingDisplayStatus) => {
	switch (status) {
		case 'within_plan':
			return 'Within plan';
		case 'ignore':
			return 'Ignored (<24h)';
		case 'warning':
			return 'Warning';
		case 'billable':
			return 'Billable';
		case 'upgrade_recommended':
			return 'Upgrade recommended';
		case 'unlimited':
			return 'Unlimited';
	}
};

export const getOverallBillingDisplayStatus = (
	metrics: BillingUsageMetric[]
): BillingDisplayStatus => {
	if (metrics.length === 0) return 'within_plan';

	const displayStatuses = metrics.map((metric) => getBillingMetricDisplayStatus(metric));
	if (displayStatuses.every((status) => status === 'unlimited')) {
		return 'unlimited';
	}

	return displayStatuses.reduce<Exclude<BillingDisplayStatus, 'unlimited'>>((current, status) => {
		if (status === 'unlimited') return current;
		return BILLING_DISPLAY_STATUS_SEVERITY[status] > BILLING_DISPLAY_STATUS_SEVERITY[current]
			? status
			: current;
	}, 'within_plan');
};
