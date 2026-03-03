<script lang="ts">
	import LegalDocumentsDrawer from '$lib/components/admin/LegalDocumentsDrawer.svelte';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import Scale from 'lucide-svelte/icons/scale';

	let { data } = $props();
	let isLegalDrawerOpen = $state(false);

	type SettingItem = {
		id: string;
		title: string;
		description: string;
		icon: typeof Scale;
		action: () => void;
	};

	const settingsItems: SettingItem[] = [
		{
			id: 'legal',
			title: 'Legal documents',
			description: 'Manage terms of service, privacy notices, and other legal documents.',
			icon: Scale,
			action: () => {
				isLegalDrawerOpen = true;
			}
		}
	];
</script>

<div class="space-y-6">
	<header>
		<h1 class="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">Settings</h1>
		<p class="text-muted-fg mt-3 text-lg">Manage administrative workspace settings.</p>
	</header>

	<div class="border-border bg-card divide-border divide-y rounded-sm border">
		{#each settingsItems as item (item.id)}
			<button
				type="button"
				class="hover:bg-muted/50 flex w-full items-center gap-4 p-4 text-left transition-colors"
				onclick={item.action}
			>
				<div
					class="bg-muted text-muted-fg flex h-10 w-10 shrink-0 items-center justify-center rounded-sm"
				>
					<item.icon class="h-5 w-5" />
				</div>
				<div class="min-w-0 flex-1">
					<p class="text-foreground text-sm font-semibold">{item.title}</p>
					<p class="text-muted-fg mt-0.5 text-sm">{item.description}</p>
				</div>
				<ChevronRight class="text-muted-fg h-5 w-5 shrink-0" />
			</button>
		{/each}
	</div>
</div>

<LegalDocumentsDrawer bind:open={isLegalDrawerOpen} documents={data.legalDocuments ?? []} />
