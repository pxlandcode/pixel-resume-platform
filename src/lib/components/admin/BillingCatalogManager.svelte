<script lang="ts">
	import { Badge, Button, Card, FormControl, Input, TextArea } from '@pixelcode_/blocks/components';
	import Drawer from '$lib/components/drawer/drawer.svelte';
	import type { BillingAddonVersion, BillingPlanVersion } from '$lib/types/billing';

	type Panel = 'plans' | 'addons' | 'create-plan' | 'create-addon' | null;

	type BillingCatalogFormData = {
		type?: string;
		ok?: boolean;
		message?: string;
	} | null;

	let {
		planVersions = [],
		addonVersions = [],
		form = null
	}: {
		planVersions: BillingPlanVersion[];
		addonVersions: BillingAddonVersion[];
		form?: BillingCatalogFormData;
	} = $props();

	const formatSek = (ore: number) =>
		new Intl.NumberFormat('sv-SE', {
			style: 'currency',
			currency: 'SEK',
			maximumFractionDigits: 0
		}).format(ore / 100);
	const formatBillingType = (value: string) => (value === 'one_time' ? 'One time' : 'Monthly');
	const formatPlanFamily = (value: string) =>
		value.length > 0 ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
	const panelFromActionType = (value: string | undefined): Panel => {
		switch (value) {
			case 'setPlanVersionState':
				return 'plans';
			case 'createPlanVersion':
				return 'create-plan';
			case 'setAddonVersionState':
				return 'addons';
			case 'createAddonVersion':
				return 'create-addon';
			default:
				return null;
		}
	};

	let activePanel = $state<Panel>(panelFromActionType(form?.type));
	let drawerOpen = $state(panelFromActionType(form?.type) !== null);

	const activePanelMeta = $derived.by(() => {
		switch (activePanel) {
			case 'plans':
				return {
					title: 'Plan catalog',
					subtitle: 'Review active and inactive plan versions for future month assignments.'
				};
			case 'addons':
				return {
					title: 'Add-on catalog',
					subtitle: 'Review active and inactive add-ons used in organisation billing.'
				};
			case 'create-plan':
				return {
					title: 'Create plan version',
					subtitle: 'Create an immutable plan version for future billing periods.'
				};
			case 'create-addon':
				return {
					title: 'Create add-on version',
					subtitle: 'Define monthly or one-time add-ons and package pricing.'
				};
			default:
				return {
					title: 'Billing catalog',
					subtitle: ''
				};
		}
	});

	const activePlanCount = $derived(planVersions.filter((plan) => plan.isActive).length);
	const activeAddonCount = $derived(addonVersions.filter((addon) => addon.isActive).length);

	function openPanel(panel: Exclude<Panel, null>) {
		activePanel = panel;
		drawerOpen = true;
	}

	$effect(() => {
		const nextPanel = panelFromActionType(form?.type);
		if (!nextPanel) return;
		activePanel = nextPanel;
		drawerOpen = true;
	});

	$effect(() => {
		if (!drawerOpen) {
			activePanel = null;
		}
	});
</script>

<div class="space-y-4">
	<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
		<div class="border-border bg-background rounded-sm border p-4">
			<p class="text-muted-fg text-xs uppercase tracking-wide">Active plans</p>
			<p class="text-foreground mt-2 text-2xl font-semibold">{activePlanCount}</p>
			<Button
				type="button"
				variant="outline"
				size="sm"
				class="mt-4 w-full"
				onclick={() => openPanel('plans')}
			>
				Plan catalog
			</Button>
		</div>

		<div class="border-border bg-background rounded-sm border p-4">
			<p class="text-muted-fg text-xs uppercase tracking-wide">Active add-ons</p>
			<p class="text-foreground mt-2 text-2xl font-semibold">{activeAddonCount}</p>
			<Button
				type="button"
				variant="outline"
				size="sm"
				class="mt-4 w-full"
				onclick={() => openPanel('addons')}
			>
				Add-on catalog
			</Button>
		</div>

		<div class="border-border bg-background rounded-sm border p-4">
			<p class="text-muted-fg text-xs uppercase tracking-wide">Create</p>
			<p class="text-foreground mt-2 text-base font-semibold">New plan version</p>
			<p class="text-muted-fg mt-1 text-sm">
				Add a future billing plan without mutating existing history.
			</p>
			<Button type="button" size="sm" class="mt-4 w-full" onclick={() => openPanel('create-plan')}>
				New plan
			</Button>
		</div>

		<div class="border-border bg-background rounded-sm border p-4">
			<p class="text-muted-fg text-xs uppercase tracking-wide">Create</p>
			<p class="text-foreground mt-2 text-base font-semibold">New add-on version</p>
			<p class="text-muted-fg mt-1 text-sm">
				Create monthly or one-time billing add-ons for organisations.
			</p>
			<Button type="button" size="sm" class="mt-4 w-full" onclick={() => openPanel('create-addon')}>
				New add-on
			</Button>
		</div>
	</div>
</div>

<Drawer
	variant="bottom"
	bind:open={drawerOpen}
	title={activePanelMeta.title}
	subtitle={activePanelMeta.subtitle}
	dismissable
>
	<div class="mx-auto w-full max-w-5xl pb-6">
		{#if activePanel === 'plans'}
			<Card class="border-border/20 bg-card space-y-4 rounded-sm p-5">
				<div class="space-y-3">
					{#each planVersions as plan (plan.id)}
						<div
							class="border-border/20 flex flex-wrap items-center justify-between gap-3 rounded-sm border p-4"
						>
							<div class="space-y-1">
								<div class="flex flex-wrap items-center gap-2">
									<p class="font-medium">{plan.planName}</p>
									<Badge size="xs">{formatPlanFamily(plan.planFamily)}</Badge>
									<Badge size="xs" variant={plan.isActive ? 'success' : 'default'}>
										{plan.isActive ? 'Active' : 'Inactive'}
									</Badge>
								</div>
								<p class="text-muted-fg text-sm">
									{plan.planCode} v{plan.versionNumber} • {formatSek(plan.monthlyPriceOre)}
								</p>
							</div>
							<form method="POST" action="?/setPlanVersionState">
								<input type="hidden" name="plan_version_id" value={plan.id} />
								<input type="hidden" name="is_active" value={plan.isActive ? 'false' : 'true'} />
								<Button type="submit" size="sm" variant="outline">
									{plan.isActive ? 'Deactivate' : 'Activate'}
								</Button>
							</form>
						</div>
					{/each}
				</div>
			</Card>
		{:else if activePanel === 'addons'}
			<Card class="border-border/20 bg-card space-y-4 rounded-sm p-5">
				<div class="space-y-3">
					{#each addonVersions as addon (addon.id)}
						<div
							class="border-border/20 flex flex-wrap items-center justify-between gap-3 rounded-sm border p-4"
						>
							<div class="space-y-1">
								<div class="flex flex-wrap items-center gap-2">
									<p class="font-medium">{addon.addonName}</p>
									<Badge size="xs">{formatBillingType(addon.billingType)}</Badge>
									<Badge size="xs" variant={addon.isActive ? 'success' : 'default'}>
										{addon.isActive ? 'Active' : 'Inactive'}
									</Badge>
								</div>
								<p class="text-muted-fg text-sm">
									{addon.addonCode} v{addon.versionNumber} • {formatSek(addon.unitPriceOre)}
								</p>
							</div>
							<form method="POST" action="?/setAddonVersionState">
								<input type="hidden" name="addon_version_id" value={addon.id} />
								<input type="hidden" name="is_active" value={addon.isActive ? 'false' : 'true'} />
								<Button type="submit" size="sm" variant="outline">
									{addon.isActive ? 'Deactivate' : 'Activate'}
								</Button>
							</form>
						</div>
					{/each}
				</div>
			</Card>
		{:else if activePanel === 'create-plan'}
			<Card class="border-border/20 bg-card rounded-sm p-5">
				<form method="POST" action="?/createPlanVersion" class="grid gap-4">
					<div class="grid gap-4 md:grid-cols-2">
						<FormControl label="Family" class="gap-2 text-sm">
							<select
								name="plan_family"
								class="bg-input text-foreground border-border h-10 rounded-sm border px-3"
							>
								<option value="standard">Standard</option>
								<option value="broker">Broker</option>
							</select>
						</FormControl>
						<FormControl label="Code" class="gap-2 text-sm">
							<Input name="plan_code" required />
						</FormControl>
						<FormControl label="Name" class="gap-2 text-sm">
							<Input name="plan_name" required />
						</FormControl>
						<FormControl label="Monthly price (SEK)" class="gap-2 text-sm">
							<Input name="monthly_price" type="number" min="0" step="1" required />
						</FormControl>
						<FormControl label="Talent profiles" class="gap-2 text-sm">
							<Input name="included_talent_profiles" type="number" min="0" />
						</FormControl>
						<FormControl label="Talent users" class="gap-2 text-sm">
							<Input name="included_talent_user_seats" type="number" min="0" />
						</FormControl>
						<FormControl label="Admin seats" class="gap-2 text-sm">
							<Input name="included_admin_seats" type="number" min="0" />
						</FormControl>
						<FormControl label="Sort order" class="gap-2 text-sm">
							<Input name="sort_order" type="number" step="1" value="100" />
						</FormControl>
					</div>

					<FormControl label="Features, one per line" class="gap-2 text-sm">
						<TextArea name="features" rows={6} />
					</FormControl>

					<div
						class="border-border bg-background/95 sticky bottom-0 z-10 mt-2 flex flex-wrap justify-end gap-3 border-t pt-4 backdrop-blur-sm"
					>
						<Button
							variant="outline"
							type="button"
							onclick={() => (drawerOpen = false)}
							class="bg-input hover:bg-muted/70"
						>
							Cancel
						</Button>
						<Button type="submit">Create plan</Button>
					</div>
				</form>
			</Card>
		{:else if activePanel === 'create-addon'}
			<Card class="border-border/20 bg-card rounded-sm p-5">
				<form method="POST" action="?/createAddonVersion" class="grid gap-4">
					<div class="grid gap-4 md:grid-cols-2">
						<FormControl label="Code" class="gap-2 text-sm">
							<Input name="addon_code" required />
						</FormControl>
						<FormControl label="Name" class="gap-2 text-sm">
							<Input name="addon_name" required />
						</FormControl>
						<FormControl label="Billing type" class="gap-2 text-sm">
							<select
								name="billing_type"
								class="bg-input text-foreground border-border h-10 rounded-sm border px-3"
							>
								<option value="monthly">Monthly</option>
								<option value="one_time">One time</option>
							</select>
						</FormControl>
						<FormControl label="Unit price (SEK)" class="gap-2 text-sm">
							<Input name="unit_price" type="number" min="0" step="1" required />
						</FormControl>
						<FormControl label="Package quantity" class="gap-2 text-sm">
							<Input name="package_quantity" type="number" min="0" />
						</FormControl>
						<FormControl label="Applies to metric" class="gap-2 text-sm">
							<select
								name="applies_to_metric"
								class="bg-input text-foreground border-border h-10 rounded-sm border px-3"
							>
								<option value="">General</option>
								<option value="talent_profiles">Talent profiles</option>
								<option value="talent_user_seats">Talent users</option>
								<option value="admin_seats">Admin seats</option>
							</select>
						</FormControl>
						<FormControl label="Sort order" class="gap-2 text-sm">
							<Input name="sort_order" type="number" step="1" value="100" />
						</FormControl>
					</div>

					<div
						class="border-border bg-background/95 sticky bottom-0 z-10 mt-2 flex flex-wrap justify-end gap-3 border-t pt-4 backdrop-blur-sm"
					>
						<Button
							variant="outline"
							type="button"
							onclick={() => (drawerOpen = false)}
							class="bg-input hover:bg-muted/70"
						>
							Cancel
						</Button>
						<Button type="submit">Create add-on</Button>
					</div>
				</form>
			</Card>
		{/if}
	</div>
</Drawer>
