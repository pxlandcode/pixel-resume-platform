<script lang="ts">
	import TechStackSelector from '$lib/components/tech-stack-selector/tech-stack-selector.svelte';
	import ConsultantAvailabilityPills from '$lib/components/resumes/ConsultantAvailabilityPills.svelte';
	import { DropdownCheckbox } from '$lib/components/dropdown-checkbox';
	import { SuperList, ListHandler, Cell, Row } from '$lib/components/super-list';
	import type { SuperListHead } from '$lib/components/super-list';
	import { clickOutside } from '$lib/utils/clickOutside';
	import { userSettingsStore } from '$lib/stores/userSettings';
	import type { ViewMode } from '$lib/types/userSettings';
	import { Button, Card, Input } from '@pixelcode_/blocks/components';
	import { User, Search, SlidersHorizontal, LayoutGrid, List } from 'lucide-svelte';
	import { onDestroy } from 'svelte';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	const { data } = $props();

	type AvailabilityMode = 'all' | 'now' | 'within-days';
	type TechStatus = 'met' | 'insufficient' | 'missing';
	type SelectedTechFilter = {
		label: string;
		key: string;
		requiredYears: number | null;
	};
	type TechMatch = SelectedTechFilter & {
		actualYears: number;
		status: TechStatus;
	};

	const DEFAULT_AVAILABILITY_WITHIN_DAYS = 30;
	const allTalents = data.talents ?? [];
	let selectedTechs = $state<string[]>([]);
	let requiredYearsByTechKey = $state<Record<string, number>>({});
	let filtersOpen = $state(false);
	let searchQuery = $state('');
	let availabilityMode = $state<AvailabilityMode>('all');
	let availabilityWithinDaysInput = $state(String(DEFAULT_AVAILABILITY_WITHIN_DAYS));
	let availabilityWithinDaysAppliedInput = $state(String(DEFAULT_AVAILABILITY_WITHIN_DAYS));
	let openTechRequirementKey = $state<string | null>(null);
	let techRequirementDraft = $state('');
	let techRequirementError = $state('');
	let availabilityWithinDaysDebounceTimer: ReturnType<typeof setTimeout> | null = null;

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

	const organisationFilteredTalents = $derived.by(() => {
		if (selectedOrganisationIds.length === 0) return allTalents;

		const selectedSet = new Set(selectedOrganisationIds);
		return allTalents.filter(
			(talent) =>
				typeof talent.organisation_id === 'string' && selectedSet.has(talent.organisation_id)
		);
	});

	const normalize = (value: string) => value.trim().toLowerCase();

	const toIsoUtcDate = (date: Date) => {
		const year = date.getUTCFullYear();
		const month = String(date.getUTCMonth() + 1).padStart(2, '0');
		const day = String(date.getUTCDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	};

	const parseNonNegativeInteger = (value: string, fallback: number) => {
		const trimmed = value.trim();
		if (!trimmed) return fallback;
		const parsed = Number.parseInt(trimmed, 10);
		if (!Number.isInteger(parsed) || parsed < 0) return fallback;
		return parsed;
	};

	const availabilityWithinDays = $derived.by(() =>
		parseNonNegativeInteger(availabilityWithinDaysAppliedInput, DEFAULT_AVAILABILITY_WITHIN_DAYS)
	);

	const clearAvailabilityDaysDebounce = () => {
		if (availabilityWithinDaysDebounceTimer === null) return;
		clearTimeout(availabilityWithinDaysDebounceTimer);
		availabilityWithinDaysDebounceTimer = null;
	};

	const scheduleAvailabilityWithinDaysApply = (rawValue: string) => {
		availabilityWithinDaysInput = rawValue;
		clearAvailabilityDaysDebounce();
		availabilityWithinDaysDebounceTimer = setTimeout(() => {
			availabilityWithinDaysAppliedInput = rawValue;
			availabilityWithinDaysDebounceTimer = null;
		}, 180);
	};

	const applyAvailabilityWithinDaysNow = (rawValue: string) => {
		availabilityWithinDaysInput = rawValue;
		availabilityWithinDaysAppliedInput = rawValue;
		clearAvailabilityDaysDebounce();
	};

	const handleAvailabilityWithinDaysKeydown = (event: KeyboardEvent) => {
		if (event.key !== 'Enter') return;
		const inputEl = event.currentTarget as HTMLInputElement | null;
		applyAvailabilityWithinDaysNow(inputEl?.value ?? availabilityWithinDaysInput);
	};

	onDestroy(() => {
		clearAvailabilityDaysDebounce();
	});

	const isAvailableNow = (
		availability: (typeof allTalents)[number]['availability'] | null | undefined
	) => typeof availability?.nowPercent === 'number' && availability.nowPercent > 0;

	const getEarliestAvailabilityDate = (
		availability: (typeof allTalents)[number]['availability'] | null | undefined
	) => {
		const switchDate =
			typeof availability?.switchFromDate === 'string' ? availability.switchFromDate : null;
		const plannedDate =
			typeof availability?.plannedFromDate === 'string' ? availability.plannedFromDate : null;
		if (switchDate && plannedDate) return switchDate < plannedDate ? switchDate : plannedDate;
		return switchDate ?? plannedDate;
	};

	const availabilityFilteredTalents = $derived.by(() => {
		if (availabilityMode === 'all') return organisationFilteredTalents;

		if (availabilityMode === 'now') {
			return organisationFilteredTalents.filter((talent) =>
				isAvailableNow(talent.availability ?? null)
			);
		}

		const now = new Date();
		const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
		todayUtc.setUTCDate(todayUtc.getUTCDate() + availabilityWithinDays);
		const latestAllowedDate = toIsoUtcDate(todayUtc);

		return organisationFilteredTalents.filter((talent) => {
			const availability = talent.availability ?? null;
			if (isAvailableNow(availability)) return true;
			const earliestDate = getEarliestAvailabilityDate(availability);
			if (!earliestDate) return false;
			return earliestDate <= latestAllowedDate;
		});
	});

	const selectedTechFilters = $derived.by<SelectedTechFilter[]>(() => {
		const seen = new Set<string>();
		const filters: SelectedTechFilter[] = [];

		for (const tech of selectedTechs) {
			const trimmed = tech.trim();
			if (!trimmed) continue;
			const key = normalize(trimmed);
			if (!key || seen.has(key)) continue;
			seen.add(key);
			filters.push({
				label: trimmed,
				key,
				requiredYears: requiredYearsByTechKey[key] ?? null
			});
		}

		return filters;
	});

	const recordsEqual = (left: Record<string, number>, right: Record<string, number>) => {
		const leftKeys = Object.keys(left);
		const rightKeys = Object.keys(right);
		if (leftKeys.length !== rightKeys.length) return false;
		for (const key of leftKeys) {
			if (!(key in right)) return false;
			if (left[key] !== right[key]) return false;
		}
		return true;
	};

	$effect(() => {
		const validKeys = new Set(selectedTechFilters.map((filter) => filter.key));
		const nextYearsByKey: Record<string, number> = {};

		for (const [key, years] of Object.entries(requiredYearsByTechKey)) {
			if (!validKeys.has(key)) continue;
			nextYearsByKey[key] = years;
		}

		if (!recordsEqual(requiredYearsByTechKey, nextYearsByKey)) {
			requiredYearsByTechKey = nextYearsByKey;
		}

		if (openTechRequirementKey && !validKeys.has(openTechRequirementKey)) {
			openTechRequirementKey = null;
			techRequirementDraft = '';
			techRequirementError = '';
		}
	});

	type TalentWithScore = (typeof allTalents)[number] & {
		metCount: number;
		insufficientCount: number;
		missingCount: number;
		total: number;
		techMatches: TechMatch[];
	};

	type TalentGroup = {
		metCount: number;
		insufficientCount: number;
		total: number;
		talents: TalentWithScore[];
	};

	const getTalentName = (talent: (typeof allTalents)[number]) =>
		[talent.first_name, talent.last_name].filter(Boolean).join(' ') || 'Unnamed';

	const getTalentTechYearsByKey = (talent: (typeof allTalents)[number]) => {
		const raw = talent.tech_years_by_key;
		if (!raw || typeof raw !== 'object') return {} as Record<string, number>;

		const normalized: Record<string, number> = {};
		for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
			if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
			normalized[normalize(key)] = value;
		}

		return normalized;
	};

	const groupedTalents = $derived.by<TalentGroup[]>(() => {
		if (selectedTechFilters.length === 0) return [];

		const scoredTalents: TalentWithScore[] = availabilityFilteredTalents
			.map((talent) => {
				const talentTechSet = new Set(
					(talent.search_techs ?? [])
						.filter((tech): tech is string => typeof tech === 'string')
						.map((tech) => normalize(tech))
						.filter((tech) => tech.length > 0)
				);
				const talentTechYearsByKey = getTalentTechYearsByKey(talent);

				const techMatches: TechMatch[] = selectedTechFilters.map((techFilter) => {
					const hasTech = talentTechSet.has(techFilter.key);
					const actualYears = talentTechYearsByKey[techFilter.key] ?? 0;

					let status: TechStatus = 'missing';
					if (hasTech) {
						if (techFilter.requiredYears === null || actualYears >= techFilter.requiredYears) {
							status = 'met';
						} else {
							status = 'insufficient';
						}
					}

					return {
						...techFilter,
						actualYears,
						status
					};
				});

				const metCount = techMatches.filter((match) => match.status === 'met').length;
				const insufficientCount = techMatches.filter(
					(match) => match.status === 'insufficient'
				).length;
				const missingCount = techMatches.length - metCount - insufficientCount;

				return {
					...talent,
					metCount,
					insufficientCount,
					missingCount,
					total: techMatches.length,
					techMatches
				};
			})
			.filter((talent) => talent.metCount + talent.insufficientCount > 0)
			.sort((left, right) => {
				if (right.metCount !== left.metCount) return right.metCount - left.metCount;
				if (right.insufficientCount !== left.insufficientCount) {
					return right.insufficientCount - left.insufficientCount;
				}
				return getTalentName(left).localeCompare(getTalentName(right));
			});

		const groupsByScore = new Map<string, TalentGroup>();
		for (const talent of scoredTalents) {
			const key = `${talent.metCount}:${talent.insufficientCount}`;
			const group = groupsByScore.get(key);
			if (group) {
				group.talents.push(talent);
				continue;
			}
			groupsByScore.set(key, {
				metCount: talent.metCount,
				insufficientCount: talent.insufficientCount,
				total: talent.total,
				talents: [talent]
			});
		}

		return Array.from(groupsByScore.values());
	});

	const totalMatches = $derived(
		groupedTalents.reduce((sum, group) => sum + group.talents.length, 0)
	);

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

	const toListRows = (talents: typeof availabilityFilteredTalents): ResumesListRow[] =>
		talents.map((talent) => ({
			id: talent.id,
			name: getTalentName(talent),
			avatar_url: talent.avatar_url ?? null,
			availability: talent.availability ?? null,
			organisation_name: talent.organisation_name ?? null,
			organisation_logo_url: talent.organisation_logo_url ?? null
		}));

	const listHandler = $derived.by(() => {
		const handler = new ListHandler<ResumesListRow>(
			resumesListHeadings,
			toListRows(availabilityFilteredTalents)
		);
		handler.query = searchQuery;
		return handler;
	});

	const isPerfectMatch = (metCount: number, total: number, insufficientCount: number) =>
		metCount === total && insufficientCount === 0;

	const getMatchPillClass = (metCount: number, total: number, insufficientCount: number) => {
		if (isPerfectMatch(metCount, total, insufficientCount))
			return 'bg-emerald-100 text-emerald-700';
		if (metCount + insufficientCount > 0) return 'bg-amber-100 text-amber-700';
		return 'bg-muted text-muted-fg';
	};

	const getMatchBadgeClass = (metCount: number, total: number, insufficientCount: number) => {
		if (isPerfectMatch(metCount, total, insufficientCount)) return 'bg-emerald-500 text-white';
		if (metCount + insufficientCount > 0) return 'bg-amber-500 text-white';
		return 'bg-muted-fg text-white';
	};

	const getTechStatusClass = (status: TechStatus) => {
		if (status === 'met') return 'bg-emerald-100 text-emerald-700';
		if (status === 'insufficient') return 'bg-amber-100 text-amber-700';
		return 'bg-red-100 text-red-700';
	};

	const roundUpOneDecimal = (value: number) => Math.ceil(value * 10) / 10;
	const formatYears = (value: number) => {
		const rounded = roundUpOneDecimal(value);
		const nearestInteger = Math.round(rounded);
		if (Math.abs(rounded - nearestInteger) < 0.000001) return `${nearestInteger}y`;
		return `${rounded.toFixed(1).replace(/\.0$/, '')}y`;
	};

	const getTechMatchTooltip = (techMatch: TechMatch) => {
		const actualYearsLabel = formatYears(techMatch.actualYears);
		if (techMatch.requiredYears === null) {
			return `${techMatch.label}: ${actualYearsLabel} experience`;
		}

		const requiredYearsLabel = formatYears(techMatch.requiredYears);
		if (techMatch.status === 'missing') {
			return `${techMatch.label}: missing (required ${requiredYearsLabel})`;
		}

		return `${techMatch.label}: ${actualYearsLabel} (required ${requiredYearsLabel})`;
	};

	const searchFilteredTalents = $derived.by(() => {
		if (!searchQuery.trim()) return availabilityFilteredTalents;
		const q = searchQuery.trim().toLowerCase();
		return availabilityFilteredTalents.filter((talent) =>
			getTalentName(talent).toLowerCase().includes(q)
		);
	});

	const activeFilterCount = $derived(
		selectedTechFilters.length + (availabilityMode === 'all' ? 0 : 1)
	);

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

	const closeTechRequirementPopover = () => {
		openTechRequirementKey = null;
		techRequirementDraft = '';
		techRequirementError = '';
	};

	const openTechRequirementPopover = (filter: SelectedTechFilter) => {
		if (openTechRequirementKey === filter.key) {
			closeTechRequirementPopover();
			return;
		}

		openTechRequirementKey = filter.key;
		techRequirementDraft = filter.requiredYears === null ? '' : String(filter.requiredYears);
		techRequirementError = '';
	};

	const removeSelectedTech = (techKey: string) => {
		selectedTechs = selectedTechs.filter((tech) => normalize(tech) !== techKey);
		if (openTechRequirementKey === techKey) {
			closeTechRequirementPopover();
		}
	};

	const clearSelectedTechFilters = () => {
		selectedTechs = [];
		requiredYearsByTechKey = {};
		closeTechRequirementPopover();
	};

	const applyTechRequirementDraft = (
		techKey: string,
		rawDraft = techRequirementDraft,
		closeOnSuccess = false
	) => {
		techRequirementDraft = rawDraft;
		const raw = rawDraft.trim().replace(',', '.');

		if (!raw) {
			const { [techKey]: _, ...rest } = requiredYearsByTechKey;
			requiredYearsByTechKey = rest;
			techRequirementError = '';
			if (closeOnSuccess) closeTechRequirementPopover();
			return true;
		}

		const parsed = Number(raw);
		if (!Number.isFinite(parsed) || parsed < 0) {
			techRequirementError = 'Enter a non-negative number.';
			return false;
		}

		const normalizedYears = Math.round(parsed * 2) / 2;
		requiredYearsByTechKey = {
			...requiredYearsByTechKey,
			[techKey]: normalizedYears
		};
		techRequirementError = '';
		if (closeOnSuccess) closeTechRequirementPopover();
		return true;
	};

	const clearTechRequirement = (techKey: string) => {
		const { [techKey]: _, ...rest } = requiredYearsByTechKey;
		requiredYearsByTechKey = rest;
		closeTechRequirementPopover();
	};

	const handleTechRequirementKeydown = (event: KeyboardEvent, techKey: string) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			const inputEl = event.currentTarget as HTMLInputElement | null;
			void applyTechRequirementDraft(techKey, inputEl?.value ?? techRequirementDraft, true);
			return;
		}

		if (event.key === 'Escape') {
			event.preventDefault();
			closeTechRequirementPopover();
		}
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
					<h2 class="text-muted-fg mb-3 text-xs font-semibold uppercase tracking-wide">
						Availability
					</h2>
					<div class="flex flex-wrap items-center gap-2">
						<Button
							type="button"
							size="sm"
							variant={availabilityMode === 'all' ? 'primary' : 'outline'}
							onclick={() => (availabilityMode = 'all')}
						>
							All
						</Button>
						<Button
							type="button"
							size="sm"
							variant={availabilityMode === 'now' ? 'primary' : 'outline'}
							onclick={() => (availabilityMode = 'now')}
						>
							Available now
						</Button>
						<Button
							type="button"
							size="sm"
							variant={availabilityMode === 'within-days' ? 'primary' : 'outline'}
							onclick={() => (availabilityMode = 'within-days')}
						>
							Available within X days
						</Button>
					</div>
					{#if availabilityMode === 'within-days'}
						<div class="mt-3 flex items-center gap-2">
							<Input
								type="number"
								min="0"
								step="1"
								size="sm"
								class="w-24"
								value={availabilityWithinDaysInput}
								oninput={(event) =>
									scheduleAvailabilityWithinDaysApply(
										(event.currentTarget as HTMLInputElement).value
									)}
								onblur={(event) =>
									applyAvailabilityWithinDaysNow((event.currentTarget as HTMLInputElement).value)}
								onkeydown={handleAvailabilityWithinDaysKeydown}
							/>
							<span class="text-muted-fg text-sm">days (including uppsägningstid)</span>
						</div>
					{/if}
				</div>

				<div>
					<div class="mb-3 flex items-center justify-between gap-4">
						<h2 class="text-muted-fg text-xs font-semibold uppercase tracking-wide">
							Search by tech
						</h2>
						{#if selectedTechFilters.length > 0}
							<Button variant="ghost" size="sm" onclick={clearSelectedTechFilters}>Clear</Button>
						{/if}
					</div>
					<TechStackSelector bind:value={selectedTechs} showSelectedChips={false} />

					{#if selectedTechFilters.length > 0}
						<div class="mt-3 flex flex-wrap gap-2" use:clickOutside={closeTechRequirementPopover}>
							{#each selectedTechFilters as techFilter (techFilter.key)}
								<div class="relative">
									<button
										type="button"
										onclick={() => openTechRequirementPopover(techFilter)}
										class="border-border bg-muted text-foreground inline-flex items-center gap-2 rounded-sm border px-3 py-1.5 pr-8 text-xs font-medium"
									>
										<span>{techFilter.label}</span>
										{#if techFilter.requiredYears !== null}
											<span class="text-muted-fg text-[10px]"
												>{formatYears(techFilter.requiredYears)}</span
											>
										{:else}
											<span class="text-muted-fg text-[10px]">any years</span>
										{/if}
									</button>
									<button
										type="button"
										onclick={(event) => {
											event.stopPropagation();
											removeSelectedTech(techFilter.key);
										}}
										class="text-muted-fg hover:text-foreground absolute right-1 top-1/2 -translate-y-1/2 rounded-sm px-1 text-xs"
										aria-label={`Remove ${techFilter.label}`}
									>
										×
									</button>

									{#if openTechRequirementKey === techFilter.key}
										<div
											class="border-border bg-card absolute left-0 top-full z-20 mt-2 w-52 rounded-sm border p-3 shadow-xl"
										>
											<p class="text-foreground text-xs font-semibold">
												Min years for {techFilter.label}
											</p>
											<Input
												type="number"
												min="0"
												step="0.5"
												size="sm"
												class="mt-2 w-full"
												value={techRequirementDraft}
												oninput={(event) =>
													void applyTechRequirementDraft(
														techFilter.key,
														(event.currentTarget as HTMLInputElement).value
													)}
												onblur={(event) =>
													void applyTechRequirementDraft(
														techFilter.key,
														(event.currentTarget as HTMLInputElement).value
													)}
												onkeydown={(event) => handleTechRequirementKeydown(event, techFilter.key)}
											/>
											{#if techRequirementError}
												<p class="mt-1 text-xs text-red-600">{techRequirementError}</p>
											{/if}
											<div class="mt-2 flex items-center justify-between gap-2">
												<Button
													type="button"
													size="sm"
													variant="ghost"
													onclick={() => clearTechRequirement(techFilter.key)}
												>
													Clear
												</Button>
												<span class="text-muted-fg text-[11px]">Auto-saved</span>
											</div>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}

					<p class="text-muted-fg mt-3 text-sm">
						{#if selectedTechFilters.length > 0}
							{totalMatches} of {availabilityFilteredTalents.length} consultants match.
						{:else}
							{availabilityFilteredTalents.length} consultants in current result set.
						{/if}
					</p>
				</div>
			</div>
		</div>
	{/if}

	{#if organisationFilteredTalents.length === 0}
		<div class="border-border rounded-none border-2 border-dashed p-10 text-center">
			<h3 class="text-foreground text-lg font-medium">No consultants in selected organisations</h3>
			<p class="text-muted-fg mt-2 text-sm">Try selecting another organisation filter.</p>
		</div>
	{:else if availabilityFilteredTalents.length === 0}
		<div class="border-border rounded-none border-2 border-dashed p-10 text-center">
			<h3 class="text-foreground text-lg font-medium">No consultants match availability filter</h3>
			<p class="text-muted-fg mt-2 text-sm">
				Try changing availability filter or extending days for availability window.
			</p>
		</div>
	{:else if selectedTechFilters.length === 0}
		<!-- No search active - show all talents -->
		{#if resumesViewMode === 'grid'}
			<div class="mb-2">
				<Input icon={Search} bind:value={searchQuery} placeholder="Search..." class="pl-9" />
			</div>
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
		<!-- Search active - show grouped by score -->
		<div class="space-y-10">
			{#each groupedTalents as group (`${group.metCount}-${group.insufficientCount}`)}
				<section>
					<div class="mb-4 flex items-center gap-3">
						<h2 class="text-foreground text-lg font-semibold">
							{#if isPerfectMatch(group.metCount, group.total, group.insufficientCount)}
								<span class="text-emerald-600">Perfect match</span>
							{:else}
								Partial match
							{/if}
						</h2>
						<span
							class={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${getMatchPillClass(
								group.metCount,
								group.total,
								group.insufficientCount
							)}`}
						>
							{group.metCount}/{group.total} met
							{#if group.insufficientCount > 0}
								<span class="ml-1">+ {group.insufficientCount} close</span>
							{/if}
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
										class="flex h-full flex-col overflow-visible rounded-none transition-all hover:shadow-md
											{isPerfectMatch(talent.metCount, group.total, talent.insufficientCount)
											? 'ring-2 ring-emerald-200'
											: ''}"
									>
										<div class="relative aspect-square w-full">
											<div class="bg-muted absolute inset-0 overflow-hidden">
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
											<span
												class={`absolute right-2 top-2 z-10 inline-flex items-center rounded-full px-2 py-1 text-xs font-bold shadow-sm ${getMatchBadgeClass(
													talent.metCount,
													group.total,
													talent.insufficientCount
												)}`}
											>
												{talent.metCount}/{group.total}
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
											<div class="mt-3 flex flex-wrap gap-1">
												{#each talent.techMatches as techMatch}
													<span
														class={`rounded-sm px-2 py-0.5 text-xs font-medium ${getTechStatusClass(techMatch.status)}`}
													>
														{techMatch.label}
														{#if techMatch.actualYears > 0}
															<span class="opacity-60">{formatYears(techMatch.actualYears)}</span>
														{/if}
													</span>
												{/each}
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
									highlight={isPerfectMatch(talent.metCount, group.total, talent.insufficientCount)}
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
													talent.metCount,
													group.total,
													talent.insufficientCount
												)}`}
											>
												{talent.metCount}/{group.total}
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
											{#each talent.techMatches as techMatch}
												<span
													class={`rounded-sm px-2 py-0.5 text-xs font-medium ${getTechStatusClass(techMatch.status)}`}
												>
													{techMatch.label}
													{#if techMatch.actualYears > 0}
														<span class="opacity-60">{formatYears(techMatch.actualYears)}</span>
													{/if}
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
				No consultant matched the selected technologies and year requirements.
			</p>
		</div>
	{/if}
</div>
