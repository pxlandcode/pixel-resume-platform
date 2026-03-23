<script lang="ts">
	import { Button } from '@pixelcode_/blocks/components';
	import Drawer from '$lib/components/drawer/drawer.svelte';
	import { AlertCircle, Loader2 } from 'lucide-svelte';

	let {
		open = $bindable(false),
		uppyContainer = $bindable(null),
		beforeClose,
		isBackgroundImporting = false,
		importStatusLabel = '',
		importSourceFilename = null,
		importError = null,
		canImport = false,
		isImportBusy = false,
		isKickoffImporting = false,
		onCancel,
		onImport
	}: {
		open?: boolean;
		uppyContainer?: HTMLDivElement | null;
		beforeClose?: () => boolean;
		isBackgroundImporting?: boolean;
		importStatusLabel?: string;
		importSourceFilename?: string | null;
		importError?: string | null;
		canImport?: boolean;
		isImportBusy?: boolean;
		isKickoffImporting?: boolean;
		onCancel?: () => void;
		onImport?: () => void;
	} = $props();
</script>

<Drawer
	bind:open
	variant="bottom"
	title="Import from PDF"
	subtitle="Upload a resume PDF to create an editable draft."
	{beforeClose}
>
	<div class="flex min-h-0 flex-1 flex-col">
		{#if isBackgroundImporting}
			<div class="flex flex-1 flex-col items-center justify-center py-8">
				<div class="bg-primary/10 mb-4 flex h-16 w-16 items-center justify-center rounded-full">
					<Loader2 size={32} class="text-primary animate-spin" />
				</div>
				<p class="text-foreground mb-1 text-lg font-medium">{importStatusLabel}</p>
				{#if importSourceFilename}
					<p class="text-muted-fg text-sm">{importSourceFilename}</p>
				{/if}
				<p class="text-muted-fg mt-4 text-xs">
					You can close this drawer. The import will continue in the background.
				</p>
			</div>
		{:else}
			<div bind:this={uppyContainer} class="uppy-container rounded-xs w-full flex-1"></div>

			{#if importError}
				<div class="mt-4 flex items-start gap-2 rounded-lg bg-red-50 p-3">
					<AlertCircle size={16} class="mt-0.5 shrink-0 text-red-500" />
					<p class="text-sm text-red-700">{importError}</p>
				</div>
			{/if}

			<div class="border-border mt-4 flex items-center justify-between gap-4 border-t pt-4">
				<p class="text-muted-fg text-xs">PDF only, max 10MB</p>
				<div class="flex gap-2">
					<Button type="button" variant="ghost" size="sm" onclick={onCancel}>Cancel</Button>
					<Button
						type="button"
						variant="primary"
						size="sm"
						onclick={onImport}
						disabled={!canImport || isImportBusy}
						loading={isKickoffImporting}
					>
						Import
					</Button>
				</div>
			</div>
		{/if}
	</div>
</Drawer>

<style>
	:global(.uppy-container .uppy-Dashboard) {
		border: 1px dashed var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		background: var(--color-muted, #edf2f7);
		min-height: 160px;
	}
	:global(.uppy-container .uppy-Dashboard-inner) {
		background: transparent;
		border: none;
	}
	:global(.uppy-container .uppy-Dashboard-AddFiles) {
		border: none;
		border-radius: 0.5rem;
	}
	:global(.uppy-container .uppy-Dashboard-AddFiles-title) {
		font-size: 0.875rem;
		color: var(--color-muted-fg, #2e333a);
	}
	:global(.uppy-container .uppy-Dashboard-note) {
		display: none;
	}
</style>
