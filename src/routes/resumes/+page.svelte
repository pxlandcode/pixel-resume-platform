<script lang="ts">
	import TechStackSelector from '$lib/components/tech-stack-selector/tech-stack-selector.svelte';
	import ConsultantAvailabilityPills from '$lib/components/resumes/ConsultantAvailabilityPills.svelte';
	import { DropdownCheckbox } from '$lib/components/dropdown-checkbox';
	import { SuperList, ListHandler, Cell, Row } from '$lib/components/super-list';
	import type { SuperListHead } from '$lib/components/super-list';
	import { userSettingsStore } from '$lib/stores/userSettings';
	import type { ViewMode } from '$lib/types/userSettings';
	import { Button, Card, Input } from '@pixelcode_/blocks/components';
	import { User, Search, SlidersHorizontal, LayoutGrid, List } from 'lucide-svelte';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	const { data } = $props();

	const allTalents = data.talents ?? [];
	let selectedTechs = $state<string[]>([]);
	let filtersOpen = $state(false);
	let searchQuery = $state('');
	const resumesViewMode = $derived($userSettingsStore.settings.views.resumes);
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
			$userSettingsStore.settings.organisationFilters.resumes
		);
		if (configured.length > 0) return configured;

		if (homeOrganisationId && availableOrganisationIds.includes(homeOrganisationId)) {
			return [homeOrganisationId];
		}

		return [availableOrganisationIds[0]];
	});

	const visibleTalents = $derived.by(() => {
		if (selectedOrganisationIds.length === 0) return allTalents;

		const selectedSet = new Set(selectedOrganisationIds);
		return allTalents.filter(
			(talent) =>
				typeof talent.organisation_id === 'string' && selectedSet.has(talent.organisation_id)
		);
	});

	const normalize = (value: string) => value.trim().toLowerCase();

	const selectedTechFilters = $derived(
		selectedTechs.map((tech) => normalize(tech)).filter((tech) => tech.length > 0)
	);

	type TalentWithScore = (typeof visibleTalents)[number] & {
		matchCount: number;
		matchedTechs: string[];
		unmatchedTechs: string[];
	};

	const groupedTalents = $derived.by(() => {
		if (selectedTechFilters.length === 0) {
			return [{ matchCount: 0, total: 0, talents: visibleTalents as TalentWithScore[] }];
		}

		const talentsWithScores: TalentWithScore[] = visibleTalents.map((talent) => {
			const talentTechSet = new Set(
				(talent.search_techs ?? [])
					.filter((tech): tech is string => typeof tech === 'string')
					.map((tech) => normalize(tech))
					.filter((tech) => tech.length > 0)
			);

			const matchedTechs: string[] = [];
			const unmatchedTechs: string[] = [];

			// Use original selectedTechs to preserve casing for display
			for (const tech of selectedTechs) {
				if (talentTechSet.has(normalize(tech))) {
					matchedTechs.push(tech);
				} else {
					unmatchedTechs.push(tech);
				}
			}

			const matchCount = matchedTechs.length;
			return { ...talent, matchCount, matchedTechs, unmatchedTechs };
		});

		// Group by match count, sorted descending
		const groups = new Map<number, TalentWithScore[]>();
		for (const emp of talentsWithScores) {
			if (emp.matchCount === 0) continue; // Skip talents with no matches
			const existing = groups.get(emp.matchCount) ?? [];
			existing.push(emp);
			groups.set(emp.matchCount, existing);
		}

		// Convert to array sorted by match count descending
		return Array.from(groups.entries())
			.sort((a, b) => b[0] - a[0])
			.map(([matchCount, talents]) => ({
				matchCount,
				total: selectedTechFilters.length,
				talents
			}));
	});

	const totalMatches = $derived(
		groupedTalents.reduce((sum, group) => sum + group.talents.length, 0)
	);

	const getTalentName = (talent: (typeof allTalents)[number]) =>
		[talent.first_name, talent.last_name].filter(Boolean).join(' ') || 'Unnamed';

	type ResumesListRow = {
		id: string;
		name: string;
		avatar_url: string | null;
		availability: (typeof allTalents)[number]['availability'] | null;
		organisation_name: string | null;
		organisation_logo_url: string | null;
	};

	const resumesListHeadings: SuperListHead<ResumesListRow>[] = [
		{ heading: null, width: 6 },
		{ heading: 'Name', sortable: 'name', filterable: 'name', width: 34 },
		{ heading: 'Availability', width: 35 },
		{ heading: 'Organisation', sortable: 'organisation_name', width: 25 }
	];

	const toListRows = (talents: typeof visibleTalents): ResumesListRow[] =>
		talents.map((t) => ({
			id: t.id,
			name: getTalentName(t),
			avatar_url: t.avatar_url ?? null,
			availability: t.availability ?? null,
			organisation_name: t.organisation_name ?? null,
			organisation_logo_url: t.organisation_logo_url ?? null
		}));

	const listHandler = $derived.by(() => {
		const handler = new ListHandler<ResumesListRow>(
			resumesListHeadings,
			toListRows(visibleTalents)
		);
		handler.query = searchQuery;
		return handler;
	});

	const getMatchPillClass = (matchCount: number, total: number) => {
		if (matchCount === total) return 'bg-emerald-100 text-emerald-700';
		if (matchCount >= total * 0.6) return 'bg-amber-100 text-amber-700';
		return 'bg-muted text-muted-fg';
	};

	const getMatchBadgeClass = (matchCount: number, total: number) => {
		if (matchCount === total) return 'bg-emerald-500 text-white';
		if (matchCount >= total * 0.6) return 'bg-amber-500 text-white';
		return 'bg-muted-fg text-white';
	};

	const searchFilteredTalents = $derived.by(() => {
		if (!searchQuery.trim()) return visibleTalents;
		const q = searchQuery.trim().toLowerCase();
		return visibleTalents.filter((t) => getTalentName(t).toLowerCase().includes(q));
	});

	const activeFilterCount = $derived(selectedTechs.length);

	function toggleFilters() {
		filtersOpen = !filtersOpen;
	}

	const setResumesViewMode = (mode: ViewMode) => {
		void userSettingsStore.setViewMode('resumes', mode);
	};

	const handleOrganisationFilterChange = (selected: string[]) => {
		let next = sanitizeOrganisationIds(selected);
		if (next.length === 0) {
			if (homeOrganisationId && availableOrganisationIds.includes(homeOrganisationId)) {
				next = [homeOrganisationId];
			} else if (availableOrganisationIds.length > 0) {
				next = [availableOrganisationIds[0]];
			}
		}
		void userSettingsStore.setOrganisationFilters('resumes', next);
	};
</script>

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
				{#if activeFilterCount > 0}
					<span
						class="bg-primary absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white"
					></span>
				{/if}
			</button>
		</div>
		<div class="border-border bg-card inline-flex rounded-sm border p-1">
			<Button
				type="button"
				variant="outline"
				size="sm"
				onclick={() => setResumesViewMode('grid')}
				class={`px-2 ${
					resumesViewMode === 'grid'
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
				onclick={() => setResumesViewMode('list')}
				class={`px-2 ${
					resumesViewMode === 'list'
						? 'border-primary bg-primary hover:bg-primary/90 text-white hover:text-white'
						: 'border-transparent bg-transparent'
				}`}
			>
				<List size={16} />
			</Button>
		</div>
	</div>

	<header>
		<h1 class="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">Resumes</h1>
		<p class="text-muted-fg mt-3 text-lg">
			Manage and view talents and resumes for all Pixel&Code consultants.
		</p>
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

				<div>
					<div class="mb-3 flex items-center justify-between gap-4">
						<h2 class="text-muted-fg text-xs font-semibold uppercase tracking-wide">
							Search by tech
						</h2>
						{#if selectedTechs.length > 0}
							<Button variant="ghost" size="sm" onclick={() => (selectedTechs = [])}>Clear</Button>
						{/if}
					</div>
					<TechStackSelector bind:value={selectedTechs} />
					<p class="text-muted-fg mt-3 text-sm">
						{totalMatches} of {visibleTalents.length} consultants match.
					</p>
				</div>
			</div>
		</div>
	{/if}

	{#if visibleTalents.length === 0}
		<div class="border-border rounded-none border-2 border-dashed p-10 text-center">
			<h3 class="text-foreground text-lg font-medium">No consultants in selected organisations</h3>
			<p class="text-muted-fg mt-2 text-sm">Try selecting another organisation filter.</p>
		</div>
	{:else if selectedTechFilters.length === 0}
		<!-- No search active - show all talents -->
		<div class="mb-2">
			<Input icon={Search} bind:value={searchQuery} placeholder="Search..." class="pl-9" />
		</div>
		{#if resumesViewMode === 'grid'}
			<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
				{#each searchFilteredTalents as talent (talent.id)}
					<a href={`/resumes/${encodeURIComponent(talent.id)}`} class="block h-full">
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
								<div class="mt-2">
									<ConsultantAvailabilityPills compact availability={talent.availability ?? null} />
								</div>
								{#if talent.organisation_logo_url || talent.organisation_name}
									<div class="mt-auto pt-3">
										{#if talent.organisation_logo_url}
											<img
												src={talent.organisation_logo_url}
												alt={talent.organisation_name ?? 'Organisation'}
												class="h-5 w-auto object-contain"
											/>
										{:else}
											<span class="text-muted-fg text-xs font-medium"
												>{talent.organisation_name}</span
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
			<SuperList instance={listHandler} emptyMessage="No consultants found">
				{#each listHandler.data as row (row.id)}
					<Row.Root href={`/resumes/${encodeURIComponent(row.id)}`}>
						<Cell.Value width={6}>
							<Cell.Avatar src={row.avatar_url} alt={row.name} size={36} />
						</Cell.Value>
						<Cell.Value width={34}>
							<span class="text-foreground truncate text-sm font-semibold">{row.name}</span>
						</Cell.Value>
						<Cell.Value width={35}>
							<ConsultantAvailabilityPills compact availability={row.availability} />
						</Cell.Value>
						<Cell.Value width={25}>
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
	{:else if groupedTalents.length > 0}
		<!-- Search active - show grouped by match count -->
		<div class="space-y-10">
			{#each groupedTalents as group (group.matchCount)}
				<section>
					<div class="mb-4 flex items-center gap-3">
						<h2 class="text-foreground text-lg font-semibold">
							{#if group.matchCount === group.total}
								<span class="text-emerald-600">Perfect match</span>
							{:else}
								Partial match
							{/if}
						</h2>
						<span
							class={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${getMatchPillClass(
								group.matchCount,
								group.total
							)}`}
						>
							{group.matchCount}/{group.total} techs
						</span>
						<span class="text-muted-fg text-sm">
							({group.talents.length} consultant{group.talents.length === 1 ? '' : 's'})
						</span>
					</div>

					{#if resumesViewMode === 'grid'}
						<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
							{#each group.talents as talent (talent.id)}
								<a href={`/resumes/${encodeURIComponent(talent.id)}`} class="block h-full">
									<Card
										class="flex h-full flex-col overflow-hidden rounded-none transition-all hover:shadow-md
											{group.matchCount === group.total ? 'ring-2 ring-emerald-200' : ''}"
									>
										<div class="bg-muted relative aspect-square w-full overflow-hidden">
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
											<!-- Match badge on image -->
											<span
												class={`group absolute right-2 top-2 inline-flex cursor-help items-center rounded-full px-2 py-1 text-xs font-bold shadow-sm ${getMatchBadgeClass(
													talent.matchCount,
													group.total
												)}`}
											>
												{talent.matchCount}/{group.total}
												<!-- Tooltip -->
												<div
													class="border-border bg-card text-foreground pointer-events-none invisible absolute right-0 top-full z-50 mt-2 w-56 rounded-sm border p-3 text-left text-sm opacity-0 shadow-xl transition-all group-hover:visible group-hover:opacity-100"
												>
													<div class="flex flex-wrap gap-1">
														{#each talent.matchedTechs as tech}
															<span
																class="rounded-sm bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"
															>
																{tech}
															</span>
														{/each}
														{#each talent.unmatchedTechs as tech}
															<span
																class="rounded-sm bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
															>
																{tech}
															</span>
														{/each}
													</div>
												</div>
											</span>
										</div>

										<div class="flex flex-1 flex-col p-5">
											<h3 class="text-foreground text-lg font-semibold">{getTalentName(talent)}</h3>
											<div class="mt-2">
												<ConsultantAvailabilityPills
													compact
													availability={talent.availability ?? null}
												/>
											</div>
											{#if talent.organisation_logo_url || talent.organisation_name}
												<div class="mt-auto pt-3">
													{#if talent.organisation_logo_url}
														<img
															src={talent.organisation_logo_url}
															alt={talent.organisation_name ?? 'Organisation'}
															class="h-5 w-auto object-contain"
														/>
													{:else}
														<span class="text-muted-fg text-xs font-medium"
															>{talent.organisation_name}</span
														>
													{/if}
												</div>
											{/if}
										</div>
									</Card>
								</a>
							{/each}
						</div>
					{:else}
						<div class="border-border divide-border divide-y border-x border-b">
							{#each group.talents as talent (talent.id)}
								<Row.Root
									href={`/resumes/${encodeURIComponent(talent.id)}`}
									highlight={talent.matchCount === group.total}
								>
									<Cell.Value width={6}>
										<Cell.Avatar src={talent.avatar_url} alt={getTalentName(talent)} size={36} />
									</Cell.Value>
									<Cell.Value width={24}>
										<div class="flex flex-wrap items-center gap-2">
											<span class="text-foreground truncate text-sm font-semibold">
												{getTalentName(talent)}
											</span>
											<span
												class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getMatchPillClass(
													talent.matchCount,
													group.total
												)}`}
											>
												{talent.matchCount}/{group.total}
											</span>
										</div>
									</Cell.Value>
									<Cell.Value width={20}>
										<ConsultantAvailabilityPills
											compact
											availability={talent.availability ?? null}
										/>
									</Cell.Value>
									<Cell.Value width={30}>
										<div class="flex flex-wrap gap-1">
											{#each talent.matchedTechs as tech}
												<span
													class="rounded-sm bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"
												>
													{tech}
												</span>
											{/each}
											{#each talent.unmatchedTechs as tech}
												<span
													class="rounded-sm bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
												>
													{tech}
												</span>
											{/each}
										</div>
									</Cell.Value>
									<Cell.Value width={20}>
										{#if talent.organisation_logo_url}
											<img
												src={talent.organisation_logo_url}
												alt={talent.organisation_name ?? 'Organisation'}
												class="h-5 w-auto object-contain"
											/>
										{:else if talent.organisation_name}
											<span class="text-muted-fg text-xs font-medium"
												>{talent.organisation_name}</span
											>
										{/if}
									</Cell.Value>
								</Row.Root>
							{/each}
						</div>
					{/if}
				</section>
			{/each}
		</div>
	{:else}
		<div class="border-border rounded-none border-2 border-dashed p-10 text-center">
			<h3 class="text-foreground text-lg font-medium">No consultants found</h3>
			<p class="text-muted-fg mt-2 text-sm">
				No consultant matched any of the selected technologies.
			</p>
		</div>
	{/if}
</div>
