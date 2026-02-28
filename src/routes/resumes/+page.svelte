<script lang="ts">
	import TechStackSelector from '$lib/components/tech-stack-selector/tech-stack-selector.svelte';
	import ConsultantAvailabilityPills from '$lib/components/resumes/ConsultantAvailabilityPills.svelte';
	import { Button, Card } from '@pixelcode_/blocks/components';
	import { User, Search, X } from 'lucide-svelte';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	const { data } = $props();

	const liveTalents = data.talents ?? [];
	let selectedTechs = $state<string[]>([]);
	let searchOpen = $state(false);

	const normalize = (value: string) => value.trim().toLowerCase();

	const selectedTechFilters = $derived(
		selectedTechs.map((tech) => normalize(tech)).filter((tech) => tech.length > 0)
	);

	type TalentWithScore = (typeof liveTalents)[number] & {
		matchCount: number;
		matchedTechs: string[];
		unmatchedTechs: string[];
	};

	const groupedTalents = $derived.by(() => {
		if (selectedTechFilters.length === 0) {
			return [{ matchCount: 0, total: 0, talents: liveTalents as TalentWithScore[] }];
		}

		const talentsWithScores: TalentWithScore[] = liveTalents.map((talent) => {
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

	function toggleSearch() {
		searchOpen = !searchOpen;
	}
</script>

<div class="">
	<div class="mb-12 flex items-start justify-between gap-4">
		<div>
			<h1 class="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">Resumes</h1>
			<p class="text-muted-fg mt-4 text-lg">
				Manage and view talents and resumes for all Pixel&Code consultants.
			</p>
		</div>
		<Button
			variant="outline"
			size="sm"
			onclick={toggleSearch}
			class="flex shrink-0 items-center gap-2 {searchOpen ? 'bg-muted text-foreground' : ''}"
		>
			{#if searchOpen}
				<X size={16} />
				Close
			{:else}
				<Search size={16} />
				Search
				{#if selectedTechs.length > 0}
					<span
						class="bg-primary ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-xs text-white"
					>
						{selectedTechs.length}
					</span>
				{/if}
			{/if}
		</Button>
	</div>

	{#if searchOpen}
		<div
			transition:slide={{ duration: 300, easing: cubicOut }}
			class="border-border bg-card mb-8 rounded-none border p-6"
		>
			<div class="mb-3 flex items-center justify-between gap-4">
				<h2 class="text-muted-fg text-xs font-semibold uppercase tracking-wide">Search by tech</h2>
				{#if selectedTechs.length > 0}
					<Button variant="ghost" size="sm" onclick={() => (selectedTechs = [])}>Clear</Button>
				{/if}
			</div>
			<TechStackSelector bind:value={selectedTechs} />
			<p class="text-muted-fg mt-3 text-sm">
				{totalMatches} of {liveTalents.length} consultants match.
			</p>
		</div>
	{/if}

	{#if selectedTechFilters.length === 0}
		<!-- No search active - show all talents -->
		<div class="grid gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{#each liveTalents as talent (talent.id)}
				<a href={`/resumes/${encodeURIComponent(talent.id)}`} class="block h-full">
					<Card
						class="flex h-full flex-col overflow-hidden rounded-none transition-all hover:shadow-md"
					>
						<div class="bg-muted aspect-square w-full overflow-hidden">
							{#if talent.avatar_url}
								<img
									src={talent.avatar_url}
									alt={[talent.first_name, talent.last_name].filter(Boolean).join(' ')}
									class="h-full w-full object-cover object-top transition-transform duration-500 hover:scale-105"
								/>
							{:else}
								<div class="text-muted-fg flex h-full w-full items-center justify-center">
									<User size={48} />
								</div>
							{/if}
						</div>

						<div class="flex flex-1 flex-col p-5">
							<h3 class="text-foreground text-lg font-semibold">
								{[talent.first_name, talent.last_name].filter(Boolean).join(' ') || 'Unnamed'}
							</h3>
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
							class="inline-flex items-center rounded-full px-3 py-1 text-sm font-medium
								{group.matchCount === group.total
								? 'bg-emerald-100 text-emerald-700'
								: group.matchCount >= group.total * 0.6
									? 'bg-amber-100 text-amber-700'
								: 'bg-muted text-muted-fg'}"
						>
							{group.matchCount}/{group.total} techs
						</span>
						<span class="text-muted-fg text-sm">
							({group.talents.length} consultant{group.talents.length === 1 ? '' : 's'})
						</span>
					</div>

					<div class="grid gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
												alt={[talent.first_name, talent.last_name].filter(Boolean).join(' ')}
												class="h-full w-full object-cover object-top transition-transform duration-500 hover:scale-105"
											/>
										{:else}
											<div class="text-muted-fg flex h-full w-full items-center justify-center">
												<User size={48} />
											</div>
										{/if}
										<!-- Match badge on image -->
										<span
											class="group absolute right-2 top-2 inline-flex cursor-help items-center rounded-full px-2 py-1 text-xs font-bold shadow-sm
												{group.matchCount === group.total
												? 'bg-emerald-500 text-white'
												: group.matchCount >= group.total * 0.6
													? 'bg-amber-500 text-white'
												: 'bg-muted-fg text-white'}"
										>
											{group.matchCount}/{group.total}
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
										<h3 class="text-foreground text-lg font-semibold">
											{[talent.first_name, talent.last_name].filter(Boolean).join(' ') || 'Unnamed'}
										</h3>
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
