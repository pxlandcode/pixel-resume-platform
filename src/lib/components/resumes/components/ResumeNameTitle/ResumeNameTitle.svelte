<script lang="ts">
	import { Input, FormControl } from '@pixelcode_/blocks/components';
	import type { LocalizedText } from '$lib/types/resume';
	import { t, getLocalizedValue, setLocalizedValue, type Language } from '../utils';

	let {
		name = '',
		title = $bindable(),
		isEditing = false,
		language = 'sv'
	}: {
		name?: string;
		title: LocalizedText;
		isEditing?: boolean;
		language?: Language;
	} = $props();
</script>

{#if isEditing}
	<div class="space-y-3">
		<FormControl label="Title (SV)">
			<Input
				value={getLocalizedValue(title, 'sv')}
				oninput={(e) => (title = setLocalizedValue(title, 'sv', e.currentTarget.value))}
				placeholder="Title (SV)"
				class="border-border bg-card text-foreground"
			/>
		</FormControl>
		<FormControl label="Title (EN)">
			<Input
				value={getLocalizedValue(title, 'en')}
				oninput={(e) => (title = setLocalizedValue(title, 'en', e.currentTarget.value))}
				placeholder="Title (EN)"
				class="border-border bg-card text-foreground"
			/>
		</FormControl>
	</div>
{:else}
	<div>
		{#if name}
			<h1 class="text-text text-2xl font-semibold">{name}</h1>
		{/if}
		<h2 class="text-text text-xl font-medium">{t(title, language)}</h2>
	</div>
{/if}
