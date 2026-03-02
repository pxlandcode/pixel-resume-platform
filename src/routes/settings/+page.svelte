<script lang="ts">
	import LegalDocumentsDrawer from '$lib/components/admin/LegalDocumentsDrawer.svelte';
	import { Button } from '@pixelcode_/blocks/components';

	let { data } = $props();
	let isLegalDrawerOpen = $state(false);

	const openLegalDrawer = () => {
		isLegalDrawerOpen = true;
	};
</script>

<div class="relative space-y-6">
	<div class="absolute right-0 top-0 z-10 flex items-center gap-2">
		<div class="bg-primary inline-flex items-center rounded-sm p-1">
			<Button variant="primary" size="sm" type="button" class="px-3" onclick={openLegalDrawer}>
				Legal documents
			</Button>
		</div>
	</div>

	<header>
		<h1 class="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">Settings</h1>
		<p class="text-muted-fg mt-3 text-lg">Manage administrative workspace settings.</p>
	</header>

	<div class="border-border bg-card rounded-sm border p-6">
		<p class="text-muted-fg text-sm font-medium">
			Use legal documents to create, review, and activate legal versions.
		</p>
	</div>
</div>

<LegalDocumentsDrawer bind:open={isLegalDrawerOpen} documents={data.legalDocuments ?? []} />
