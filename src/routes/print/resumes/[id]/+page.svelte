<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import ResumePrint from '$lib/components/resumes/ResumePrint.svelte';

	let { data } = $props();
	const person = $derived(data.resumePerson ?? null);
	const language = $derived(data.language as 'sv' | 'en');

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
</svelte:head>

<div class="bg-white text-slate-900">
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
	/>
</div>
