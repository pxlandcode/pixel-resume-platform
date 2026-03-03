<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import User from 'lucide-svelte/icons/user';
	import {
		applyImageFallbackOnce,
		getOriginalImageUrl,
		supabaseImagePresets,
		transformSupabasePublicUrl,
		transformSupabasePublicUrlSrcSet
	} from '$lib/images/supabaseImage';

	type Props = {
		src?: string | null;
		alt?: string;
		size?: number;
	};

	let { src, alt = '', size = 40, ...rest }: Props & HTMLAttributes<HTMLDivElement> = $props();

	const transformedSrc = $derived(transformSupabasePublicUrl(src, supabaseImagePresets.avatarList));
	const transformedSrcSet = $derived(
		transformSupabasePublicUrlSrcSet(src, [size, size * 2], {
			height: supabaseImagePresets.avatarList.height,
			quality: supabaseImagePresets.avatarList.quality,
			resize: supabaseImagePresets.avatarList.resize
		})
	);
	const fallbackSrc = $derived(getOriginalImageUrl(src));
	const sizeHint = $derived(`${Math.max(1, Math.round(size))}px`);
</script>

<div
	class="bg-muted shrink-0 overflow-hidden rounded-sm"
	style="width: {size}px; height: {size}px"
	{...rest}
>
	{#if src}
		<img
			src={transformedSrc || src}
			srcset={transformedSrcSet}
			sizes={sizeHint}
			{alt}
			class="h-full w-full object-cover object-center"
			loading="lazy"
			decoding="async"
			onerror={(event) => applyImageFallbackOnce(event, fallbackSrc || src)}
		/>
	{:else}
		<div class="text-muted-fg flex h-full w-full items-center justify-center">
			<User size={size * 0.5} />
		</div>
	{/if}
</div>
