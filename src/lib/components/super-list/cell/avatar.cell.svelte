<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import User from 'lucide-svelte/icons/user';

	type Props = {
		src?: string | null;
		alt?: string;
		size?: number;
	};

	let { src, alt = '', size = 40, ...rest }: Props & HTMLAttributes<HTMLDivElement> = $props();
</script>

<div
	class="bg-muted shrink-0 overflow-hidden rounded-sm"
	style="width: {size}px; height: {size}px"
	{...rest}
>
	{#if src}
		<img {src} {alt} class="h-full w-full object-cover object-top" />
	{:else}
		<div class="text-muted-fg flex h-full w-full items-center justify-center">
			<User size={size * 0.5} />
		</div>
	{/if}
</div>
