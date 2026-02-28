<script lang="ts">
	import { Input, FormControl } from '@pixelcode_/blocks/components';
	import type { LocalizedText } from '$lib/types/resume';
	import { t, getLocalizedValue, setLocalizedValue, type Language } from '../utils';

	let {
		title = $bindable(),
		isEditing = false,
		language = 'sv'
	}: {
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
		<h2 class="text-xl font-medium text-muted-fg">{t(title, language)}</h2>
	</div>
{/if}
