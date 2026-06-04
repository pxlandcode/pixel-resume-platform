<script lang="ts">
	import { Button } from '@pixelcode_/blocks/components';
	import { FileSearch, LayoutGrid, List, SlidersHorizontal } from 'lucide-svelte';
	import type { ViewMode } from '$lib/types/userSettings';

	let {
		filtersOpen,
		activeFilterCount,
		viewMode,
		searchResultsOpen = false,
		hasUnreadSearchResults = false,
		activeSearchJobCount = 0,
		onToggleFilters,
		onToggleSearchResults,
		onSetViewMode
	} = $props<{
		filtersOpen: boolean;
		activeFilterCount: number;
		viewMode: ViewMode;
		searchResultsOpen?: boolean;
		hasUnreadSearchResults?: boolean;
		activeSearchJobCount?: number;
		onToggleFilters: () => void;
		onToggleSearchResults?: () => void;
		onSetViewMode: (mode: ViewMode) => void;
	}>();
</script>

<div class="absolute right-0 top-0 z-10 flex items-center gap-2">
	{#if onToggleSearchResults}
		<div class="border-border bg-card inline-flex rounded-sm border p-1">
			<button
				type="button"
				onclick={onToggleSearchResults}
				class="rounded-xs relative inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap px-2 py-1.5 text-sm font-medium transition-colors {searchResultsOpen
					? 'border-primary bg-primary hover:bg-primary/90 text-white'
					: 'text-primary hover:bg-primary/20 border-transparent bg-transparent'}"
				aria-label="Open previous search results"
			>
				<FileSearch size={16} />
				<span class="sm:hidden">Results</span>
				<span class="hidden sm:inline">Previous results</span>
				{#if hasUnreadSearchResults}
					<span
						class="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-red-500"
					></span>
				{:else if activeSearchJobCount > 0}
					<span
						class="bg-primary absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white"
					></span>
				{/if}
			</button>
		</div>
	{/if}

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
