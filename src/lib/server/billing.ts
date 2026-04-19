import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActorAccessContext } from '$lib/server/access';
import type {
	BillingAddonVersion,
	BillingCurrencyCode,
	BillingLineItem,
	BillingMetricKey,
	BillingMetricStatus,
	BillingPlanFamily,
	BillingPlanVersion,
	BillingReview,
	BillingReviewMetricDecision,
	BillingTotals,
	BillingUsageMetric,
	OrganisationBillingListRow,
	OrganisationBillingMonthView,
	ResolvedBillingPlan,
	ResolvedOrganisationBillingAddon
} from '$lib/types/billing';

export const BILLING_TIME_ZONE = 'Europe/Stockholm';

const BILLING_METRIC_ORDER: BillingMetricKey[] = [
	'talent_profiles',
	'talent_user_seats',
	'admin_seats'
];

const BILLING_METRIC_LABELS: Record<BillingMetricKey, string> = {
	talent_profiles: 'Talent profiles',
	talent_user_seats: 'Talent users',
	admin_seats: 'Admin seats'
};

const STATUS_SEVERITY: Record<BillingMetricStatus, number> = {
	ignore: 0,
	warning: 1,
	billable: 2,
	upgrade_recommended: 3,
	unlimited: -1
};

const ORGANISATION_IMAGES_BUCKET = 'organisation-images';

type BillingPlanVersionRow = {
	id: string;
	plan_family: BillingPlanFamily;
	plan_code: string;
	version_number: number;
	plan_name: string;
	currency_code: string;
	monthly_price_ore: number | string;
	included_talent_profiles: number | null;
	included_talent_user_seats: number | null;
	included_admin_seats: number | null;
	sort_order: number | null;
	features_json: unknown;
	metadata_json: unknown;
	is_active: boolean | null;
	created_at: string;
	updated_at: string;
};

type BillingAddonVersionRow = {
	id: string;
	addon_code: string;
	version_number: number;
	addon_name: string;
	billing_type: 'monthly' | 'one_time';
	currency_code: string;
	unit_price_ore: number | string;
	package_quantity: number | null;
	applies_to_metric: BillingMetricKey | null;
	sort_order: number | null;
	metadata_json: unknown;
	is_active: boolean | null;
	created_at: string;
	updated_at: string;
};

type OrganisationBillingAssignmentRow = {
	id: string;
	organisation_id: string;
	plan_version_id: string;
	effective_month: string;
	price_override_ore: number | string | null;
	included_talent_profiles_override: number | null;
	included_talent_user_seats_override: number | null;
	included_admin_seats_override: number | null;
	notes: string | null;
};

type OrganisationBillingAddonRow = {
	id: string;
	organisation_id: string;
	addon_version_id: string;
	effective_month: string;
	end_month: string | null;
	quantity: number | null;
	price_override_ore: number | string | null;
	notes: string | null;
};

type UsageSnapshotRow = {
	id: string;
	organisation_id: string;
	captured_at: string;
	talent_profiles_count: number | null;
	talent_user_seats_count: number | null;
	admin_seats_count: number | null;
};

type OrganisationBillingPeriodRow = {
	id: string;
	organisation_id: string;
	period_month: string;
	currency_code: string;
	plan_snapshot_json: unknown;
	addons_snapshot_json: unknown;
	metrics_json: unknown;
	totals_json: unknown;
	frozen_at: string;
	source_generated_at: string;
	created_at: string;
	updated_at: string;
};

type OrganisationBillingReviewRow = {
	id: string;
	organisation_id: string;
	period_month: string;
	billing_period_id: string | null;
	decision_flags_json: unknown;
	notes: string | null;
	updated_by_user_id: string | null;
	updated_at: string;
	created_at: string;
};

const toNumber = (value: number | string | null | undefined, fallback = 0) => {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string') {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return fallback;
};

const toInteger = (value: number | string | null | undefined, fallback = 0) =>
	Math.trunc(toNumber(value, fallback));

const toNullableInteger = (value: number | string | null | undefined) => {
	if (value === null || value === undefined) return null;
	return Math.trunc(toNumber(value));
};

const asObject = (value: unknown): Record<string, unknown> => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return value as Record<string, unknown>;
};

const asStringArray = (value: unknown): string[] => {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === 'string');
};

const pad2 = (value: number) => value.toString().padStart(2, '0');

const normalizeMonthParts = (year: number, month: number) => {
	const date = new Date(Date.UTC(year, month - 1, 1));
	return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-01`;
};

export const normalizePeriodMonth = (value: string | null | undefined): string | null => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;

	const shortMatch = /^(\d{4})-(\d{2})$/.exec(trimmed);
	if (shortMatch) {
		const year = Number(shortMatch[1]);
		const month = Number(shortMatch[2]);
		if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
			return null;
		}
		return normalizeMonthParts(year, month);
	}

	const fullMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
	if (fullMatch) {
		const year = Number(fullMatch[1]);
		const month = Number(fullMatch[2]);
		const day = Number(fullMatch[3]);
		if (
			!Number.isFinite(year) ||
			!Number.isFinite(month) ||
			!Number.isFinite(day) ||
			month < 1 ||
			month > 12 ||
			day < 1 ||
			day > 31
		) {
			return null;
		}
		return normalizeMonthParts(year, month);
	}

	return null;
};

const getZonedFormatter = (options: Intl.DateTimeFormatOptions) =>
	new Intl.DateTimeFormat('en-CA', {
		timeZone: BILLING_TIME_ZONE,
		hourCycle: 'h23',
		...options
	});

const resolveStoragePublicUrl = (adminClient: SupabaseClient, value: string | null | undefined) => {
	if (!value || typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (/^https?:\/\//i.test(trimmed)) return trimmed;
	const normalizedPath = trimmed.replace(/^\/+/, '').replace(/^organisation-images\//, '');
	const { data } = adminClient.storage
		.from(ORGANISATION_IMAGES_BUCKET)
		.getPublicUrl(normalizedPath);
	return data.publicUrl ?? null;
};

const getZonedParts = (date: Date) => {
	const parts = getZonedFormatter({
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	}).formatToParts(date);

	const valueByType = new Map(parts.map((part) => [part.type, part.value] as const));

	return {
		year: Number(valueByType.get('year') ?? '0'),
		month: Number(valueByType.get('month') ?? '0'),
		day: Number(valueByType.get('day') ?? '0'),
		hour: Number(valueByType.get('hour') ?? '0'),
		minute: Number(valueByType.get('minute') ?? '0'),
		second: Number(valueByType.get('second') ?? '0')
	};
};

const getTimeZoneOffsetMinutes = (date: Date) => {
	const parts = getZonedFormatter({
		timeZoneName: 'shortOffset',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	}).formatToParts(date);

	const timeZoneName = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
	if (timeZoneName === 'GMT') return 0;

	const match = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(timeZoneName);
	if (!match) return 0;

	const sign = match[1] === '-' ? -1 : 1;
	const hours = Number(match[2] ?? '0');
	const minutes = Number(match[3] ?? '0');
	return sign * (hours * 60 + minutes);
};

const getTimeZoneDate = (
	year: number,
	month: number,
	day: number,
	hour = 0,
	minute = 0,
	second = 0
) => {
	const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
	const initialOffset = getTimeZoneOffsetMinutes(new Date(utcGuess));
	let adjusted = utcGuess - initialOffset * 60_000;
	const adjustedOffset = getTimeZoneOffsetMinutes(new Date(adjusted));
	if (adjustedOffset !== initialOffset) {
		adjusted = utcGuess - adjustedOffset * 60_000;
	}
	return new Date(adjusted);
};

const addMonths = (periodMonth: string, delta: number) => {
	const normalized = normalizePeriodMonth(periodMonth);
	if (!normalized) throw new Error('Invalid billing period month.');
	const [year, month] = normalized.split('-').map((part) => Number(part));
	const source = new Date(Date.UTC(year, month - 1 + delta, 1));
	return normalizeMonthParts(source.getUTCFullYear(), source.getUTCMonth() + 1);
};

export const getCurrentBillingPeriodMonth = (now = new Date()) => {
	const { year, month } = getZonedParts(now);
	return normalizeMonthParts(year, month);
};

export const listRecentBillingMonths = (count = 12, now = new Date()) => {
	const months: string[] = [];
	const current = getCurrentBillingPeriodMonth(now);
	for (let index = 0; index < count; index += 1) {
		months.push(addMonths(current, -index));
	}
	return months;
};

export const isClosedBillingMonth = (periodMonth: string, now = new Date()) => {
	const normalized = normalizePeriodMonth(periodMonth);
	if (!normalized) return false;
	return normalized < getCurrentBillingPeriodMonth(now);
};

export const isCurrentBillingMonth = (periodMonth: string, now = new Date()) => {
	const normalized = normalizePeriodMonth(periodMonth);
	if (!normalized) return false;
	return normalized === getCurrentBillingPeriodMonth(now);
};

export const formatBillingPeriodLabel = (periodMonth: string) => {
	const normalized = normalizePeriodMonth(periodMonth);
	if (!normalized) return periodMonth;
	const [year, month] = normalized.split('-').map((part) => Number(part));
	const utcDate = new Date(Date.UTC(year, month - 1, 1));
	return new Intl.DateTimeFormat('sv-SE', {
		timeZone: BILLING_TIME_ZONE,
		month: 'long',
		year: 'numeric'
	}).format(utcDate);
};

export const canAccessOrganisationBilling = (
	actor: Pick<ActorAccessContext, 'isAdmin' | 'isOrganisationAdmin' | 'homeOrganisationId'>,
	organisationId: string
) => actor.isAdmin || (actor.isOrganisationAdmin && actor.homeOrganisationId === organisationId);

const resolvePeriodBounds = (periodMonth: string) => {
	const normalized = normalizePeriodMonth(periodMonth);
	if (!normalized) throw new Error('Invalid billing period month.');
	const [year, month] = normalized.split('-').map((part) => Number(part));
	const start = getTimeZoneDate(year, month, 1, 0, 0, 0);
	const nextMonth = addMonths(normalized, 1);
	const [nextYear, nextMonthNumber] = nextMonth.split('-').map((part) => Number(part));
	const end = getTimeZoneDate(nextYear, nextMonthNumber, 1, 0, 0, 0);
	return { normalized, start, end };
};

const roundToTwoDecimals = (value: number) => Math.round(value * 100) / 100;

const determineMetricStatus = (
	durationAboveLimitMs: number,
	limit: number | null
): BillingMetricStatus => {
	if (limit === null) return 'unlimited';
	if (durationAboveLimitMs < 24 * 60 * 60 * 1000) return 'ignore';
	if (durationAboveLimitMs < 72 * 60 * 60 * 1000) return 'warning';
	if (durationAboveLimitMs < 7 * 24 * 60 * 60 * 1000) return 'billable';
	return 'upgrade_recommended';
};

const mapBillingPlanVersion = (row: BillingPlanVersionRow): BillingPlanVersion => ({
	id: row.id,
	planFamily: row.plan_family,
	planCode: row.plan_code,
	versionNumber: row.version_number,
	planName: row.plan_name,
	currencyCode: row.currency_code,
	monthlyPriceOre: toInteger(row.monthly_price_ore),
	includedTalentProfiles: toNullableInteger(row.included_talent_profiles),
	includedTalentUserSeats: toNullableInteger(row.included_talent_user_seats),
	includedAdminSeats: toNullableInteger(row.included_admin_seats),
	sortOrder: toInteger(row.sort_order, 100),
	features: asStringArray(row.features_json),
	metadata: asObject(row.metadata_json),
	isActive: row.is_active !== false,
	createdAt: row.created_at,
	updatedAt: row.updated_at
});

const mapBillingAddonVersion = (row: BillingAddonVersionRow): BillingAddonVersion => ({
	id: row.id,
	addonCode: row.addon_code,
	versionNumber: row.version_number,
	addonName: row.addon_name,
	billingType: row.billing_type,
	currencyCode: row.currency_code,
	unitPriceOre: toInteger(row.unit_price_ore),
	packageQuantity: toNullableInteger(row.package_quantity),
	appliesToMetric: row.applies_to_metric ?? null,
	sortOrder: toInteger(row.sort_order, 100),
	metadata: asObject(row.metadata_json),
	isActive: row.is_active !== false,
	createdAt: row.created_at,
	updatedAt: row.updated_at
});

const mapReview = (row: OrganisationBillingReviewRow): BillingReview => {
	const rawFlags = asObject(row.decision_flags_json);
	const decisionFlags: Partial<Record<BillingMetricKey, BillingReviewMetricDecision>> = {};

	for (const metricKey of BILLING_METRIC_ORDER) {
		const metricValue = rawFlags[metricKey];
		if (!metricValue || typeof metricValue !== 'object' || Array.isArray(metricValue)) continue;
		const metricObject = metricValue as Record<string, unknown>;
		const rawDecision = metricObject.decision;
		const decision =
			rawDecision === 'ignore' ||
			rawDecision === 'warning' ||
			rawDecision === 'billable' ||
			rawDecision === 'upgrade_recommended' ||
			rawDecision === 'unlimited' ||
			rawDecision === 'manual_override'
				? rawDecision
				: null;
		const note = typeof metricObject.note === 'string' ? metricObject.note : null;
		decisionFlags[metricKey] = { decision, note };
	}

	return {
		id: row.id,
		organisationId: row.organisation_id,
		periodMonth: row.period_month,
		billingPeriodId: row.billing_period_id,
		decisionFlags,
		notes: row.notes,
		updatedByUserId: row.updated_by_user_id,
		updatedAt: row.updated_at,
		createdAt: row.created_at
	};
};

const serializeMetrics = (metrics: BillingUsageMetric[]) =>
	Object.fromEntries(metrics.map((metric) => [metric.key, metric])) as Record<string, unknown>;

const readSerializedMetrics = (value: unknown): BillingUsageMetric[] => {
	const raw = asObject(value);
	return BILLING_METRIC_ORDER.map((metricKey) => {
		const metricValue = raw[metricKey];
		const metric = asObject(metricValue);
		return {
			key: metricKey,
			label: typeof metric.label === 'string' ? metric.label : BILLING_METRIC_LABELS[metricKey],
			limit: metric.limit == null ? null : toInteger(metric.limit as number | string),
			currentUsage: toInteger(metric.currentUsage as number | string),
			maxUsage: toInteger(metric.maxUsage as number | string),
			averageUsage: roundToTwoDecimals(toNumber(metric.averageUsage as number | string, 0)),
			durationAboveLimitMs: toInteger(metric.durationAboveLimitMs as number | string),
			durationAboveLimitHours: roundToTwoDecimals(
				toNumber(metric.durationAboveLimitHours as number | string, 0)
			),
			status:
				metric.status === 'warning' ||
				metric.status === 'billable' ||
				metric.status === 'upgrade_recommended' ||
				metric.status === 'unlimited'
					? (metric.status as BillingMetricStatus)
					: 'ignore'
		} satisfies BillingUsageMetric;
	});
};

const buildTotals = (
	currencyCode: BillingCurrencyCode,
	lineItems: BillingLineItem[]
): BillingTotals => {
	const subtotalOre = lineItems.reduce((sum, item) => sum + item.totalPriceOre, 0);
	return {
		currencyCode,
		subtotalOre,
		totalOre: subtotalOre
	};
};

export const getOverallBillingStatus = (metrics: BillingUsageMetric[]) =>
	metrics.reduce((current: BillingMetricStatus, metric: BillingUsageMetric) => {
		return STATUS_SEVERITY[metric.status] > STATUS_SEVERITY[current] ? metric.status : current;
	}, 'ignore' as BillingMetricStatus);

export const loadBillingPlanVersions = async (
	adminClient: SupabaseClient
): Promise<BillingPlanVersion[]> => {
	const { data, error } = await adminClient
		.from('billing_plan_versions')
		.select('*')
		.order('sort_order', { ascending: true })
		.order('plan_family', { ascending: true })
		.order('plan_code', { ascending: true })
		.order('version_number', { ascending: false });

	if (error) throw new Error(error.message);

	return (data as BillingPlanVersionRow[] | null)?.map((row) => mapBillingPlanVersion(row)) ?? [];
};

export const loadBillingAddonVersions = async (
	adminClient: SupabaseClient
): Promise<BillingAddonVersion[]> => {
	const { data, error } = await adminClient
		.from('billing_addon_versions')
		.select('*')
		.order('sort_order', { ascending: true })
		.order('addon_code', { ascending: true })
		.order('version_number', { ascending: false });

	if (error) throw new Error(error.message);

	return (data as BillingAddonVersionRow[] | null)?.map((row) => mapBillingAddonVersion(row)) ?? [];
};

const loadResolvedBillingPlan = async (
	adminClient: SupabaseClient,
	organisationId: string,
	periodMonth: string
): Promise<ResolvedBillingPlan | null> => {
	const normalizedMonth = normalizePeriodMonth(periodMonth);
	if (!normalizedMonth) throw new Error('Invalid billing period month.');

	const { data: assignmentData, error: assignmentError } = await adminClient
		.from('organisation_billing_assignments')
		.select(
			'id, organisation_id, plan_version_id, effective_month, price_override_ore, included_talent_profiles_override, included_talent_user_seats_override, included_admin_seats_override, notes'
		)
		.eq('organisation_id', organisationId)
		.lte('effective_month', normalizedMonth)
		.order('effective_month', { ascending: false })
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();

	if (assignmentError) throw new Error(assignmentError.message);
	if (!assignmentData) return null;

	const assignment = assignmentData as OrganisationBillingAssignmentRow;
	const { data: planVersionData, error: planVersionError } = await adminClient
		.from('billing_plan_versions')
		.select('*')
		.eq('id', assignment.plan_version_id)
		.maybeSingle();

	if (planVersionError) throw new Error(planVersionError.message);
	if (!planVersionData) return null;

	const planVersion = mapBillingPlanVersion(planVersionData as BillingPlanVersionRow);

	return {
		planVersionId: planVersion.id,
		planFamily: planVersion.planFamily,
		planCode: planVersion.planCode,
		versionNumber: planVersion.versionNumber,
		planName: planVersion.planName,
		currencyCode: planVersion.currencyCode,
		monthlyPriceOre:
			assignment.price_override_ore == null
				? planVersion.monthlyPriceOre
				: toInteger(assignment.price_override_ore),
		includedTalentProfiles:
			assignment.included_talent_profiles_override ?? planVersion.includedTalentProfiles,
		includedTalentUserSeats:
			assignment.included_talent_user_seats_override ?? planVersion.includedTalentUserSeats,
		includedAdminSeats: assignment.included_admin_seats_override ?? planVersion.includedAdminSeats,
		notes: assignment.notes,
		features: planVersion.features,
		metadata: planVersion.metadata
	};
};

const loadResolvedBillingAddOns = async (
	adminClient: SupabaseClient,
	organisationId: string,
	periodMonth: string
): Promise<ResolvedOrganisationBillingAddon[]> => {
	const normalizedMonth = normalizePeriodMonth(periodMonth);
	if (!normalizedMonth) throw new Error('Invalid billing period month.');

	const { data, error } = await adminClient
		.from('organisation_billing_addons')
		.select(
			'id, organisation_id, addon_version_id, effective_month, end_month, quantity, price_override_ore, notes'
		)
		.eq('organisation_id', organisationId)
		.lte('effective_month', normalizedMonth)
		.order('effective_month', { ascending: false })
		.order('created_at', { ascending: false });

	if (error) throw new Error(error.message);

	const rows = (data as OrganisationBillingAddonRow[] | null) ?? [];
	if (rows.length === 0) return [];

	const addonVersionIds = Array.from(new Set(rows.map((row) => row.addon_version_id)));
	const { data: addonVersionsData, error: addonVersionsError } = await adminClient
		.from('billing_addon_versions')
		.select('*')
		.in('id', addonVersionIds);

	if (addonVersionsError) throw new Error(addonVersionsError.message);

	const addonVersionById = new Map(
		((addonVersionsData as BillingAddonVersionRow[] | null) ?? []).map((row) => {
			const version = mapBillingAddonVersion(row);
			return [version.id, version] as const;
		})
	);

	return rows
		.map((row) => {
			const version = addonVersionById.get(row.addon_version_id);
			if (!version) return null;

			if (version.billingType === 'monthly') {
				if (row.end_month && row.end_month <= normalizedMonth) {
					return null;
				}
			} else if (row.effective_month !== normalizedMonth) {
				return null;
			}

			const quantity = Math.max(1, toInteger(row.quantity, 1));
			const unitPriceOre =
				row.price_override_ore == null
					? version.unitPriceOre
					: Math.max(0, toInteger(row.price_override_ore));

			return {
				id: row.id,
				addonVersionId: version.id,
				addonCode: version.addonCode,
				addonName: version.addonName,
				billingType: version.billingType,
				currencyCode: version.currencyCode,
				unitPriceOre,
				quantity,
				totalPriceOre: unitPriceOre * quantity,
				packageQuantity: version.packageQuantity,
				appliesToMetric: version.appliesToMetric,
				effectiveMonth: row.effective_month,
				endMonth: row.end_month,
				notes: row.notes,
				metadata: version.metadata
			} satisfies ResolvedOrganisationBillingAddon;
		})
		.filter((row): row is ResolvedOrganisationBillingAddon => row !== null)
		.sort((left, right) => left.addonName.localeCompare(right.addonName));
};

const countSnapshotToUsage = (row: UsageSnapshotRow) => ({
	talent_profiles: toInteger(row.talent_profiles_count),
	talent_user_seats: toInteger(row.talent_user_seats_count),
	admin_seats: toInteger(row.admin_seats_count)
});

const computeUsageMetrics = (payload: {
	snapshots: UsageSnapshotRow[];
	baselineSnapshot: UsageSnapshotRow | null;
	periodStart: Date;
	analysisEnd: Date;
	plan: ResolvedBillingPlan | null;
}): { metrics: BillingUsageMetric[]; isPartialPeriod: boolean } => {
	const { snapshots, baselineSnapshot, periodStart, analysisEnd, plan } = payload;

	const durationsByMetric: Record<BillingMetricKey, number> = {
		talent_profiles: 0,
		talent_user_seats: 0,
		admin_seats: 0
	};

	const weightedTotalsByMetric: Record<BillingMetricKey, number> = {
		talent_profiles: 0,
		talent_user_seats: 0,
		admin_seats: 0
	};

	const maxUsageByMetric: Record<BillingMetricKey, number> = {
		talent_profiles: 0,
		talent_user_seats: 0,
		admin_seats: 0
	};

	const limits: Record<BillingMetricKey, number | null> = {
		talent_profiles: plan?.includedTalentProfiles ?? null,
		talent_user_seats: plan?.includedTalentUserSeats ?? null,
		admin_seats: plan?.includedAdminSeats ?? null
	};

	let currentUsage = {
		talent_profiles: 0,
		talent_user_seats: 0,
		admin_seats: 0
	};

	if (baselineSnapshot) {
		currentUsage = countSnapshotToUsage(baselineSnapshot);
	}

	let cursor = periodStart.getTime();
	const endMs = analysisEnd.getTime();
	const isPartialPeriod = !baselineSnapshot && snapshots.length > 0;

	for (const metricKey of BILLING_METRIC_ORDER) {
		maxUsageByMetric[metricKey] = currentUsage[metricKey];
	}

	for (const snapshot of snapshots) {
		const snapshotTime = new Date(snapshot.captured_at).getTime();
		if (!Number.isFinite(snapshotTime) || snapshotTime <= cursor || snapshotTime > endMs) continue;

		const duration = snapshotTime - cursor;
		for (const metricKey of BILLING_METRIC_ORDER) {
			weightedTotalsByMetric[metricKey] += currentUsage[metricKey] * duration;
			if (limits[metricKey] !== null && currentUsage[metricKey] > (limits[metricKey] ?? 0)) {
				durationsByMetric[metricKey] += duration;
			}
		}

		currentUsage = countSnapshotToUsage(snapshot);
		for (const metricKey of BILLING_METRIC_ORDER) {
			maxUsageByMetric[metricKey] = Math.max(maxUsageByMetric[metricKey], currentUsage[metricKey]);
		}
		cursor = snapshotTime;
	}

	if (endMs > cursor) {
		const duration = endMs - cursor;
		for (const metricKey of BILLING_METRIC_ORDER) {
			weightedTotalsByMetric[metricKey] += currentUsage[metricKey] * duration;
			if (limits[metricKey] !== null && currentUsage[metricKey] > (limits[metricKey] ?? 0)) {
				durationsByMetric[metricKey] += duration;
			}
		}
	}

	const totalDurationMs = Math.max(endMs - periodStart.getTime(), 1);

	const metrics = BILLING_METRIC_ORDER.map((metricKey) => {
		const averageUsage = weightedTotalsByMetric[metricKey] / totalDurationMs;
		const durationAboveLimitMs = durationsByMetric[metricKey];
		const limit = limits[metricKey];
		return {
			key: metricKey,
			label: BILLING_METRIC_LABELS[metricKey],
			limit,
			currentUsage: currentUsage[metricKey],
			maxUsage: maxUsageByMetric[metricKey],
			averageUsage: roundToTwoDecimals(averageUsage),
			durationAboveLimitMs,
			durationAboveLimitHours: roundToTwoDecimals(durationAboveLimitMs / (60 * 60 * 1000)),
			status: determineMetricStatus(durationAboveLimitMs, limit)
		} satisfies BillingUsageMetric;
	});

	return { metrics, isPartialPeriod };
};

const loadReviewRow = async (
	adminClient: SupabaseClient,
	organisationId: string,
	periodMonth: string
): Promise<BillingReview | null> => {
	const normalizedMonth = normalizePeriodMonth(periodMonth);
	if (!normalizedMonth) throw new Error('Invalid billing period month.');

	const { data, error } = await adminClient
		.from('organisation_billing_period_reviews')
		.select(
			'id, organisation_id, period_month, billing_period_id, decision_flags_json, notes, updated_by_user_id, updated_at, created_at'
		)
		.eq('organisation_id', organisationId)
		.eq('period_month', normalizedMonth)
		.maybeSingle();

	if (error) throw new Error(error.message);
	if (!data) return null;
	return mapReview(data as OrganisationBillingReviewRow);
};

const computeLiveBillingMonthView = async (
	adminClient: SupabaseClient,
	organisationId: string,
	periodMonth: string,
	now = new Date()
): Promise<OrganisationBillingMonthView> => {
	const { normalized, start, end } = resolvePeriodBounds(periodMonth);
	const currentMonth = getCurrentBillingPeriodMonth(now);
	const analysisEnd = normalized === currentMonth ? (now < end ? now : end) : end;

	const [plan, addOns, baselineSnapshotResult, snapshotsResult, review] = await Promise.all([
		loadResolvedBillingPlan(adminClient, organisationId, normalized),
		loadResolvedBillingAddOns(adminClient, organisationId, normalized),
		adminClient
			.from('organisation_usage_snapshots')
			.select(
				'id, organisation_id, captured_at, talent_profiles_count, talent_user_seats_count, admin_seats_count'
			)
			.eq('organisation_id', organisationId)
			.lt('captured_at', start.toISOString())
			.order('captured_at', { ascending: false })
			.order('id', { ascending: false })
			.limit(1)
			.maybeSingle(),
		adminClient
			.from('organisation_usage_snapshots')
			.select(
				'id, organisation_id, captured_at, talent_profiles_count, talent_user_seats_count, admin_seats_count'
			)
			.eq('organisation_id', organisationId)
			.gte('captured_at', start.toISOString())
			.lt('captured_at', analysisEnd.toISOString())
			.order('captured_at', { ascending: true })
			.order('id', { ascending: true }),
		loadReviewRow(adminClient, organisationId, normalized)
	]);

	if (baselineSnapshotResult.error) throw new Error(baselineSnapshotResult.error.message);
	if (snapshotsResult.error) throw new Error(snapshotsResult.error.message);

	const lineItems: BillingLineItem[] = [];
	if (plan) {
		lineItems.push({
			kind: 'plan',
			code: `${plan.planFamily}_${plan.planCode}`,
			name: plan.planName,
			quantity: 1,
			unitPriceOre: plan.monthlyPriceOre,
			totalPriceOre: plan.monthlyPriceOre,
			billingType: 'monthly',
			notes: plan.notes
		});
	}
	for (const addOn of addOns) {
		lineItems.push({
			kind: 'addon',
			code: addOn.addonCode,
			name: addOn.addonName,
			quantity: addOn.quantity,
			unitPriceOre: addOn.unitPriceOre,
			totalPriceOre: addOn.totalPriceOre,
			billingType: addOn.billingType,
			notes: addOn.notes
		});
	}

	const currencyCode = (plan?.currencyCode ??
		addOns[0]?.currencyCode ??
		'SEK') as BillingCurrencyCode;
	const { metrics, isPartialPeriod } = computeUsageMetrics({
		snapshots: ((snapshotsResult.data as UsageSnapshotRow[] | null) ?? []).slice(),
		baselineSnapshot: (baselineSnapshotResult.data as UsageSnapshotRow | null) ?? null,
		periodStart: start,
		analysisEnd,
		plan
	});

	return {
		organisationId,
		periodMonth: normalized,
		periodLabel: formatBillingPeriodLabel(normalized),
		isCurrentMonth: normalized === currentMonth,
		isClosedMonth: normalized < currentMonth,
		isFrozen: false,
		isPartialPeriod,
		usageAsOf: analysisEnd.toISOString(),
		plan,
		addOns,
		lineItems,
		metrics,
		totals: buildTotals(currencyCode, lineItems),
		review,
		frozenAt: null,
		sourceGeneratedAt: analysisEnd.toISOString()
	};
};

const mapFrozenBillingMonthView = (
	row: OrganisationBillingPeriodRow,
	review: BillingReview | null,
	now = new Date()
): OrganisationBillingMonthView => {
	const totals = asObject(row.totals_json);
	const lineItems = Array.isArray(totals.lineItems)
		? (totals.lineItems.filter(
				(item): item is BillingLineItem =>
					Boolean(item) &&
					typeof item === 'object' &&
					!Array.isArray(item) &&
					typeof (item as BillingLineItem).name === 'string'
			) as BillingLineItem[])
		: [];
	const planSnapshot = asObject(row.plan_snapshot_json);
	const plan =
		typeof planSnapshot.planVersionId === 'string'
			? ({
					planVersionId: planSnapshot.planVersionId,
					planFamily: planSnapshot.planFamily === 'broker' ? 'broker' : 'standard',
					planCode: typeof planSnapshot.planCode === 'string' ? planSnapshot.planCode : 'custom',
					versionNumber: toInteger(planSnapshot.versionNumber as number | string, 1),
					planName: typeof planSnapshot.planName === 'string' ? planSnapshot.planName : 'Custom',
					currencyCode:
						typeof planSnapshot.currencyCode === 'string'
							? planSnapshot.currencyCode
							: row.currency_code,
					monthlyPriceOre: toInteger(planSnapshot.monthlyPriceOre as number | string),
					includedTalentProfiles:
						planSnapshot.includedTalentProfiles == null
							? null
							: toInteger(planSnapshot.includedTalentProfiles as number | string),
					includedTalentUserSeats:
						planSnapshot.includedTalentUserSeats == null
							? null
							: toInteger(planSnapshot.includedTalentUserSeats as number | string),
					includedAdminSeats:
						planSnapshot.includedAdminSeats == null
							? null
							: toInteger(planSnapshot.includedAdminSeats as number | string),
					notes: typeof planSnapshot.notes === 'string' ? planSnapshot.notes : null,
					features: asStringArray(planSnapshot.features),
					metadata: asObject(planSnapshot.metadata)
				} satisfies ResolvedBillingPlan)
			: null;
	const addOns = Array.isArray(row.addons_snapshot_json)
		? (row.addons_snapshot_json.filter(
				(item): item is ResolvedOrganisationBillingAddon =>
					Boolean(item) &&
					typeof item === 'object' &&
					!Array.isArray(item) &&
					typeof (item as ResolvedOrganisationBillingAddon).addonName === 'string'
			) as ResolvedOrganisationBillingAddon[])
		: [];

	return {
		organisationId: row.organisation_id,
		periodMonth: row.period_month,
		periodLabel:
			typeof totals.periodLabel === 'string'
				? totals.periodLabel
				: formatBillingPeriodLabel(row.period_month),
		isCurrentMonth: isCurrentBillingMonth(row.period_month, now),
		isClosedMonth: true,
		isFrozen: true,
		isPartialPeriod: totals.isPartialPeriod === true,
		usageAsOf: typeof totals.usageAsOf === 'string' ? totals.usageAsOf : row.source_generated_at,
		plan,
		addOns,
		lineItems,
		metrics: readSerializedMetrics(row.metrics_json),
		totals: {
			currencyCode:
				typeof totals.currencyCode === 'string' ? totals.currencyCode : row.currency_code,
			subtotalOre: toInteger(totals.subtotalOre as number | string),
			totalOre: toInteger(totals.totalOre as number | string)
		},
		review,
		frozenAt: row.frozen_at,
		sourceGeneratedAt: row.source_generated_at
	};
};

export const ensureFrozenBillingPeriod = async (
	adminClient: SupabaseClient,
	organisationId: string,
	periodMonth: string,
	now = new Date()
): Promise<OrganisationBillingMonthView | null> => {
	const normalizedMonth = normalizePeriodMonth(periodMonth);
	if (!normalizedMonth) throw new Error('Invalid billing period month.');
	if (!isClosedBillingMonth(normalizedMonth, now)) return null;

	const { data: existingData, error: existingError } = await adminClient
		.from('organisation_billing_periods')
		.select(
			'id, organisation_id, period_month, currency_code, plan_snapshot_json, addons_snapshot_json, metrics_json, totals_json, frozen_at, source_generated_at, created_at, updated_at'
		)
		.eq('organisation_id', organisationId)
		.eq('period_month', normalizedMonth)
		.maybeSingle();

	if (existingError) throw new Error(existingError.message);
	if (existingData) {
		const review = await loadReviewRow(adminClient, organisationId, normalizedMonth);
		return mapFrozenBillingMonthView(existingData as OrganisationBillingPeriodRow, review, now);
	}

	const liveData = await computeLiveBillingMonthView(
		adminClient,
		organisationId,
		normalizedMonth,
		now
	);
	const frozenAt = now.toISOString();
	const insertPayload = {
		organisation_id: organisationId,
		period_month: normalizedMonth,
		currency_code: liveData.totals.currencyCode,
		plan_snapshot_json: liveData.plan ?? {},
		addons_snapshot_json: liveData.addOns,
		metrics_json: serializeMetrics(liveData.metrics),
		totals_json: {
			currencyCode: liveData.totals.currencyCode,
			subtotalOre: liveData.totals.subtotalOre,
			totalOre: liveData.totals.totalOre,
			lineItems: liveData.lineItems,
			isPartialPeriod: liveData.isPartialPeriod,
			usageAsOf: liveData.usageAsOf,
			periodLabel: liveData.periodLabel
		},
		frozen_at: frozenAt,
		source_generated_at: liveData.sourceGeneratedAt ?? frozenAt,
		updated_at: frozenAt
	};

	const { data: insertedData, error: insertError } = await adminClient
		.from('organisation_billing_periods')
		.insert(insertPayload)
		.select(
			'id, organisation_id, period_month, currency_code, plan_snapshot_json, addons_snapshot_json, metrics_json, totals_json, frozen_at, source_generated_at, created_at, updated_at'
		)
		.maybeSingle();

	if (insertError) {
		if (insertError.code === '23505') {
			const { data: racedData, error: racedError } = await adminClient
				.from('organisation_billing_periods')
				.select(
					'id, organisation_id, period_month, currency_code, plan_snapshot_json, addons_snapshot_json, metrics_json, totals_json, frozen_at, source_generated_at, created_at, updated_at'
				)
				.eq('organisation_id', organisationId)
				.eq('period_month', normalizedMonth)
				.maybeSingle();
			if (racedError) throw new Error(racedError.message);
			const review = await loadReviewRow(adminClient, organisationId, normalizedMonth);
			if (!racedData) return null;
			return mapFrozenBillingMonthView(racedData as OrganisationBillingPeriodRow, review, now);
		}
		throw new Error(insertError.message);
	}

	if (liveData.review) {
		const { error: reviewUpdateError } = await adminClient
			.from('organisation_billing_period_reviews')
			.update({
				billing_period_id: insertedData?.id ?? null,
				updated_at: frozenAt
			})
			.eq('id', liveData.review.id);
		if (reviewUpdateError) throw new Error(reviewUpdateError.message);
	}

	const review = await loadReviewRow(adminClient, organisationId, normalizedMonth);
	if (!insertedData) return null;
	return mapFrozenBillingMonthView(insertedData as OrganisationBillingPeriodRow, review, now);
};

export const loadOrganisationBillingMonthView = async (
	adminClient: SupabaseClient,
	organisationId: string,
	periodMonth: string,
	now = new Date()
): Promise<OrganisationBillingMonthView> => {
	const normalizedMonth = normalizePeriodMonth(periodMonth);
	if (!normalizedMonth) throw new Error('Invalid billing period month.');

	if (isClosedBillingMonth(normalizedMonth, now)) {
		const frozen = await ensureFrozenBillingPeriod(
			adminClient,
			organisationId,
			normalizedMonth,
			now
		);
		if (frozen) return frozen;
	}

	return computeLiveBillingMonthView(adminClient, organisationId, normalizedMonth, now);
};

export const saveOrganisationBillingReview = async (payload: {
	adminClient: SupabaseClient;
	organisationId: string;
	periodMonth: string;
	updatedByUserId: string | null;
	decisionFlags: Partial<Record<BillingMetricKey, BillingReviewMetricDecision>>;
	notes: string | null;
	now?: Date;
}) => {
	const normalizedMonth = normalizePeriodMonth(payload.periodMonth);
	if (!normalizedMonth) throw new Error('Invalid billing period month.');

	let billingPeriodId: string | null = null;
	if (isClosedBillingMonth(normalizedMonth, payload.now ?? new Date())) {
		const frozen = await ensureFrozenBillingPeriod(
			payload.adminClient,
			payload.organisationId,
			normalizedMonth,
			payload.now ?? new Date()
		);
		if (frozen?.isFrozen) {
			const { data: periodData, error: periodError } = await payload.adminClient
				.from('organisation_billing_periods')
				.select('id')
				.eq('organisation_id', payload.organisationId)
				.eq('period_month', normalizedMonth)
				.maybeSingle();

			if (periodError) throw new Error(periodError.message);
			billingPeriodId =
				typeof periodData?.id === 'string' && periodData.id.length > 0 ? periodData.id : null;
		}
	}

	const upsertPayload = {
		organisation_id: payload.organisationId,
		period_month: normalizedMonth,
		billing_period_id: billingPeriodId,
		decision_flags_json: payload.decisionFlags,
		notes: payload.notes,
		updated_by_user_id: payload.updatedByUserId,
		updated_at: (payload.now ?? new Date()).toISOString()
	};

	const { error } = await payload.adminClient
		.from('organisation_billing_period_reviews')
		.upsert(upsertPayload, {
			onConflict: 'organisation_id,period_month'
		});

	if (error) throw new Error(error.message);
};

export const upsertOrganisationBillingAssignment = async (payload: {
	adminClient: SupabaseClient;
	organisationId: string;
	planVersionId: string;
	effectiveMonth: string;
	priceOverrideOre: number | null;
	includedTalentProfilesOverride: number | null;
	includedTalentUserSeatsOverride: number | null;
	includedAdminSeatsOverride: number | null;
	notes: string | null;
	createdByUserId: string | null;
	now?: Date;
}) => {
	const normalizedMonth = normalizePeriodMonth(payload.effectiveMonth);
	if (!normalizedMonth) throw new Error('Invalid effective month.');

	const { error } = await payload.adminClient.from('organisation_billing_assignments').upsert(
		{
			organisation_id: payload.organisationId,
			plan_version_id: payload.planVersionId,
			effective_month: normalizedMonth,
			price_override_ore: payload.priceOverrideOre,
			included_talent_profiles_override: payload.includedTalentProfilesOverride,
			included_talent_user_seats_override: payload.includedTalentUserSeatsOverride,
			included_admin_seats_override: payload.includedAdminSeatsOverride,
			notes: payload.notes,
			created_by_user_id: payload.createdByUserId,
			updated_at: (payload.now ?? new Date()).toISOString()
		},
		{ onConflict: 'organisation_id,effective_month' }
	);

	if (error) throw new Error(error.message);
};

export const upsertOrganisationBillingAddon = async (payload: {
	adminClient: SupabaseClient;
	organisationId: string;
	addonId?: string | null;
	addonVersionId: string;
	effectiveMonth: string;
	endMonth: string | null;
	quantity: number;
	priceOverrideOre: number | null;
	notes: string | null;
	createdByUserId: string | null;
	now?: Date;
}) => {
	const normalizedEffectiveMonth = normalizePeriodMonth(payload.effectiveMonth);
	if (!normalizedEffectiveMonth) throw new Error('Invalid addon effective month.');
	const normalizedEndMonth = payload.endMonth ? normalizePeriodMonth(payload.endMonth) : null;
	if (payload.endMonth && !normalizedEndMonth) throw new Error('Invalid addon end month.');

	const record = {
		organisation_id: payload.organisationId,
		addon_version_id: payload.addonVersionId,
		effective_month: normalizedEffectiveMonth,
		end_month: normalizedEndMonth,
		quantity: Math.max(1, Math.trunc(payload.quantity)),
		price_override_ore: payload.priceOverrideOre,
		notes: payload.notes,
		created_by_user_id: payload.createdByUserId,
		updated_at: (payload.now ?? new Date()).toISOString()
	};

	if (payload.addonId) {
		const { error } = await payload.adminClient
			.from('organisation_billing_addons')
			.update(record)
			.eq('id', payload.addonId)
			.eq('organisation_id', payload.organisationId);
		if (error) throw new Error(error.message);
		return;
	}

	const { error } = await payload.adminClient.from('organisation_billing_addons').insert(record);
	if (error) throw new Error(error.message);
};

export const deleteOrganisationBillingAddon = async (payload: {
	adminClient: SupabaseClient;
	organisationId: string;
	addonId: string;
}) => {
	const { error } = await payload.adminClient
		.from('organisation_billing_addons')
		.delete()
		.eq('id', payload.addonId)
		.eq('organisation_id', payload.organisationId);

	if (error) throw new Error(error.message);
};

const resolveNextPlanVersionNumber = async (
	adminClient: SupabaseClient,
	planFamily: BillingPlanFamily,
	planCode: string
) => {
	const { data, error } = await adminClient
		.from('billing_plan_versions')
		.select('version_number')
		.eq('plan_family', planFamily)
		.eq('plan_code', planCode)
		.order('version_number', { ascending: false })
		.limit(1)
		.maybeSingle();

	if (error) throw new Error(error.message);
	return Math.max(toInteger(data?.version_number ?? 0), 0) + 1;
};

export const createBillingPlanVersion = async (payload: {
	adminClient: SupabaseClient;
	planFamily: BillingPlanFamily;
	planCode: string;
	planName: string;
	currencyCode: string;
	monthlyPriceOre: number;
	includedTalentProfiles: number | null;
	includedTalentUserSeats: number | null;
	includedAdminSeats: number | null;
	sortOrder: number;
	features: string[];
	metadata: Record<string, unknown>;
	now?: Date;
}) => {
	const versionNumber = await resolveNextPlanVersionNumber(
		payload.adminClient,
		payload.planFamily,
		payload.planCode
	);

	const { error } = await payload.adminClient.from('billing_plan_versions').insert({
		plan_family: payload.planFamily,
		plan_code: payload.planCode.trim(),
		version_number: versionNumber,
		plan_name: payload.planName.trim(),
		currency_code: payload.currencyCode.trim() || 'SEK',
		monthly_price_ore: Math.max(0, Math.trunc(payload.monthlyPriceOre)),
		included_talent_profiles: payload.includedTalentProfiles,
		included_talent_user_seats: payload.includedTalentUserSeats,
		included_admin_seats: payload.includedAdminSeats,
		sort_order: payload.sortOrder,
		features_json: payload.features,
		metadata_json: payload.metadata,
		updated_at: (payload.now ?? new Date()).toISOString()
	});

	if (error) throw new Error(error.message);
};

export const setBillingPlanVersionActiveState = async (payload: {
	adminClient: SupabaseClient;
	planVersionId: string;
	isActive: boolean;
	now?: Date;
}) => {
	const { error } = await payload.adminClient
		.from('billing_plan_versions')
		.update({
			is_active: payload.isActive,
			updated_at: (payload.now ?? new Date()).toISOString()
		})
		.eq('id', payload.planVersionId);

	if (error) throw new Error(error.message);
};

const resolveNextAddonVersionNumber = async (adminClient: SupabaseClient, addonCode: string) => {
	const { data, error } = await adminClient
		.from('billing_addon_versions')
		.select('version_number')
		.eq('addon_code', addonCode)
		.order('version_number', { ascending: false })
		.limit(1)
		.maybeSingle();

	if (error) throw new Error(error.message);
	return Math.max(toInteger(data?.version_number ?? 0), 0) + 1;
};

export const createBillingAddonVersion = async (payload: {
	adminClient: SupabaseClient;
	addonCode: string;
	addonName: string;
	billingType: 'monthly' | 'one_time';
	currencyCode: string;
	unitPriceOre: number;
	packageQuantity: number | null;
	appliesToMetric: BillingMetricKey | null;
	sortOrder: number;
	metadata: Record<string, unknown>;
	now?: Date;
}) => {
	const versionNumber = await resolveNextAddonVersionNumber(
		payload.adminClient,
		payload.addonCode.trim()
	);

	const { error } = await payload.adminClient.from('billing_addon_versions').insert({
		addon_code: payload.addonCode.trim(),
		version_number: versionNumber,
		addon_name: payload.addonName.trim(),
		billing_type: payload.billingType,
		currency_code: payload.currencyCode.trim() || 'SEK',
		unit_price_ore: Math.max(0, Math.trunc(payload.unitPriceOre)),
		package_quantity: payload.packageQuantity,
		applies_to_metric: payload.appliesToMetric,
		sort_order: payload.sortOrder,
		metadata_json: payload.metadata,
		updated_at: (payload.now ?? new Date()).toISOString()
	});

	if (error) throw new Error(error.message);
};

export const setBillingAddonVersionActiveState = async (payload: {
	adminClient: SupabaseClient;
	addonVersionId: string;
	isActive: boolean;
	now?: Date;
}) => {
	const { error } = await payload.adminClient
		.from('billing_addon_versions')
		.update({
			is_active: payload.isActive,
			updated_at: (payload.now ?? new Date()).toISOString()
		})
		.eq('id', payload.addonVersionId);

	if (error) throw new Error(error.message);
};

export const loadOrganisationBillingListRows = async (
	adminClient: SupabaseClient
): Promise<OrganisationBillingListRow[]> => {
	const currentMonth = getCurrentBillingPeriodMonth();
	const { data, error } = await adminClient
		.from('organisations')
		.select('id, name')
		.order('name', { ascending: true });

	if (error) throw new Error(error.message);

	const organisations = (
		(data as Array<{ id?: string | null; name?: string | null }> | null) ?? []
	).filter(
		(row): row is { id: string; name: string } =>
			typeof row.id === 'string' &&
			row.id.length > 0 &&
			typeof row.name === 'string' &&
			row.name.length > 0
	);

	const organisationIds = organisations.map((organisation) => organisation.id);
	const templatesResult =
		organisationIds.length === 0
			? {
					data: [] as Array<{
						organisation_id: string;
						main_logotype_path: string | null;
					}>,
					error: null
				}
			: await adminClient
					.from('organisation_templates')
					.select('organisation_id, main_logotype_path')
					.in('organisation_id', organisationIds);

	if (templatesResult.error) throw new Error(templatesResult.error.message);

	const organisationLogoUrlById = new Map<string, string | null>();
	for (const template of templatesResult.data ?? []) {
		organisationLogoUrlById.set(
			template.organisation_id,
			resolveStoragePublicUrl(adminClient, template.main_logotype_path)
		);
	}

	const rows = await Promise.all(
		organisations.map(async (organisation) => {
			const monthView = await loadOrganisationBillingMonthView(
				adminClient,
				organisation.id,
				currentMonth
			);

			return {
				organisationId: organisation.id,
				organisationName: organisation.name,
				organisationLogoUrl: organisationLogoUrlById.get(organisation.id) ?? null,
				planName: monthView.plan?.planName ?? null,
				planFamily: monthView.plan?.planFamily ?? null,
				periodMonth: currentMonth,
				metrics: monthView.metrics,
				totals: monthView.totals
			} satisfies OrganisationBillingListRow;
		})
	);

	return rows;
};
