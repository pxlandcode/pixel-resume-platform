<script lang="ts">
	import { Button, FormControl, Input } from '@pixelcode_/blocks/components';
	import Drawer from '$lib/components/drawer/drawer.svelte';

	let { open = $bindable(false) }: { open: boolean } = $props();

	$effect(() => {
		if (!open) {
			// Reset any local state when drawer closes if needed
		}
	});
</script>

<Drawer
	variant="right"
	bind:open
	title="Create organisation"
	subtitle="Create a new organisation with basic settings. You can configure branding and memberships after creation."
	class="mr-0 w-full max-w-xl"
	dismissable
>
	<form
		method="POST"
		action="?/createOrganisation"
		class="flex flex-col gap-5 overflow-y-auto pb-16"
	>
		<FormControl label="Name" required class="gap-2 text-sm">
			<Input
				id="name"
				name="name"
				placeholder="Organisation name"
				required
				class="bg-input text-foreground"
			/>
		</FormControl>

		<FormControl label="Slug" class="gap-2 text-sm">
			<Input
				id="slug"
				name="slug"
				placeholder="optional-auto-generated"
				class="bg-input text-foreground"
			/>
			<p class="text-muted-fg text-xs">Leave empty to auto-generate from name.</p>
		</FormControl>

		<FormControl label="Homepage URL" class="gap-2 text-sm">
			<Input
				id="homepage_url"
				name="homepage_url"
				placeholder="https://example.com"
				class="bg-input text-foreground"
			/>
		</FormControl>

		<div class="sticky bottom-0 flex flex-wrap justify-end gap-3 bg-transparent pt-4">
			<Button
				variant="outline"
				type="button"
				onclick={() => (open = false)}
				class="bg-input hover:bg-muted/70"
			>
				Cancel
			</Button>
			<Button variant="primary" type="submit">Create organisation</Button>
		</div>
	</form>
</Drawer>
