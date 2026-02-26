<script lang="ts">
	import { soloImages } from '$lib/images/manifest';

	type ImageResource = (typeof soloImages)[keyof typeof soloImages];

	let {
		image,
		name
	}: {
		image?: ImageResource | string | null;
		name: string;
	} = $props();

	const resolved = $derived.by(() => {
		if (!image) return null;
		if (typeof image === 'string') {
			return { src: image } as ImageResource;
		}
		return image;
	});
</script>

<div
	class="relative aspect-square w-full flex-shrink-0 overflow-hidden rounded-xs border border-slate-200 bg-white"
>
	{#if resolved}
		<img
			src={resolved.src}
			srcset={resolved.srcset}
			alt={name || 'Profile'}
			class="h-full w-full object-cover object-center"
			loading="lazy"
			decoding="async"
		/>
	{:else}
		<div class="absolute inset-0 flex items-center justify-center bg-slate-50 text-slate-400">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-20 w-20"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="1.5"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
				/>
			</svg>
		</div>
	{/if}
</div>
