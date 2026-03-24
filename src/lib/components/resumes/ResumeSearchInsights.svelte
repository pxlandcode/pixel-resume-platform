<script lang="ts">
	import type { ResumeSearchItem } from '$lib/types/resumes';

	const DEFAULT_VISIBLE_TERMS = 8;

	let { search, showQueryTechSummary = true } = $props<{
		search: ResumeSearchItem;
		showQueryTechSummary?: boolean;
	}>();
	let matchingExpanded = $state(false);
	let missingExpanded = $state(false);
	let previousMatchedTermsKey = $state('');
	let previousMissingTermsKey = $state('');

	const normalizeTerm = (value: string) => value.trim().toLowerCase();
	const uniqueTerms = (terms: string[]) => {
		const seen = new Set<string>();
		const output: string[] = [];

		for (const term of terms) {
			const normalized = normalizeTerm(term);
			if (!normalized || seen.has(normalized)) continue;
			seen.add(normalized);
			output.push(term);
		}

		return output;
	};

	const queryTechTermSet = $derived.by(
		() =>
			new Set(
				[...search.matchedQueryTechs, ...search.missingQueryTechs]
					.map((term) => normalizeTerm(term))
					.filter(Boolean)
			)
	);
	const matchedRequirementTerms = $derived.by(() =>
		search.matchedTerms.filter((term: string) => !queryTechTermSet.has(normalizeTerm(term)))
	);
	const missingRequirementTerms = $derived.by(() =>
		search.missingTerms.filter((term: string) => !queryTechTermSet.has(normalizeTerm(term)))
	);
	const combinedMatchedTerms = $derived.by(() =>
		uniqueTerms([
			...(showQueryTechSummary ? search.matchedQueryTechs : []),
			...matchedRequirementTerms
		])
	);
	const combinedMissingTerms = $derived.by(() =>
		uniqueTerms([
			...(showQueryTechSummary ? search.missingQueryTechs : []),
			...missingRequirementTerms
		])
	);
	const matchedTermsKey = $derived(combinedMatchedTerms.join('\u0000'));
	const missingTermsKey = $derived(combinedMissingTerms.join('\u0000'));
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
				{#each visibleMatchedTerms as matchedTerm, termIndex (`${matchedTerm}-${termIndex}`)}
					<span class="rounded-sm bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
						{matchedTerm}
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
				{#each visibleMissingTerms as missingTerm, termIndex (`${missingTerm}-${termIndex}`)}
					<span class="rounded-sm bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
						{missingTerm}
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
