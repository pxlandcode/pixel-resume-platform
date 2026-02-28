<script lang="ts">
	import TalentFormDrawer from '$lib/components/admin/TalentFormDrawer.svelte';
	import { Alert, Button, Card } from '@pixelcode_/blocks/components';
	import { User } from 'lucide-svelte';
	import { resolve } from '$app/paths';

	const { data, form } = $props();
	const talents = $derived(data.talents ?? []);
	const canManageTalents = $derived(Boolean(data.canManageTalents));
	const actionMessage = $derived(typeof form?.message === 'string' ? form.message : null);
	const actionFailed = $derived(form?.ok === false);
	let isCreateDrawerOpen = $state(false);
</script>

<div class="space-y-6">
	<header class="flex items-center justify-between">
		<div>
			<h1 class="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">Talents</h1>
			<p class="text-muted-fg mt-3 text-lg">Browse all talents and open their resume workspace.</p>
		</div>
		{#if canManageTalents}
			<Button type="button" variant="primary" size="md" onclick={() => (isCreateDrawerOpen = true)}>
				Create talent
			</Button>
		{/if}
	</header>

	{#if canManageTalents && actionMessage}
		<Alert variant={actionFailed ? 'destructive' : 'success'} size="sm">
			<p class="text-foreground text-sm font-medium">{actionMessage}</p>
		</Alert>
	{/if}

	{#if canManageTalents}
		<TalentFormDrawer bind:open={isCreateDrawerOpen} />
	{/if}

	{#if talents.length === 0}
		<div class="border-border bg-card rounded-sm border p-6">
			<h2 class="text-foreground text-lg font-semibold">No talents yet</h2>
			<p class="text-muted-fg mt-2 text-sm">
				Talents will appear here once created. User linkage is optional.
			</p>
		</div>
	{:else}
		<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{#each talents as talent (talent.id)}
				<a href={resolve('/resumes/[personId]', { personId: talent.id })} class="block h-full">
					<Card
						class="flex h-full flex-col overflow-hidden rounded-none transition-all hover:shadow-md"
					>
						<div class="bg-muted aspect-square w-full overflow-hidden">
							{#if talent.avatar_url}
								<img
									src={talent.avatar_url}
									alt={[talent.first_name, talent.last_name].filter(Boolean).join(' ')}
									class="h-full w-full object-cover object-top transition-transform duration-500 hover:scale-105"
								/>
							{:else}
								<div class="text-muted-fg flex h-full w-full items-center justify-center">
									<User size={48} />
								</div>
							{/if}
						</div>
						<div class="flex flex-1 flex-col p-5">
							<h3 class="text-foreground text-lg font-semibold">
								{[talent.first_name, talent.last_name].filter(Boolean).join(' ') ||
									'Unnamed Talent'}
							</h3>
							{#if talent.title}
								<p class="text-muted-fg mt-1 text-sm">{talent.title}</p>
							{/if}
							{#if talent.email}
								<p class="text-muted-fg mt-2 text-xs">{talent.email}</p>
							{/if}
							{#if talent.organisation_logo_url || talent.organisation_name}
								<div class="mt-auto pt-3">
									{#if talent.organisation_logo_url}
										<img
											src={talent.organisation_logo_url}
											alt={talent.organisation_name ?? 'Organisation'}
											class="h-5 w-auto object-contain"
										/>
									{:else}
										<span class="text-muted-fg text-xs font-medium"
											>{talent.organisation_name}</span
										>
									{/if}
								</div>
							{/if}
						</div>
					</Card>
				</a>
			{/each}
		</div>
	{/if}
</div>
