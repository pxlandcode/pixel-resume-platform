<script lang="ts" generics="D">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import Search from 'lucide-svelte/icons/search';
	import ArrowDown from 'lucide-svelte/icons/arrow-down';
	import ArrowUp from 'lucide-svelte/icons/arrow-up';
	import ArrowUpDown from 'lucide-svelte/icons/arrow-up-down';
	import { Input } from '@pixelcode_/blocks/components';
	import type { ListHandler } from './list-handler.svelte.js';

	type Props = {
		children: Snippet;
		instance: InstanceType<new () => ListHandler<D>>;
		emptyMessage?: string;
		emptyFilterMessage?: string;
	};

	let {
		children,
		instance,
		emptyMessage = 'No items to display',
		emptyFilterMessage,
		...rest
	}: Props & HTMLAttributes<HTMLDivElement> = $props();
</script>

<div {...rest}>
	{#if instance.hasFilterableRows}
		<div class="mb-2">
			<div class="relative w-full">
				<Input icon={Search} bind:value={instance.query} placeholder="Search..." class="pl-9" />
			</div>
		</div>
	{/if}

	<!-- Column headings -->
	<div
		class="border-border text-muted-fg hidden border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide sm:flex"
	>
		{#each instance.headings as { heading, sortable, width }}
			<div
				class="flex items-center gap-1"
				style={width ? `width: ${width}%; flex: 0 0 ${width}%` : 'flex: 1 1 0%'}
			>
				{#if sortable}
					<button
						class="hover:text-foreground flex cursor-pointer items-center gap-1"
						onclick={() => instance.sort(sortable as string)}
					>
						{heading}
						{#if instance.isAscending && instance.activeSortedProp === sortable}
							<ArrowUp size={14} />
						{:else if instance.isAscending === false && instance.activeSortedProp === sortable}
							<ArrowDown size={14} />
						{:else}
							<ArrowUpDown size={14} />
						{/if}
					</button>
				{:else}
					{heading}
				{/if}
			</div>
		{/each}
	</div>

	<!-- Rows -->
	<div class="border-border divide-border divide-y border-x border-b">
		{@render children()}
	</div>

	{#if !instance.data.length}
		<div class="text-muted-fg flex justify-center p-6 text-sm font-medium">
			{#if instance.query}
				{emptyFilterMessage ?? `No results for: ${instance.query}`}
			{:else}
				{emptyMessage}
			{/if}
		</div>
	{/if}
</div>
