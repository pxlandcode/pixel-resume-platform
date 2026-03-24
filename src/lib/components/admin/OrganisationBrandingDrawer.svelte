<script lang="ts">
	import { Alert, Button, Checkbox, FormControl } from '@pixelcode_/blocks/components';
	import {
		BRANDING_COLOR_KEYS,
		BRANDING_MODES,
		resolveOrganisationBrandingTheme,
		DEFAULT_ORGANISATION_BRANDING_THEME,
		type OrganisationBrandingColorKey,
		type OrganisationBrandingMode
	} from '$lib/branding/theme';
	import {
		ORGANISATION_MAIN_FONT_OPTIONS,
		resolveOrganisationBrandingTypography
	} from '$lib/branding/font';
	import BrandingColorField from './BrandingColorField.svelte';
	import Drawer from '$lib/components/drawer/drawer.svelte';
	import OrganisationTemplateImageUpload from './OrganisationTemplateImageUpload.svelte';
	import Dropdown from '$lib/components/dropdown/Dropdown.svelte';
	import { Info, ChevronDown, Check } from 'lucide-svelte';
	import { clickOutside } from '$lib/utils/clickOutside';

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

	type FontUploadMode = 'variable' | 'static';

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
		secondaryText: {
			label: 'Secondary text',
			description: 'Color for supporting and secondary text.'
		},
		card: { label: 'Card background', description: 'Surface color for cards and panels.' },
		cardForeground: { label: 'Card text', description: 'Text color shown on cards.' },
		border: { label: 'Border', description: 'Borders and separators.' },
		input: { label: 'Input background', description: 'Background color for form fields.' },
		muted: { label: 'Muted background', description: 'Muted sections and subtle backgrounds.' },
		mutedForeground: { label: 'Muted text', description: 'Hint and muted label text color.' }
	};

	const brandingColorFields = BRANDING_COLOR_KEYS.map((key) => ({
		key,
		label: brandingColorFieldMeta[key].label,
		description: brandingColorFieldMeta[key].description
	}));

	const fontUploadModeOptions = [
		{ label: 'Variable font', value: 'variable' as FontUploadMode },
		{ label: 'Static fonts (4 files)', value: 'static' as FontUploadMode }
	];

	// Font family CSS for displaying each option in its own font
	const fontFamilyMap: Record<string, string> = {
		inter: "'Inter', sans-serif",
		roboto: "'Roboto', sans-serif",
		lora: "'Lora', serif",
		merriweather: "'Merriweather', serif",
		'playfair-display': "'Playfair Display', serif",
		domine: "'Domine', serif",
		montserrat: "'Montserrat', sans-serif"
	};

	// Custom font dropdown state
	let fontDropdownOpen = $state(false);
	let useUploadedFont = $state(false);
	let selectedBuiltInFont = $state('inter');
	let fontUploadMode = $state<FontUploadMode>('variable');

	// pixel&code_ branding flag
	let isPixelCode = $state(false);

	const selectedFontLabel = $derived(
		ORGANISATION_MAIN_FONT_OPTIONS.find((opt) => opt.key === selectedBuiltInFont)?.label ??
			'Select font'
	);

	const closeFontDropdown = () => {
		fontDropdownOpen = false;
	};

	const selectFont = (key: string) => {
		selectedBuiltInFont = key;
		fontDropdownOpen = false;
	};

	let {
		open = $bindable(false),
		organisation = undefined,
		template = undefined,
		form = undefined
	}: {
		open: boolean;
		organisation?: Organisation;
		template?: Template;
		form?: { type?: string; ok?: boolean; message?: string } | null;
	} = $props();

	const templateImageUrl = (slot: TemplateAssetSlot) => {
		if (!template) return null;
		if (slot === 'main_logotype_path') return template.main_logotype_url ?? null;
		if (slot === 'accent_logo_path') return template.accent_logo_url ?? null;
		return template.end_logo_url ?? null;
	};

	const brandingTheme = $derived(
		resolveOrganisationBrandingTheme(organisation?.brand_settings ?? null)
	);
	const typography = $derived(
		resolveOrganisationBrandingTypography(organisation?.brand_settings ?? null)
	);
	const brandingErrorMessage = $derived(
		form?.type === 'updateOrganisationBranding' &&
			form.ok === false &&
			typeof form.message === 'string'
			? form.message
			: null
	);

	// Derive the actual main_font_key to submit
	// When isPixelCode is true, use montserrat; otherwise use uploaded or selected built-in
	const actualMainFontKey = $derived(
		isPixelCode ? 'montserrat' : useUploadedFont ? 'uploaded' : selectedBuiltInFont
	);

	// Initialize font source mode based on current typography
	$effect(() => {
		if (typography.mainFontKey === 'uploaded') {
			useUploadedFont = true;
			fontUploadMode = typography.uploadedFont?.mode ?? 'variable';
		} else if (typography.mainFontKey === 'montserrat') {
			// montserrat is set via isPixelCode, don't set selectedBuiltInFont
			useUploadedFont = false;
		} else {
			useUploadedFont = false;
			selectedBuiltInFont = typography.mainFontKey;
		}
	});

	// Initialize isPixelCode from organisation settings
	$effect(() => {
		const settings = organisation?.brand_settings as Record<string, unknown> | null;
		isPixelCode = settings?.isPixelCode === true;
	});

	$effect(() => {
		if (!open) {
			// Reset font state when drawer closes
			if (typography.mainFontKey === 'uploaded') {
				useUploadedFont = true;
				fontUploadMode = typography.uploadedFont?.mode ?? 'variable';
			} else if (typography.mainFontKey === 'montserrat') {
				useUploadedFont = false;
			} else {
				useUploadedFont = false;
				selectedBuiltInFont = typography.mainFontKey;
			}
			// Reset isPixelCode
			const settings = organisation?.brand_settings as Record<string, unknown> | null;
			isPixelCode = settings?.isPixelCode === true;
		}
	});
</script>

<Drawer
	variant="right"
	bind:open
	title="Edit branding"
	subtitle="Configure colors and branding assets for {organisation?.name ?? 'this organisation'}."
	class="mr-0 w-full max-w-xl"
	dismissable
>
	{#if organisation}
		<form
			method="POST"
			action="?/updateOrganisationBranding"
			enctype="multipart/form-data"
			class="flex flex-col gap-6 overflow-y-auto pb-24"
		>
			<input type="hidden" name="organisation_id" value={organisation.id} />
			<input type="hidden" name="main_font_key" value={actualMainFontKey} />
			<input type="hidden" name="is_pixel_code" value={isPixelCode ? 'true' : 'false'} />

			<!-- Main Font Section -->
			<div class="space-y-4">
				<h3 class="text-foreground text-sm font-semibold">Main font</h3>

				{#if !useUploadedFont && !isPixelCode}
					<FormControl label="Select font" class="gap-2 text-sm">
						<div class="relative" use:clickOutside={closeFontDropdown}>
							<button
								type="button"
								class="border-border bg-input text-foreground flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm"
								style="font-family: {fontFamilyMap[selectedBuiltInFont]}"
								onclick={() => (fontDropdownOpen = !fontDropdownOpen)}
							>
								<span>{selectedFontLabel}</span>
								<ChevronDown
									class="text-muted-fg h-4 w-4 transition-transform {fontDropdownOpen
										? 'rotate-180'
										: ''}"
								/>
							</button>
							{#if fontDropdownOpen}
								<ul
									class="border-border bg-card absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border py-1 shadow-lg"
								>
									{#each ORGANISATION_MAIN_FONT_OPTIONS as option (option.key)}
										<li>
											<button
												type="button"
												class="hover:bg-muted text-foreground flex w-full items-center justify-between px-3 py-2 text-sm transition-colors"
												style="font-family: {fontFamilyMap[option.key]}"
												onclick={() => selectFont(option.key)}
											>
												<span>{option.label}</span>
												{#if selectedBuiltInFont === option.key}
													<Check class="text-primary h-4 w-4" />
												{/if}
											</button>
										</li>
									{/each}
								</ul>
							{/if}
						</div>
					</FormControl>
				{/if}

				{#if isPixelCode}
					<div
						class="border-border bg-muted/50 flex items-center gap-2 rounded-md border px-3 py-2"
					>
						<span class="text-foreground text-sm" style="font-family: {fontFamilyMap.montserrat}"
							>Montserrat</span
						>
						<span class="text-muted-fg text-xs">(pixel&code_ default)</span>
					</div>
				{/if}

				<div class="flex flex-wrap gap-x-6 gap-y-2">
					<Checkbox bind:checked={useUploadedFont} disabled={isPixelCode}
						>Upload custom font</Checkbox
					>
					<Checkbox bind:checked={isPixelCode}>Is pixel&code_</Checkbox>
				</div>
				{#if typography.uploadedFont}
					<p class="text-muted-fg text-xs">
						Current uploaded font: <span class="text-foreground font-medium"
							>{typography.uploadedFont.family}</span
						>
						({typography.uploadedFont.mode})
					</p>
				{/if}

				{#if useUploadedFont}
					<div class="border-border bg-card space-y-3 rounded-sm border p-3">
						<FormControl label="Upload mode" class="gap-2 text-sm">
							<div class="flex items-center gap-2">
								<div class="flex-1">
									<Dropdown
										options={fontUploadModeOptions}
										bind:value={fontUploadMode}
										placeholder="Select upload mode"
									/>
								</div>
								<div class="tooltip-container relative">
									<Info
										class="text-muted-fg hover:text-foreground h-4 w-4 cursor-help transition-colors"
									/>
									<div class="tooltip-content">
										{#if fontUploadMode === 'variable'}
											<p class="font-medium">Variable font</p>
											<p>
												Upload one variable font file (.ttf/.otf/.woff/.woff2) with weight and
												italic axis support.
											</p>
										{:else}
											<p class="font-medium">Static fonts</p>
											<p>
												Upload 4 files from the same family: Regular (400), Italic (400), Bold
												(700), Bold Italic (700).
											</p>
										{/if}
									</div>
								</div>
							</div>
						</FormControl>

						{#if fontUploadMode === 'variable'}
							<FormControl label="Variable font file" class="gap-2 text-sm">
								<input
									type="file"
									name="uploaded_font_variable"
									accept=".ttf,.otf,.woff,.woff2"
									class="border-border bg-input text-foreground w-full rounded border px-2 py-2 text-xs"
								/>
							</FormControl>
						{:else}
							<div class="grid gap-3 sm:grid-cols-2">
								<FormControl label="Regular (400)" class="gap-2 text-sm">
									<input
										type="file"
										name="uploaded_font_regular"
										accept=".ttf,.otf,.woff,.woff2"
										class="border-border bg-input text-foreground w-full rounded border px-2 py-2 text-xs"
									/>
								</FormControl>
								<FormControl label="Italic (400)" class="gap-2 text-sm">
									<input
										type="file"
										name="uploaded_font_italic"
										accept=".ttf,.otf,.woff,.woff2"
										class="border-border bg-input text-foreground w-full rounded border px-2 py-2 text-xs"
									/>
								</FormControl>
								<FormControl label="Bold (700)" class="gap-2 text-sm">
									<input
										type="file"
										name="uploaded_font_bold"
										accept=".ttf,.otf,.woff,.woff2"
										class="border-border bg-input text-foreground w-full rounded border px-2 py-2 text-xs"
									/>
								</FormControl>
								<FormControl label="Bold Italic (700)" class="gap-2 text-sm">
									<input
										type="file"
										name="uploaded_font_bold_italic"
										accept=".ttf,.otf,.woff,.woff2"
										class="border-border bg-input text-foreground w-full rounded border px-2 py-2 text-xs"
									/>
								</FormControl>
							</div>
						{/if}
					</div>
				{/if}
			</div>

			{#if brandingErrorMessage}
				<Alert variant="destructive" size="sm">
					<p class="text-foreground text-xs font-medium">{brandingErrorMessage}</p>
				</Alert>
			{/if}

			<!-- Organisation Colors Section -->
			<div class="space-y-4">
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
										defaultValue={DEFAULT_ORGANISATION_BRANDING_THEME[mode][field.key]}
									/>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			</div>

			<!-- Template Branding Images -->
			<div class="border-border space-y-4 border-t pt-6">
				<div>
					<h3 class="text-foreground text-sm font-semibold">Branding images</h3>
					<p class="text-muted-fg text-xs">Upload logos and images for resume templates.</p>
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

			<!-- Floating Save/Cancel Footer -->
			<div
				class="bg-background border-border fixed bottom-0 left-0 right-0 flex justify-end gap-3 border-t p-4 sm:left-auto sm:w-full sm:max-w-xl"
			>
				<Button variant="outline" type="button" onclick={() => (open = false)} class="bg-input">
					Cancel
				</Button>
				<Button type="submit" variant="primary">Save changes</Button>
			</div>
		</form>
	{/if}
</Drawer>

<style>
	.tooltip-container {
		position: relative;
		display: inline-flex;
	}

	.tooltip-content {
		position: absolute;
		bottom: calc(100% + 8px);
		right: 0;
		z-index: 50;
		width: 240px;
		padding: 0.75rem;
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--color-foreground);
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: 0.375rem;
		box-shadow:
			0 4px 6px -1px rgb(0 0 0 / 0.1),
			0 2px 4px -2px rgb(0 0 0 / 0.1);
		opacity: 0;
		visibility: hidden;
		transition:
			opacity 0.15s ease-in-out,
			visibility 0.15s ease-in-out;
		pointer-events: none;
	}

	.tooltip-content::after {
		content: '';
		position: absolute;
		top: 100%;
		right: 6px;
		border: 6px solid transparent;
		border-top-color: var(--color-border);
	}

	.tooltip-container:hover .tooltip-content {
		opacity: 1;
		visibility: visible;
	}

	.tooltip-content p {
		margin: 0;
	}

	.tooltip-content p + p {
		margin-top: 0.25rem;
	}
</style>
