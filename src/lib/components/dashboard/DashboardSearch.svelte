<script lang="ts">
	import { page } from '$app/stores';
	import { Input } from '@pixelcode_/blocks/components';
	import { Search, Users, FileText, CircleCheck, CalendarClock, Briefcase } from 'lucide-svelte';
	import { onDestroy, onMount } from 'svelte';

	import { SvelteSet } from 'svelte/reactivity';
	import ConsultantAvailabilityPills from '$lib/components/resumes/ConsultantAvailabilityPills.svelte';

	import type { QuickSearchResponse, QuickSearchSection } from '$lib/types/quickSearch';
	import type { QuickSearchStatus } from '$lib/components/menu-layout/types';
	import { getEarliestAvailabilityDate } from '$lib/utils/availability';
	import {
		getQuickSearchEmptyMessage,
		getQuickSearchErrorMessage,
		isSearchResultActive
	} from '$lib/components/menu-layout/utils';
	import { ripple } from '$lib/utils/ripple';

	let { autoFocus = false }: { autoFocus?: boolean } = $props();

	const activePath = $derived($page.url.pathname);

	type IndividualFilter = 'profiles' | 'resumes' | 'available-now' | 'available-soon';

	const filters: Array<{ id: 'all' | IndividualFilter; label: string; icon: typeof Users }> = [
		{ id: 'all', label: 'All', icon: Search },
		{ id: 'profiles', label: 'Talents', icon: Users },
		{ id: 'resumes', label: 'Resumes', icon: FileText },
		{ id: 'available-now', label: 'Available Now', icon: CircleCheck },
		{ id: 'available-soon', label: 'Available Soon', icon: CalendarClock }
	];

	let activeFilters = new SvelteSet<IndividualFilter>();

	const isAllMode = $derived(activeFilters.size === 0);

	const isFilterActive = (id: 'all' | IndividualFilter) => {
		if (id === 'all') return isAllMode;
		return activeFilters.has(id);
	};

	const toggleFilter = (id: 'all' | IndividualFilter) => {
		if (id === 'all') {
			activeFilters.clear();
			return;
		}
		if (activeFilters.has(id)) {
			activeFilters.delete(id);
		} else {
			activeFilters.add(id);
		}
	};

	let searchQuery = $state('');
	let quickSearchSections = $state<QuickSearchSection[]>([]);
	let quickSearchStatus = $state<QuickSearchStatus>('idle');
	let quickSearchError = $state<string | null>(null);
	let quickSearchAbortController: AbortController | null = null;
	let quickSearchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	let inputFocused = $state(false);
	let searchContainerEl: HTMLDivElement | undefined = $state();

	onMount(() => {
		if (autoFocus || window.innerWidth >= 1024) {
			searchContainerEl?.querySelector('input')?.focus();
		}
	});

	const searchTerm = $derived(searchQuery.trim());
	const hasSearchQuery = $derived(searchTerm.length > 0);

	const AVAILABLE_SOON_DAYS = 30;

	const isAvailableNow = (result: {
		availability?: { nowPercent?: number | null; hasData?: boolean } | null;
	}) => {
		const avail = result.availability;
		return avail?.hasData === true && avail.nowPercent != null && avail.nowPercent >= 50;
	};

	const isAvailableSoon = (result: {
		availability?: {
			nowPercent?: number | null;
			futurePercent?: number | null;
			switchFromDate?: string | null;
			plannedFromDate?: string | null;
			hasData?: boolean;
		} | null;
	}) => {
		const avail = result.availability;
		if (!avail?.hasData) return false;
		if (avail.nowPercent != null && avail.nowPercent >= 50) return false;
		const earliest = getEarliestAvailabilityDate(avail);
		if (!earliest) return false;
		const daysUntil = Math.ceil(
			(new Date(earliest).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
		);
		return daysUntil >= 0 && daysUntil <= AVAILABLE_SOON_DAYS;
	};

	const filteredSections = $derived.by(() => {
		if (isAllMode) return quickSearchSections;

		const wantProfiles = activeFilters.has('profiles');
		const wantResumes = activeFilters.has('resumes');
		const wantAvailNow = activeFilters.has('available-now');
		const wantAvailSoon = activeFilters.has('available-soon');

		const sections: QuickSearchSection[] = [];

		// Profiles section: shown if 'profiles' or any availability filter is active
		const hasProfileFilter = wantProfiles || wantAvailNow || wantAvailSoon;
		if (hasProfileFilter) {
			const profilesSection = quickSearchSections.find((s) => s.id === 'profiles');
			if (profilesSection) {
				const hasAvailabilityFilter = wantAvailNow || wantAvailSoon;
				if (!hasAvailabilityFilter) {
					// Only 'profiles' toggle — show all profiles
					sections.push(profilesSection);
				} else {
					// Apply availability narrowing
					const filtered = profilesSection.results.filter((r) => {
						if (wantAvailNow && isAvailableNow(r)) return true;
						if (wantAvailSoon && isAvailableSoon(r)) return true;
						return false;
					});
					if (filtered.length > 0) {
						sections.push({ ...profilesSection, results: filtered });
					}
				}
			}
		}

		// Resumes section
		if (wantResumes) {
			const resumesSection = quickSearchSections.find((s) => s.id === 'resumes');
			if (resumesSection) sections.push(resumesSection);
		}

		return sections;
	});
	const showResults = $derived(hasSearchQuery && inputFocused);

	const clearQuickSearchDebounce = () => {
		if (quickSearchDebounceTimer === null) return;
		clearTimeout(quickSearchDebounceTimer);
		quickSearchDebounceTimer = null;
	};

	const abortQuickSearch = () => {
		quickSearchAbortController?.abort();
		quickSearchAbortController = null;
	};

	const resetQuickSearch = () => {
		clearQuickSearchDebounce();
		abortQuickSearch();
		quickSearchSections = [];
		quickSearchStatus = 'idle';
		quickSearchError = null;
	};

	const loadQuickSearch = async (query: string) => {
		abortQuickSearch();
		const controller = new AbortController();
		quickSearchAbortController = controller;
		quickSearchStatus = 'loading';
		quickSearchError = null;

		try {
			const response = await fetch(`/internal/api/quick-search?q=${encodeURIComponent(query)}`, {
				method: 'GET',
				credentials: 'include',
				signal: controller.signal
			});

			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as { message?: unknown } | null;
				throw new Error(
					typeof payload?.message === 'string'
						? payload.message
						: 'Could not load quick search results.'
				);
			}

			const payload = (await response.json()) as QuickSearchResponse;
			if (controller.signal.aborted || searchQuery.trim() !== query) return;

			quickSearchSections = Array.isArray(payload?.sections) ? payload.sections : [];
			quickSearchStatus = 'ready';
			quickSearchError = null;
		} catch (error) {
			if (controller.signal.aborted) return;
			quickSearchSections = [];
			quickSearchStatus = 'error';
			quickSearchError =
				error instanceof Error ? error.message : 'Could not load quick search results.';
		} finally {
			if (quickSearchAbortController === controller) {
				quickSearchAbortController = null;
			}
		}
	};

	const handleSelect = () => {
		searchQuery = '';
		resetQuickSearch();
		inputFocused = false;
	};

	const handleKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape' && hasSearchQuery) {
			searchQuery = '';
			resetQuickSearch();
		}
	};

	$effect(() => {
		const query = searchTerm;
		clearQuickSearchDebounce();

		if (!query) {
			resetQuickSearch();
			return;
		}

		quickSearchStatus = 'loading';
		quickSearchError = null;
		quickSearchDebounceTimer = setTimeout(() => {
			void loadQuickSearch(query);
			quickSearchDebounceTimer = null;
		}, 180);

		return () => {
			clearQuickSearchDebounce();
		};
	});

	onDestroy(() => {
		clearQuickSearchDebounce();
		abortQuickSearch();
	});
</script>

<div
	class="space-y-3"
	onfocusin={() => (inputFocused = true)}
	onfocusout={(e) => {
		const container = e.currentTarget;
		setTimeout(() => {
			if (!container.contains(document.activeElement)) inputFocused = false;
		}, 200);
	}}
>
	<!-- Filter buttons -->
	<div class="flex flex-wrap items-center gap-2">
		{#each filters as filter (filter.id)}
			<button
				type="button"
				class="flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors {isFilterActive(
					filter.id
				)
					? 'bg-foreground text-background'
					: 'bg-muted text-muted-fg hover:text-foreground'}"
				onclick={() => toggleFilter(filter.id)}
			>
				<filter.icon size={14} />
				{filter.label}
			</button>
		{/each}
	</div>

	<!-- Search input -->
	<div class="relative" bind:this={searchContainerEl}>
		<Input
			icon={Search}
			bind:value={searchQuery}
			placeholder="Search talents, resumes, tech stack..."
			class="h-11 rounded-sm pl-10 text-sm"
			onkeydown={handleKeydown}
		/>
		{#if showResults}
			<div
				class="border-border bg-card absolute left-0 right-0 top-full z-50 mt-1 max-h-[28rem] overflow-y-auto rounded-sm border p-3 shadow-lg"
			>
				{#if quickSearchStatus === 'loading' && filteredSections.length === 0}
					<div
						class="border-border text-muted-fg rounded-sm border border-dashed px-4 py-6 text-sm"
					>
						Searching talents, profiles, resumes, and tech stack...
					</div>
				{:else if quickSearchStatus === 'error'}
					<div class="border-border rounded-sm border border-dashed px-4 py-6 text-sm text-red-600">
						{getQuickSearchErrorMessage(quickSearchError)}
					</div>
				{:else if filteredSections.length > 0}
					<div class="space-y-4">
						{#if quickSearchStatus === 'loading'}
							<p class="text-muted-fg px-1 text-[11px] font-medium uppercase tracking-[0.16em]">
								Updating results
							</p>
						{/if}

						{#each filteredSections as section, sectionIndex (section.id)}
							<section class={sectionIndex > 0 ? 'mt-4' : ''}>
								<div class="mb-3 flex min-h-4 items-center">
									<p class="text-muted-fg text-[11px] font-semibold uppercase tracking-[0.22em]">
										{section.label}
									</p>
								</div>

								<div class="space-y-1.5">
									{#each section.results as result (`${result.kind}:${result.id}`)}
										{@const ResultIcon = result.kind === 'resume' ? FileText : Briefcase}
										{@const resultLabel = result.kind === 'resume' ? 'Resume' : 'Profile'}
										<a
											href={result.href}
											onclick={() => handleSelect()}
											use:ripple={{ opacity: 0.14 }}
											class={`relative isolate flex items-start gap-3 rounded-sm px-3 py-2.5 transition-colors ${
												isSearchResultActive(result.href, activePath)
													? 'bg-primary/10 text-primary'
													: 'text-secondary-text hover:bg-muted/60 hover:text-foreground'
											}`}
										>
											<div
												class={`relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm ${
													isSearchResultActive(result.href, activePath)
														? 'bg-primary/12 text-primary'
														: 'bg-muted text-muted-fg'
												}`}
											>
												<ResultIcon size={16} />
											</div>

											<div class="relative z-10 min-w-0 flex-1">
												<div class="flex items-center gap-2">
													<p class="truncate text-sm font-semibold">{result.title}</p>
													<span
														class="bg-muted text-muted-fg rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]"
													>
														{resultLabel}
													</span>
												</div>

												{#if result.description}
													<p class="text-muted-fg mt-1 text-xs leading-5">{result.description}</p>
												{/if}

												{#if result.kind === 'profile' && result.availability}
													<div class="mt-1.5">
														<ConsultantAvailabilityPills
															availability={result.availability}
															compact
														/>
													</div>
												{/if}

												{#if result.matchedTechs.length > 0}
													<div class="mt-2 flex flex-wrap gap-1.5">
														{#each result.matchedTechs as tech (tech)}
															<span
																class="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[11px] font-medium"
															>
																{tech}
															</span>
														{/each}
													</div>
												{/if}
											</div>
										</a>
									{/each}
								</div>
							</section>
						{/each}
					</div>
				{:else}
					<div
						class="border-border text-muted-fg rounded-sm border border-dashed px-4 py-6 text-sm"
					>
						{getQuickSearchEmptyMessage(searchTerm)}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
