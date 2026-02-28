<script lang="ts">
	import { Button, FormControl, Input } from '@pixelcode_/blocks/components';
	import Drawer from '$lib/components/drawer/drawer.svelte';

	type Organisation = {
		id: string;
		name: string;
		slug: string;
		homepage_url: string | null;
		brand_settings: Record<string, unknown> | null;
	};

	let {
		open = $bindable(false),
		organisation = undefined
	}: {
		open: boolean;
		organisation?: Organisation;
	} = $props();

	$effect(() => {
		if (!open) {
			// Reset any local state when drawer closes if needed
		}
	});
</script>

<Drawer
	variant="right"
	bind:open
	title="Edit details"
	subtitle="Update organisation name, slug, homepage URL, and brand settings."
	class="mr-0 w-full max-w-xl"
	dismissable
>
	{#if organisation}
		<form
			method="POST"
			action="?/updateOrganisation"
			class="flex flex-col gap-5 overflow-y-auto pb-16"
		>
			<input type="hidden" name="organisation_id" value={organisation.id} />

			<FormControl label="Name" required class="gap-2 text-sm">
				<Input name="name" value={organisation.name} required class="bg-white text-gray-900" />
			</FormControl>

			<FormControl label="Slug" required class="gap-2 text-sm">
				<Input name="slug" value={organisation.slug} required class="bg-white text-gray-900" />
			</FormControl>

			<FormControl label="Homepage URL" class="gap-2 text-sm">
				<Input
					name="homepage_url"
					value={organisation.homepage_url ?? ''}
					placeholder="https://example.com"
					class="bg-white text-gray-900"
				/>
			</FormControl>

			<FormControl label="Brand settings JSON" class="gap-2 text-sm">
				<textarea
					name="brand_settings"
					rows="4"
					class="w-full rounded border border-slate-300 bg-white p-2 font-mono text-sm text-slate-900"
					>{JSON.stringify(organisation.brand_settings ?? {}, null, 2)}</textarea
				>
			</FormControl>

			<div class="sticky bottom-0 flex flex-wrap justify-end gap-3 bg-transparent pt-4">
				<Button
					variant="outline"
					type="button"
					onclick={() => (open = false)}
					class="bg-white hover:bg-slate-50"
				>
					Cancel
				</Button>
				<Button variant="primary" type="submit">Save changes</Button>
			</div>
		</form>
	{/if}
</Drawer>
