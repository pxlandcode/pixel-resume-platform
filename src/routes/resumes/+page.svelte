<script lang="ts">
	import { Input } from '@pixelcode_/blocks/components';
	import { Search } from 'lucide-svelte';
	import { onDestroy } from 'svelte';
	import { getEarliestAvailabilityDate } from '$lib/utils/availability';
	import { userSettingsStore } from '$lib/stores/userSettings';
	import type { ViewMode } from '$lib/types/userSettings';
	import type {
		ResumeSearchItem,
		ResumeSearchResponse,
		ResumeTechIndexResponse
	} from '$lib/types/resumes';
	import ResumeDefaultResults from '$lib/components/resumes/ResumeDefaultResults.svelte';
	import ResumeEmptyState from '$lib/components/resumes/ResumeEmptyState.svelte';
	import ResumeFreeTextResults from '$lib/components/resumes/ResumeFreeTextResults.svelte';
	import ResumeGroupedTechResults from '$lib/components/resumes/ResumeGroupedTechResults.svelte';
	import ResumesFiltersPanel from '$lib/components/resumes/ResumesFiltersPanel.svelte';
	import ResumesPageToolbar from '$lib/components/resumes/ResumesPageToolbar.svelte';
	import {
		type AvailabilityMode,
		type FreeTextTalentResult,
		type SelectedTechFilter,
		type TechMatch,
		type TechMatchSummary,
		type TalentGroup,
		getTalentName
	} from '$lib/components/resumes/pageShared';
	import type { PageData } from './$types';

	const { data } = $props<{ data: PageData }>();

	type FreeTextSearchCacheEntry = {
		generatedAt: string | null;
		items: ResumeSearchItem[];
	};

	const DEFAULT_AVAILABILITY_WITHIN_DAYS = 30;
	const MS_PER_DAY = 24 * 60 * 60 * 1000;
	const allTalents = data.talents ?? [];

	type Talent = (typeof allTalents)[number];
	type TalentTechData = {
		searchTechs: string[];
		techYearsByKey: Record<string, number>;
	};
	type TechScopeCacheEntry = {
		etag: string | null;
		generatedAt: string | null;
		itemsByTalentId: Record<string, TalentTechData>;
	};
	type TalentWithScore = Talent & TechMatchSummary;

	let selectedTechs = $state<string[]>([]);
	let requiredYearsByTechKey = $state<Record<string, number>>({});
	let filtersOpen = $state(false);
	let searchQuery = $state('');
	let freeTextSearchInput = $state('');
	let freeTextSearchApplied = $state('');
	let availabilityMode = $state<AvailabilityMode>('all');
	let availabilityWithinDaysInput = $state(String(DEFAULT_AVAILABILITY_WITHIN_DAYS));
	let availabilityWithinDaysAppliedInput = $state(String(DEFAULT_AVAILABILITY_WITHIN_DAYS));
	let openTechRequirementKey = $state<string | null>(null);
	let techRequirementDraft = $state('');
	let techRequirementError = $state('');
	let availabilityWithinDaysDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	let freeTextSearchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	let techIndexStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let techIndexError = $state<string | null>(null);
	let loadedTechScopeSignature = $state<string | null>(null);
	let activeTechScopeSignature = $state<string | null>(null);
	let techIndexAbortController: AbortController | null = null;
	let techScopeCache = $state<Record<string, TechScopeCacheEntry>>({});
	let freeTextSearchStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let freeTextSearchError = $state<string | null>(null);
	let loadedFreeTextSearchCacheKey = $state<string | null>(null);
	let activeFreeTextSearchCacheKey = $state<string | null>(null);
	let freeTextSearchAbortController: AbortController | null = null;
	let freeTextSearchCache = $state<Record<string, FreeTextSearchCacheEntry>>({});

	const resumesViewMode = $derived($userSettingsStore.settings.views.resumes);
	const homeOrganisationId = $derived(
		typeof data.homeOrganisationId === 'string' ? data.homeOrganisationId : null
	);

	const organisationFilterOptions = $derived.by<Array<{ label: string; value: string }>>(() =>
		(data.organisationOptions ?? []).map((org: { id: string; name: string }) => ({
			label: org.name,
			value: org.id
		}))
	);
	const availableOrganisationIds = $derived(
		organisationFilterOptions.map((org: { label: string; value: string }) => org.value)
	);

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

	const techScopeOrgIds = $derived(
		Array.from(new Set(selectedOrganisationIds.map((id) => id.trim()).filter(Boolean))).sort()
	);
	const techScopeSignature = $derived(
		techScopeOrgIds.length > 0 ? `org:${techScopeOrgIds.join(',')}` : 'default'
	);

	const organisationFilteredTalents = $derived.by(() => {
		if (selectedOrganisationIds.length === 0) return allTalents;

		const selectedSet = new Set(selectedOrganisationIds);
		return allTalents.filter(
			(talent: Talent) =>
				typeof talent.organisation_id === 'string' && selectedSet.has(talent.organisation_id)
		);
	});

	const normalize = (value: string) => value.trim().toLowerCase();

	const toIsoUtcDateFromMs = (timeMs: number) => {
		const date = new globalThis.Date(timeMs);
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
	const appliedFreeTextSearch = $derived(freeTextSearchApplied.trim());
	const hasFreeTextSearch = $derived(appliedFreeTextSearch.length > 0);
	const freeTextSearchCacheKey = $derived(
		hasFreeTextSearch ? `${techScopeSignature}::${appliedFreeTextSearch}` : null
	);

	const clearAvailabilityDaysDebounce = () => {
		if (availabilityWithinDaysDebounceTimer === null) return;
		clearTimeout(availabilityWithinDaysDebounceTimer);
		availabilityWithinDaysDebounceTimer = null;
	};

	const clearFreeTextSearchDebounce = () => {
		if (freeTextSearchDebounceTimer === null) return;
		clearTimeout(freeTextSearchDebounceTimer);
		freeTextSearchDebounceTimer = null;
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

	const scheduleFreeTextSearchApply = (rawValue: string) => {
		freeTextSearchInput = rawValue;
		clearFreeTextSearchDebounce();
		freeTextSearchDebounceTimer = setTimeout(() => {
			freeTextSearchApplied = rawValue;
			freeTextSearchDebounceTimer = null;
		}, 220);
	};

	const applyFreeTextSearchNow = (rawValue: string) => {
		freeTextSearchInput = rawValue;
		freeTextSearchApplied = rawValue;
		clearFreeTextSearchDebounce();
	};

	const clearFreeTextSearch = () => {
		freeTextSearchInput = '';
		freeTextSearchApplied = '';
		clearFreeTextSearchDebounce();
	};

	const handleAvailabilityWithinDaysKeydown = (event: KeyboardEvent) => {
		if (event.key !== 'Enter') return;
		const inputEl = event.currentTarget as HTMLInputElement | null;
		applyAvailabilityWithinDaysNow(inputEl?.value ?? availabilityWithinDaysInput);
	};

	onDestroy(() => {
		clearAvailabilityDaysDebounce();
		clearFreeTextSearchDebounce();
		techIndexAbortController?.abort();
		techIndexAbortController = null;
		freeTextSearchAbortController?.abort();
		freeTextSearchAbortController = null;
	});

	const isAvailableNow = (availability: Talent['availability'] | null | undefined) =>
		typeof availability?.nowPercent === 'number' && availability.nowPercent > 0;

	const availabilityFilteredTalents = $derived.by(() => {
		if (availabilityMode === 'all') return organisationFilteredTalents;

		if (availabilityMode === 'now') {
			return organisationFilteredTalents.filter((talent: Talent) =>
				isAvailableNow(talent.availability ?? null)
			);
		}

		const latestAllowedDate = toIsoUtcDateFromMs(Date.now() + availabilityWithinDays * MS_PER_DAY);

		return organisationFilteredTalents.filter((talent: Talent) => {
			const availability = talent.availability ?? null;
			if (isAvailableNow(availability)) return true;
			const earliestDate = getEarliestAvailabilityDate(availability);
			if (!earliestDate) return false;
			return earliestDate <= latestAllowedDate;
		});
	});

	const selectedTechFilters = $derived.by<SelectedTechFilter[]>(() => {
		const seen: Record<string, true> = {};
		const filters: SelectedTechFilter[] = [];

		for (const tech of selectedTechs) {
			const trimmed = tech.trim();
			if (!trimmed) continue;
			const key = normalize(trimmed);
			if (!key || seen[key]) continue;
			seen[key] = true;
			filters.push({
				label: trimmed,
				key,
				requiredYears: requiredYearsByTechKey[key] ?? null
			});
		}

		return filters;
	});

	const hasSelectedTechFilters = $derived(selectedTechFilters.length > 0);
	const techIndexReady = $derived(
		techIndexStatus === 'ready' && loadedTechScopeSignature === techScopeSignature
	);
	const activeTechIndexByTalentId = $derived(
		loadedTechScopeSignature === techScopeSignature
			? (techScopeCache[techScopeSignature]?.itemsByTalentId ?? {})
			: {}
	);
	const techIndexIsLoadingForScope = $derived(
		techIndexStatus === 'loading' && activeTechScopeSignature === techScopeSignature
	);
	const freeTextSearchReady = $derived(
		hasFreeTextSearch &&
			freeTextSearchStatus === 'ready' &&
			loadedFreeTextSearchCacheKey === freeTextSearchCacheKey
	);
	const freeTextSearchIsLoadingForKey = $derived(
		freeTextSearchStatus === 'loading' && activeFreeTextSearchCacheKey === freeTextSearchCacheKey
	);
	const activeFreeTextSearchResults = $derived(
		freeTextSearchCacheKey && loadedFreeTextSearchCacheKey === freeTextSearchCacheKey
			? (freeTextSearchCache[freeTextSearchCacheKey]?.items ?? [])
			: []
	);

	const toItemsByTalentId = (items: ResumeTechIndexResponse['items']) => {
		const normalizedItems: Record<string, TalentTechData> = {};

		for (const item of items) {
			if (!item || typeof item.talentId !== 'string' || item.talentId.trim().length === 0) continue;
			const talentId = item.talentId.trim();

			const searchTechs = Array.isArray(item.searchTechs)
				? Array.from(
						new Set(
							item.searchTechs
								.filter((value): value is string => typeof value === 'string')
								.map((value) => value.trim())
								.filter(Boolean)
						)
					)
				: [];

			const techYearsByKey: Record<string, number> = {};
			if (item.techYearsByKey && typeof item.techYearsByKey === 'object') {
				for (const [key, value] of Object.entries(item.techYearsByKey)) {
					if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
					techYearsByKey[normalize(key)] = value;
				}
			}

			normalizedItems[talentId] = { searchTechs, techYearsByKey };
		}

		return normalizedItems;
	};

	const setTechCacheEntry = (scopeSignature: string, entry: TechScopeCacheEntry) => {
		techScopeCache = {
			...techScopeCache,
			[scopeSignature]: entry
		};
	};

	const setFreeTextSearchCacheEntry = (cacheKey: string, entry: FreeTextSearchCacheEntry) => {
		freeTextSearchCache = {
			...freeTextSearchCache,
			[cacheKey]: entry
		};
	};

	const loadTechIndexForScope = async (scopeSignature: string, orgIds: string[]) => {
		if (techIndexStatus === 'loading' && activeTechScopeSignature === scopeSignature) return;

		const cached = techScopeCache[scopeSignature];
		if (cached) {
			activeTechScopeSignature = scopeSignature;
			loadedTechScopeSignature = scopeSignature;
			techIndexStatus = 'ready';
			techIndexError = null;
			return;
		}

		techIndexAbortController?.abort();
		const controller = new AbortController();
		techIndexAbortController = controller;
		activeTechScopeSignature = scopeSignature;
		techIndexStatus = 'loading';
		techIndexError = null;

		try {
			const query = orgIds.map((orgId) => `org=${encodeURIComponent(orgId)}`).join('&');
			const endpoint = query
				? `/internal/api/resumes/tech-index?${query}`
				: '/internal/api/resumes/tech-index';
			const response = await fetch(endpoint, {
				method: 'GET',
				credentials: 'include',
				signal: controller.signal
			});

			if (response.status === 304) {
				const existing = techScopeCache[scopeSignature];
				if (!existing) {
					throw new Error('Technology index cache was empty after revalidation.');
				}
				if (controller.signal.aborted) return;
				activeTechScopeSignature = scopeSignature;
				loadedTechScopeSignature = scopeSignature;
				techIndexStatus = 'ready';
				techIndexError = null;
				return;
			}

			if (!response.ok) {
				const message = await response.text().catch(() => '');
				throw new Error(message || 'Could not load technology search index.');
			}

			const payload = (await response.json()) as ResumeTechIndexResponse;
			const responseScopeSignature =
				typeof payload?.scope?.signature === 'string' && payload.scope.signature.trim().length > 0
					? payload.scope.signature.trim()
					: scopeSignature;

			setTechCacheEntry(responseScopeSignature, {
				etag: response.headers.get('etag'),
				generatedAt:
					typeof payload?.generatedAt === 'string' && payload.generatedAt.trim().length > 0
						? payload.generatedAt
						: null,
				itemsByTalentId: toItemsByTalentId(Array.isArray(payload?.items) ? payload.items : [])
			});

			if (controller.signal.aborted) return;
			activeTechScopeSignature = responseScopeSignature;
			loadedTechScopeSignature = responseScopeSignature;
			techIndexStatus = 'ready';
			techIndexError = null;
		} catch (error) {
			if (controller.signal.aborted) return;
			techIndexStatus = 'error';
			loadedTechScopeSignature = null;
			techIndexError = error instanceof Error ? error.message : 'Could not load technology index.';
		} finally {
			if (techIndexAbortController === controller) {
				techIndexAbortController = null;
			}
		}
	};

	const loadFreeTextSearchForScope = async (
		scopeSignature: string,
		orgIds: string[],
		query: string
	) => {
		const trimmedQuery = query.trim();
		const cacheKey = `${scopeSignature}::${trimmedQuery}`;
		if (freeTextSearchStatus === 'loading' && activeFreeTextSearchCacheKey === cacheKey) return;

		const cached = freeTextSearchCache[cacheKey];
		if (cached) {
			activeFreeTextSearchCacheKey = cacheKey;
			loadedFreeTextSearchCacheKey = cacheKey;
			freeTextSearchStatus = 'ready';
			freeTextSearchError = null;
			return;
		}

		freeTextSearchAbortController?.abort();
		const controller = new AbortController();
		freeTextSearchAbortController = controller;
		activeFreeTextSearchCacheKey = cacheKey;
		freeTextSearchStatus = 'loading';
		freeTextSearchError = null;

		try {
			const params = new URLSearchParams();
			params.set('q', trimmedQuery);
			for (const orgId of orgIds) params.append('org', orgId);

			const response = await fetch(`/internal/api/resumes/search?${params.toString()}`, {
				method: 'GET',
				credentials: 'include',
				signal: controller.signal
			});

			if (!response.ok) {
				const message = await response.text().catch(() => '');
				throw new Error(message || 'Could not load free text search results.');
			}

			const payload = (await response.json()) as ResumeSearchResponse;
			const responseScopeSignature =
				typeof payload?.scope?.signature === 'string' && payload.scope.signature.trim().length > 0
					? payload.scope.signature.trim()
					: scopeSignature;
			const responseQuery =
				typeof payload?.query === 'string' && payload.query.trim().length > 0
					? payload.query.trim()
					: trimmedQuery;
			const responseCacheKey = `${responseScopeSignature}::${responseQuery}`;

			setFreeTextSearchCacheEntry(responseCacheKey, {
				generatedAt:
					typeof payload?.generatedAt === 'string' && payload.generatedAt.trim().length > 0
						? payload.generatedAt
						: null,
				items: Array.isArray(payload?.items) ? payload.items : []
			});

			if (controller.signal.aborted) return;
			activeFreeTextSearchCacheKey = responseCacheKey;
			loadedFreeTextSearchCacheKey = responseCacheKey;
			freeTextSearchStatus = 'ready';
			freeTextSearchError = null;
		} catch (error) {
			if (controller.signal.aborted) return;
			freeTextSearchStatus = 'error';
			loadedFreeTextSearchCacheKey = null;
			freeTextSearchError =
				error instanceof Error ? error.message : 'Could not load free text search results.';
		} finally {
			if (freeTextSearchAbortController === controller) {
				freeTextSearchAbortController = null;
			}
		}
	};

	$effect(() => {
		if (!hasSelectedTechFilters) {
			if (techIndexStatus === 'loading') {
				techIndexAbortController?.abort();
				techIndexAbortController = null;
			}
			techIndexStatus = 'idle';
			techIndexError = null;
			return;
		}

		void loadTechIndexForScope(techScopeSignature, techScopeOrgIds);
	});

	$effect(() => {
		if (!hasFreeTextSearch) {
			if (freeTextSearchStatus === 'loading') {
				freeTextSearchAbortController?.abort();
				freeTextSearchAbortController = null;
			}
			freeTextSearchStatus = 'idle';
			freeTextSearchError = null;
			loadedFreeTextSearchCacheKey = null;
			return;
		}

		void loadFreeTextSearchForScope(techScopeSignature, techScopeOrgIds, appliedFreeTextSearch);
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

	const getTalentTechData = (talentId: string): TalentTechData =>
		activeTechIndexByTalentId[talentId] ?? { searchTechs: [], techYearsByKey: {} };

	const talentById = $derived.by(
		() => new Map<string, Talent>(allTalents.map((talent: Talent) => [talent.id, talent]))
	);
	const availabilityFilteredTalentIdSet = $derived.by(
		() => new Set<string>(availabilityFilteredTalents.map((talent: Talent) => talent.id))
	);

	const matchesNameFilter = (talent: Talent, rawQuery = searchQuery) => {
		const query = rawQuery.trim().toLowerCase();
		if (!query) return true;
		return getTalentName(talent).toLowerCase().includes(query);
	};

	const buildTechMatchSummary = (talentId: string): TechMatchSummary => {
		if (!hasSelectedTechFilters) {
			return {
				metCount: 0,
				insufficientCount: 0,
				missingCount: 0,
				total: 0,
				techMatches: []
			};
		}

		const techData = getTalentTechData(talentId);
		const talentTechSet = new Set(
			techData.searchTechs
				.filter((tech): tech is string => typeof tech === 'string')
				.map((tech) => normalize(tech))
				.filter((tech) => tech.length > 0)
		);
		const talentTechYearsByKey = techData.techYearsByKey;

		const techMatches: TechMatch[] = selectedTechFilters.map((techFilter) => {
			const hasTech = talentTechSet.has(techFilter.key);
			const actualYears = talentTechYearsByKey[techFilter.key] ?? 0;

			let status: TechMatch['status'] = 'missing';
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
		const insufficientCount = techMatches.filter((match) => match.status === 'insufficient').length;

		return {
			metCount,
			insufficientCount,
			missingCount: techMatches.length - metCount - insufficientCount,
			total: techMatches.length,
			techMatches
		};
	};

	const groupedTalents = $derived.by<TalentGroup[]>(() => {
		if (!hasSelectedTechFilters || !techIndexReady) return [];

		const scoredTalents: TalentWithScore[] = availabilityFilteredTalents
			.map((talent: Talent) => ({
				...talent,
				...buildTechMatchSummary(talent.id)
			}))
			.filter((talent: TalentWithScore) => talent.metCount + talent.insufficientCount > 0)
			.sort((left: TalentWithScore, right: TalentWithScore) => {
				if (right.metCount !== left.metCount) return right.metCount - left.metCount;
				if (right.insufficientCount !== left.insufficientCount) {
					return right.insufficientCount - left.insufficientCount;
				}
				return getTalentName(left).localeCompare(getTalentName(right));
			});

		const groupsByScore: Record<string, TalentGroup> = {};
		for (const talent of scoredTalents) {
			const key = `${talent.metCount}:${talent.insufficientCount}`;
			const group = groupsByScore[key];
			if (group) {
				group.talents.push(talent);
				continue;
			}
			groupsByScore[key] = {
				metCount: talent.metCount,
				insufficientCount: talent.insufficientCount,
				total: talent.total,
				talents: [talent]
			};
		}

		return Object.values(groupsByScore);
	});

	const totalMatches = $derived(
		groupedTalents.reduce((sum, group) => sum + group.talents.length, 0)
	);

	const rankedFreeTextTalents = $derived.by<FreeTextTalentResult[]>(() => {
		if (!hasFreeTextSearch || !freeTextSearchReady) return [];
		if (hasSelectedTechFilters && !techIndexReady) return [];

		return activeFreeTextSearchResults
			.map((searchResult) => {
				const talent = talentById.get(searchResult.talentId);
				if (!talent) return null;
				if (!availabilityFilteredTalentIdSet.has(talent.id)) return null;
				if (!matchesNameFilter(talent)) return null;

				const techMatchSummary = buildTechMatchSummary(talent.id);
				if (
					hasSelectedTechFilters &&
					techMatchSummary.metCount + techMatchSummary.insufficientCount === 0
				) {
					return null;
				}

				const sortScore =
					searchResult.score +
					techMatchSummary.metCount * 120 +
					techMatchSummary.insufficientCount * 40;

				return {
					...talent,
					...techMatchSummary,
					search: searchResult,
					sortScore
				} satisfies FreeTextTalentResult;
			})
			.filter((result): result is FreeTextTalentResult => result !== null)
			.sort((left, right) => {
				if (right.search.matchPercent !== left.search.matchPercent) {
					return right.search.matchPercent - left.search.matchPercent;
				}
				if (right.sortScore !== left.sortScore) return right.sortScore - left.sortScore;
				return getTalentName(left).localeCompare(getTalentName(right));
			});
	});

	const activeFilterCount = $derived(
		selectedTechFilters.length + (availabilityMode === 'all' ? 0 : 1) + (hasFreeTextSearch ? 1 : 0)
	);

	const filtersSummaryText = $derived.by(() => {
		if (hasFreeTextSearch) {
			if (freeTextSearchIsLoadingForKey) return 'Searching consultants...';
			if (freeTextSearchError) return `Could not load search matches: ${freeTextSearchError}`;
			if (hasSelectedTechFilters && !techIndexReady && !techIndexError) {
				return 'Loading tech matches...';
			}
			if (hasSelectedTechFilters && techIndexError) {
				return `Could not load tech matches: ${techIndexError}`;
			}
			return `${rankedFreeTextTalents.length} of ${availabilityFilteredTalents.length} consultants match.`;
		}

		if (hasSelectedTechFilters) {
			if (techIndexIsLoadingForScope) return 'Loading tech matches...';
			if (techIndexError) return `Could not load tech matches: ${techIndexError}`;
			return `${totalMatches} of ${availabilityFilteredTalents.length} consultants match.`;
		}

		return `${availabilityFilteredTalents.length} consultants in current result set.`;
	});

	const showNameFilter = $derived(
		hasFreeTextSearch || (!hasSelectedTechFilters && resumesViewMode === 'grid')
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

	const setAvailabilityMode = (mode: AvailabilityMode) => {
		availabilityMode = mode;
	};

	const setSelectedTechs = (techs: string[]) => {
		selectedTechs = techs;
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
			const next = { ...requiredYearsByTechKey };
			delete next[techKey];
			requiredYearsByTechKey = next;
			techRequirementError = '';
			if (closeOnSuccess) closeTechRequirementPopover();
			return true;
		}

		const parsed = Number(raw);
		if (!Number.isFinite(parsed) || parsed < 0) {
			techRequirementError = 'Enter a non-negative number.';
			return false;
		}

		requiredYearsByTechKey = {
			...requiredYearsByTechKey,
			[techKey]: Math.round(parsed * 2) / 2
		};
		techRequirementError = '';
		if (closeOnSuccess) closeTechRequirementPopover();
		return true;
	};

	const clearTechRequirement = (techKey: string) => {
		const next = { ...requiredYearsByTechKey };
		delete next[techKey];
		requiredYearsByTechKey = next;
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
	<ResumesPageToolbar
		{filtersOpen}
		{activeFilterCount}
		viewMode={resumesViewMode}
		onToggleFilters={toggleFilters}
		onSetViewMode={setResumesViewMode}
	/>

	<header>
		<h1 class="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">Resumes</h1>
		<p class="text-muted-fg mt-3 text-lg">Manage and view talents and resumes.</p>
	</header>

	<ResumesFiltersPanel
		open={filtersOpen}
		{organisationFilterOptions}
		{selectedOrganisationIds}
		onOrganisationFilterChange={handleOrganisationFilterChange}
		{availabilityMode}
		onAvailabilityModeChange={setAvailabilityMode}
		{availabilityWithinDaysInput}
		onAvailabilityWithinDaysInput={scheduleAvailabilityWithinDaysApply}
		onAvailabilityWithinDaysCommit={applyAvailabilityWithinDaysNow}
		onAvailabilityWithinDaysKeydown={handleAvailabilityWithinDaysKeydown}
		{freeTextSearchInput}
		{hasFreeTextSearch}
		freeTextSearchLoading={freeTextSearchIsLoadingForKey}
		onFreeTextSearchInput={scheduleFreeTextSearchApply}
		onFreeTextSearchCommit={applyFreeTextSearchNow}
		onClearFreeTextSearch={clearFreeTextSearch}
		{selectedTechs}
		onSelectedTechsChange={setSelectedTechs}
		{selectedTechFilters}
		{openTechRequirementKey}
		{techRequirementDraft}
		{techRequirementError}
		onOpenTechRequirementPopover={openTechRequirementPopover}
		onCloseTechRequirementPopover={closeTechRequirementPopover}
		onRemoveSelectedTech={removeSelectedTech}
		onClearSelectedTechFilters={clearSelectedTechFilters}
		onApplyTechRequirementDraft={applyTechRequirementDraft}
		onClearTechRequirement={clearTechRequirement}
		onTechRequirementKeydown={handleTechRequirementKeydown}
		summaryText={filtersSummaryText}
	/>

	{#if showNameFilter}
		<div class="mb-2">
			<Input icon={Search} bind:value={searchQuery} placeholder="Filter by name" class="pl-9" />
		</div>
	{/if}

	{#if organisationFilteredTalents.length === 0}
		<ResumeEmptyState
			title="No consultants in selected organisations"
			description="Try selecting another organisation filter."
		/>
	{:else if availabilityFilteredTalents.length === 0}
		<ResumeEmptyState
			title="No consultants match availability filter"
			description="Try changing availability filter or extending days for availability window."
		/>
	{:else if hasFreeTextSearch}
		{#if freeTextSearchIsLoadingForKey}
			<ResumeEmptyState
				title="Searching consultants"
				description="Scanning profile text, resume summaries, assignments, and technologies."
				loadingLabel="Analyzing"
				loadingTone="muted"
			/>
		{:else if freeTextSearchError}
			<ResumeEmptyState title="Could not load search results" description={freeTextSearchError} />
		{:else if hasSelectedTechFilters && !techIndexReady && !techIndexError}
			<ResumeEmptyState
				title="Loading tech matches"
				description="Applying technology requirements to the ranked search results."
			/>
		{:else if hasSelectedTechFilters && techIndexError}
			<ResumeEmptyState title="Could not load tech matches" description={techIndexError} />
		{:else if rankedFreeTextTalents.length > 0}
			<ResumeFreeTextResults talents={rankedFreeTextTalents} viewMode={resumesViewMode} />
		{:else}
			<ResumeEmptyState
				title="No consultants found"
				description="No consultant matched the current free text search and filters."
			/>
		{/if}
	{:else if !hasSelectedTechFilters}
		<ResumeDefaultResults
			talents={availabilityFilteredTalents}
			viewMode={resumesViewMode}
			{searchQuery}
		/>
	{:else if techIndexIsLoadingForScope}
		<ResumeEmptyState
			title="Loading tech matches"
			description="Calculating skill matches for the selected consultants."
		/>
	{:else if techIndexError}
		<ResumeEmptyState title="Could not load tech matches" description={techIndexError} />
	{:else if groupedTalents.length > 0}
		<ResumeGroupedTechResults groups={groupedTalents} viewMode={resumesViewMode} />
	{:else}
		<ResumeEmptyState
			title="No consultants found"
			description="No consultant matched the selected technologies and year requirements."
		/>
	{/if}
</div>

<style>
	@media (max-width: 639px) {
		:global(.mobile-fill-cell) {
			width: auto !important;
			flex: 1 1 0% !important;
		}

		:global(.mobile-logo-cell) {
			width: auto !important;
			flex: 0 0 auto !important;
		}
	}
</style>
