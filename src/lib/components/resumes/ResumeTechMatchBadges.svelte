<script lang="ts">
	import type { TechMatch } from './pageShared';
	import { formatYears, getTechStatusClass } from './pageShared';

	let { techMatches } = $props<{
		techMatches: TechMatch[];
	}>();
</script>

<div class="flex flex-wrap gap-1">
	{#each techMatches as techMatch, techMatchIndex (`${techMatch.key}-${techMatchIndex}`)}
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
