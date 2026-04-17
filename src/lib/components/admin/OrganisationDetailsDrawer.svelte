<script lang="ts">
	import { Button, FormControl, Input } from '@pixelcode_/blocks/components';
	import Drawer from '$lib/components/drawer/drawer.svelte';
	import EmailDomainInput from './EmailDomainInput.svelte';

	type Organisation = {
		id: string;
		name: string;
		slug: string;
		homepage_url: string | null;
		email_domains: string[];
	};

	let {
		open = $bindable(false),
		organisation = undefined
	}: {
		open: boolean;
		organisation?: Organisation;
	} = $props();

	let emailDomains = $state<string[]>([]);

	$effect(() => {
		if (organisation) {
			emailDomains = [...organisation.email_domains];
		}
	});
</script>

<Drawer
	variant="right"
	bind:open
	title="Edit details"
	subtitle="Update organisation name, slug, and homepage URL."
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
				<Input name="name" value={organisation.name} required class="bg-input text-foreground" />
			</FormControl>

			<FormControl label="Slug" required class="gap-2 text-sm">
				<Input name="slug" value={organisation.slug} required class="bg-input text-foreground" />
			</FormControl>

			<FormControl label="Homepage URL" class="gap-2 text-sm">
				<Input
					name="homepage_url"
					value={organisation.homepage_url ?? ''}
					placeholder="https://example.com"
					class="bg-input text-foreground"
				/>
			</FormControl>

			<FormControl label="Microsoft sign-in domains" class="gap-2 text-sm" tag="div">
				<EmailDomainInput bind:domains={emailDomains} />
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
				<Button variant="primary" type="submit">Save changes</Button>
			</div>
		</form>
	{/if}
</Drawer>
