<script lang="ts">
	import type { ResumeSearchItem } from '$lib/types/resumes';
	import type { TechMatch } from './pageShared';
	import { formatYears } from './pageShared';

	const DEFAULT_VISIBLE_TERMS = 8;
	type SearchInsightChip = {
		key: string;
		label: string;
		yearsLabel: string | null;
	};

	let {
		search,
		techMatches = [],
		showQueryTechSummary = true
	} = $props<{
		search: ResumeSearchItem;
		techMatches?: TechMatch[];
		showQueryTechSummary?: boolean;
	}>();
	let matchingExpanded = $state(false);
	let missingExpanded = $state(false);
	let previousMatchedTermsKey = $state('');
	let previousMissingTermsKey = $state('');

	const normalizeTerm = (value: string) =>
		value
			.trim()
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
	const uniqueChips = (chips: SearchInsightChip[]) => {
		const seen = new Set<string>();
		const output: SearchInsightChip[] = [];

		for (const chip of chips) {
			if (!chip.key || seen.has(chip.key)) continue;
			seen.add(chip.key);
			output.push(chip);
		}

		return output;
	};

	const queryTechTermSet = $derived.by(() => {
		if (techMatches.length > 0) {
			return new Set(
				techMatches
					.flatMap((techMatch: TechMatch) => [techMatch.label, techMatch.key])
					.map((term: string) => normalizeTerm(term))
					.filter(Boolean)
			);
		}

		return new Set(
			[...search.matchedQueryTechs, ...search.missingQueryTechs]
				.map((term) => normalizeTerm(term))
				.filter(Boolean)
		);
	});
	const toRequirementChip = (term: string): SearchInsightChip => ({
		key: normalizeTerm(term),
		label: term,
		yearsLabel: null
	});
	const toTechChip = (techMatch: TechMatch): SearchInsightChip => ({
		key: normalizeTerm(techMatch.label),
		label: techMatch.label,
		yearsLabel: techMatch.actualYears > 0 ? formatYears(techMatch.actualYears) : null
	});
	const matchedRequirementTerms = $derived.by(() =>
		search.matchedTerms.filter((term: string) => !queryTechTermSet.has(normalizeTerm(term)))
	);
	const missingRequirementTerms = $derived.by(() =>
		search.missingTerms.filter((term: string) => !queryTechTermSet.has(normalizeTerm(term)))
	);
	const matchedTechTerms = $derived.by<SearchInsightChip[]>(() => {
		if (!showQueryTechSummary) return [];
		if (techMatches.length === 0) return search.matchedQueryTechs.map(toRequirementChip);
		return techMatches.filter((techMatch: TechMatch) => techMatch.status === 'met').map(toTechChip);
	});
	const missingTechTerms = $derived.by<SearchInsightChip[]>(() => {
		if (!showQueryTechSummary) return [];
		if (techMatches.length === 0) return search.missingQueryTechs.map(toRequirementChip);
		return techMatches.filter((techMatch: TechMatch) => techMatch.status !== 'met').map(toTechChip);
	});
	const combinedMatchedTerms = $derived.by(() =>
		uniqueChips([...matchedTechTerms, ...matchedRequirementTerms.map(toRequirementChip)])
	);
	const combinedMissingTerms = $derived.by(() =>
		uniqueChips([...missingTechTerms, ...missingRequirementTerms.map(toRequirementChip)])
	);
	const matchedTermsKey = $derived(
		combinedMatchedTerms.map((chip) => `${chip.key}:${chip.yearsLabel ?? ''}`).join('\u0000')
	);
	const missingTermsKey = $derived(
		combinedMissingTerms.map((chip) => `${chip.key}:${chip.yearsLabel ?? ''}`).join('\u0000')
	);
	const visibleMatchedTerms = $derived(
		matchingExpanded ? combinedMatchedTerms : combinedMatchedTerms.slice(0, DEFAULT_VISIBLE_TERMS)
	);
	const visibleMissingTerms = $derived(
		missingExpanded ? combinedMissingTerms : combinedMissingTerms.slice(0, DEFAULT_VISIBLE_TERMS)
	);
	const hiddenMatchedCount = $derived(combinedMatchedTerms.length - visibleMatchedTerms.length);
	const hiddenMissingCount = $derived(combinedMissingTerms.length - visibleMissingTerms.length);

	$effect(() => {
		if (matchedTermsKey === previousMatchedTermsKey) return;
		previousMatchedTermsKey = matchedTermsKey;
		matchingExpanded = false;
	});

	$effect(() => {
		if (missingTermsKey === previousMissingTermsKey) return;
		previousMissingTermsKey = missingTermsKey;
		missingExpanded = false;
	});

	const stopResultNavigation = (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
	};
</script>

<div class="space-y-3">
	{#if combinedMatchedTerms.length > 0}
		<div>
			<p class="text-foreground text-[11px] font-semibold uppercase tracking-wide">Matching</p>
			<div class="mt-1 flex flex-wrap gap-1">
				{#each visibleMatchedTerms as matchedChip, termIndex (`${matchedChip.key}-${termIndex}`)}
					<span class="rounded-sm bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
						{matchedChip.label}
						{#if matchedChip.yearsLabel}
							<span class="ml-1 text-emerald-600">{matchedChip.yearsLabel}</span>
						{/if}
					</span>
				{/each}

				{#if hiddenMatchedCount > 0}
					<button
						type="button"
						class="rounded-sm border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
						onmousedown={stopResultNavigation}
						onclick={(event) => {
							stopResultNavigation(event);
							matchingExpanded = true;
						}}
					>
						{hiddenMatchedCount} more...
					</button>
				{:else if matchingExpanded && combinedMatchedTerms.length > DEFAULT_VISIBLE_TERMS}
					<button
						type="button"
						class="rounded-sm border border-emerald-200 bg-white px-2 py-0.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50"
						onmousedown={stopResultNavigation}
						onclick={(event) => {
							stopResultNavigation(event);
							matchingExpanded = false;
						}}
					>
						Show less
					</button>
				{/if}
			</div>
		</div>
	{/if}

	{#if combinedMissingTerms.length > 0}
		<div>
			<p class="text-foreground text-[11px] font-semibold uppercase tracking-wide">Missing</p>
			<div class="mt-1 flex flex-wrap gap-1">
				{#each visibleMissingTerms as missingChip, termIndex (`${missingChip.key}-${termIndex}`)}
					<span class="rounded-sm bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
						{missingChip.label}
						{#if missingChip.yearsLabel}
							<span class="ml-1 text-rose-600">{missingChip.yearsLabel}</span>
						{/if}
					</span>
				{/each}

				{#if hiddenMissingCount > 0}
					<button
						type="button"
						class="rounded-sm border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-100"
						onmousedown={stopResultNavigation}
						onclick={(event) => {
							stopResultNavigation(event);
							missingExpanded = true;
						}}
					>
						{hiddenMissingCount} more...
					</button>
				{:else if missingExpanded && combinedMissingTerms.length > DEFAULT_VISIBLE_TERMS}
					<button
						type="button"
						class="rounded-sm border border-rose-200 bg-white px-2 py-0.5 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-50"
						onmousedown={stopResultNavigation}
						onclick={(event) => {
							stopResultNavigation(event);
							missingExpanded = false;
						}}
					>
						Show less
					</button>
				{/if}
			</div>
		</div>
	{/if}
</div>
