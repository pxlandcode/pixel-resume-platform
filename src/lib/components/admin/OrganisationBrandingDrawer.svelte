<script lang="ts">
	import { Button, FormControl, Input } from '@pixelcode_/blocks/components';
	import {
		BRANDING_COLOR_KEYS,
		BRANDING_MODES,
		resolveOrganisationBrandingTheme,
		type OrganisationBrandingColorKey,
		type OrganisationBrandingMode
	} from '$lib/branding/theme';
	import BrandingColorField from './BrandingColorField.svelte';
	import Drawer from '$lib/components/drawer/drawer.svelte';
	import OrganisationTemplateImageUpload from './OrganisationTemplateImageUpload.svelte';

	type Organisation = {
		id: string;
		name: string;
		brand_settings: Record<string, unknown> | null;
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

	const brandingModeLabels: Record<OrganisationBrandingMode, string> = {
		light: 'Light mode',
		dark: 'Dark mode'
	};

	const brandingColorFieldMeta: Record<
		OrganisationBrandingColorKey,
		{ label: string; description: string }
	> = {
		primary: { label: 'Primary', description: 'Accent color for actions and highlights.' },
		background: { label: 'Background', description: 'Page and app background tone.' },
		foreground: { label: 'Foreground', description: 'Base foreground color for content.' },
		text: { label: 'Text', description: 'Main text color.' },
		card: { label: 'Card background', description: 'Surface color for cards and panels.' },
		cardForeground: { label: 'Card text', description: 'Text color shown on cards.' },
		border: { label: 'Border', description: 'Borders and separators.' },
		input: { label: 'Input background', description: 'Background color for form fields.' },
		muted: { label: 'Muted background', description: 'Muted sections and subtle backgrounds.' },
		mutedForeground: { label: 'Muted text', description: 'Secondary text color.' }
	};

	const brandingColorFields = BRANDING_COLOR_KEYS.map((key) => ({
		key,
		label: brandingColorFieldMeta[key].label,
		description: brandingColorFieldMeta[key].description
	}));

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

	const brandingTheme = $derived(
		resolveOrganisationBrandingTheme(organisation?.brand_settings ?? null)
	);
</script>

<Drawer
	variant="right"
	bind:open
	title="Edit branding"
	subtitle="Configure colors, template settings, and branding assets for {organisation?.name ??
		'this organisation'}."
	class="mr-0 w-full max-w-xl"
	dismissable
>
	{#if organisation}
		<div class="flex flex-col gap-8 overflow-y-auto pb-16">
			<form method="POST" action="?/updateOrganisationBranding" class="space-y-4">
				<input type="hidden" name="organisation_id" value={organisation.id} />

				<div>
					<h3 class="text-foreground text-sm font-semibold">Organisation colors</h3>
					<p class="text-muted-fg text-xs">
						Saved in JSONB as theme values. Users in this organisation automatically get this
						branding.
					</p>
				</div>

				<div class="grid gap-4 lg:grid-cols-2">
					{#each BRANDING_MODES as mode (mode)}
						<div class="border-border bg-card space-y-3 rounded-sm border p-3">
							<h4 class="text-foreground text-sm font-semibold">{brandingModeLabels[mode]}</h4>
							<div class="space-y-3">
								{#each brandingColorFields as field (field.key)}
									<BrandingColorField
										id={`org-color-${mode}-${field.key}`}
										name={`theme_${mode}_${field.key}`}
										label={field.label}
										description={field.description}
										value={brandingTheme[mode][field.key]}
									/>
								{/each}
							</div>
						</div>
					{/each}
				</div>

				<div class="flex justify-end">
					<Button type="submit" variant="primary">Save brand colors</Button>
				</div>
			</form>

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
				<Button variant="outline" type="button" onclick={() => (open = false)} class="bg-input">
					Close
				</Button>
			</div>
		</div>
	{/if}
</Drawer>
