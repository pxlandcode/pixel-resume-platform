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
		class="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-secondary-text shadow-sm hover:bg-muted focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:outline-none"
		onclick={onToggle}
	>
		<span class={language === 'sv' ? 'font-bold text-primary' : 'text-secondary-text'}>SV</span>
		<span class="text-secondary-text">/</span>
		<span class={language === 'en' ? 'font-bold text-primary' : 'text-secondary-text'}>EN</span>
	</button>
</div>
