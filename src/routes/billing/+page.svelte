<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import { slide } from 'svelte/transition';
	import { Badge, Button, Card, Input } from '@pixelcode_/blocks/components';
	import BillingTable from '$lib/components/admin/BillingTable.svelte';
	import { DropdownCheckbox } from '$lib/components/dropdown-checkbox';
	import { userSettingsStore } from '$lib/stores/userSettings';
	import {
		getBillingDisplayStatusLabel,
		getOverallBillingDisplayStatus,
		type BillingMetricKey,
		type BillingDisplayStatus,
		type BillingPlanFamily,
		type BillingUsageMetric,
		type OrganisationBillingListRow
	} from '$lib/types/billing';
	import type { ViewMode } from '$lib/types/userSettings';
	import {
		AlertTriangle,
		Ban,
		Check,
		CircleDollarSign,
		Infinity as InfinityIcon,
		LayoutGrid,
		List,
		Search,
		SlidersHorizontal,
		TrendingUp
	} from 'lucide-svelte';

	type BillingPlanFamilyFilter = BillingPlanFamily | '__none__';
	type MetricCellValue = {
		currentUsage: number;
		maxUsage: number;
		limit: number | null;
	};

	const UNASSIGNED_PLAN_FILTER = '__none__';
	const planFamilyFilterOptions = [
		{ label: 'Standard', value: 'standard' },
		{ label: 'Broker', value: 'broker' },
		{ label: 'No plan', value: UNASSIGNED_PLAN_FILTER }
	];
	const statusFilterOptions = [
		{ label: 'Within plan', value: 'within_plan' },
		{ label: 'Ignored (<24h)', value: 'ignore' },
		{ label: 'Warning', value: 'warning' },
		{ label: 'Billable', value: 'billable' },
		{ label: 'Upgrade recommended', value: 'upgrade_recommended' },
		{ label: 'Unlimited', value: 'unlimited' }
	];

	let { data } = $props();

	let filtersOpen = $state(false);
	let searchQuery = $state('');
	let selectedPlanFamilies = $state<BillingPlanFamilyFilter[]>([]);
	let selectedStatusFilters = $state<BillingDisplayStatus[]>([]);

	const billingViewMode = $derived($userSettingsStore.settings.views.billing);
	const formatMonth = (value: string) => value.slice(0, 7);
	const formatMonthShort = (value: string) =>
		new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(
			new Date(`${value}T00:00:00Z`)
		);
	const formatSek = (ore: number) =>
		new Intl.NumberFormat('sv-SE', {
			style: 'currency',
			currency: 'SEK',
			maximumFractionDigits: 0
		}).format(ore / 100);
	const formatPlanFamily = (value: string) =>
		value.length > 0 ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
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
	const formatMetric = ({ currentUsage, limit }: MetricCellValue) =>
		limit === null ? `${currentUsage}` : `${currentUsage} / ${limit}`;
	const isOverLimit = (metric: MetricCellValue) =>
		metric.limit !== null && metric.currentUsage > metric.limit;
	const getOrganisationInitials = (value: string) =>
		value
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part.charAt(0).toUpperCase())
			.join('') || 'O';

	const organisationFilterOptions = $derived.by(() =>
		Array.from(
			new Map(
				(data.rows as OrganisationBillingListRow[]).map((row) => [
					row.organisationId,
					{ label: row.organisationName, value: row.organisationId }
				])
			).values()
		).sort((left, right) => left.label.localeCompare(right.label))
	);
	const availableOrganisationIds = $derived(
		organisationFilterOptions.map((organisation) => organisation.value)
	);

	const sanitizeOrganisationIds = (ids: string[]) => {
		const allowed = new Set(availableOrganisationIds);
		return Array.from(
			new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0 && allowed.has(id)))
		);
	};

	const sanitizePlanFamilyFilters = (values: string[]) => {
		const allowed = new Set<BillingPlanFamilyFilter>([
			'standard',
			'broker',
			UNASSIGNED_PLAN_FILTER
		]);
		return Array.from(
			new Set(
				values.filter((value): value is BillingPlanFamilyFilter =>
					allowed.has(value as BillingPlanFamilyFilter)
				)
			)
		);
	};

	const sanitizeStatusFilters = (values: string[]) => {
		const allowed = new Set<BillingDisplayStatus>([
			'within_plan',
			'ignore',
			'warning',
			'billable',
			'upgrade_recommended',
			'unlimited'
		]);
		return Array.from(
			new Set(
				values.filter((value): value is BillingDisplayStatus =>
					allowed.has(value as BillingDisplayStatus)
				)
			)
		);
	};

	const currentMonthShort = $derived(formatMonthShort(data.currentMonth));

	const selectedOrganisationIds = $derived.by(() =>
		sanitizeOrganisationIds($userSettingsStore.settings.organisationFilters.billing)
	);

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

	const filteredRows = $derived.by(() => {
		let items = [...((data.rows as OrganisationBillingListRow[] | undefined) ?? [])];

		if (selectedOrganisationIds.length > 0) {
			const selected = new Set(selectedOrganisationIds);
			items = items.filter((row) => selected.has(row.organisationId));
		}

		if (selectedPlanFamilies.length > 0) {
			const selected = new Set(selectedPlanFamilies);
			items = items.filter((row) => {
				if (row.planFamily) return selected.has(row.planFamily);
				return selected.has(UNASSIGNED_PLAN_FILTER);
			});
		}

		if (selectedStatusFilters.length > 0) {
			const selected = new Set(selectedStatusFilters);
			items = items.filter((row) => selected.has(getOverallBillingDisplayStatus(row.metrics)));
		}

		return items;
	});

	const searchFilteredRows = $derived.by(() => {
		if (!searchQuery.trim()) return filteredRows;

		const query = searchQuery.trim().toLowerCase();
		return filteredRows.filter((row) => {
			const status = getBillingDisplayStatusLabel(
				getOverallBillingDisplayStatus(row.metrics)
			).toLowerCase();
			const planLabel = (row.planName ?? 'No plan assigned').toLowerCase();
			const planFamily = row.planFamily ? formatPlanFamily(row.planFamily).toLowerCase() : '';

			return (
				row.organisationName.toLowerCase().includes(query) ||
				planLabel.includes(query) ||
				planFamily.includes(query) ||
				status.includes(query)
			);
		});
	});

	const setBillingViewMode = (mode: ViewMode) => {
		void userSettingsStore.setViewMode('billing', mode);
	};

	const toggleFilters = () => {
		filtersOpen = !filtersOpen;
	};

	const handleOrganisationFilterChange = (selected: string[]) => {
		void userSettingsStore.setOrganisationFilters('billing', sanitizeOrganisationIds(selected));
	};

	const handlePlanFamilyFilterChange = (selected: string[]) => {
		selectedPlanFamilies = sanitizePlanFamilyFilters(selected);
	};

	const handleStatusFilterChange = (selected: string[]) => {
		selectedStatusFilters = sanitizeStatusFilters(selected);
	};
</script>

<svelte:head>
	<title>Billing</title>
</svelte:head>

<div class="relative space-y-6">
	<div class="absolute right-0 top-0 z-10 flex items-center gap-2">
		<div class="border-border bg-card inline-flex rounded-sm border p-1">
			<button
				type="button"
				onclick={toggleFilters}
				class="rounded-xs relative inline-flex cursor-pointer items-center justify-center p-1.5 transition-colors {filtersOpen
					? 'border-primary bg-primary hover:bg-primary/90 text-white'
					: 'text-primary hover:bg-primary/20 border-transparent bg-transparent'}"
				aria-label="Toggle filters"
			>
				<SlidersHorizontal size={16} />
			</button>
		</div>
		<div class="border-border bg-card inline-flex rounded-sm border p-1">
			<Button
				type="button"
				variant="outline"
				size="sm"
				onclick={() => setBillingViewMode('grid')}
				class={`px-2 ${
					billingViewMode === 'grid'
						? 'border-primary bg-primary hover:bg-primary/90 text-white hover:text-white'
						: 'border-transparent bg-transparent'
				}`}
			>
				<LayoutGrid size={16} />
			</Button>
			<Button
				type="button"
				variant="outline"
				size="sm"
				onclick={() => setBillingViewMode('list')}
				class={`px-2 ${
					billingViewMode === 'list'
						? 'border-primary bg-primary hover:bg-primary/90 text-white hover:text-white'
						: 'border-transparent bg-transparent'
				}`}
			>
				<List size={16} />
			</Button>
		</div>
	</div>

	<header>
		<h1 class="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">Billing</h1>
		<p class="text-muted-fg mt-3 text-lg">
			Live billing status for {formatMonth(data.currentMonth)} across all organisations.
		</p>
	</header>

	{#if filtersOpen}
		<div
			transition:slide={{ duration: 300, easing: cubicOut }}
			class="border-border bg-card rounded-none border p-6"
		>
			<div class="grid gap-6 md:grid-cols-3">
				{#if organisationFilterOptions.length > 0}
					<div>
						<h2 class="text-muted-fg mb-3 text-xs font-semibold uppercase tracking-wide">
							Organisation
						</h2>
						<div class="w-64 max-w-full">
							<DropdownCheckbox
								label="Organisations"
								hideLabel
								placeholder="Organisations"
								options={organisationFilterOptions}
								selectedValues={selectedOrganisationIds}
								onchange={handleOrganisationFilterChange}
								variant="outline"
								size="sm"
								search
								searchPlaceholder="Search organisations"
							/>
						</div>
					</div>
				{/if}

				<div>
					<h2 class="text-muted-fg mb-3 text-xs font-semibold uppercase tracking-wide">
						Plan family
					</h2>
					<div class="w-64 max-w-full">
						<DropdownCheckbox
							label="Plan families"
							hideLabel
							placeholder="Plan families"
							options={planFamilyFilterOptions}
							selectedValues={selectedPlanFamilies}
							onchange={handlePlanFamilyFilterChange}
							variant="outline"
							size="sm"
						/>
					</div>
				</div>

				<div>
					<h2 class="text-muted-fg mb-3 text-xs font-semibold uppercase tracking-wide">Status</h2>
					<div class="w-64 max-w-full">
						<DropdownCheckbox
							label="Statuses"
							hideLabel
							placeholder="Statuses"
							options={statusFilterOptions}
							selectedValues={selectedStatusFilters}
							onchange={handleStatusFilterChange}
							variant="outline"
							size="sm"
						/>
					</div>
				</div>
			</div>
		</div>
	{/if}

	{#if data.rows.length === 0}
		<div class="border-border bg-card rounded-sm border p-6">
			<h2 class="text-foreground text-lg font-semibold">No billing organisations yet</h2>
			<p class="text-muted-fg mt-2 text-sm">
				Organisation billing rows will appear here once organisations have billing data.
			</p>
		</div>
	{:else if filteredRows.length === 0}
		<div class="border-border bg-card rounded-sm border p-6">
			<h2 class="text-foreground text-lg font-semibold">
				No organisations match the current filters
			</h2>
			<p class="text-muted-fg mt-2 text-sm">
				Try another organisation, plan family, or billing status combination.
			</p>
		</div>
	{:else}
		<div class="mb-2">
			<Input icon={Search} bind:value={searchQuery} placeholder="Search..." class="pl-9" />
		</div>

		{#if searchFilteredRows.length === 0}
			<div class="text-muted-fg flex justify-center p-6 text-sm font-medium">
				No results for: {searchQuery}
			</div>
		{:else if billingViewMode === 'grid'}
			<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
				{#each searchFilteredRows as row (row.organisationId)}
					{@const status = getOverallBillingDisplayStatus(row.metrics)}
					{@const talentProfiles = getMetricValue(row.metrics, 'talent_profiles')}
					{@const talentUsers = getMetricValue(row.metrics, 'talent_user_seats')}
					{@const adminSeats = getMetricValue(row.metrics, 'admin_seats')}

					<a href={`/billing/${row.organisationId}`} class="group block">
						<Card
							class="flex h-full min-h-[17rem] cursor-pointer flex-col rounded-none p-4 transition-all group-hover:shadow-md sm:aspect-square"
						>
							<div class="flex items-start justify-between gap-3">
								<div
									class="flex h-10 max-w-[6rem] shrink-0 items-center justify-center overflow-hidden"
								>
									{#if row.organisationLogoUrl}
										<img
											src={row.organisationLogoUrl}
											alt={row.organisationName}
											class="h-full w-auto object-contain"
											loading="lazy"
											decoding="async"
										/>
									{:else}
										<span class="text-foreground text-sm font-semibold">
											{getOrganisationInitials(row.organisationName)}
										</span>
									{/if}
								</div>
								<Badge variant={getStatusBadgeVariant(status)} size="xs">
									{#if status === 'within_plan'}
										<Check size={12} />
									{:else if status === 'ignore'}
										<Ban size={12} />
									{:else if status === 'warning'}
										<AlertTriangle size={12} />
									{:else if status === 'billable'}
										<CircleDollarSign size={12} />
									{:else if status === 'upgrade_recommended'}
										<TrendingUp size={12} />
									{:else if status === 'unlimited'}
										<InfinityIcon size={12} />
									{/if}
									{getBillingDisplayStatusLabel(status)}
								</Badge>
							</div>

							<div class="mt-4 min-w-0">
								<h3 class="text-foreground line-clamp-2 text-lg font-semibold leading-tight">
									{row.organisationName}
								</h3>
								<div class="mt-1.5 flex items-center gap-2">
									<span class="text-muted-fg truncate text-sm">
										{row.planName ?? 'No plan assigned'}
									</span>
									{#if row.planFamily}
										<Badge variant={getPlanFamilyBadgeVariant(row.planFamily)} size="xs"
											>{formatPlanFamily(row.planFamily)}</Badge
										>
									{/if}
								</div>
							</div>

							<div class="border-border/20 mt-4 grid gap-2 border-t pt-3 text-sm">
								<div class="flex items-center justify-between gap-3">
									<span class="text-muted-fg">Profiles</span>
									<span
										class={isOverLimit(talentProfiles)
											? 'text-destructive font-semibold'
											: 'text-foreground'}
									>
										{formatMetric(talentProfiles)}
									</span>
								</div>
								<div class="flex items-center justify-between gap-3">
									<span class="text-muted-fg">Talent users</span>
									<span
										class={isOverLimit(talentUsers)
											? 'text-destructive font-semibold'
											: 'text-foreground'}
									>
										{formatMetric(talentUsers)}
									</span>
								</div>
								<div class="flex items-center justify-between gap-3">
									<span class="text-muted-fg">Admin seats</span>
									<span
										class={isOverLimit(adminSeats)
											? 'text-destructive font-semibold'
											: 'text-foreground'}
									>
										{formatMetric(adminSeats)}
									</span>
								</div>
							</div>

							<div
								class="border-border/20 mt-auto flex items-end justify-between gap-3 border-t pt-3"
							>
								<div class="min-w-0">
									<p class="text-muted-fg text-xs font-medium uppercase tracking-wide">
										{currentMonthShort} cost
									</p>
									<p class="text-foreground truncate text-sm font-semibold">
										{formatSek(row.totals.totalOre)}
									</p>
								</div>
							</div>
						</Card>
					</a>
				{/each}
			</div>
		{:else}
			<BillingTable rows={searchFilteredRows} monthShortLabel={currentMonthShort} />
		{/if}
	{/if}
</div>
