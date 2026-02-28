<script lang="ts">
	import pixelcodeLogoDark from '$lib/assets/pixelcodelogodark.svg?url';

	let { logoUrl = pixelcodeLogoDark, logoAlt = 'Brand logo' } = $props<{
		logoUrl?: string | null;
		logoAlt?: string;
	}>();
</script>

<div class="header-brand mb-6 text-center">
	<img src={logoUrl ?? pixelcodeLogoDark} alt={logoAlt} class="mx-auto h-8 w-auto object-contain" />
	<p class="-mt-1 -rotate-10 text-2xl text-primary" style="font-family: 'Fave Script', cursive;">
		proudly presents
	</p>
</div>
