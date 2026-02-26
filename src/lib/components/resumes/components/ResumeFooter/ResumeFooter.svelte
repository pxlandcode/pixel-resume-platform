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
	<div class="mt-8 rounded-xs border border-slate-200 bg-slate-50 p-4">
		<p class="mb-2 text-sm font-semibold text-slate-700">Footer Note</p>
		<div class="grid grid-cols-2 gap-4">
			<Input
				value={getLocalizedValue(footerNote ?? '', 'sv')}
				oninput={(e) =>
					(footerNote = setLocalizedValue(footerNote ?? '', 'sv', e.currentTarget.value))}
				placeholder="Footer note (SV)"
				class="border-slate-300 bg-white"
			/>
			<Input
				value={getLocalizedValue(footerNote ?? '', 'en')}
				oninput={(e) =>
					(footerNote = setLocalizedValue(footerNote ?? '', 'en', e.currentTarget.value))}
				placeholder="Footer note (EN)"
				class="border-slate-300 bg-white"
			/>
		</div>
	</div>
{:else if footerNote}
	<div class="mt-8 border-t border-slate-200 pt-4 text-center text-sm text-slate-500 italic">
		{t(footerNote, language)}
	</div>
{/if}
