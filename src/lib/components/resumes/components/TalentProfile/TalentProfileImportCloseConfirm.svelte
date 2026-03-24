<script lang="ts">
	import { Button } from '@pixelcode_/blocks/components';

	let {
		open = false,
		onCancel,
		onConfirm
	}: {
		open?: boolean;
		onCancel?: () => void;
		onConfirm?: () => void;
	} = $props();
</script>

{#if open}
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
		onclick={onCancel}
		onkeydown={(event) => event.key === 'Escape' && onCancel?.()}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_click_events_have_key_events -->
		<div
			class="bg-card w-full max-w-sm rounded-lg p-6 shadow-xl"
			onclick={(event) => event.stopPropagation()}
			role="document"
		>
			<h3 class="text-foreground mb-2 text-lg font-semibold">Cancel import?</h3>
			<p class="text-muted-fg mb-4 text-sm">
				The import is still starting. If you close now, it will be cancelled.
			</p>
			<div class="flex justify-end gap-2">
				<Button type="button" variant="ghost" size="sm" onclick={onCancel}>Keep importing</Button>
				<Button type="button" variant="destructive" size="sm" onclick={onConfirm}>
					Cancel import
				</Button>
			</div>
		</div>
	</div>
{/if}
