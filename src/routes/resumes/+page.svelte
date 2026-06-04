<script lang="ts">
	import { Button, Input, Toaster, toast } from '@pixelcode_/blocks/components';
	import { RefreshCw, Search } from 'lucide-svelte';
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/stores';
	import { getEarliestAvailabilityDate } from '$lib/utils/availability';
	import { clickOutside } from '$lib/utils/clickOutside';
	import { tooltip } from '$lib/utils/tooltip';
	import { userSettingsStore } from '$lib/stores/userSettings';
	import type { ViewMode } from '$lib/types/userSettings';
	import type { TalentLabelDefinition } from '$lib/types/talentLabels';
	import type {
		ResumeSearchFilterTerm,
		ResumeSearchJob,
		ResumeSearchJobsResponse,
		ResumeSearchItem,
		ResumeSimpleSearchResponse,
		ResumeTechIndexResponse
	} from '$lib/types/resumes';
	import ResumeDefaultResults from '$lib/components/resumes/ResumeDefaultResults.svelte';
	import ResumeEmptyState from '$lib/components/resumes/ResumeEmptyState.svelte';
	import ResumeFreeTextResults from '$lib/components/resumes/ResumeFreeTextResults.svelte';
	import ResumeGroupedTechResults from '$lib/components/resumes/ResumeGroupedTechResults.svelte';
	import ResumeSearchJobTray from '$lib/components/resumes/ResumeSearchJobTray.svelte';
	import ResumeSearchResultsDrawer from '$lib/components/resumes/ResumeSearchResultsDrawer.svelte';
	import ResumesFiltersPanel from '$lib/components/resumes/ResumesFiltersPanel.svelte';
	import ResumesPageToolbar from '$lib/components/resumes/ResumesPageToolbar.svelte';
	import TechStackSelector from '$lib/components/tech-stack-selector/tech-stack-selector.svelte';
	import {
		type AvailabilityMode,
		type FreeTextTalentResult,
		type SelectedSearchFilter,
		type SelectedTechFilter,
		type TechMatch,
		type TechMatchSummary,
		type TalentGroup,
		formatYears,
		getTalentName
	} from '$lib/components/resumes/pageShared';
	import type { PageData } from './$types';

	const { data } = $props<{ data: PageData }>();

	type FreeTextSearchCacheEntry = {
		generatedAt: string | null;
		aiApplied: boolean;
		items: ResumeSearchItem[];
	};
	type Talent = NonNullable<PageData['talents']>[number];
	type LabelFilterOption = {
		label: string;
		value: string;
	};

	const DEFAULT_AVAILABILITY_WITHIN_DAYS = 30;
	const MS_PER_DAY = 24 * 60 * 60 * 1000;
	const SEARCH_JOBS_POLL_INTERVAL_MS = 3500;
	const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	const SEMANTIC_ONLY_MATCH_PERCENT_CAP = 45;
	const serverTalents = (data.talents ?? []) as Talent[];

	const buildTalentLabelState = (talents: Talent[]) =>
		Object.fromEntries(
			talents.map((talent: Talent) => [talent.id, [...(talent.labels ?? [])]] as const)
		) as Record<string, TalentLabelDefinition[]>;

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
	let extractedSearchTerms = $state<ResumeSearchFilterTerm[]>([]);
	let requiredYearsByFilterKey = $state<Record<string, number>>({});
	let filtersOpen = $state(false);
	let searchQuery = $state('');
	let freeTextSearchInput = $state('');
	let freeTextSearchApplied = $state('');
	const initialAvailability = $page.url.searchParams.get('availability');
	let availabilityMode = $state<AvailabilityMode>(
		initialAvailability === 'now' || initialAvailability === 'within-days'
			? initialAvailability
			: 'all'
	);
	let availabilityWithinDaysInput = $state(String(DEFAULT_AVAILABILITY_WITHIN_DAYS));
	let availabilityWithinDaysAppliedInput = $state(String(DEFAULT_AVAILABILITY_WITHIN_DAYS));
	let selectedLabelIds = $state<string[]>([]);
	let openTechRequirementKey = $state<string | null>(null);
	let techRequirementDraft = $state('');
	let techRequirementError = $state('');
	let availabilityWithinDaysDebounceTimer: ReturnType<typeof setTimeout> | null = null;
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
	let deepSearchStartStatus = $state<'idle' | 'loading' | 'error'>('idle');
	let searchJobs = $state<ResumeSearchJob[]>([]);
	let searchResultsOpen = $state(false);
	let selectedSearchJobId = $state<string | null>(null);
	let activeResultTuneJobId = $state<string | null>(null);
	let activeResultSearchTerms = $state<ResumeSearchFilterTerm[]>([]);
	let activeResultRequiredYearsByFilterKey = $state<Record<string, number>>({});
	let activeResultOpenTechRequirementKey = $state<string | null>(null);
	let activeResultTechRequirementDraft = $state('');
	let activeResultTechRequirementError = $state('');
	let activeResultTuneStatus = $state<'idle' | 'loading' | 'error'>('idle');
	let activeResultTuneError = $state<string | null>(null);
	let searchJobsAbortController: AbortController | null = null;
	let searchJobsPollTimeoutId: ReturnType<typeof setTimeout> | null = null;
	let hasLoadedSearchJobs = $state(false);
	let knownSearchJobStatuses = $state<Record<string, ResumeSearchJob['status']>>({});
	let talentLabelsById = $state<Record<string, TalentLabelDefinition[]>>(
		buildTalentLabelState(serverTalents)
	);
	let labelMutationByTalentId = $state<Record<string, boolean>>({});

	const resumesViewMode = $derived($userSettingsStore.settings.views.resumes);
	const homeOrganisationId = $derived(
		typeof data.homeOrganisationId === 'string' ? data.homeOrganisationId : null
	);
	const labelDefinitions = $derived(
		((data.labelDefinitions ?? []) as TalentLabelDefinition[]).slice().sort((left, right) => {
			if (left.sort_order !== right.sort_order) return left.sort_order - right.sort_order;
			return left.name.localeCompare(right.name);
		})
	);
	const labelFilterOptions = $derived.by<LabelFilterOption[]>(() =>
		labelDefinitions.map((labelDefinition) => ({
			label: labelDefinition.name,
			value: labelDefinition.id
		}))
	);
	const availableLabelIds = $derived(labelFilterOptions.map((labelOption) => labelOption.value));
	const labelContextOrganisationId = $derived(
		typeof data.labelContextOrganisationId === 'string' ? data.labelContextOrganisationId : null
	);
	const canManageTalentLabels = $derived(
		Boolean(data.canManageTalentLabels) && Boolean(labelContextOrganisationId)
	);
	const allTalents = $derived.by<Talent[]>(() =>
		serverTalents.map((talent: Talent) => ({
			...talent,
			labels: talentLabelsById[talent.id] ?? talent.labels ?? []
		}))
	);

	const organisationFilterOptions = $derived.by<Array<{ label: string; value: string }>>(() =>
		(data.organisationOptions ?? []).map((org: { id: string; name: string }) => ({
			label: org.name,
			value: org.id
		}))
	);
	const availableOrganisationIds = $derived(
		organisationFilterOptions
			.map((org: { label: string; value: string }) => org.value.trim())
			.filter((id) => UUID_REGEX.test(id))
	);

	const sanitizeOrganisationIds = (ids: string[]) => {
		const allowed = new Set(availableOrganisationIds);
		return Array.from(
			new Set(
				ids
					.map((id) => id.trim())
					.filter((id) => id.length > 0 && UUID_REGEX.test(id) && allowed.has(id))
			)
		);
	};
	const sanitizeLabelIds = (ids: string[]) => {
		const allowed = new Set(availableLabelIds);
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
		Array.from(
			new Set(selectedOrganisationIds.map((id) => id.trim()).filter((id) => UUID_REGEX.test(id)))
		).sort()
	);
	const techCatalogScope = $derived<'global' | 'organisation'>(
		homeOrganisationId ? 'organisation' : 'global'
	);
	const techCatalogOrganisationId = $derived(homeOrganisationId);
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

	const normalize = (value: string) =>
		value
			.trim()
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
	const HIDDEN_SEARCH_FILTER_KEYS = new Set(['developer experience', 'semantic match']);
	const FILTER_KIND_ORDER: Record<SelectedSearchFilter['kind'], number> = {
		technology: 0,
		role: 1,
		concept: 2
	};

	const sortSelectedSearchFilters = (filters: SelectedSearchFilter[]) =>
		[...filters].sort((left, right) => {
			if (FILTER_KIND_ORDER[left.kind] !== FILTER_KIND_ORDER[right.kind]) {
				return FILTER_KIND_ORDER[left.kind] - FILTER_KIND_ORDER[right.kind];
			}
			return left.label.localeCompare(right.label);
		});

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
	const freeTextSearchBaseKey = $derived(
		hasFreeTextSearch ? `${techScopeSignature}::${appliedFreeTextSearch}` : null
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

	const scheduleFreeTextSearchApply = (rawValue: string) => {
		freeTextSearchInput = rawValue;
	};

	const applyFreeTextSearchNow = (rawValue: string) => {
		freeTextSearchInput = rawValue;
	};

	const setTalentLabels = (talentId: string, labels: TalentLabelDefinition[]) => {
		talentLabelsById = {
			...talentLabelsById,
			[talentId]: [...labels].sort((left, right) => {
				if (left.sort_order !== right.sort_order) return left.sort_order - right.sort_order;
				return left.name.localeCompare(right.name);
			})
		};
	};

	const sanitizeSearchTermLabels = (terms: string[]) =>
		terms.filter((term) => {
			const normalized = normalize(term);
			return normalized.length > 0 && !HIDDEN_SEARCH_FILTER_KEYS.has(normalized);
		});

	const getConcreteSearchMatchCount = (search: ResumeSearchItem) => {
		const matchedKeys: string[] = [];
		for (const term of [
			...search.matchedTerms,
			...search.matchedQueryTechs,
			...search.matchedTechs
		]) {
			const normalized = normalize(term);
			if (!normalized || HIDDEN_SEARCH_FILTER_KEYS.has(normalized)) continue;
			if (matchedKeys.includes(normalized)) continue;
			matchedKeys.push(normalized);
		}
		return matchedKeys.length;
	};

	const normalizeSearchResultForDisplay = (search: ResumeSearchItem): ResumeSearchItem => {
		const normalizedSearch: ResumeSearchItem = {
			...search,
			matchedTerms: sanitizeSearchTermLabels(search.matchedTerms),
			missingTerms: sanitizeSearchTermLabels(search.missingTerms),
			matchedQueryTechs: sanitizeSearchTermLabels(search.matchedQueryTechs),
			missingQueryTechs: sanitizeSearchTermLabels(search.missingQueryTechs),
			matchedTechs: sanitizeSearchTermLabels(search.matchedTechs)
		};
		const isSemanticOnly =
			getConcreteSearchMatchCount(normalizedSearch) === 0 &&
			((normalizedSearch.semanticMatchPercent ?? 0) > 0 ||
				normalizedSearch.reasons.some((reason) => normalize(reason.label) === 'semantic match'));

		if (!isSemanticOnly) return normalizedSearch;
		return {
			...normalizedSearch,
			matchPercent: Math.min(normalizedSearch.matchPercent, SEMANTIC_ONLY_MATCH_PERCENT_CAP)
		};
	};

	const compareFreeTextTalentResults = (
		left: FreeTextTalentResult,
		right: FreeTextTalentResult
	) => {
		const leftHasRequirementSummary = left.total > 0;
		const rightHasRequirementSummary = right.total > 0;
		if (leftHasRequirementSummary || rightHasRequirementSummary) {
			const leftRequirementRatio = left.total > 0 ? left.metCount / left.total : 0;
			const rightRequirementRatio = right.total > 0 ? right.metCount / right.total : 0;
			if (rightRequirementRatio !== leftRequirementRatio) {
				return rightRequirementRatio - leftRequirementRatio;
			}
			if (right.metCount !== left.metCount) return right.metCount - left.metCount;
			if (right.insufficientCount !== left.insufficientCount) {
				return right.insufficientCount - left.insufficientCount;
			}
		}

		const leftConcreteMatchCount = getConcreteSearchMatchCount(left.search);
		const rightConcreteMatchCount = getConcreteSearchMatchCount(right.search);
		const leftHasConcreteMatches = leftConcreteMatchCount > 0;
		const rightHasConcreteMatches = rightConcreteMatchCount > 0;

		if (rightHasConcreteMatches !== leftHasConcreteMatches) {
			return Number(rightHasConcreteMatches) - Number(leftHasConcreteMatches);
		}
		if (right.search.matchPercent !== left.search.matchPercent) {
			return right.search.matchPercent - left.search.matchPercent;
		}
		if (rightConcreteMatchCount !== leftConcreteMatchCount) {
			return rightConcreteMatchCount - leftConcreteMatchCount;
		}
		if (right.sortScore !== left.sortScore) return right.sortScore - left.sortScore;
		return getTalentName(left).localeCompare(getTalentName(right));
	};

	const setTalentLabelMutation = (talentId: string, isBusy: boolean) => {
		labelMutationByTalentId = {
			...labelMutationByTalentId,
			[talentId]: isBusy
		};
	};

	const showLabelMutationError = (message: string) => {
		if (typeof toast.error === 'function') {
			toast.error(message);
			return;
		}
		toast(message);
	};

	const showSearchToast = (message: string, kind: 'success' | 'error' = 'success') => {
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

	const mutateTalentLabel = async (payload: {
		talentId: string;
		labelDefinitionId: string;
		action: 'assign' | 'remove';
	}) => {
		if (!canManageTalentLabels || labelMutationByTalentId[payload.talentId]) return;

		const labelDefinition = labelDefinitions.find(
			(definition) => definition.id === payload.labelDefinitionId
		);
		if (!labelDefinition) return;

		const previousLabels =
			talentLabelsById[payload.talentId] ??
			serverTalents.find((talent: Talent) => talent.id === payload.talentId)?.labels ??
			[];
		const optimisticLabels =
			payload.action === 'assign'
				? [...previousLabels, labelDefinition]
				: previousLabels.filter((label) => label.id !== payload.labelDefinitionId);

		setTalentLabels(payload.talentId, optimisticLabels);
		setTalentLabelMutation(payload.talentId, true);

		try {
			const response = await fetch('/internal/api/resumes/talent-labels', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(payload)
			});
			const result = (await response.json().catch(() => null)) as {
				labels?: TalentLabelDefinition[];
				message?: string;
			} | null;

			if (!response.ok || !Array.isArray(result?.labels)) {
				throw new Error(result?.message || 'Could not update labels.');
			}

			setTalentLabels(payload.talentId, result.labels);
		} catch (error) {
			setTalentLabels(payload.talentId, previousLabels);
			showLabelMutationError(error instanceof Error ? error.message : 'Could not update labels.');
		} finally {
			setTalentLabelMutation(payload.talentId, false);
		}
	};

	const handleAssignTalentLabel = (talentId: string, labelDefinitionId: string) => {
		void mutateTalentLabel({ talentId, labelDefinitionId, action: 'assign' });
	};

	const handleRemoveTalentLabel = (talentId: string, labelDefinitionId: string) => {
		void mutateTalentLabel({ talentId, labelDefinitionId, action: 'remove' });
	};

	const clearFreeTextSearch = () => {
		freeTextSearchInput = '';
		freeTextSearchApplied = '';
		if (freeTextSearchStatus === 'loading') {
			freeTextSearchAbortController?.abort();
			freeTextSearchAbortController = null;
		}
		freeTextSearchStatus = 'idle';
		freeTextSearchError = null;
		loadedFreeTextSearchCacheKey = null;
		activeFreeTextSearchCacheKey = null;
		extractedSearchTerms = [];
	};

	const handleAvailabilityWithinDaysKeydown = (event: KeyboardEvent) => {
		if (event.key !== 'Enter') return;
		const inputEl = event.currentTarget as HTMLInputElement | null;
		applyAvailabilityWithinDaysNow(inputEl?.value ?? availabilityWithinDaysInput);
	};

	onDestroy(() => {
		clearAvailabilityDaysDebounce();
		techIndexAbortController?.abort();
		techIndexAbortController = null;
		freeTextSearchAbortController?.abort();
		freeTextSearchAbortController = null;
		searchJobsAbortController?.abort();
		searchJobsAbortController = null;
		stopSearchJobsPoll();
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
	const selectedLabelDefinitions = $derived.by<TalentLabelDefinition[]>(() => {
		if (selectedLabelIds.length === 0) return [];

		const selectedSet = new Set(selectedLabelIds);
		return labelDefinitions.filter((labelDefinition) => selectedSet.has(labelDefinition.id));
	});
	const labelFilteredTalents = $derived.by(() => {
		if (selectedLabelIds.length === 0) return availabilityFilteredTalents;

		const selectedSet = new Set(selectedLabelIds);
		return availabilityFilteredTalents.filter((talent: Talent) =>
			(talent.labels ?? []).some((label) => selectedSet.has(label.id))
		);
	});

	const manualTechFilters = $derived.by<SelectedTechFilter[]>(() => {
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
				requiredYears: requiredYearsByFilterKey[key] ?? null
			});
		}

		return filters;
	});

	const extractedSearchFilters = $derived.by<SelectedSearchFilter[]>(() =>
		extractedSearchTerms.map((term) => ({
			label: term.label,
			key: term.key,
			kind: term.kind,
			requiredYears: requiredYearsByFilterKey[term.key] ?? term.requiredYears ?? null,
			interpretedFrom: term.interpretedFrom ?? null
		}))
	);

	const selectedSearchFilters = $derived.by<SelectedSearchFilter[]>(() => {
		const filtersByKey: Record<string, SelectedSearchFilter> = {};

		for (const filter of extractedSearchFilters) {
			filtersByKey[filter.key] = filter;
		}

		for (const filter of manualTechFilters) {
			filtersByKey[filter.key] = {
				...filter,
				kind: 'technology'
			};
		}

		return sortSelectedSearchFilters(Object.values(filtersByKey));
	});

	const selectedTechFilters = $derived.by<SelectedTechFilter[]>(() =>
		selectedSearchFilters
			.filter(
				(filter): filter is SelectedSearchFilter & { kind: 'technology' } =>
					filter.kind === 'technology'
			)
			.map((filter) => ({
				label: filter.label,
				key: filter.key,
				requiredYears: filter.requiredYears,
				interpretedFrom: filter.interpretedFrom ?? null
			}))
	);

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
	const freeTextSearchRequestKey = $derived.by(() => {
		if (!freeTextSearchBaseKey) return null;
		return `${freeTextSearchBaseKey}::simple`;
	});
	const freeTextSearchReady = $derived(
		hasFreeTextSearch &&
			freeTextSearchStatus === 'ready' &&
			loadedFreeTextSearchCacheKey === freeTextSearchRequestKey
	);
	const freeTextSearchIsLoadingForKey = $derived(
		freeTextSearchStatus === 'loading' && activeFreeTextSearchCacheKey === freeTextSearchRequestKey
	);
	const activeFreeTextSearchResponse = $derived(
		freeTextSearchRequestKey && loadedFreeTextSearchCacheKey === freeTextSearchRequestKey
			? (freeTextSearchCache[freeTextSearchRequestKey] ?? null)
			: null
	);
	const activeFreeTextSearchResults = $derived(activeFreeTextSearchResponse?.items ?? []);
	const activeSearchJobs = $derived(searchJobs.filter(isSearchJobActive));
	const activeSearchJobCount = $derived(activeSearchJobs.length);
	const selectedSearchJob = $derived.by(
		() => searchJobs.find((candidate) => candidate.id === selectedSearchJobId) ?? null
	);
	const activeDeepSearchJob = $derived(selectedSearchJob?.result ? selectedSearchJob : null);
	const hasActiveDeepSearchResult = $derived(Boolean(activeDeepSearchJob));
	const hasUnreadSearchResults = $derived(
		searchJobs.some((job) => job.status === 'succeeded' && !job.readAt)
	);
	const deepSearchLoading = $derived(deepSearchStartStatus === 'loading');
	const activeResultSearchFilters = $derived.by<SelectedSearchFilter[]>(() =>
		sortSelectedSearchFilters(
			activeResultSearchTerms.map((term) => ({
				label: term.label,
				key: term.key,
				kind: term.kind,
				requiredYears: activeResultRequiredYearsByFilterKey[term.key] ?? term.requiredYears ?? null,
				interpretedFrom: term.interpretedFrom ?? null
			}))
		)
	);
	const activeResultTechFilters = $derived.by<SelectedTechFilter[]>(() =>
		activeResultSearchFilters
			.filter(
				(filter): filter is SelectedSearchFilter & { kind: 'technology' } =>
					filter.kind === 'technology'
			)
			.map((filter) => ({
				label: filter.label,
				key: filter.key,
				requiredYears: filter.requiredYears,
				interpretedFrom: filter.interpretedFrom ?? null
			}))
	);
	const activeResultSelectedTechs = $derived(activeResultTechFilters.map((filter) => filter.label));
	const hasActiveResultTechFilters = $derived(activeResultTechFilters.length > 0);
	const needsTechIndex = $derived(hasSelectedTechFilters || hasActiveResultTechFilters);
	const activeResultTuneLoading = $derived(activeResultTuneStatus === 'loading');

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

	const normalizeRequiredYears = (value: unknown): number | null => {
		if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
		return value;
	};

	const getInterpretedTooltip = (source: string) => `Search term interpreted from "${source}"`;

	const normalizeSearchFilterTerm = (
		term: Pick<ResumeSearchFilterTerm, 'label' | 'kind'> & {
			key?: string;
			requiredYears?: number | null;
			interpretedFrom?: string | null;
		}
	): ResumeSearchFilterTerm | null => {
		const label = term.label.trim();
		if (!label) return null;
		const key = (term.key?.trim() || normalize(label)).toLowerCase();
		if (!key) return null;
		if (HIDDEN_SEARCH_FILTER_KEYS.has(key) || HIDDEN_SEARCH_FILTER_KEYS.has(normalize(label))) {
			return null;
		}
		const requiredYears =
			term.kind === 'technology'
				? normalizeRequiredYears((term as ResumeSearchFilterTerm).requiredYears)
				: null;
		const interpretedFrom =
			typeof term.interpretedFrom === 'string' && term.interpretedFrom.trim().length > 0
				? term.interpretedFrom.trim()
				: null;
		return {
			label,
			key,
			kind: term.kind,
			...(requiredYears !== null ? { requiredYears } : {}),
			...(interpretedFrom ? { interpretedFrom } : {})
		};
	};

	const buildDeepSearchTermOverrides = (): ResumeSearchFilterTerm[] =>
		selectedSearchFilters.map((filter) => ({
			label: filter.label,
			key: filter.key,
			kind: filter.kind,
			...(filter.kind === 'technology' && filter.requiredYears !== null
				? { requiredYears: filter.requiredYears }
				: {}),
			...(filter.interpretedFrom ? { interpretedFrom: filter.interpretedFrom } : {})
		}));

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
		const cacheKey = `${scopeSignature}::${trimmedQuery}::simple`;
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
			const response = await fetch('/internal/api/resumes/search/simple', {
				method: 'POST',
				credentials: 'include',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					q: trimmedQuery,
					orgIds,
					limit: 100
				}),
				signal: controller.signal
			});

			if (!response.ok) {
				const message = await response.text().catch(() => '');
				throw new Error(message || 'Could not load free text search results.');
			}

			const payload = (await response.json()) as ResumeSimpleSearchResponse;
			const responseScopeSignature =
				typeof payload?.scope?.signature === 'string' && payload.scope.signature.trim().length > 0
					? payload.scope.signature.trim()
					: scopeSignature;
			const responseQuery =
				typeof payload?.query === 'string' && payload.query.trim().length > 0
					? payload.query.trim()
					: trimmedQuery;
			const responseCacheKey = `${responseScopeSignature}::${responseQuery}::simple`;
			const items: ResumeSearchItem[] = Array.isArray(payload?.items)
				? payload.items.map((item) => ({
						talentId: item.talentId,
						score: item.score,
						matchPercent: item.matchPercent,
						matchedTerms: Array.isArray(item.matchedTerms) ? item.matchedTerms : [],
						missingTerms: [],
						matchedQueryTechs: [],
						missingQueryTechs: [],
						matchedTechs: [],
						reasons: Array.isArray(item.reasons) ? item.reasons : [],
						bestResumeId: null,
						bestResumeTitle: null
					}))
				: [];

			setFreeTextSearchCacheEntry(responseCacheKey, {
				generatedAt:
					typeof payload?.generatedAt === 'string' && payload.generatedAt.trim().length > 0
						? payload.generatedAt
						: null,
				aiApplied: false,
				items
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

	function isSearchJobActive(job: ResumeSearchJob) {
		return job.status === 'queued' || job.status === 'processing';
	}

	const getSearchJobTitle = (job: ResumeSearchJob) =>
		job.title || job.result?.title || 'Deep search';

	function stopSearchJobsPoll() {
		if (searchJobsPollTimeoutId === null) return;
		clearTimeout(searchJobsPollTimeoutId);
		searchJobsPollTimeoutId = null;
	}

	function scheduleSearchJobsPoll() {
		stopSearchJobsPoll();
		searchJobsPollTimeoutId = setTimeout(() => {
			searchJobsPollTimeoutId = null;
			void loadSearchJobs(true);
		}, SEARCH_JOBS_POLL_INTERVAL_MS);
	}

	async function loadSearchJobs(announceTransitions = false) {
		stopSearchJobsPoll();
		searchJobsAbortController?.abort();
		const controller = new AbortController();
		searchJobsAbortController = controller;

		try {
			const response = await fetch('/internal/api/resumes/search/jobs', {
				method: 'GET',
				credentials: 'include',
				signal: controller.signal
			});

			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as { message?: unknown } | null;
				const message =
					typeof payload?.message === 'string' && payload.message.trim()
						? payload.message.trim()
						: 'Could not load deep-search jobs.';
				throw new Error(message);
			}

			const payload = (await response.json()) as ResumeSearchJobsResponse;
			const nextJobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
			const nextKnownStatuses = { ...knownSearchJobStatuses };

			if (announceTransitions && hasLoadedSearchJobs) {
				for (const job of nextJobs) {
					const previousStatus = knownSearchJobStatuses[job.id];
					const wasRunning = previousStatus === 'queued' || previousStatus === 'processing';
					if (!wasRunning) continue;

					if (job.status === 'succeeded') {
						showSearchToast(`Deep search finished: ${getSearchJobTitle(job)}`, 'success');
					} else if (job.status === 'failed') {
						showSearchToast(`Deep search failed: ${getSearchJobTitle(job)}`, 'error');
					}
				}
			}

			for (const job of nextJobs) {
				nextKnownStatuses[job.id] = job.status;
			}

			if (controller.signal.aborted) return;
			searchJobs = nextJobs;
			knownSearchJobStatuses = nextKnownStatuses;
			hasLoadedSearchJobs = true;

			if (nextJobs.some(isSearchJobActive)) {
				scheduleSearchJobsPoll();
			}
		} catch {
			if (controller.signal.aborted) return;
		} finally {
			if (searchJobsAbortController === controller) {
				searchJobsAbortController = null;
			}
		}
	}

	async function runSimpleSearch() {
		const trimmedQuery = freeTextSearchInput.trim();
		if (!trimmedQuery) {
			clearFreeTextSearch();
			return;
		}

		freeTextSearchInput = trimmedQuery;
		freeTextSearchApplied = trimmedQuery;
		selectedSearchJobId = null;

		await loadFreeTextSearchForScope(techScopeSignature, techScopeOrgIds, trimmedQuery);
	}

	async function runDeepSearch() {
		const trimmedQuery = freeTextSearchInput.trim();
		if (!trimmedQuery || deepSearchStartStatus === 'loading') return;

		deepSearchStartStatus = 'loading';
		selectedSearchJobId = null;
		let createdJobId: string | null = null;

		try {
			const termOverrides = buildDeepSearchTermOverrides();
			const createResponse = await fetch('/internal/api/resumes/search/jobs', {
				method: 'POST',
				credentials: 'include',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					q: trimmedQuery,
					orgIds: techScopeOrgIds,
					...(termOverrides.length > 0 ? { termOverrides } : {})
				})
			});
			const createPayload = (await createResponse.json().catch(() => null)) as {
				jobId?: unknown;
				message?: unknown;
			} | null;

			if (!createResponse.ok || typeof createPayload?.jobId !== 'string') {
				const message =
					typeof createPayload?.message === 'string' && createPayload.message.trim()
						? createPayload.message.trim()
						: 'Could not create deep-search job.';
				throw new Error(message);
			}

			const jobId = createPayload.jobId;
			createdJobId = jobId;
			searchResultsOpen = true;
			await loadSearchJobs(false);

			const runResponse = await fetch(
				`/internal/api/resumes/search/jobs/${encodeURIComponent(jobId)}/run`,
				{
					method: 'POST',
					credentials: 'include'
				}
			);
			if (!runResponse.ok) {
				const runPayload = (await runResponse.json().catch(() => null)) as {
					message?: unknown;
				} | null;
				const message =
					typeof runPayload?.message === 'string' && runPayload.message.trim()
						? runPayload.message.trim()
						: 'Could not start deep-search job.';
				throw new Error(message);
			}

			deepSearchStartStatus = 'idle';
			await loadSearchJobs(true);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Could not start deep-search job.';
			deepSearchStartStatus = 'error';
			showSearchToast(message, 'error');
			if (createdJobId) {
				void loadSearchJobs(false);
			}
		}
	}

	function setActiveResultTuneDraftFromJob(job: ResumeSearchJob | null) {
		if (!job?.result) {
			activeResultTuneJobId = null;
			activeResultSearchTerms = [];
			activeResultRequiredYearsByFilterKey = {};
			activeResultOpenTechRequirementKey = null;
			activeResultTechRequirementDraft = '';
			activeResultTechRequirementError = '';
			activeResultTuneStatus = 'idle';
			activeResultTuneError = null;
			return;
		}

		const sourceTerms =
			job.result.appliedTerms.length > 0 ? job.result.appliedTerms : job.result.analyzedTerms;
		const normalizedTerms: ResumeSearchFilterTerm[] = [];
		const yearsByKey: Record<string, number> = {};

		for (const term of sourceTerms) {
			const normalizedTerm = normalizeSearchFilterTerm(term);
			if (!normalizedTerm) continue;
			normalizedTerms.push(normalizedTerm);
			const requiredYears = normalizeRequiredYears(normalizedTerm.requiredYears);
			if (normalizedTerm.kind === 'technology' && requiredYears !== null) {
				yearsByKey[normalizedTerm.key] = requiredYears;
			}
		}

		activeResultTuneJobId = job.id;
		activeResultSearchTerms = normalizedTerms;
		activeResultRequiredYearsByFilterKey = yearsByKey;
		activeResultOpenTechRequirementKey = null;
		activeResultTechRequirementDraft = '';
		activeResultTechRequirementError = '';
		activeResultTuneStatus = 'idle';
		activeResultTuneError = null;
	}

	function setActiveResultSelectedTechs(techs: string[]) {
		const existingTechTermsByKey = new Map(
			activeResultSearchTerms
				.filter((term) => term.kind === 'technology')
				.map((term) => [term.key, term])
		);
		const nextTechnologyTerms: ResumeSearchFilterTerm[] = [];
		const selectedTechnologyKeys: string[] = [];

		for (const tech of techs) {
			const normalizedTerm = normalizeSearchFilterTerm({ label: tech, kind: 'technology' });
			if (!normalizedTerm || selectedTechnologyKeys.includes(normalizedTerm.key)) continue;

			const existingTerm = existingTechTermsByKey.get(normalizedTerm.key);
			nextTechnologyTerms.push(
				existingTerm ? { ...normalizedTerm, ...existingTerm } : normalizedTerm
			);
			selectedTechnologyKeys.push(normalizedTerm.key);
		}

		activeResultSearchTerms = [
			...activeResultSearchTerms.filter((term) => term.kind !== 'technology'),
			...nextTechnologyTerms
		];

		const nextYears: Record<string, number> = {};
		for (const key of selectedTechnologyKeys) {
			const years = activeResultRequiredYearsByFilterKey[key];
			if (typeof years === 'number' && Number.isFinite(years) && years >= 0) {
				nextYears[key] = years;
			}
		}
		activeResultRequiredYearsByFilterKey = nextYears;

		if (
			activeResultOpenTechRequirementKey &&
			!selectedTechnologyKeys.includes(activeResultOpenTechRequirementKey)
		) {
			closeActiveResultTechRequirementPopover();
		}
	}

	function removeActiveResultSearchFilter(filterKey: string) {
		activeResultSearchTerms = activeResultSearchTerms.filter((term) => term.key !== filterKey);
		if (filterKey in activeResultRequiredYearsByFilterKey) {
			const remainingYears = { ...activeResultRequiredYearsByFilterKey };
			delete remainingYears[filterKey];
			activeResultRequiredYearsByFilterKey = remainingYears;
		}
		if (activeResultOpenTechRequirementKey === filterKey) {
			activeResultOpenTechRequirementKey = null;
			activeResultTechRequirementDraft = '';
			activeResultTechRequirementError = '';
		}
	}

	function openActiveResultTechRequirementPopover(filter: SelectedSearchFilter) {
		if (filter.kind !== 'technology') return;
		activeResultOpenTechRequirementKey = filter.key;
		activeResultTechRequirementDraft =
			activeResultRequiredYearsByFilterKey[filter.key]?.toString() ?? '';
		activeResultTechRequirementError = '';
	}

	function closeActiveResultTechRequirementPopover() {
		activeResultOpenTechRequirementKey = null;
		activeResultTechRequirementDraft = '';
		activeResultTechRequirementError = '';
	}

	function applyActiveResultTechRequirementDraft(techKey: string, rawDraft?: string) {
		const draft = rawDraft ?? activeResultTechRequirementDraft;
		activeResultTechRequirementDraft = draft;
		const trimmed = draft.trim();

		if (!trimmed) {
			const remainingYears = { ...activeResultRequiredYearsByFilterKey };
			delete remainingYears[techKey];
			activeResultRequiredYearsByFilterKey = remainingYears;
			activeResultTechRequirementError = '';
			return;
		}

		const years = Number(trimmed);
		if (!Number.isFinite(years) || years < 0) {
			activeResultTechRequirementError = 'Use 0 or more years.';
			return;
		}

		activeResultRequiredYearsByFilterKey = {
			...activeResultRequiredYearsByFilterKey,
			[techKey]: years
		};
		activeResultTechRequirementError = '';
	}

	function clearActiveResultTechRequirement(techKey: string) {
		const remainingYears = { ...activeResultRequiredYearsByFilterKey };
		delete remainingYears[techKey];
		activeResultRequiredYearsByFilterKey = remainingYears;
		activeResultTechRequirementDraft = '';
		activeResultTechRequirementError = '';
	}

	function handleActiveResultTechRequirementKeydown(event: KeyboardEvent, techKey: string) {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		applyActiveResultTechRequirementDraft(techKey, (event.currentTarget as HTMLInputElement).value);
		closeActiveResultTechRequirementPopover();
	}

	const buildActiveResultTermOverrides = (): ResumeSearchFilterTerm[] =>
		activeResultSearchFilters.map((filter) => ({
			label: filter.label,
			key: filter.key,
			kind: filter.kind,
			...(filter.kind === 'technology' && filter.requiredYears !== null
				? { requiredYears: filter.requiredYears }
				: {}),
			...(filter.interpretedFrom ? { interpretedFrom: filter.interpretedFrom } : {})
		}));

	async function updateActiveSearchJob() {
		const job = activeDeepSearchJob;
		if (!job || activeResultTuneStatus === 'loading' || isSearchJobActive(job)) return;

		activeResultTuneStatus = 'loading';
		activeResultTuneError = null;

		try {
			const updateResponse = await fetch(
				`/internal/api/resumes/search/jobs/${encodeURIComponent(job.id)}`,
				{
					method: 'PATCH',
					credentials: 'include',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						termOverrides: buildActiveResultTermOverrides()
					})
				}
			);
			const updatePayload = (await updateResponse.json().catch(() => null)) as {
				job?: ResumeSearchJob;
				message?: unknown;
			} | null;

			if (!updateResponse.ok || !updatePayload?.job) {
				const message =
					typeof updatePayload?.message === 'string' && updatePayload.message.trim()
						? updatePayload.message.trim()
						: 'Could not update deep-search terms.';
				throw new Error(message);
			}

			searchJobs = searchJobs.map((candidate) =>
				candidate.id === updatePayload.job?.id ? updatePayload.job : candidate
			);
			knownSearchJobStatuses = {
				...knownSearchJobStatuses,
				[updatePayload.job.id]: updatePayload.job.status
			};

			const runResponse = await fetch(
				`/internal/api/resumes/search/jobs/${encodeURIComponent(job.id)}/run`,
				{
					method: 'POST',
					credentials: 'include'
				}
			);
			if (!runResponse.ok) {
				const runPayload = (await runResponse.json().catch(() => null)) as {
					message?: unknown;
				} | null;
				const message =
					typeof runPayload?.message === 'string' && runPayload.message.trim()
						? runPayload.message.trim()
						: 'Could not restart deep search.';
				throw new Error(message);
			}

			activeResultTuneStatus = 'idle';
			await loadSearchJobs(true);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Could not update deep search.';
			activeResultTuneStatus = 'error';
			activeResultTuneError = message;
			showSearchToast(message, 'error');
			void loadSearchJobs(false);
		}
	}

	async function markSearchJobRead(jobId: string) {
		const job = searchJobs.find((candidate) => candidate.id === jobId);
		if (!job || job.status !== 'succeeded' || job.readAt) return;

		try {
			const response = await fetch(
				`/internal/api/resumes/search/jobs/${encodeURIComponent(jobId)}/read`,
				{
					method: 'POST',
					credentials: 'include'
				}
			);
			const payload = (await response.json().catch(() => null)) as {
				job?: ResumeSearchJob;
				message?: unknown;
			} | null;
			if (!response.ok || !payload?.job) {
				const message =
					typeof payload?.message === 'string' && payload.message.trim()
						? payload.message.trim()
						: 'Could not mark search result as read.';
				throw new Error(message);
			}

			searchJobs = searchJobs.map((candidate) =>
				candidate.id === payload.job?.id ? payload.job : candidate
			);
		} catch (error) {
			showSearchToast(
				error instanceof Error ? error.message : 'Could not mark search result as read.',
				'error'
			);
		}
	}

	function selectSearchJob(jobId: string) {
		selectedSearchJobId = jobId;
		const job = searchJobs.find((candidate) => candidate.id === jobId);
		setActiveResultTuneDraftFromJob(job ?? null);
		if (job?.status === 'succeeded' && !job.readAt) {
			void markSearchJobRead(job.id);
		}
	}

	function clearSelectedSearchJob() {
		selectedSearchJobId = null;
		setActiveResultTuneDraftFromJob(null);
	}

	function openSearchResults() {
		searchResultsOpen = true;
	}

	onMount(() => {
		void loadSearchJobs(false);
	});

	$effect(() => {
		if (!needsTechIndex) {
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
		const normalizedLabelIds = sanitizeLabelIds(selectedLabelIds);
		const isSame =
			normalizedLabelIds.length === selectedLabelIds.length &&
			normalizedLabelIds.every((labelId, index) => labelId === selectedLabelIds[index]);
		if (!isSame) {
			selectedLabelIds = normalizedLabelIds;
		}
	});

	$effect(() => {
		const validKeys = new Set(selectedTechFilters.map((filter) => filter.key));
		const nextYearsByKey: Record<string, number> = {};

		for (const [key, years] of Object.entries(requiredYearsByFilterKey)) {
			if (!validKeys.has(key)) continue;
			nextYearsByKey[key] = years;
		}

		if (!recordsEqual(requiredYearsByFilterKey, nextYearsByKey)) {
			requiredYearsByFilterKey = nextYearsByKey;
		}

		if (openTechRequirementKey && !validKeys.has(openTechRequirementKey)) {
			openTechRequirementKey = null;
			techRequirementDraft = '';
			techRequirementError = '';
		}
	});

	$effect(() => {
		if (!activeDeepSearchJob) {
			if (activeResultTuneJobId !== null) {
				setActiveResultTuneDraftFromJob(null);
			}
			return;
		}
		if (activeResultTuneJobId !== activeDeepSearchJob.id) {
			setActiveResultTuneDraftFromJob(activeDeepSearchJob);
		}
	});

	$effect(() => {
		const validKeys = new Set(activeResultTechFilters.map((filter) => filter.key));
		const nextYearsByKey: Record<string, number> = {};

		for (const [key, years] of Object.entries(activeResultRequiredYearsByFilterKey)) {
			if (!validKeys.has(key)) continue;
			nextYearsByKey[key] = years;
		}

		if (!recordsEqual(activeResultRequiredYearsByFilterKey, nextYearsByKey)) {
			activeResultRequiredYearsByFilterKey = nextYearsByKey;
		}

		if (activeResultOpenTechRequirementKey && !validKeys.has(activeResultOpenTechRequirementKey)) {
			activeResultOpenTechRequirementKey = null;
			activeResultTechRequirementDraft = '';
			activeResultTechRequirementError = '';
		}
	});

	const getTalentTechData = (talentId: string): TalentTechData =>
		activeTechIndexByTalentId[talentId] ?? { searchTechs: [], techYearsByKey: {} };

	const emptyTechMatchSummary = (): TechMatchSummary => ({
		metCount: 0,
		insufficientCount: 0,
		missingCount: 0,
		total: 0,
		techMatches: []
	});

	const talentById = $derived.by(
		() => new Map<string, Talent>(allTalents.map((talent: Talent) => [talent.id, talent]))
	);
	const labelFilteredTalentIdSet = $derived.by(
		() => new Set<string>(labelFilteredTalents.map((talent: Talent) => talent.id))
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

	const buildFreeTextTechMatchSummary = (
		talentId: string,
		searchResult: ResumeSearchItem,
		techFilters = selectedTechFilters
	): TechMatchSummary => {
		if (techFilters.length === 0) return emptyTechMatchSummary();

		const techData = getTalentTechData(talentId);
		const talentTechSet = new Set(
			techData.searchTechs
				.filter((tech): tech is string => typeof tech === 'string')
				.map((tech) => normalize(tech))
				.filter((tech) => tech.length > 0)
		);
		const matchedSearchTermSet = new Set(
			[...searchResult.matchedTerms, ...searchResult.matchedQueryTechs]
				.map((term) => normalize(term))
				.filter((term) => term.length > 0)
		);
		const talentTechYearsByKey = techData.techYearsByKey;

		const techMatches: TechMatch[] = techFilters.map((techFilter) => {
			const normalizedLabel = normalize(techFilter.label);
			const foundInSearch =
				matchedSearchTermSet.has(techFilter.key) ||
				matchedSearchTermSet.has(normalizedLabel) ||
				talentTechSet.has(techFilter.key) ||
				talentTechSet.has(normalizedLabel);
			const actualYears =
				talentTechYearsByKey[techFilter.key] ?? talentTechYearsByKey[normalizedLabel] ?? 0;

			let status: TechMatch['status'] = 'missing';
			if (foundInSearch) {
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

		const scoredTalents: TalentWithScore[] = labelFilteredTalents
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
				const displaySearchResult = normalizeSearchResultForDisplay(searchResult);
				const talent = talentById.get(searchResult.talentId);
				if (!talent) return null;
				if (!labelFilteredTalentIdSet.has(talent.id)) return null;
				if (!matchesNameFilter(talent)) return null;

				const techMatchSummary = buildFreeTextTechMatchSummary(talent.id, displaySearchResult);
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
					search: displaySearchResult,
					sortScore
				} satisfies FreeTextTalentResult;
			})
			.filter((result): result is FreeTextTalentResult => result !== null)
			.sort(compareFreeTextTalentResults);
	});

	const rankedDeepSearchTalents = $derived.by<FreeTextTalentResult[]>(() => {
		const job = activeDeepSearchJob;
		if (!job?.result) return [];

		const results: FreeTextTalentResult[] = [];

		for (const searchResult of job.result.items) {
			const displaySearchResult = normalizeSearchResultForDisplay(searchResult);
			const talent = talentById.get(searchResult.talentId);
			if (!talent) continue;
			if (!matchesNameFilter(talent)) continue;
			const techMatchSummary =
				hasActiveResultTechFilters && techIndexReady
					? buildFreeTextTechMatchSummary(talent.id, displaySearchResult, activeResultTechFilters)
					: emptyTechMatchSummary();

			results.push({
				...talent,
				...techMatchSummary,
				search: displaySearchResult,
				sortScore: displaySearchResult.score
			});
		}

		return results.sort(compareFreeTextTalentResults);
	});

	const activeFilterCount = $derived.by(() => {
		const searchFilterCount = hasFreeTextSearch
			? Math.max(selectedSearchFilters.length, 1)
			: selectedSearchFilters.length;
		return (
			searchFilterCount + selectedLabelDefinitions.length + (availabilityMode === 'all' ? 0 : 1)
		);
	});

	const filtersSummaryText = $derived.by(() => {
		if (activeDeepSearchJob) {
			return `${rankedDeepSearchTalents.length} ranked matches from previous result.`;
		}

		if (hasFreeTextSearch) {
			if (freeTextSearchIsLoadingForKey) return 'Searching consultants...';
			if (freeTextSearchError) return `Could not load search matches: ${freeTextSearchError}`;
			if (hasSelectedTechFilters && !techIndexReady && !techIndexError) {
				return 'Loading tech matches...';
			}
			if (hasSelectedTechFilters && techIndexError) {
				return `Could not load tech matches: ${techIndexError}`;
			}
			return `${rankedFreeTextTalents.length} of ${labelFilteredTalents.length} consultants match.`;
		}

		if (hasSelectedTechFilters) {
			if (techIndexIsLoadingForScope) return 'Loading tech matches...';
			if (techIndexError) return `Could not load tech matches: ${techIndexError}`;
			return `${totalMatches} of ${labelFilteredTalents.length} consultants match.`;
		}

		return `${labelFilteredTalents.length} consultants in current result set.`;
	});

	const showNameFilter = $derived(
		hasActiveDeepSearchResult ||
			hasFreeTextSearch ||
			(!hasSelectedTechFilters && resumesViewMode === 'grid')
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
	const handleSelectedLabelFilterChange = (selected: string[]) => {
		selectedLabelIds = sanitizeLabelIds(selected);
	};
	const removeSelectedLabelFilter = (labelId: string) => {
		selectedLabelIds = selectedLabelIds.filter((selectedId) => selectedId !== labelId);
	};

	const setSelectedTechs = (techs: string[]) => {
		selectedTechs = techs;
	};

	const closeTechRequirementPopover = () => {
		openTechRequirementKey = null;
		techRequirementDraft = '';
		techRequirementError = '';
	};

	const openTechRequirementPopover = (filter: SelectedSearchFilter) => {
		if (openTechRequirementKey === filter.key) {
			closeTechRequirementPopover();
			return;
		}

		openTechRequirementKey = filter.key;
		techRequirementDraft = filter.requiredYears === null ? '' : String(filter.requiredYears);
		techRequirementError = '';
	};

	const removeSelectedSearchFilter = (filterKey: string) => {
		selectedTechs = selectedTechs.filter((tech) => normalize(tech) !== filterKey);
		extractedSearchTerms = extractedSearchTerms.filter((term) => term.key !== filterKey);
		const nextYears = { ...requiredYearsByFilterKey };
		delete nextYears[filterKey];
		requiredYearsByFilterKey = nextYears;
		if (openTechRequirementKey === filterKey) {
			closeTechRequirementPopover();
		}
	};

	const clearSelectedSearchFilters = () => {
		selectedLabelIds = [];
		selectedTechs = [];
		extractedSearchTerms = [];
		requiredYearsByFilterKey = {};
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
			const next = { ...requiredYearsByFilterKey };
			delete next[techKey];
			requiredYearsByFilterKey = next;
			techRequirementError = '';
			if (closeOnSuccess) closeTechRequirementPopover();
			return true;
		}

		const parsed = Number(raw);
		if (!Number.isFinite(parsed) || parsed < 0) {
			techRequirementError = 'Enter a non-negative number.';
			return false;
		}

		requiredYearsByFilterKey = {
			...requiredYearsByFilterKey,
			[techKey]: Math.round(parsed * 2) / 2
		};
		techRequirementError = '';
		if (closeOnSuccess) closeTechRequirementPopover();
		return true;
	};

	const clearTechRequirement = (techKey: string) => {
		const next = { ...requiredYearsByFilterKey };
		delete next[techKey];
		requiredYearsByFilterKey = next;
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
	<Toaster />

	<ResumesPageToolbar
		{filtersOpen}
		{activeFilterCount}
		viewMode={resumesViewMode}
		{searchResultsOpen}
		{hasUnreadSearchResults}
		{activeSearchJobCount}
		onToggleFilters={toggleFilters}
		onToggleSearchResults={() => openSearchResults()}
		onSetViewMode={setResumesViewMode}
	/>

	<header>
		<h1 class="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">Resumes</h1>
		<p class="text-muted-fg mt-3 text-lg">Manage and view talents and resumes.</p>
	</header>

	<ResumeSearchJobTray jobs={searchJobs} onOpenResults={openSearchResults} />

	<ResumesFiltersPanel
		open={filtersOpen}
		{organisationFilterOptions}
		{selectedOrganisationIds}
		{techCatalogOrganisationId}
		{techCatalogScope}
		onOrganisationFilterChange={handleOrganisationFilterChange}
		{availabilityMode}
		onAvailabilityModeChange={setAvailabilityMode}
		{availabilityWithinDaysInput}
		onAvailabilityWithinDaysInput={scheduleAvailabilityWithinDaysApply}
		onAvailabilityWithinDaysCommit={applyAvailabilityWithinDaysNow}
		onAvailabilityWithinDaysKeydown={handleAvailabilityWithinDaysKeydown}
		{labelFilterOptions}
		{selectedLabelIds}
		{selectedLabelDefinitions}
		onSelectedLabelIdsChange={handleSelectedLabelFilterChange}
		onRemoveSelectedLabelFilter={removeSelectedLabelFilter}
		{freeTextSearchInput}
		{hasFreeTextSearch}
		freeTextSearchLoading={freeTextSearchIsLoadingForKey}
		{deepSearchLoading}
		onFreeTextSearchInput={scheduleFreeTextSearchApply}
		onFreeTextSearchCommit={applyFreeTextSearchNow}
		onClearFreeTextSearch={clearFreeTextSearch}
		onRunSimpleSearch={runSimpleSearch}
		onRunDeepSearch={runDeepSearch}
		{selectedTechs}
		onSelectedTechsChange={setSelectedTechs}
		{selectedSearchFilters}
		{openTechRequirementKey}
		{techRequirementDraft}
		{techRequirementError}
		onOpenTechRequirementPopover={openTechRequirementPopover}
		onCloseTechRequirementPopover={closeTechRequirementPopover}
		onRemoveSelectedSearchFilter={removeSelectedSearchFilter}
		onClearSelectedSearchFilters={clearSelectedSearchFilters}
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

	{#if activeDeepSearchJob}
		<div class="border-border bg-card rounded-sm border p-4">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div class="min-w-0">
					<p class="text-muted-fg text-xs font-semibold uppercase tracking-wide">Previous result</p>
					<h2 class="text-foreground mt-1 truncate text-lg font-semibold">
						{getSearchJobTitle(activeDeepSearchJob)}
					</h2>
					<p class="text-muted-fg mt-1 text-sm">
						{#if activeDeepSearchJob.status === 'queued'}
							Update queued · showing last completed result
						{:else if activeDeepSearchJob.status === 'processing'}
							Updating search · showing last completed result
						{:else if activeDeepSearchJob.status === 'failed'}
							Update failed · showing last completed result
						{:else}
							{rankedDeepSearchTalents.length} ranked matches
						{/if}
					</p>
				</div>
				<Button type="button" variant="outline" size="sm" onclick={clearSelectedSearchJob}>
					Back to current list
				</Button>
			</div>

			<div class="border-border mt-4 border-t pt-4">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div>
						<h3 class="text-muted-fg text-xs font-semibold uppercase tracking-wide">Searched on</h3>
						<p class="text-muted-fg mt-1 text-sm">
							Adjust these terms, then update this saved search.
						</p>
					</div>
					<Button
						type="button"
						size="sm"
						variant="primary"
						loading={activeResultTuneLoading}
						disabled={activeResultTuneLoading ||
							activeDeepSearchJob.status === 'queued' ||
							activeDeepSearchJob.status === 'processing' ||
							activeResultSearchFilters.length === 0}
						onclick={updateActiveSearchJob}
					>
						<RefreshCw class="h-4 w-4" />
						Update search
					</Button>
				</div>

				{#if activeResultTuneError}
					<p class="mt-3 text-sm text-red-700">{activeResultTuneError}</p>
				{:else if activeDeepSearchJob.status === 'failed' && activeDeepSearchJob.errorMessage}
					<p class="mt-3 text-sm text-red-700">{activeDeepSearchJob.errorMessage}</p>
				{/if}

				{#if activeResultSearchFilters.length > 0}
					<div
						class="mt-3 flex flex-wrap gap-2"
						use:clickOutside={closeActiveResultTechRequirementPopover}
					>
						{#each activeResultSearchFilters as searchFilter (searchFilter.key)}
							<div class="relative">
								<button
									type="button"
									onclick={() => openActiveResultTechRequirementPopover(searchFilter)}
									class="border-border bg-muted text-foreground inline-flex items-center gap-2 rounded-sm border px-3 py-1.5 pr-8 text-xs font-medium {searchFilter.interpretedFrom
										? 'cursor-help'
										: ''}"
									aria-label={searchFilter.kind === 'technology'
										? `Set minimum years for ${searchFilter.label}`
										: searchFilter.label}
									use:tooltip={searchFilter.interpretedFrom
										? {
												text: getInterpretedTooltip(searchFilter.interpretedFrom),
												position: 'top',
												openOnClick: false
											}
										: ''}
								>
									<span>{searchFilter.label}</span>
									{#if searchFilter.interpretedFrom}
										<span class="text-primary text-[11px] font-bold" aria-hidden="true"> * </span>
									{/if}
									<span class="text-muted-fg text-[10px] uppercase">{searchFilter.kind}</span>
									{#if searchFilter.requiredYears !== null}
										<span class="text-muted-fg text-[10px]">
											{formatYears(searchFilter.requiredYears)}
										</span>
									{/if}
								</button>

								<button
									type="button"
									onclick={(event) => {
										event.stopPropagation();
										removeActiveResultSearchFilter(searchFilter.key);
									}}
									class="text-muted-fg hover:text-foreground absolute right-1 top-1/2 -translate-y-1/2 rounded-sm px-1 text-xs"
									aria-label={`Remove ${searchFilter.label}`}
								>
									×
								</button>

								{#if activeResultOpenTechRequirementKey === searchFilter.key}
									<div
										class="border-border bg-card absolute left-0 top-full z-20 mt-2 w-52 rounded-sm border p-3 shadow-xl"
									>
										<p class="text-foreground text-xs font-semibold">
											Min years for {searchFilter.label}
										</p>
										<Input
											type="number"
											min="0"
											step="0.5"
											size="sm"
											class="mt-2 w-full"
											value={activeResultTechRequirementDraft}
											oninput={(event) =>
												applyActiveResultTechRequirementDraft(
													searchFilter.key,
													(event.currentTarget as HTMLInputElement).value
												)}
											onblur={(event) =>
												applyActiveResultTechRequirementDraft(
													searchFilter.key,
													(event.currentTarget as HTMLInputElement).value
												)}
											onkeydown={(event) =>
												handleActiveResultTechRequirementKeydown(event, searchFilter.key)}
										/>

										{#if activeResultTechRequirementError}
											<p class="mt-1 text-xs text-red-600">
												{activeResultTechRequirementError}
											</p>
										{/if}

										<div class="mt-2 flex items-center justify-between gap-2">
											<Button
												type="button"
												size="sm"
												variant="ghost"
												onclick={() => clearActiveResultTechRequirement(searchFilter.key)}
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
				{:else}
					<p class="text-muted-fg mt-3 text-sm">No search terms are saved for this result.</p>
				{/if}

				<div class="mt-4">
					<h3 class="text-muted-fg mb-2 text-xs font-semibold uppercase tracking-wide">
						Add technologies
					</h3>
					<TechStackSelector
						value={activeResultSelectedTechs}
						showSelectedChips={false}
						catalogScope={techCatalogScope}
						organisationId={techCatalogOrganisationId}
						organisationIds={activeDeepSearchJob.scope.orgIds}
						onchange={setActiveResultSelectedTechs}
					/>
				</div>
			</div>
		</div>

		{#if rankedDeepSearchTalents.length > 0}
			<ResumeFreeTextResults
				talents={rankedDeepSearchTalents}
				viewMode={resumesViewMode}
				{labelDefinitions}
				{canManageTalentLabels}
				{labelMutationByTalentId}
				onAssignTalentLabel={handleAssignTalentLabel}
				onRemoveTalentLabel={handleRemoveTalentLabel}
			/>
		{:else}
			<ResumeEmptyState
				title="No consultants found"
				description="No consultant from this previous result matches the current name filter."
			/>
		{/if}
	{:else if organisationFilteredTalents.length === 0}
		<ResumeEmptyState
			title="No consultants in selected organisations"
			description="Try selecting another organisation filter."
		/>
	{:else if availabilityFilteredTalents.length === 0}
		<ResumeEmptyState
			title="No consultants match availability filter"
			description="Try changing availability filter or extending days for availability window."
		/>
	{:else if labelFilteredTalents.length === 0}
		<ResumeEmptyState
			title="No consultants match label filter"
			description="Try clearing one or more selected labels."
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
			<ResumeFreeTextResults
				talents={rankedFreeTextTalents}
				viewMode={resumesViewMode}
				{labelDefinitions}
				{canManageTalentLabels}
				{labelMutationByTalentId}
				onAssignTalentLabel={handleAssignTalentLabel}
				onRemoveTalentLabel={handleRemoveTalentLabel}
			/>
		{:else}
			<ResumeEmptyState
				title="No consultants found"
				description="No consultant matched the current free text search and filters."
			/>
		{/if}
	{:else if !hasSelectedTechFilters}
		<ResumeDefaultResults
			talents={labelFilteredTalents}
			viewMode={resumesViewMode}
			{searchQuery}
			{labelDefinitions}
			{canManageTalentLabels}
			{labelMutationByTalentId}
			onAssignTalentLabel={handleAssignTalentLabel}
			onRemoveTalentLabel={handleRemoveTalentLabel}
		/>
	{:else if techIndexIsLoadingForScope}
		<ResumeEmptyState
			title="Loading tech matches"
			description="Calculating skill matches for the selected consultants."
		/>
	{:else if techIndexError}
		<ResumeEmptyState title="Could not load tech matches" description={techIndexError} />
	{:else if groupedTalents.length > 0}
		<ResumeGroupedTechResults
			groups={groupedTalents}
			viewMode={resumesViewMode}
			{labelDefinitions}
			{canManageTalentLabels}
			{labelMutationByTalentId}
			onAssignTalentLabel={handleAssignTalentLabel}
			onRemoveTalentLabel={handleRemoveTalentLabel}
		/>
	{:else}
		<ResumeEmptyState
			title="No consultants found"
			description="No consultant matched the selected technologies and year requirements."
		/>
	{/if}
</div>

<ResumeSearchResultsDrawer
	bind:open={searchResultsOpen}
	jobs={searchJobs}
	selectedJobId={selectedSearchJobId}
	onSelectJob={selectSearchJob}
/>

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

		:global(.mobile-label-cell) {
			width: auto !important;
			flex: 0 0 auto !important;
		}
	}
</style>
