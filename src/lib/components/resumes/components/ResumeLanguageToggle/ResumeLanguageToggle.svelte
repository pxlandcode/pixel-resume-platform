<script lang="ts">
	import type { Language } from '../utils';

	let {
		language,
		onToggle
	}: {
		language: Language;
		onToggle: () => void;
	} = $props();
</script>

<div class="absolute top-4 right-4 z-10 print:hidden">
	<button
		type="button"
		class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:outline-none"
		onclick={onToggle}
	>
		<span class={language === 'sv' ? 'font-bold text-indigo-600' : 'text-slate-500'}>SV</span>
		<span class="text-slate-300">/</span>
		<span class={language === 'en' ? 'font-bold text-indigo-600' : 'text-slate-500'}>EN</span>
	</button>
</div>
