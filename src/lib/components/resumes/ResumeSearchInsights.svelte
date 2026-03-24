<script lang="ts">
	import type { ResumeSearchItem } from '$lib/types/resumes';

	let { search, showQueryTechSummary = true } = $props<{
		search: ResumeSearchItem;
		showQueryTechSummary?: boolean;
	}>();

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
</script>

<div class="space-y-3">
	{#if combinedMatchedTerms.length > 0}
		<div>
			<p class="text-foreground text-[11px] font-semibold uppercase tracking-wide">Matching</p>
			<div class="mt-1 flex flex-wrap gap-1">
				{#each combinedMatchedTerms as matchedTerm, termIndex (`${matchedTerm}-${termIndex}`)}
					<span class="rounded-sm bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
						{matchedTerm}
					</span>
				{/each}
			</div>
		</div>
	{/if}

	{#if combinedMissingTerms.length > 0}
		<div>
			<p class="text-foreground text-[11px] font-semibold uppercase tracking-wide">Missing</p>
			<div class="mt-1 flex flex-wrap gap-1">
				{#each combinedMissingTerms as missingTerm, termIndex (`${missingTerm}-${termIndex}`)}
					<span class="rounded-sm bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
						{missingTerm}
					</span>
				{/each}
			</div>
		</div>
	{/if}
</div>
