<script lang="ts">
	import { FileText, Users, UserCheck, CalendarClock } from 'lucide-svelte';
	import { resolve } from '$app/paths';

	let {
		stats
	}: {
		stats: {
			totalTalents: number;
			totalResumes: number;
			availableNow: number;
			availableSoon: number;
		};
	} = $props();

	const items = $derived([
		{ label: 'Talents', value: stats.totalTalents, href: resolve('/talents'), icon: Users },
		{ label: 'Resumes', value: stats.totalResumes, href: resolve('/resumes'), icon: FileText },
		{
			label: 'Available now',
			value: stats.availableNow,
			href: `${resolve('/resumes')}?availability=now`,
			icon: UserCheck
		},
		{
			label: 'Available soon',
			value: stats.availableSoon,
			href: `${resolve('/resumes')}?availability=within-days`,
			icon: CalendarClock
		}
	]);
</script>

<div class="flex flex-wrap items-center gap-x-5 gap-y-1">
	{#each items as item, i (item.label)}
		{#if i > 0}
			<span class="text-border hidden sm:inline">·</span>
		{/if}
		<a
			href={item.href}
			class="text-muted-fg hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
		>
			<item.icon size={13} class="shrink-0" />
			<span class="font-semibold">{item.value}</span>
			<span>{item.label}</span>
		</a>
	{/each}
</div>
