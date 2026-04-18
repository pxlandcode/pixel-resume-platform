<script lang="ts">
	import { page } from '$app/stores';
	import DashboardSearch from '$lib/components/dashboard/DashboardSearch.svelte';

	const status = $derived($page.status);

	const headline = $derived(
		status === 404
			? 'This page took a coffee break'
			: status === 403
				? 'Nothing to see here, move along'
				: 'Well, that wasn\u2019t supposed to happen'
	);

	const subtext = $derived(
		status === 404
			? 'We looked everywhere, under the keyboard, behind the server rack, but this page is gone. Try searching for what you need instead!'
			: status === 403
				? 'You don\u2019t have access to this page. If you think that\u2019s a mistake, try searching for something you do have access to.'
				: 'Something went sideways. While we sort things out, why not search for what you were looking for?'
	);
</script>

<div
	class="bg-background text-foreground flex min-h-screen flex-col items-center justify-center px-6 py-16"
>
	<p
		class="text-primary/15 select-none text-[9rem] font-extrabold leading-none tracking-tight sm:text-[12rem]"
	>
		{status}
	</p>

	<h1 class="text-foreground mt-2 text-center text-2xl font-semibold sm:text-3xl">
		{headline}
	</h1>

	<p class="text-muted-fg mt-3 max-w-md text-center text-sm leading-relaxed">
		{subtext}
	</p>

	<div class="mt-10 w-full max-w-2xl">
		<DashboardSearch autoFocus />
	</div>
</div>
