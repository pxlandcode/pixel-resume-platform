<script lang="ts">
	let {
		logoUrl = null,
		logoAlt = 'Brand logo',
		showProudlyPresents = false
	} = $props<{
		logoUrl?: string | null;
		logoAlt?: string;
		showProudlyPresents?: boolean;
	}>();

	const resolvedLogoUrl = $derived(logoUrl?.trim() || null);
</script>

<div class="header-brand mb-6 text-center">
	{#if resolvedLogoUrl}
		<img src={resolvedLogoUrl} alt={logoAlt} class="mx-auto h-8 w-auto object-contain" />
	{/if}
	{#if showProudlyPresents && resolvedLogoUrl}
		<p class="-rotate-10 text-primary -mt-1 text-2xl" style="font-family: 'Fave Script', cursive;">
			proudly presents
		</p>
	{/if}
</div>
