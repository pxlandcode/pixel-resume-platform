<script lang="ts">
	import type { LocalizedText } from '$lib/types/resume';
	import { Input } from '@pixelcode_/blocks/components';
	import { t, getLocalizedValue, setLocalizedValue, type Language } from '../utils';

	let {
		footerNote = $bindable(),
		isEditing = false,
		language = 'sv'
	}: {
		footerNote: LocalizedText | undefined;
		isEditing?: boolean;
		language?: Language;
	} = $props();
</script>

{#if isEditing}
	<div class="mt-8 rounded-xs border border-border bg-muted p-4">
		<p class="mb-2 text-sm font-semibold text-secondary-text">Footer Note</p>
		<div class="grid grid-cols-2 gap-4">
			<Input
				value={getLocalizedValue(footerNote ?? '', 'sv')}
				oninput={(e) =>
					(footerNote = setLocalizedValue(footerNote ?? '', 'sv', e.currentTarget.value))}
				placeholder="Footer note (SV)"
				class="border-border bg-card"
			/>
			<Input
				value={getLocalizedValue(footerNote ?? '', 'en')}
				oninput={(e) =>
					(footerNote = setLocalizedValue(footerNote ?? '', 'en', e.currentTarget.value))}
				placeholder="Footer note (EN)"
				class="border-border bg-card"
			/>
		</div>
	</div>
{:else if footerNote}
	<div class="mt-8 border-t border-border pt-4 text-center text-sm text-secondary-text italic">
		{t(footerNote, language)}
	</div>
{/if}
