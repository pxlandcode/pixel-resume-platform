<script lang="ts">
	import { Button, FormControl, Input } from '@pixelcode_/blocks/components';
	import Drawer from '$lib/components/drawer/drawer.svelte';
	import OrganisationTemplateImageUpload from './OrganisationTemplateImageUpload.svelte';

	type Organisation = {
		id: string;
		name: string;
	};

	type Template = {
		organisation_id: string;
		template_key: string;
		template_version: number;
		template_json: Record<string, unknown> | null;
		main_logotype_url: string | null;
		accent_logo_url: string | null;
		end_logo_url: string | null;
	};

	type TemplateAssetSlot = 'main_logotype_path' | 'accent_logo_path' | 'end_logo_path';

	const templateAssetLabels: Array<{ slot: TemplateAssetSlot; label: string }> = [
		{ slot: 'main_logotype_path', label: 'Main logotype' },
		{ slot: 'accent_logo_path', label: 'Accent logo' },
		{ slot: 'end_logo_path', label: 'End logo' }
	];

	let {
		open = $bindable(false),
		organisation = undefined,
		template = undefined
	}: {
		open: boolean;
		organisation?: Organisation;
		template?: Template;
	} = $props();

	const templateImageUrl = (slot: TemplateAssetSlot) => {
		if (!template) return null;
		if (slot === 'main_logotype_path') return template.main_logotype_url ?? null;
		if (slot === 'accent_logo_path') return template.accent_logo_url ?? null;
		return template.end_logo_url ?? null;
	};

	$effect(() => {
		if (!open) {
			// Reset any local state when drawer closes if needed
		}
	});
</script>

<Drawer
	variant="right"
	bind:open
	title="Edit branding"
	subtitle="Configure template settings and branding images for {organisation?.name ??
		'this organisation'}."
	class="mr-0 w-full max-w-xl"
	dismissable
>
	{#if organisation}
		<div class="flex flex-col gap-8 overflow-y-auto pb-16">
			<!-- Template Settings -->
			<form method="POST" action="?/updateOrganisationTemplate" class="space-y-4">
				<input type="hidden" name="organisation_id" value={organisation.id} />

				<div class="grid gap-4 sm:grid-cols-2">
					<FormControl label="Template key" required class="gap-2 text-sm">
						<Input
							name="template_key"
							value={template?.template_key ?? 'default'}
							required
							class="bg-white text-gray-900"
						/>
					</FormControl>

					<FormControl label="Template version" class="gap-2 text-sm">
						<Input
							name="template_version"
							type="number"
							min="1"
							value={template?.template_version ?? 1}
							class="bg-white text-gray-900"
						/>
					</FormControl>
				</div>

				<FormControl label="Template JSON" class="gap-2 text-sm">
					<textarea
						name="template_json"
						rows="4"
						class="w-full rounded border border-slate-300 bg-white p-2 font-mono text-sm text-slate-900"
						>{JSON.stringify(template?.template_json ?? {}, null, 2)}</textarea
					>
				</FormControl>

				<div class="flex justify-end">
					<Button type="submit" variant="outline">Save template settings</Button>
				</div>
			</form>

			<!-- Template Branding Images -->
			<div class="space-y-4 border-t border-slate-200 pt-6">
				<div>
					<h3 class="text-sm font-semibold text-slate-900">Branding images</h3>
					<p class="text-xs text-slate-500">Upload logos and images for resume templates.</p>
				</div>
				<div class="grid gap-4 sm:grid-cols-3">
					{#each templateAssetLabels as asset (asset.slot)}
						<OrganisationTemplateImageUpload
							organisationId={organisation.id}
							assetSlot={asset.slot}
							label={asset.label}
							initialUrl={templateImageUrl(asset.slot)}
						/>
					{/each}
				</div>
			</div>

			<!-- Close Button -->
			<div class="sticky bottom-0 flex justify-end bg-transparent pt-4">
				<Button
					variant="outline"
					type="button"
					onclick={() => (open = false)}
					class="bg-white hover:bg-slate-50"
				>
					Close
				</Button>
			</div>
		</div>
	{/if}
</Drawer>
