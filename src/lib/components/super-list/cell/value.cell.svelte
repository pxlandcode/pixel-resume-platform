<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	type Props = {
		children: Snippet;
		width?: number;
	};

	let { children, width, ...rest }: Props & HTMLAttributes<HTMLDivElement> = $props();
</script>

<div
	class="min-w-0"
	style={width ? `width: ${width}%; flex: 0 0 ${width}%` : 'flex: 1 1 0%'}
	{...rest}
>
	{@render children()}
</div>
