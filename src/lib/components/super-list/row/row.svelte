<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '@pixelcode_/blocks/utils';

	type Props = {
		children: Snippet;
		href?: string;
		highlight?: boolean;
		class?: string;
		onclick?: (event: MouseEvent) => void;
	};

	let {
		children,
		href,
		highlight = false,
		class: className,
		onclick,
		...rest
	}: Props & HTMLAttributes<HTMLDivElement> = $props();
</script>

{#if href}
	<a
		{href}
		class={cn('hover:bg-muted/40 block transition-colors', highlight && 'bg-muted/20', className)}
	>
		<div class="flex items-center px-3 py-2" {...rest}>
			{@render children()}
		</div>
	</a>
{:else}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class={cn(
			'flex items-center px-3 py-2',
			highlight && 'bg-muted/20',
			onclick && 'hover:bg-muted/40 transition-colors',
			className
		)}
		{onclick}
		{...rest}
	>
		{@render children()}
	</div>
{/if}
