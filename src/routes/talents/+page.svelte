<script lang="ts">
	import TalentFormDrawer from '$lib/components/admin/TalentFormDrawer.svelte';
	import { DropdownCheckbox } from '$lib/components/dropdown-checkbox';
	import { SuperList, ListHandler, Cell, Row } from '$lib/components/super-list';
	import type { SuperListHead } from '$lib/components/super-list';
	import { userSettingsStore } from '$lib/stores/userSettings';
	import type { ViewMode } from '$lib/types/userSettings';
	import { Alert, Button, Card, Input } from '@pixelcode_/blocks/components';
	import { User, LayoutGrid, List, SlidersHorizontal, Search } from 'lucide-svelte';
	import { resolve } from '$app/paths';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	const { data, form } = $props();

	const allTalents = $derived(data.talents ?? []);
	const canManageTalents = $derived(Boolean(data.canManageTalents));
	const actionMessage = $derived(typeof form?.message === 'string' ? form.message : null);
	const actionFailed = $derived(form?.ok === false);
	const talentsViewMode = $derived($userSettingsStore.settings.views.talents);
	const homeOrganisationId = $derived(
		typeof data.homeOrganisationId === 'string' ? data.homeOrganisationId : null
	);

	const organisationFilterOptions = $derived(
		(data.organisationOptions ?? []).map((org: { id: string; name: string }) => ({
			label: org.name,
			value: org.id
		}))
	);
	const availableOrganisationIds = $derived(organisationFilterOptions.map((org) => org.value));

	const sanitizeOrganisationIds = (ids: string[]) => {
		const allowed = new Set(availableOrganisationIds);
		return Array.from(
			new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0 && allowed.has(id)))
		);
	};

	const selectedOrganisationIds = $derived.by(() => {
		if (availableOrganisationIds.length === 0) return [];

		const configured = sanitizeOrganisationIds(
			$userSettingsStore.settings.organisationFilters.talents
		);
		if (configured.length > 0) return configured;

		if (homeOrganisationId && availableOrganisationIds.includes(homeOrganisationId)) {
			return [homeOrganisationId];
		}

		return [availableOrganisationIds[0]];
	});

	const talents = $derived.by(() => {
		if (selectedOrganisationIds.length === 0) return allTalents;

		const selectedSet = new Set(selectedOrganisationIds);
		return allTalents.filter(
			(talent) =>
				typeof talent.organisation_id === 'string' && selectedSet.has(talent.organisation_id)
		);
	});

	let isCreateDrawerOpen = $state(false);
	let filtersOpen = $state(false);
	let searchQuery = $state('');

	const getTalentName = (talent: (typeof allTalents)[number]) =>
		[talent.first_name, talent.last_name].filter(Boolean).join(' ') || 'Unnamed Talent';

	type TalentsListRow = {
		id: string;
		name: string;
		avatar_url: string | null;
		title: string | null;
		email: string | null;
		organisation_name: string | null;
		organisation_logo_url: string | null;
	};

	const talentsListHeadings: SuperListHead<TalentsListRow>[] = [
		{ heading: null, width: 6 },
		{ heading: 'Name', sortable: 'name', filterable: 'name', width: 28 },
		{ heading: 'Title', sortable: 'title', filterable: 'title', width: 28 },
		{ heading: 'Email', sortable: 'email', filterable: 'email', width: 22 },
		{ heading: 'Organisation', sortable: 'organisation_name', width: 16 }
	];

	const toTalentListRows = (items: typeof talents): TalentsListRow[] =>
		items.map((t) => ({
			id: t.id,
			name: getTalentName(t),
			avatar_url: t.avatar_url ?? null,
			title: t.title ?? null,
			email: t.email ?? null,
			organisation_name: t.organisation_name ?? null,
			organisation_logo_url: t.organisation_logo_url ?? null
		}));

	const talentListHandler = $derived.by(() => {
		const handler = new ListHandler<TalentsListRow>(talentsListHeadings, toTalentListRows(talents));
		handler.query = searchQuery;
		return handler;
	});

	const searchFilteredTalents = $derived.by(() => {
		if (!searchQuery.trim()) return talents;
		const q = searchQuery.trim().toLowerCase();
		return talents.filter((t) => {
			const name = getTalentName(t).toLowerCase();
			const title = (t.title ?? '').toLowerCase();
			const email = (t.email ?? '').toLowerCase();
			return name.includes(q) || title.includes(q) || email.includes(q);
		});
	});

	const setTalentsViewMode = (mode: ViewMode) => {
		void userSettingsStore.setViewMode('talents', mode);
	};

	function toggleFilters() {
		filtersOpen = !filtersOpen;
	}

	const handleOrganisationFilterChange = (selected: string[]) => {
		let next = sanitizeOrganisationIds(selected);
		if (next.length === 0) {
			if (homeOrganisationId && availableOrganisationIds.includes(homeOrganisationId)) {
				next = [homeOrganisationId];
			} else if (availableOrganisationIds.length > 0) {
				next = [availableOrganisationIds[0]];
			}
		}
		void userSettingsStore.setOrganisationFilters('talents', next);
	};
</script>

<div class="relative space-y-6">
	<div class="absolute right-0 top-0 z-10 flex items-center gap-2">
		{#if canManageTalents}
			<div class="bg-primary inline-flex items-center rounded-sm p-1">
				<Button
					type="button"
					variant="primary"
					size="sm"
					class="px-3"
					onclick={() => (isCreateDrawerOpen = true)}
				>
					Create talent
				</Button>
			</div>
		{/if}
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
				onclick={() => setTalentsViewMode('grid')}
				class={`px-2 ${
					talentsViewMode === 'grid'
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
				onclick={() => setTalentsViewMode('list')}
				class={`px-2 ${
					talentsViewMode === 'list'
						? 'border-primary bg-primary hover:bg-primary/90 text-white hover:text-white'
						: 'border-transparent bg-transparent'
				}`}
			>
				<List size={16} />
			</Button>
		</div>
	</div>

	<header>
		<h1 class="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">Talents</h1>
		<p class="text-muted-fg mt-3 text-lg">Browse all talents and open their resume workspace.</p>
	</header>

	{#if filtersOpen}
		<div
			transition:slide={{ duration: 300, easing: cubicOut }}
			class="border-border bg-card rounded-none border p-6"
		>
			<div class="space-y-6">
				{#if organisationFilterOptions.length > 0}
					<div>
						<h2 class="text-muted-fg mb-3 text-xs font-semibold uppercase tracking-wide">
							Organisation
						</h2>
						<div class="w-64">
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
			</div>
		</div>
	{/if}

	{#if canManageTalents && actionMessage}
		<Alert variant={actionFailed ? 'destructive' : 'success'} size="sm">
			<p class="text-foreground text-sm font-medium">{actionMessage}</p>
		</Alert>
	{/if}

	{#if canManageTalents}
		<TalentFormDrawer bind:open={isCreateDrawerOpen} />
	{/if}

	{#if allTalents.length === 0}
		<div class="border-border bg-card rounded-sm border p-6">
			<h2 class="text-foreground text-lg font-semibold">No talents yet</h2>
			<p class="text-muted-fg mt-2 text-sm">
				Talents will appear here once created. User linkage is optional.
			</p>
		</div>
	{:else if talents.length === 0}
		<div class="border-border bg-card rounded-sm border p-6">
			<h2 class="text-foreground text-lg font-semibold">No talents in selected organisations</h2>
			<p class="text-muted-fg mt-2 text-sm">Try selecting another organisation filter.</p>
		</div>
	{:else if talentsViewMode === 'grid'}
		<div class="mb-2">
			<Input icon={Search} bind:value={searchQuery} placeholder="Search..." class="pl-9" />
		</div>
		<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{#each searchFilteredTalents as talent (talent.id)}
				<a href={resolve('/resumes/[personId]', { personId: talent.id })} class="block h-full">
					<Card
						class="flex h-full flex-col overflow-hidden rounded-none transition-all hover:shadow-md"
					>
						<div class="bg-muted aspect-square w-full overflow-hidden">
							{#if talent.avatar_url}
								<img
									src={talent.avatar_url}
									alt={getTalentName(talent)}
									class="h-full w-full object-cover object-top transition-transform duration-500 hover:scale-105"
								/>
							{:else}
								<div class="text-muted-fg flex h-full w-full items-center justify-center">
									<User size={48} />
								</div>
							{/if}
						</div>
						<div class="flex flex-1 flex-col p-5">
							<h3 class="text-foreground text-lg font-semibold">{getTalentName(talent)}</h3>
							{#if talent.title}
								<p class="text-muted-fg mt-1 text-sm">{talent.title}</p>
							{/if}
							{#if talent.email}
								<p class="text-muted-fg mt-2 text-xs">{talent.email}</p>
							{/if}
							{#if talent.organisation_logo_url || talent.organisation_name}
								<div class="mt-auto pt-3">
									{#if talent.organisation_logo_url}
										<img
											src={talent.organisation_logo_url}
											alt={talent.organisation_name ?? 'Organisation'}
											class="h-5 w-auto object-contain"
										/>
									{:else}
										<span class="text-muted-fg text-xs font-medium">{talent.organisation_name}</span
										>
									{/if}
								</div>
							{/if}
						</div>
					</Card>
				</a>
			{/each}
		</div>
		{#if searchQuery && searchFilteredTalents.length === 0}
			<div class="text-muted-fg flex justify-center p-6 text-sm font-medium">
				No results for: {searchQuery}
			</div>
		{/if}
	{:else}
		<SuperList instance={talentListHandler} emptyMessage="No talents found">
			{#each talentListHandler.data as row (row.id)}
				<Row.Root href={resolve('/resumes/[personId]', { personId: row.id })}>
					<Cell.Value width={6}>
						<Cell.Avatar src={row.avatar_url} alt={row.name} size={36} />
					</Cell.Value>
					<Cell.Value width={28}>
						<span class="text-foreground truncate text-sm font-semibold">{row.name}</span>
					</Cell.Value>
					<Cell.Value width={28}>
						{#if row.title}
							<span class="text-muted-fg truncate text-sm">{row.title}</span>
						{/if}
					</Cell.Value>
					<Cell.Value width={22}>
						{#if row.email}
							<span class="text-muted-fg truncate text-xs">{row.email}</span>
						{/if}
					</Cell.Value>
					<Cell.Value width={16}>
						{#if row.organisation_logo_url}
							<img
								src={row.organisation_logo_url}
								alt={row.organisation_name ?? 'Organisation'}
								class="h-5 w-auto object-contain"
							/>
						{:else if row.organisation_name}
							<span class="text-muted-fg text-xs font-medium">{row.organisation_name}</span>
						{/if}
					</Cell.Value>
				</Row.Root>
			{/each}
		</SuperList>
	{/if}
</div>
