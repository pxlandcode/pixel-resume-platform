<script lang="ts">
	import TalentFormDrawer from '$lib/components/admin/TalentFormDrawer.svelte';
	import { DropdownCheckbox } from '$lib/components/dropdown-checkbox';
	import { userSettingsStore } from '$lib/stores/userSettings';
	import type { ViewMode } from '$lib/types/userSettings';
	import { Alert, Button, Card } from '@pixelcode_/blocks/components';
	import { User } from 'lucide-svelte';
	import { resolve } from '$app/paths';

	const { data, form } = $props();

	const allTalents = $derived(data.talents ?? []);
	const canManageTalents = $derived(Boolean(data.canManageTalents));
	const actionMessage = $derived(typeof form?.message === 'string' ? form.message : null);
	const actionFailed = $derived(form?.ok === false);
	const talentsViewMode = $derived($userSettingsStore.settings.views.talents);
	const homeOrganisationId = $derived(
		typeof data.homeOrganisationId === 'string' ? data.homeOrganisationId : null
	);

	const organisationFilterOptions = $derived(
		(data.organisationOptions ?? []).map((org: { id: string; name: string }) => ({
			label: org.name,
			value: org.id
		}))
	);
	const availableOrganisationIds = $derived(organisationFilterOptions.map((org) => org.value));

	const sanitizeOrganisationIds = (ids: string[]) => {
		const allowed = new Set(availableOrganisationIds);
		return Array.from(
			new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0 && allowed.has(id)))
		);
	};

	const selectedOrganisationIds = $derived.by(() => {
		if (availableOrganisationIds.length === 0) return [];

		const configured = sanitizeOrganisationIds(
			$userSettingsStore.settings.organisationFilters.talents
		);
		if (configured.length > 0) return configured;

		if (homeOrganisationId && availableOrganisationIds.includes(homeOrganisationId)) {
			return [homeOrganisationId];
		}

		return [availableOrganisationIds[0]];
	});

	const talents = $derived.by(() => {
		if (selectedOrganisationIds.length === 0) return allTalents;

		const selectedSet = new Set(selectedOrganisationIds);
		return allTalents.filter(
			(talent) =>
				typeof talent.organisation_id === 'string' && selectedSet.has(talent.organisation_id)
		);
	});

	let isCreateDrawerOpen = $state(false);

	const getTalentName = (talent: (typeof allTalents)[number]) =>
		[talent.first_name, talent.last_name].filter(Boolean).join(' ') || 'Unnamed Talent';

	const setTalentsViewMode = (mode: ViewMode) => {
		void userSettingsStore.setViewMode('talents', mode);
	};

	const handleOrganisationFilterChange = (selected: string[]) => {
		let next = sanitizeOrganisationIds(selected);
		if (next.length === 0) {
			if (homeOrganisationId && availableOrganisationIds.includes(homeOrganisationId)) {
				next = [homeOrganisationId];
			} else if (availableOrganisationIds.length > 0) {
				next = [availableOrganisationIds[0]];
			}
		}
		void userSettingsStore.setOrganisationFilters('talents', next);
	};
</script>

<div class="space-y-6">
	<header class="flex flex-wrap items-center justify-between gap-4">
		<div>
			<h1 class="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">Talents</h1>
			<p class="text-muted-fg mt-3 text-lg">Browse all talents and open their resume workspace.</p>
		</div>
		<div class="ml-auto flex flex-wrap items-center gap-2">
			{#if organisationFilterOptions.length > 0}
				<div class="w-56">
					<DropdownCheckbox
						label="Organisations"
						hideLabel
						placeholder="Organisations"
						options={organisationFilterOptions}
						selectedValues={selectedOrganisationIds}
						onchange={handleOrganisationFilterChange}
						variant="outline"
						size="sm"
						search
						searchPlaceholder="Search organisations"
					/>
				</div>
			{/if}
			<div class="border-border bg-card inline-flex rounded-sm border p-1">
				<Button
					type="button"
					variant="outline"
					size="sm"
					onclick={() => setTalentsViewMode('grid')}
					class={`min-w-16 ${
						talentsViewMode === 'grid'
							? 'border-primary bg-primary hover:bg-primary/90 text-white hover:text-white'
							: 'border-transparent bg-transparent'
					}`}
				>
					Grid
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onclick={() => setTalentsViewMode('list')}
					class={`min-w-16 ${
						talentsViewMode === 'list'
							? 'border-primary bg-primary hover:bg-primary/90 text-white hover:text-white'
							: 'border-transparent bg-transparent'
					}`}
				>
					List
				</Button>
			</div>
			{#if canManageTalents}
				<Button
					type="button"
					variant="primary"
					size="md"
					onclick={() => (isCreateDrawerOpen = true)}
				>
					Create talent
				</Button>
			{/if}
		</div>
	</header>

	{#if canManageTalents && actionMessage}
		<Alert variant={actionFailed ? 'destructive' : 'success'} size="sm">
			<p class="text-foreground text-sm font-medium">{actionMessage}</p>
		</Alert>
	{/if}

	{#if canManageTalents}
		<TalentFormDrawer bind:open={isCreateDrawerOpen} />
	{/if}

	{#if allTalents.length === 0}
		<div class="border-border bg-card rounded-sm border p-6">
			<h2 class="text-foreground text-lg font-semibold">No talents yet</h2>
			<p class="text-muted-fg mt-2 text-sm">
				Talents will appear here once created. User linkage is optional.
			</p>
		</div>
	{:else if talents.length === 0}
		<div class="border-border bg-card rounded-sm border p-6">
			<h2 class="text-foreground text-lg font-semibold">No talents in selected organisations</h2>
			<p class="text-muted-fg mt-2 text-sm">Try selecting another organisation filter.</p>
		</div>
	{:else if talentsViewMode === 'grid'}
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
									alt={getTalentName(talent)}
									class="h-full w-full object-cover object-top transition-transform duration-500 hover:scale-105"
								/>
							{:else}
								<div class="text-muted-fg flex h-full w-full items-center justify-center">
									<User size={48} />
								</div>
							{/if}
						</div>
						<div class="flex flex-1 flex-col p-5">
							<h3 class="text-foreground text-lg font-semibold">{getTalentName(talent)}</h3>
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
										<span class="text-muted-fg text-xs font-medium">{talent.organisation_name}</span
										>
									{/if}
								</div>
							{/if}
						</div>
					</Card>
				</a>
			{/each}
		</div>
	{:else}
		<div class="border-border bg-card divide-border overflow-hidden rounded-none border">
			{#each talents as talent (talent.id)}
				<a
					href={resolve('/resumes/[personId]', { personId: talent.id })}
					class="hover:bg-muted/30 block transition-colors"
				>
					<div class="flex items-start gap-4 p-4 sm:items-center sm:p-5">
						<div class="bg-muted h-16 w-16 shrink-0 overflow-hidden rounded-sm">
							{#if talent.avatar_url}
								<img
									src={talent.avatar_url}
									alt={getTalentName(talent)}
									class="h-full w-full object-cover object-top"
								/>
							{:else}
								<div class="text-muted-fg flex h-full w-full items-center justify-center">
									<User size={24} />
								</div>
							{/if}
						</div>

						<div class="min-w-0 flex-1">
							<h3 class="text-foreground truncate text-lg font-semibold">
								{getTalentName(talent)}
							</h3>
							{#if talent.title}
								<p class="text-muted-fg mt-1 truncate text-sm">{talent.title}</p>
							{/if}
							{#if talent.email}
								<p class="text-muted-fg mt-2 truncate text-xs">{talent.email}</p>
							{/if}
						</div>

						{#if talent.organisation_logo_url || talent.organisation_name}
							<div class="ml-auto hidden shrink-0 sm:block">
								{#if talent.organisation_logo_url}
									<img
										src={talent.organisation_logo_url}
										alt={talent.organisation_name ?? 'Organisation'}
										class="h-6 w-auto object-contain"
									/>
								{:else}
									<span class="text-muted-fg text-xs font-medium">{talent.organisation_name}</span>
								{/if}
							</div>
						{/if}
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>
