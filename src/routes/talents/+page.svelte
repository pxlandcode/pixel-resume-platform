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
			<h1 class="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Talents</h1>
			<p class="mt-3 text-lg text-slate-500">Browse all talents and open their resume workspace.</p>
		</div>
		{#if canManageTalents}
			<Button type="button" variant="primary" size="md" onclick={() => (isCreateDrawerOpen = true)}>
				Create talent
			</Button>
		{/if}
	</header>

	{#if canManageTalents && actionMessage}
		<Alert variant={actionFailed ? 'destructive' : 'success'} size="sm">
			<p class="text-sm font-medium text-gray-900">{actionMessage}</p>
		</Alert>
	{/if}

	{#if canManageTalents}
		<TalentFormDrawer bind:open={isCreateDrawerOpen} />
	{/if}

	{#if talents.length === 0}
		<div class="rounded-sm border border-slate-200 bg-white p-6">
			<h2 class="text-lg font-semibold text-slate-900">No talents yet</h2>
			<p class="mt-2 text-sm text-slate-500">
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
						<div class="aspect-square w-full overflow-hidden bg-slate-100">
							{#if talent.avatar_url}
								<img
									src={talent.avatar_url}
									alt={[talent.first_name, talent.last_name].filter(Boolean).join(' ')}
									class="h-full w-full object-cover object-top transition-transform duration-500 hover:scale-105"
								/>
							{:else}
								<div class="flex h-full w-full items-center justify-center text-slate-300">
									<User size={48} />
								</div>
							{/if}
						</div>
						<div class="flex flex-1 flex-col p-5">
							<h3 class="text-lg font-semibold text-slate-900">
								{[talent.first_name, talent.last_name].filter(Boolean).join(' ') ||
									'Unnamed Talent'}
							</h3>
							{#if talent.title}
								<p class="mt-1 text-sm text-slate-500">{talent.title}</p>
							{/if}
							{#if talent.email}
								<p class="mt-2 text-xs text-slate-400">{talent.email}</p>
							{/if}
						</div>
					</Card>
				</a>
			{/each}
		</div>
	{/if}
</div>
