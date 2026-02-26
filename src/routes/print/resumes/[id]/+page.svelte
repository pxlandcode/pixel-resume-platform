<script lang="ts">
	import ResumePrint from '$lib/components/resumes/ResumePrint.svelte';

	let { data } = $props();
	const person = $derived(data.resumePerson ?? null);
	const language = $derived(data.language as 'sv' | 'en');
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
	/>
</div>
