<script lang="ts">
	import pixelcodeLogoDark from '$lib/assets/pixelcodelogodark.svg?url';

	let {
		logoUrl = pixelcodeLogoDark,
		logoAlt = 'Brand logo',
		showProudlyPresents = false
	} = $props<{
		logoUrl?: string | null;
		logoAlt?: string;
		showProudlyPresents?: boolean;
	}>();
</script>

<div class="header-brand mb-6 text-center">
	<img src={logoUrl ?? pixelcodeLogoDark} alt={logoAlt} class="mx-auto h-8 w-auto object-contain" />
	{#if showProudlyPresents}
		<p class="-rotate-10 text-primary -mt-1 text-2xl" style="font-family: 'Fave Script', cursive;">
			proudly presents
		</p>
	{/if}
</div>
