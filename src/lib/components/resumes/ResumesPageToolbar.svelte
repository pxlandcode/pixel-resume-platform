<script lang="ts">
	import { Button } from '@pixelcode_/blocks/components';
	import { LayoutGrid, List, SlidersHorizontal } from 'lucide-svelte';
	import type { ViewMode } from '$lib/types/userSettings';

	let { filtersOpen, activeFilterCount, viewMode, onToggleFilters, onSetViewMode } = $props<{
		filtersOpen: boolean;
		activeFilterCount: number;
		viewMode: ViewMode;
		onToggleFilters: () => void;
		onSetViewMode: (mode: ViewMode) => void;
	}>();
</script>

<div class="absolute right-0 top-0 z-10 flex items-center gap-2">
	<div class="border-border bg-card inline-flex rounded-sm border p-1">
		<button
			type="button"
			onclick={onToggleFilters}
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
			onclick={() => onSetViewMode('grid')}
			class={`px-2 ${
				viewMode === 'grid'
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
			onclick={() => onSetViewMode('list')}
			class={`px-2 ${
				viewMode === 'list'
					? 'border-primary bg-primary hover:bg-primary/90 text-white hover:text-white'
					: 'border-transparent bg-transparent'
			}`}
		>
			<List size={16} />
		</Button>
	</div>
</div>
