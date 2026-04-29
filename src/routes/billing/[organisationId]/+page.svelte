<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import {
		Badge,
		Button,
		Card,
		FormControl,
		Input,
		TextArea,
		Toaster,
		toast
	} from '@pixelcode_/blocks/components';
	import { Drawer, Dropdown } from '$lib/components';
	import MonthInputDatepicker from '$lib/components/month-input-datepicker.svelte';
	import { ArrowLeft, ClipboardCheck, Download, Pencil } from 'lucide-svelte';
	import {
		getBillingDisplayStatusLabel,
		getBillingMetricDisplayStatus,
		getBillingPriceSuffix,
		getBillingQuantityUnitLabel,
		type BillingPlanVersion
	} from '$lib/types/billing';

	let { data, form } = $props();

	const NO_PLAN_OPTION_VALUE = '__no_plan__';

	const formatSek = (ore: number) =>
		new Intl.NumberFormat('sv-SE', {
			style: 'currency',
			currency: 'SEK',
			maximumFractionDigits: 0
		}).format(ore / 100);
	const formatMonthInput = (value: string) => value.slice(0, 7);
	const formatPriceInput = (ore: number | null | undefined) => {
		if (ore == null) return '';
		const sek = ore / 100;
		return Number.isInteger(sek) ? String(sek) : sek.toFixed(2);
	};
	const formatQuantityInput = (quantity: number | null | undefined) =>
		quantity == null ? '' : String(quantity);
	const formatPriceWithMetadata = (ore: number, metadata: Record<string, unknown> | undefined) =>
		`${formatSek(ore)}${getBillingPriceSuffix(metadata)}`;
	const formatQuantityWithMetadata = (
		quantity: number,
		metadata: Record<string, unknown> | undefined
	) => {
		const unitLabel = getBillingQuantityUnitLabel(metadata);
		return unitLabel ? `${quantity} ${unitLabel}` : String(quantity);
	};
	const getStatusVariant = (value: string) =>
		value === 'billable' || value === 'upgrade_recommended'
			? 'destructive'
			: value === 'ignore' || value === 'unlimited'
				? 'default'
				: 'success';

	const usagePercent = (current: number, limit: number | null) => {
		if (limit === null) return 0;
		if (limit === 0) return 100;
		return Math.min(100, Math.round((current / limit) * 100));
	};
	const usageBarColor = (current: number, limit: number | null) => {
		if (limit === null) return 'bg-primary/60';
		if (limit === 0) return current > 0 ? 'bg-destructive' : 'bg-primary/40';
		const pct = current / limit;
		if (pct >= 1) return 'bg-destructive';
		if (pct >= 0.8) return 'bg-warning';
		return 'bg-primary/60';
	};
	const feedback = $derived.by(() => {
		if (!form || typeof form.message !== 'string') return null;
		return {
			ok: Boolean(form.ok),
			message: form.message
		};
	});
	const showToast = (kind: 'success' | 'error', message: string) => {
		if (kind === 'error' && typeof toast.error === 'function') {
			toast.error(message);
			return;
		}
		if (kind === 'success' && typeof toast.success === 'function') {
			toast.success(message);
			return;
		}
		toast(message);
	};
	const pdfHref = $derived(
		`/api/billing/${data.organisation.id}/pdf?month=${encodeURIComponent(formatMonthInput(data.selectedMonth))}`
	);
	let pendingMonthNavigation = $state<string | null>(null);
	let selectedMonthValue = $state(formatMonthInput(data.selectedMonth));
	const logMonthNavigation = (event: string, details?: Record<string, unknown>) => {
		console.debug(`[billing-month-page] ${event}`, details ?? {});
	};
	const handleMonthSwitcherHide = (isAnimationComplete: boolean) => {
		logMonthNavigation('month-switcher-hide', {
			isAnimationComplete,
			pendingMonthNavigation
		});
		if (!isAnimationComplete || !pendingMonthNavigation) return;

		const target = new URL($page.url);
		target.searchParams.set('month', pendingMonthNavigation);
		pendingMonthNavigation = null;

		logMonthNavigation('goto', {
			href: `${target.pathname}${target.search}`
		});
		void goto(`${target.pathname}${target.search}`, { noScroll: true });
	};
	const reviewDecisionOptions = [
		{ label: 'Use computed status', value: '' },
		{ label: 'Ignore (<24h)', value: 'ignore' },
		{ label: 'Warning', value: 'warning' },
		{ label: 'Billable', value: 'billable' },
		{ label: 'Upgrade recommended', value: 'upgrade_recommended' },
		{ label: 'Manual override', value: 'manual_override' }
	];
	const getPlanVersionGroupKey = (
		planVersion: Pick<BillingPlanVersion, 'planFamily' | 'planCode'>
	) => `${planVersion.planFamily}:${planVersion.planCode}`;
	const planVersionGroups = $derived.by(() => {
		const groups = new Map<string, BillingPlanVersion[]>();

		for (const planVersion of data.planVersions as BillingPlanVersion[]) {
			const key = getPlanVersionGroupKey(planVersion);
			if (!groups.has(key)) {
				groups.set(key, []);
			}
			groups.get(key)?.push(planVersion);
		}

		return groups;
	});
	const currentPlanShowsVersion = $derived.by(() => {
		if (!data.monthView.plan) return false;

		const groupKey = getPlanVersionGroupKey(data.monthView.plan);
		const versions = planVersionGroups.get(groupKey) ?? [];
		if (versions.length < 2) return false;

		return versions[0]?.id !== data.monthView.plan.planVersionId;
	});
	const shouldShowPlanVersionOption = (planVersion: BillingPlanVersion) => {
		if (!data.monthView.plan) return false;

		const groupKey = getPlanVersionGroupKey(planVersion);
		const currentGroupKey = getPlanVersionGroupKey(data.monthView.plan);
		if (groupKey !== currentGroupKey) return false;

		const versions = planVersionGroups.get(groupKey) ?? [];
		if (versions.length < 2) return false;

		const latestVersion = versions[0];
		if (!latestVersion || latestVersion.id === data.monthView.plan.planVersionId) {
			return false;
		}

		return (
			planVersion.id === data.monthView.plan.planVersionId || planVersion.id === latestVersion.id
		);
	};
	const planVersionOptions = $derived([
		{ label: 'No plan', value: NO_PLAN_OPTION_VALUE },
		...(data.planVersions as BillingPlanVersion[]).map((planVersion) => ({
			label: `${planVersion.planName} (${planVersion.planFamily})${
				shouldShowPlanVersionOption(planVersion) ? ` v${planVersion.versionNumber}` : ''
			}`,
			value: planVersion.id
		}))
	]);
	const addonVersionOptions = $derived(
		data.addonVersions.map((addonVersion) => ({
			label: `${addonVersion.addonName} (${addonVersion.billingType}) v${addonVersion.versionNumber}`,
			value: addonVersion.id
		}))
	);

	let assignmentEffectiveMonth = $state(formatMonthInput(data.selectedMonth));
	let selectedPlanVersionId = $state(data.monthView.plan?.planVersionId ?? NO_PLAN_OPTION_VALUE);
	let assignmentPriceOverride = $state(formatPriceInput(data.monthView.plan?.monthlyPriceOre));
	let assignmentTalentProfilesOverride = $state(
		formatQuantityInput(data.monthView.plan?.includedTalentProfiles)
	);
	let assignmentTalentUserSeatsOverride = $state(
		formatQuantityInput(data.monthView.plan?.includedTalentUserSeats)
	);
	let assignmentAdminSeatsOverride = $state(
		formatQuantityInput(data.monthView.plan?.includedAdminSeats)
	);
	let assignmentNotes = $state(data.monthView.plan?.notes ?? '');
	let addonEffectiveMonth = $state(formatMonthInput(data.selectedMonth));
	let addonEndMonth = $state('');

	let reviewDrawerOpen = $state(false);
	let planDrawerOpen = $state(false);
	let addonsDrawerOpen = $state(false);
	let lastFeedbackToastKey = $state<string | null>(null);

	const hydrateAssignmentFieldsFromCurrentPlan = () => {
		assignmentPriceOverride = formatPriceInput(data.monthView.plan?.monthlyPriceOre);
		assignmentTalentProfilesOverride = formatQuantityInput(data.monthView.plan?.includedTalentProfiles);
		assignmentTalentUserSeatsOverride = formatQuantityInput(
			data.monthView.plan?.includedTalentUserSeats
		);
		assignmentAdminSeatsOverride = formatQuantityInput(data.monthView.plan?.includedAdminSeats);
		assignmentNotes = data.monthView.plan?.notes ?? '';
	};
	const hydrateAssignmentFieldsFromPlanVersion = (planVersionId: string) => {
		if (planVersionId === NO_PLAN_OPTION_VALUE) {
			assignmentPriceOverride = '';
			assignmentTalentProfilesOverride = '';
			assignmentTalentUserSeatsOverride = '';
			assignmentAdminSeatsOverride = '';
			assignmentNotes = '';
			return;
		}

		if (planVersionId === data.monthView.plan?.planVersionId) {
			hydrateAssignmentFieldsFromCurrentPlan();
			return;
		}

		const planVersion = (data.planVersions as BillingPlanVersion[]).find(
			(version) => version.id === planVersionId
		);
		assignmentPriceOverride = formatPriceInput(planVersion?.monthlyPriceOre);
		assignmentTalentProfilesOverride = formatQuantityInput(planVersion?.includedTalentProfiles);
		assignmentTalentUserSeatsOverride = formatQuantityInput(planVersion?.includedTalentUserSeats);
		assignmentAdminSeatsOverride = formatQuantityInput(planVersion?.includedAdminSeats);
		assignmentNotes = '';
	};
	const assignmentActionMonth = $derived(assignmentEffectiveMonth || selectedMonthValue);
	const upsertAssignmentAction = $derived(
		`?month=${encodeURIComponent(assignmentActionMonth)}&/upsertAssignment`
	);
	const deleteAssignmentAction = $derived(
		`?month=${encodeURIComponent(assignmentActionMonth)}&/deleteAssignment`
	);

	$effect(() => {
		const selectedMonth = formatMonthInput(data.selectedMonth);
		logMonthNavigation('sync-from-data', {
			selectedMonth
		});
		assignmentEffectiveMonth = selectedMonth;
		selectedPlanVersionId = data.monthView.plan?.planVersionId ?? NO_PLAN_OPTION_VALUE;
		hydrateAssignmentFieldsFromCurrentPlan();
		addonEffectiveMonth = selectedMonth;
		addonEndMonth = '';
		selectedMonthValue = selectedMonth;
	});

	$effect(() => {
		const current = formatMonthInput(data.selectedMonth);
		if (selectedMonthValue && selectedMonthValue !== current) {
			logMonthNavigation('queue-navigation', {
				from: current,
				to: selectedMonthValue
			});
			pendingMonthNavigation = selectedMonthValue;
			return;
		}

		if (pendingMonthNavigation) {
			logMonthNavigation('clear-pending-navigation', {
				pendingMonthNavigation,
				current,
				selectedMonthValue
			});
		}
		pendingMonthNavigation = null;
	});

	$effect(() => {
		if (!feedback) return;
		const key = `${form?.type ?? 'unknown'}:${feedback.ok ? 'success' : 'error'}:${feedback.message}`;
		if (lastFeedbackToastKey === key) return;
		lastFeedbackToastKey = key;
		showToast(feedback.ok ? 'success' : 'error', feedback.message);
	});
</script>

<svelte:head>
	<title>{data.organisation.name} Billing</title>
</svelte:head>

<div class="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
	<Toaster />

	<!-- Header -->
	<div>
		{#if data.canManageBilling}
			<div class="mb-2 flex items-center justify-between">
				<Button
					variant="ghost"
					href="/billing"
					class="hover:text-primary pl-0 hover:bg-transparent"
				>
					<ArrowLeft size={16} class="mr-2" />
					Back to billing
				</Button>
				<Button variant="outline" size="sm" onclick={() => (reviewDrawerOpen = true)}>
					<ClipboardCheck size={14} class="mr-1.5" />
					Review
				</Button>
			</div>
		{/if}

		<div class="flex items-start gap-4">
			<div class="min-w-0">
				<h1 class="text-foreground text-2xl font-semibold">{data.organisation.name}</h1>
				<p class="text-muted-fg mt-0.5 text-sm">Manage billing and payment details.</p>
			</div>

			<div class="ml-auto shrink-0">
				<MonthInputDatepicker
					bind:value={selectedMonthValue}
					debugLabel="header-month-switcher"
					onPickerHide={handleMonthSwitcherHide}
					class="bg-card text-foreground w-40 !pl-11"
					placeholder="YYYY-MM"
				/>
			</div>
		</div>
	</div>

	<!-- Top cards: Plan summary + Add-ons -->
	<div class="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
		<!-- Current Plan Summary (with usage) -->
		<Card class="rounded-sm p-5">
			<div class="mb-4 flex items-start justify-between gap-3">
				<h2 class="text-foreground font-semibold">Current Plan Summary</h2>
				<div class="flex items-center gap-1.5">
					{#if data.monthView.isFrozen}
						<Badge size="xs" variant="info">Frozen</Badge>
					{/if}
					{#if data.canManageBilling}
						<Button
							variant="ghost"
							size="sm"
							class="h-7 w-7 p-0"
							onclick={() => (planDrawerOpen = true)}
						>
							<Pencil size={13} />
						</Button>
					{/if}
				</div>
			</div>

			{#if data.monthView.plan}
				<div class="border-border/20 mb-5 grid grid-cols-3 gap-4 border-b pb-5">
					<div>
						<p class="text-muted-fg text-[11px] font-medium uppercase tracking-wide">Plan name</p>
						<p class="text-foreground mt-0.5 text-sm font-semibold">
							{data.monthView.plan.planName}{currentPlanShowsVersion
								? ` v${data.monthView.plan.versionNumber}`
								: ''}
						</p>
					</div>
					<div>
						<p class="text-muted-fg text-[11px] font-medium uppercase tracking-wide">Family</p>
						<p class="text-foreground mt-0.5 text-sm font-semibold">
							{data.monthView.plan.planFamily}
						</p>
					</div>
					<div>
						<p class="text-muted-fg text-[11px] font-medium uppercase tracking-wide">Plan cost</p>
						<p class="text-foreground mt-0.5 text-sm font-semibold">
							{formatSek(data.monthView.plan.monthlyPriceOre)}
						</p>
					</div>
				</div>

				<!-- Usage metrics with bars + inline stats -->
				<div class="space-y-4">
					{#each data.monthView.metrics as metric (metric.key)}
						{@const metricDisplayStatus = getBillingMetricDisplayStatus(metric)}
						<div>
							<div class="mb-1 flex items-center justify-between gap-2">
								<div class="flex items-center gap-2">
									<p class="text-foreground text-sm font-medium">{metric.label}</p>
									{#if metricDisplayStatus !== 'within_plan'}
										<Badge size="xs" variant={getStatusVariant(metricDisplayStatus)}>
											{getBillingDisplayStatusLabel(metricDisplayStatus)}
										</Badge>
									{/if}
								</div>
								<p class="text-foreground text-sm font-semibold">
									{metric.currentUsage}{metric.limit !== null ? ` / ${metric.limit}` : ''}
								</p>
							</div>
							<div class="bg-muted h-2 w-full overflow-hidden rounded-full">
								{#if metric.limit !== null}
									<div
										class="{usageBarColor(
											metric.currentUsage,
											metric.limit
										)} h-full rounded-full transition-all"
										style="width: {usagePercent(metric.currentUsage, metric.limit)}%"
									></div>
								{:else}
									<div class="bg-primary/40 h-full w-full rounded-full"></div>
								{/if}
							</div>
							{#if metric.durationAboveLimitHours > 0}
								<div class="mt-1.5">
									<Badge size="xs" variant="destructive">Has been over limit</Badge>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<p class="text-muted-fg text-sm">No plan assigned for this month.</p>
				{#if data.canManageBilling}
					<Button variant="outline" size="sm" class="mt-3" onclick={() => (planDrawerOpen = true)}>
						Assign plan
					</Button>
				{/if}
			{/if}
		</Card>

		<!-- Add-ons -->
		<Card class="rounded-sm p-5">
			<div class="mb-4 flex items-start justify-between gap-3">
				<h2 class="text-foreground font-semibold">Add-ons</h2>
				{#if data.canManageBilling}
					<Button
						variant="ghost"
						size="sm"
						class="h-7 w-7 p-0"
						onclick={() => (addonsDrawerOpen = true)}
					>
						<Pencil size={13} />
					</Button>
				{/if}
			</div>

			{#if data.monthView.addOns.length > 0}
				<div class="space-y-3">
					{#each data.monthView.addOns as addOn (addOn.id)}
						<div
							class="border-border/20 flex items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"
						>
							<div class="min-w-0">
								<p class="text-sm font-medium">{addOn.addonName}</p>
								<p class="text-muted-fg text-xs">
									{formatQuantityWithMetadata(addOn.quantity, addOn.metadata)} × {formatPriceWithMetadata(
										addOn.unitPriceOre,
										addOn.metadata
									)}
								</p>
							</div>
							<p class="shrink-0 text-sm font-semibold">{formatSek(addOn.totalPriceOre)}</p>
						</div>
					{/each}
				</div>
			{:else}
				<p class="text-muted-fg text-sm">No active add-ons for this month.</p>
			{/if}
		</Card>
	</div>

	<!-- Invoice -->
	<section>
		<div class="mb-3 flex items-center justify-between gap-3">
			<div>
				<h2 class="text-foreground font-semibold">Invoice</h2>
				<p class="text-muted-fg text-sm">
					{data.monthView.isFrozen ? 'Frozen' : 'Draft'} billing for {data.monthView.periodLabel}.
				</p>
			</div>
			<Button href={pdfHref} target="_blank" variant="outline" size="sm">
				<Download size={14} class="mr-1.5" />
				Download
			</Button>
		</div>

		<Card class="overflow-hidden rounded-sm p-0">
			<table class="w-full border-collapse text-left text-sm">
				<thead>
					<tr class="border-border/20 border-b">
						<th class="text-muted-fg px-4 py-3 text-xs font-medium">Line</th>
						<th class="text-muted-fg px-4 py-3 text-xs font-medium">Type</th>
						<th class="text-muted-fg px-4 py-3 text-xs font-medium">Qty</th>
						<th class="text-muted-fg px-4 py-3 text-xs font-medium">Unit price</th>
						<th class="text-muted-fg px-4 py-3 text-right text-xs font-medium">Amount</th>
					</tr>
				</thead>
				<tbody>
					{#each data.monthView.lineItems as lineItem (`${lineItem.kind}-${lineItem.code}`)}
						<tr
							class="border-border/20 hover:bg-muted/30 border-b transition-colors last:border-b-0"
						>
							<td class="px-4 py-3">
								<p class="font-medium">{lineItem.name}</p>
								{#if lineItem.notes}
									<p class="text-muted-fg text-xs">{lineItem.notes}</p>
								{/if}
							</td>
							<td class="text-muted-fg px-4 py-3 capitalize">{lineItem.kind}</td>
							<td class="px-4 py-3">
								{formatQuantityWithMetadata(lineItem.quantity, lineItem.metadata)}
							</td>
							<td class="px-4 py-3">
								{formatPriceWithMetadata(lineItem.unitPriceOre, lineItem.metadata)}
							</td>
							<td class="px-4 py-3 text-right font-medium">{formatSek(lineItem.totalPriceOre)}</td>
						</tr>
					{:else}
						<tr>
							<td colspan="5" class="text-muted-fg px-4 py-6 text-center text-sm"
								>No billable items yet.</td
							>
						</tr>
					{/each}
				</tbody>
			</table>

			<div class="border-border/20 bg-muted/10 border-t px-4 py-3">
				<div class="flex justify-end">
					<div class="flex w-56 justify-between text-base font-semibold">
						<span>Total</span>
						<span>{formatSek(data.monthView.totals.totalOre)}</span>
					</div>
				</div>
			</div>
		</Card>
	</section>

	<!-- Non-admin info -->
	{#if !data.canManageBilling}
		<p class="text-muted-fg text-center text-sm">
			Pricing and review actions are restricted to global admins.
		</p>
	{/if}
</div>

<!-- Drawers (admin only) -->
{#if data.canManageBilling}
	<Drawer
		bind:open={reviewDrawerOpen}
		variant="right"
		title="Review Decisions"
		subtitle="Billing decisions and notes for {data.monthView.periodLabel}."
		class="mr-0 w-full max-w-xl"
	>
		<form method="POST" action="?/saveReview" class="space-y-4">
			<input type="hidden" name="period_month" value={data.selectedMonth} />
			{#each data.monthView.metrics as metric (metric.key)}
				<div class="border-border/20 space-y-2 border-b pb-4">
					<div class="flex items-center justify-between gap-3">
						<p class="text-sm font-medium">{metric.label}</p>
						<p class="text-muted-fg text-xs">
							Computed: {getBillingDisplayStatusLabel(getBillingMetricDisplayStatus(metric))}
						</p>
					</div>
					<FormControl label="Decision" class="gap-2 text-sm">
						<Dropdown
							name={`decision_${metric.key}`}
							options={reviewDecisionOptions}
							value={data.monthView.review?.decisionFlags?.[metric.key]?.decision ?? ''}
						/>
					</FormControl>
					<FormControl label="Note" class="gap-2 text-sm">
						<TextArea
							name={`note_${metric.key}`}
							rows={2}
							value={data.monthView.review?.decisionFlags?.[metric.key]?.note ?? ''}
						/>
					</FormControl>
				</div>
			{/each}

			<FormControl label="Internal notes" class="gap-2 text-sm">
				<TextArea name="review_notes" rows={3} value={data.monthView.review?.notes ?? ''} />
			</FormControl>

			<div class="border-border/20 sticky bottom-0 flex justify-end border-t pt-4">
				<Button type="submit" size="sm">Save review</Button>
			</div>
		</form>
	</Drawer>

	<Drawer
		bind:open={planDrawerOpen}
		variant="right"
		title="Plan Assignment"
		subtitle="Assign a plan version and optional overrides."
		class="mr-0 w-full max-w-xl"
	>
		<form method="POST" action={upsertAssignmentAction} class="space-y-4">
			<FormControl label="Effective month" class="gap-2 text-sm">
				<MonthInputDatepicker
					id="assignment-effective-month"
					name="effective_month"
					bind:value={assignmentEffectiveMonth}
					debugLabel="plan-assignment-effective-month"
					class="bg-card text-foreground w-full !pl-11"
					placeholder="YYYY-MM"
				/>
			</FormControl>
			<FormControl label="Plan version" class="gap-2 text-sm">
				<Dropdown
					name="plan_version_id"
					options={planVersionOptions}
					bind:value={selectedPlanVersionId}
					onchange={(value) => hydrateAssignmentFieldsFromPlanVersion(String(value))}
					placeholder="Select a plan"
					disabled={planVersionOptions.length === 0}
					search={planVersionOptions.length > 8}
				/>
			</FormControl>
			<div class="grid gap-4 sm:grid-cols-2">
				<FormControl label="Override price (SEK)" class="gap-2 text-sm">
					<Input
						name="price_override"
						type="number"
						min="0"
						step="0.01"
						bind:value={assignmentPriceOverride}
						disabled={selectedPlanVersionId === NO_PLAN_OPTION_VALUE}
					/>
				</FormControl>
				<FormControl label="Profiles override" class="gap-2 text-sm">
					<Input
						name="included_talent_profiles_override"
						type="number"
						min="0"
						bind:value={assignmentTalentProfilesOverride}
						disabled={selectedPlanVersionId === NO_PLAN_OPTION_VALUE}
					/>
				</FormControl>
				<FormControl label="Talent users override" class="gap-2 text-sm">
					<Input
						name="included_talent_user_seats_override"
						type="number"
						min="0"
						bind:value={assignmentTalentUserSeatsOverride}
						disabled={selectedPlanVersionId === NO_PLAN_OPTION_VALUE}
					/>
				</FormControl>
				<FormControl label="Admin seats override" class="gap-2 text-sm">
					<Input
						name="included_admin_seats_override"
						type="number"
						min="0"
						bind:value={assignmentAdminSeatsOverride}
						disabled={selectedPlanVersionId === NO_PLAN_OPTION_VALUE}
					/>
				</FormControl>
			</div>
			<FormControl label="Notes" class="gap-2 text-sm">
				<TextArea
					name="assignment_notes"
					rows={3}
					bind:value={assignmentNotes}
					disabled={selectedPlanVersionId === NO_PLAN_OPTION_VALUE}
				/>
			</FormControl>
			<div
				class="border-border/20 sticky bottom-0 flex items-center justify-between gap-3 border-t pt-4"
			>
				<div class="text-muted-fg text-xs">
					Removing a plan clears the current assignment and any scheduled plan changes from the
					selected month onward.
				</div>
				<div class="flex items-center gap-2">
					<Button
						type="submit"
						size="sm"
						variant="destructive"
						formaction={deleteAssignmentAction}
						formnovalidate
						disabled={!data.monthView.plan}
					>
						Remove from this month forward
					</Button>
					<Button type="submit" size="sm">Save assignment</Button>
				</div>
			</div>
		</form>
	</Drawer>

	<Drawer
		bind:open={addonsDrawerOpen}
		variant="right"
		title="Manage Add-ons"
		subtitle="Add or remove organisation-specific add-ons."
		class="mr-0 w-full max-w-xl"
	>
		{#if data.monthView.addOns.length > 0}
			<div class="mb-6 space-y-2">
				<p class="text-muted-fg text-xs font-medium uppercase tracking-wide">Current add-ons</p>
				{#each data.monthView.addOns as addOn (addOn.id)}
					<div class="border-border/20 flex items-start justify-between gap-3 border-b pb-3">
						<div>
							<p class="text-sm font-medium">{addOn.addonName}</p>
							<p class="text-muted-fg text-xs">
								{formatQuantityWithMetadata(addOn.quantity, addOn.metadata)} × {formatPriceWithMetadata(
									addOn.unitPriceOre,
									addOn.metadata
								)} · {addOn.billingType}
							</p>
						</div>
						<form method="POST" action="?/deleteAddon">
							<input type="hidden" name="addon_id" value={addOn.id} />
							<Button type="submit" variant="outline" size="sm">Remove</Button>
						</form>
					</div>
				{/each}
			</div>
		{/if}

		<form method="POST" action="?/upsertAddon" class="space-y-4">
			<p class="text-muted-fg text-xs font-medium uppercase tracking-wide">Add new</p>
			<FormControl label="Add-on version" class="gap-2 text-sm">
				<Dropdown
					name="addon_version_id"
					options={addonVersionOptions}
					value={data.addonVersions[0]?.id ?? ''}
					placeholder="No add-on versions available"
					disabled={addonVersionOptions.length === 0}
					search={addonVersionOptions.length > 8}
				/>
			</FormControl>
			<div class="grid gap-4 sm:grid-cols-2">
				<FormControl label="Effective month" class="gap-2 text-sm">
					<MonthInputDatepicker
						id="addon-effective-month"
						name="effective_month"
						bind:value={addonEffectiveMonth}
						debugLabel="addon-effective-month"
						class="bg-card text-foreground w-full !pl-11"
						placeholder="YYYY-MM"
					/>
				</FormControl>
				<FormControl label="End month" class="gap-2 text-sm">
					<MonthInputDatepicker
						id="addon-end-month"
						name="end_month"
						bind:value={addonEndMonth}
						debugLabel="addon-end-month"
						class="bg-card text-foreground w-full !pl-11"
						placeholder="YYYY-MM"
					/>
					{#if addonEndMonth}
						<Button
							type="button"
							size="sm"
							variant="ghost"
							class="w-fit px-0"
							onclick={() => (addonEndMonth = '')}
						>
							Clear end month
						</Button>
					{/if}
				</FormControl>
				<FormControl label="Quantity" class="gap-2 text-sm">
					<Input name="quantity" type="number" min="1" value="1" />
				</FormControl>
				<FormControl label="Override price (SEK)" class="gap-2 text-sm">
					<Input name="price_override" type="number" min="0" step="1" />
				</FormControl>
			</div>
			<FormControl label="Notes" class="gap-2 text-sm">
				<TextArea name="addon_notes" rows={3} />
			</FormControl>
			<div class="border-border/20 sticky bottom-0 flex justify-end border-t pt-4">
				<Button type="submit" size="sm">Add add-on</Button>
			</div>
		</form>
	</Drawer>
{/if}
