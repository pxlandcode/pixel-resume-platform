<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		Badge,
		SuperTable,
		TableHandler,
		Cell,
		type SuperTableHead
	} from '@pixelcode_/blocks/components';
	import {
		getBillingDisplayStatusLabel,
		getOverallBillingDisplayStatus,
		type BillingMetricKey,
		type BillingDisplayStatus,
		type BillingUsageMetric,
		type OrganisationBillingListRow
	} from '$lib/types/billing';
	import {
		AlertTriangle,
		Ban,
		Check,
		CircleDollarSign,
		Infinity as InfinityIcon,
		TrendingUp
	} from 'lucide-svelte';

	type MetricCellValue = {
		currentUsage: number;
		maxUsage: number;
		limit: number | null;
	};

	type TableRow = OrganisationBillingListRow & {
		source: OrganisationBillingListRow;
		displayName: string;
		planLabel: string;
		statusKey: BillingDisplayStatus;
		statusLabel: string;
		statusSeverity: number;
		totalOre: number;
		talentProfiles: MetricCellValue;
		talentUsers: MetricCellValue;
		adminSeats: MetricCellValue;
	};

	const STATUS_SEVERITY: Record<BillingDisplayStatus, number> = {
		within_plan: 0,
		ignore: 1,
		warning: 2,
		billable: 3,
		upgrade_recommended: 4,
		unlimited: -1
	};

	const createHeadings = (monthShortLabel: string): SuperTableHead<TableRow>[] => [
		{ heading: 'Organisation', sortable: 'displayName', width: 22 },
		{ heading: 'Plan', sortable: 'planLabel', width: 18 },
		{ heading: 'Status', sortable: 'statusSeverity', width: 12 },
		{ heading: 'Profiles', width: 10 },
		{ heading: 'Talent users', width: 10 },
		{ heading: 'Admin seats', width: 10 },
		{ heading: `${monthShortLabel} Cost`, sortable: 'totalOre', width: 18 }
	];

	export let rows: OrganisationBillingListRow[] = [];
	export let monthShortLabel = 'This month';

	const formatSek = (ore: number) =>
		new Intl.NumberFormat('sv-SE', {
			style: 'currency',
			currency: 'SEK',
			maximumFractionDigits: 0
		}).format(ore / 100);

	const formatPlanFamily = (value: string) =>
		value.length > 0 ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
	const formatMetric = ({ currentUsage, limit }: MetricCellValue) =>
		limit === null ? `${currentUsage}` : `${currentUsage} / ${limit}`;
	const getOrganisationBillingHref = (organisationId: string, periodMonth: string) =>
		`/billing/${organisationId}?month=${encodeURIComponent(periodMonth.slice(0, 7))}`;

	const getStatusBadgeVariant = (
		status: BillingDisplayStatus
	): 'default' | 'info' | 'success' | 'warning' | 'destructive' => {
		switch (status) {
			case 'within_plan':
				return 'success';
			case 'ignore':
				return 'default';
			case 'warning':
				return 'warning';
			case 'billable':
				return 'destructive';
			case 'upgrade_recommended':
				return 'destructive';
			case 'unlimited':
				return 'info';
		}
	};

	const getPlanFamilyBadgeVariant = (
		family: string
	): 'default' | 'info' | 'success' | 'warning' | 'destructive' => {
		switch (family) {
			case 'standard':
				return 'info';
			case 'broker':
				return 'success';
			default:
				return 'default';
		}
	};

	const getMetricValue = (
		metrics: BillingUsageMetric[],
		key: BillingMetricKey
	): MetricCellValue => {
		const metric = metrics.find((entry) => entry.key === key);

		return {
			currentUsage: metric?.currentUsage ?? 0,
			maxUsage: metric?.maxUsage ?? 0,
			limit: metric?.limit ?? null
		};
	};

	const isOverLimit = (metric: MetricCellValue) =>
		metric.limit !== null && metric.currentUsage > metric.limit;

	const toRows = (items: OrganisationBillingListRow[]): TableRow[] =>
		items.map((item) => {
			const statusKey = getOverallBillingDisplayStatus(item.metrics);

			return {
				...item,
				source: item,
				displayName: item.organisationName,
				planLabel: item.planName ?? 'No plan assigned',
				statusKey,
				statusLabel: getBillingDisplayStatusLabel(statusKey),
				statusSeverity: STATUS_SEVERITY[statusKey],
				totalOre: item.totals.totalOre,
				talentProfiles: getMetricValue(item.metrics, 'talent_profiles'),
				talentUsers: getMetricValue(item.metrics, 'talent_user_seats'),
				adminSeats: getMetricValue(item.metrics, 'admin_seats')
			};
		});

	let tableHeadings: SuperTableHead<TableRow>[] = createHeadings(monthShortLabel);
	let tableRows: TableRow[] = toRows(rows);
	let tableRevenueTotalOre = rows.reduce((total, row) => total + row.totals.totalOre, 0);
	let tableInstance = new TableHandler<TableRow>(
		tableHeadings,
		tableRows.map((row) => ({ ...row }))
	);

	$: tableHeadings = createHeadings(monthShortLabel);
	$: tableRows = toRows(rows);
	$: tableInstance = new TableHandler<TableRow>(
		tableHeadings,
		tableRows.map((row) => ({ ...row }))
	);

	$: tableRevenueTotalOre = rows.reduce((total, row) => total + row.totals.totalOre, 0);

	const openOrganisationBilling = (organisationId: string, periodMonth: string) => {
		void goto(getOrganisationBillingHref(organisationId, periodMonth));
	};

	const handleRowKeydown = (event: KeyboardEvent, organisationId: string, periodMonth: string) => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		openOrganisationBilling(organisationId, periodMonth);
	};
</script>

<div>
	<SuperTable instance={tableInstance} selectable={false} class="billing-table w-full">
		{#each tableInstance.data as row (row.organisationId)}
			<tr
				class="hover:bg-muted/40 focus-visible:bg-muted/40 cursor-pointer transition-colors"
				role="link"
				tabindex="0"
				aria-label={`Open billing for ${row.displayName}`}
				onclick={() => openOrganisationBilling(row.organisationId, row.periodMonth)}
				onkeydown={(event) => handleRowKeydown(event, row.organisationId, row.periodMonth)}
			>
				<Cell.Value class="py-3 align-middle">
					<span class="text-foreground text-sm font-semibold">
						{row.displayName}
					</span>
				</Cell.Value>

				<Cell.Value class="py-3 align-middle">
					<div class="flex items-center gap-2">
						<span class="text-foreground text-sm">{row.planLabel}</span>
						{#if row.planFamily}
							<Badge variant={getPlanFamilyBadgeVariant(row.planFamily)} size="xs"
								>{formatPlanFamily(row.planFamily)}</Badge
							>
						{/if}
					</div>
				</Cell.Value>

				<Cell.Value class="py-3 align-middle">
					<Badge variant={getStatusBadgeVariant(row.statusKey)} size="xs">
						{#if row.statusKey === 'within_plan'}
							<Check size={12} />
						{:else if row.statusKey === 'ignore'}
							<Ban size={12} />
						{:else if row.statusKey === 'warning'}
							<AlertTriangle size={12} />
						{:else if row.statusKey === 'billable'}
							<CircleDollarSign size={12} />
						{:else if row.statusKey === 'upgrade_recommended'}
							<TrendingUp size={12} />
						{:else if row.statusKey === 'unlimited'}
							<InfinityIcon size={12} />
						{/if}
						{row.statusLabel}
					</Badge>
				</Cell.Value>

				<Cell.Value class="py-3 align-middle">
					<span
						class="text-sm {isOverLimit(row.talentProfiles)
							? 'text-destructive font-semibold'
							: 'text-foreground'}"
					>
						{formatMetric(row.talentProfiles)}
					</span>
				</Cell.Value>

				<Cell.Value class="py-3 align-middle">
					<span
						class="text-sm {isOverLimit(row.talentUsers)
							? 'text-destructive font-semibold'
							: 'text-foreground'}"
					>
						{formatMetric(row.talentUsers)}
					</span>
				</Cell.Value>

				<Cell.Value class="py-3 align-middle">
					<span
						class="text-sm {isOverLimit(row.adminSeats)
							? 'text-destructive font-semibold'
							: 'text-foreground'}"
					>
						{formatMetric(row.adminSeats)}
					</span>
				</Cell.Value>

				<Cell.Value class="py-3 align-middle">
					<span class="text-foreground text-sm font-semibold">{formatSek(row.totalOre)}</span>
				</Cell.Value>
			</tr>
		{/each}
	</SuperTable>

	{#if rows.length === 0}
		<div class="text-muted-fg flex justify-center p-6 text-sm font-medium">
			No organisations found.
		</div>
	{:else}
		<div class="border-border/20 flex justify-end border-t pt-4">
			<div class="min-w-56 text-right">
				<p class="text-muted-fg text-xs font-medium uppercase tracking-wide">
					Total revenue {monthShortLabel}
				</p>
				<p class="text-foreground mt-1 text-lg font-semibold">
					{formatSek(tableRevenueTotalOre)}
				</p>
			</div>
		</div>
	{/if}
</div>

<style>
	:global(.billing-table + .flex.justify-center.p-2.text-sm.font-semibold) {
		display: none;
	}

	:global(.billing-table tr) {
		border-bottom: 1px solid var(--color-border);
		transition: background-color 0.15s ease;
	}

	:global(.billing-table tr:last-child) {
		border-bottom: none;
	}

	:global(.billing-table tr:hover) {
		background-color: color-mix(in oklab, var(--color-muted) 70%, transparent);
	}

	:global(.billing-table td) {
		padding-top: 0.75rem;
		padding-bottom: 0.75rem;
		padding-left: 0.75rem;
		padding-right: 0.75rem;
	}

	:global(.billing-table th) {
		padding-left: 0.75rem;
		padding-right: 0.75rem;
	}
</style>
