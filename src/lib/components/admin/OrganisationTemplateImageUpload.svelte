<script lang="ts">
	import { Alert } from '@pixelcode_/blocks/components';

	type AssetSlot = 'main_logotype_path' | 'accent_logo_path' | 'end_logo_path';

	let {
		organisationId,
		assetSlot,
		label,
		initialUrl = null
	}: {
		organisationId: string;
		assetSlot: AssetSlot;
		label: string;
		initialUrl?: string | null;
	} = $props();

	let fileInput: HTMLInputElement | null = null;
	let previewUrl = $state(initialUrl ?? '');
	let uploadError = $state<string | null>(null);
	let isUploading = $state(false);

	const triggerSelect = () => {
		if (isUploading) return;
		fileInput?.click();
	};

	const handleUpload = async (event: Event & { currentTarget: EventTarget & HTMLInputElement }) => {
		const inputEl = event.currentTarget;
		const file = inputEl.files?.[0];
		if (!file) return;

		if (!file.type.startsWith('image/')) {
			uploadError = 'Please choose an image file.';
			inputEl.value = '';
			return;
		}

		if (file.size > 10 * 1024 * 1024) {
			uploadError = 'Image must be 10MB or smaller.';
			inputEl.value = '';
			return;
		}

		uploadError = null;
		isUploading = true;

		try {
			const payload = new FormData();
			payload.set('file', file);
			payload.set('organisation_id', organisationId);
			payload.set('asset_slot', assetSlot);

			const response = await fetch('/internal/api/organisations/upload-template-asset', {
				method: 'POST',
				body: payload
			});
			const result = await response.json().catch(() => null);

			if (!response.ok || typeof result?.url !== 'string') {
				const message =
					typeof result?.message === 'string'
						? result.message
						: `Upload failed (${response.status}).`;
				throw new Error(message);
			}

			previewUrl = result.url;
		} catch (error) {
			uploadError = error instanceof Error ? error.message : 'Upload failed.';
		} finally {
			isUploading = false;
			inputEl.value = '';
		}
	};
</script>

<div class="space-y-2 rounded border border-slate-200 bg-white p-3">
	<input
		bind:this={fileInput}
		type="file"
		accept=".svg,image/*"
		class="hidden"
		onchange={handleUpload}
		disabled={isUploading}
	/>

	<p class="text-xs font-semibold text-slate-700">{label}</p>

	<button
		type="button"
		class="group relative aspect-[3/1] w-full overflow-hidden rounded border border-slate-200 bg-slate-50"
		onclick={triggerSelect}
		disabled={isUploading}
		aria-label={`Upload ${label}`}
	>
		{#if previewUrl}
			<img src={previewUrl} alt={label} class="h-full w-full object-contain p-2" />
		{:else}
			<div class="flex h-full w-full items-center justify-center px-3 text-xs text-slate-500">
				Click to upload
			</div>
		{/if}

		<div
			class="absolute inset-0 flex items-center justify-center bg-black/45 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100"
		>
			{#if isUploading}Uploading...{:else}Click to replace{/if}
		</div>
	</button>

	{#if uploadError}
		<Alert variant="destructive" size="sm">
			<p class="text-xs font-medium text-gray-900">{uploadError}</p>
		</Alert>
	{/if}
</div>
