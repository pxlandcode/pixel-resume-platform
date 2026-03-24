<script lang="ts">
	import { Loader2 } from 'lucide-svelte';

	let {
		title,
		description,
		loadingLabel = null,
		loadingTone = 'primary'
	} = $props<{
		title: string;
		description: string;
		loadingLabel?: string | null;
		loadingTone?: 'primary' | 'muted';
	}>();
</script>

<div class="border-border rounded-none border-2 border-dashed p-10 text-center">
	{#if loadingLabel}
		<div
			class={`mb-4 flex items-center justify-center gap-2 text-sm font-medium ${
				loadingTone === 'muted' ? 'text-muted-fg' : 'text-primary'
			}`}
		>
			<Loader2 class="h-4 w-4 animate-spin" />
			<span>{loadingLabel}</span>
		</div>
	{/if}

	<h3 class="text-foreground text-lg font-medium">{title}</h3>
	<p class="text-muted-fg mt-2 text-sm">{description}</p>
</div>
