<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	type Props = {
		children: Snippet;
		href?: string;
		highlight?: boolean;
	};

	let {
		children,
		href,
		highlight = false,
		...rest
	}: Props & HTMLAttributes<HTMLDivElement> = $props();
</script>

{#if href}
	<a {href} class="hover:bg-muted/40 block transition-colors {highlight ? 'bg-muted/20' : ''}">
		<div class="flex items-center px-3 py-2" {...rest}>
			{@render children()}
		</div>
	</a>
{:else}
	<div class="flex items-center px-3 py-2 {highlight ? 'bg-muted/20' : ''}" {...rest}>
		{@render children()}
	</div>
{/if}
