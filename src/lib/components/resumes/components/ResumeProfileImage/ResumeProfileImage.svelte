<script lang="ts">
	import { soloImages } from '$lib/images/manifest';
	import {
		applyImageFallbackOnce,
		getOriginalImageUrl,
		supabaseImagePresets,
		supabaseImageSizes,
		supabaseImageSrcsetWidths,
		transformSupabasePublicUrl,
		transformSupabasePublicUrlSrcSet
	} from '$lib/images/supabaseImage';

	type ImageResource = (typeof soloImages)[keyof typeof soloImages];
	type ResolvedImage = {
		src: string;
		srcset?: string;
		fallbackSrc?: string;
		sizes?: string;
	};

	let {
		image,
		name
	}: {
		image?: ImageResource | string | null;
		name: string;
	} = $props();

	const resolved = $derived.by<ResolvedImage | null>(() => {
		if (!image) return null;

		if (typeof image === 'string') {
			const fallbackSrc = getOriginalImageUrl(image);
			return {
				src: transformSupabasePublicUrl(image, supabaseImagePresets.avatarProfile),
				srcset: transformSupabasePublicUrlSrcSet(image, supabaseImageSrcsetWidths.avatarProfile, {
					height: supabaseImagePresets.avatarProfile.height,
					quality: supabaseImagePresets.avatarProfile.quality,
					resize: supabaseImagePresets.avatarProfile.resize
				}),
				fallbackSrc,
				sizes: supabaseImageSizes.avatarProfile
			};
		}

		return {
			src: image.src,
			srcset: image.srcset,
			fallbackSrc: image.fallbackSrc ?? image.src,
			sizes: supabaseImageSizes.avatarProfile
		};
	});
</script>

<div
	class="rounded-xs border-border bg-card relative aspect-square w-full flex-shrink-0 overflow-hidden border"
>
	{#if resolved}
		<img
			src={resolved.src}
			srcset={resolved.srcset}
			sizes={resolved.sizes}
			alt={name || 'Profile'}
			class="h-full w-full object-contain object-center"
			loading="lazy"
			decoding="async"
			onerror={(event) => applyImageFallbackOnce(event, resolved.fallbackSrc ?? resolved.src)}
		/>
	{:else}
		<div class="bg-muted text-secondary-text absolute inset-0 flex items-center justify-center">
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
