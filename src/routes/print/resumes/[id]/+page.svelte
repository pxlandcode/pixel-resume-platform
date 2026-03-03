<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import ResumePrint from '$lib/components/resumes/ResumePrint.svelte';
	import {
		DEFAULT_ORGANISATION_BRANDING_THEME,
		organisationBrandingThemeToInlineStyle
	} from '$lib/branding/theme';

	let { data } = $props();
	const person = $derived(data.resumePerson ?? null);
	const language = $derived(data.language as 'sv' | 'en');
	const templateBrandingStyle = $derived.by(() => {
		const theme = data.templateContext?.brandingTheme ?? DEFAULT_ORGANISATION_BRANDING_THEME;
		const inlineVars = organisationBrandingThemeToInlineStyle(theme);
		return `${inlineVars}; --color-primary: ${theme.light.primary};`;
	});

	onMount(() => {
		if (!browser || !data?.debug?.enabled) return;

		console.group(`[print debug] resume ${data.debug.resumeId}`);
		console.info('[print debug] server payload', data.debug);

		const domSummary = {
			nameText: document.querySelector('.page-1 h1')?.textContent?.trim() ?? '',
			titleText: document.querySelector('.page-1 h2')?.textContent?.trim() ?? '',
			summaryLength:
				document.querySelector('.page-1 .text-sm.leading-relaxed')?.textContent?.trim().length ?? 0,
			highlightedCount: document.querySelectorAll('[data-debug="highlighted-item"]').length,
			experienceCount: document.querySelectorAll('[data-debug="experience-item"]').length,
			hasAvatarImage: Boolean(document.querySelector('[data-debug="avatar-image"]')),
			avatarImageUrl:
				(document.querySelector('[data-debug="avatar-image"]') as HTMLImageElement | null)?.src ??
				null
		};
		console.info('[print debug] dom summary', domSummary);
		console.groupEnd();
	});
</script>

<svelte:head>
	<title>{data.meta?.title ?? 'Resume print'}</title>
	{#if data.templateContext?.mainFontFaceCss}
		{@html `<style id="print-template-font-face">${data.templateContext.mainFontFaceCss}</style>`}
	{/if}
</svelte:head>

<div class="bg-white text-slate-900" style={templateBrandingStyle}>
	<ResumePrint
		data={data.resume.data}
		image={data.resumePerson?.avatar_url}
		{language}
		person={person ?? undefined}
		profileTechStack={person?.techStack}
		templateKey={data.templateContext?.templateKey}
		templateMainLogotypeUrl={data.templateContext?.mainLogotypeUrl}
		templateAccentLogoUrl={data.templateContext?.accentLogoUrl}
		templateEndLogoUrl={data.templateContext?.endLogoUrl}
		templateHomepageUrl={data.templateContext?.homepageUrl}
		templateMainFontCssStack={data.templateContext?.mainFontCssStack}
		templateIsPixelCode={data.templateContext?.isPixelCode}
	/>
</div>
