<script lang="ts">
	import TalentFormDrawer from '$lib/components/admin/TalentFormDrawer.svelte';
	import { DropdownCheckbox } from '$lib/components/dropdown-checkbox';
	import { SuperList, ListHandler, Cell, Row } from '$lib/components/super-list';
	import type { SuperListHead } from '$lib/components/super-list';
	import { userSettingsStore } from '$lib/stores/userSettings';
	import type { ViewMode } from '$lib/types/userSettings';
	import { goto, invalidateAll } from '$app/navigation';
	import {
		applyImageFallbackOnce,
		getOriginalImageUrl,
		supabaseImagePresets,
		supabaseImageSizes,
		supabaseImageSrcsetWidths,
		transformSupabasePublicUrl,
		transformSupabasePublicUrlSrcSet
	} from '$lib/images/supabaseImage';
	import { Alert, Button, Card, Input } from '@pixelcode_/blocks/components';
	import { Pencil, User, LayoutGrid, List, SlidersHorizontal, Search } from 'lucide-svelte';
	import { resolve } from '$app/paths';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { onDestroy } from 'svelte';

	type LoadTalent = {
		id: string;
		user_id: string | null;
		first_name: string;
		last_name: string;
		avatar_url: string | null;
		title: string;
		resume_count: number;
		can_edit: boolean;
		organisation_id: string | null;
		organisation_name: string | null;
		organisation_logo_url: string | null;
	};

	let { data } = $props();

	const allTalents = $derived((data.talents as LoadTalent[] | undefined) ?? []);
	const canManageTalents = $derived(Boolean(data.canManageTalents));
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

	const contactScopeOrgIds = $derived(
		Array.from(new Set(selectedOrganisationIds.map((id) => id.trim()).filter(Boolean))).sort()
	);
	const contactScopeSignature = $derived(
		contactScopeOrgIds.length > 0 ? `org:${contactScopeOrgIds.join(',')}` : 'default'
	);

	let isCreateDrawerOpen = $state(false);
	let isEditDrawerOpen = $state(false);
	let selectedTalentId = $state<string | null>(null);
	let filtersOpen = $state(false);
	let searchQuery = $state('');
	let contactIndexStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let contactIndexError = $state<string | null>(null);
	let loadedContactScopeSignature = $state<string | null>(null);
	let activeContactScopeSignature = $state<string | null>(null);
	let contactIndexByScope = $state<Record<string, Record<string, string | null>>>({});
	let contactEtagByScope = $state<Record<string, string | null>>({});
	let contactIndexAbortController: AbortController | null = null;
	let feedback = $state<{ type: 'success' | 'error'; message: string } | null>(null);

	const needsContactIndex = $derived(talentsViewMode === 'list' || searchQuery.trim().length > 0);
	const contactIndexLoadingForScope = $derived(
		contactIndexStatus === 'loading' && activeContactScopeSignature === contactScopeSignature
	);
	const activeContactByTalentId = $derived(
		loadedContactScopeSignature === contactScopeSignature
			? (contactIndexByScope[contactScopeSignature] ?? {})
			: {}
	);

	const toContactByTalentId = (
		items: Array<{ talentId: unknown; email: unknown }>
	): Record<string, string | null> => {
		const result: Record<string, string | null> = {};

		for (const item of items) {
			if (typeof item.talentId !== 'string' || item.talentId.trim().length === 0) continue;
			const talentId = item.talentId.trim();
			result[talentId] = typeof item.email === 'string' ? item.email : null;
		}

		return result;
	};

	const loadContactIndexForScope = async (scopeSignature: string, orgIds: string[]) => {
		if (contactIndexStatus === 'loading' && activeContactScopeSignature === scopeSignature) return;

		const cached = contactIndexByScope[scopeSignature];
		if (cached) {
			activeContactScopeSignature = scopeSignature;
			loadedContactScopeSignature = scopeSignature;
			contactIndexStatus = 'ready';
			contactIndexError = null;
			return;
		}

		contactIndexAbortController?.abort();
		const controller = new AbortController();
		contactIndexAbortController = controller;
		activeContactScopeSignature = scopeSignature;
		contactIndexStatus = 'loading';
		contactIndexError = null;

		try {
			const query = orgIds.map((orgId) => `org=${encodeURIComponent(orgId)}`).join('&');
			const endpoint = query
				? `/internal/api/talents/contact-index?${query}`
				: '/internal/api/talents/contact-index';

			const response = await fetch(endpoint, {
				method: 'GET',
				credentials: 'include',
				signal: controller.signal,
				headers: contactEtagByScope[scopeSignature]
					? { 'If-None-Match': contactEtagByScope[scopeSignature] }
					: undefined
			});

			if (response.status === 304) {
				if (!contactIndexByScope[scopeSignature]) {
					throw new Error('Contact index cache was empty after revalidation.');
				}
				if (controller.signal.aborted) return;
				activeContactScopeSignature = scopeSignature;
				loadedContactScopeSignature = scopeSignature;
				contactIndexStatus = 'ready';
				contactIndexError = null;
				return;
			}

			if (!response.ok) {
				const message = await response.text().catch(() => '');
				throw new Error(message || 'Could not load talent contact index.');
			}

			const payload = (await response.json()) as {
				scope?: { signature?: unknown };
				items?: Array<{ talentId: unknown; email: unknown }>;
			};
			const responseScopeSignature =
				typeof payload.scope?.signature === 'string' && payload.scope.signature.trim().length > 0
					? payload.scope.signature.trim()
					: scopeSignature;
			const contactsByTalentId = toContactByTalentId(payload.items ?? []);

			contactIndexByScope = {
				...contactIndexByScope,
				[responseScopeSignature]: contactsByTalentId
			};
			contactEtagByScope = {
				...contactEtagByScope,
				[responseScopeSignature]: response.headers.get('etag')
			};

			if (controller.signal.aborted) return;
			activeContactScopeSignature = responseScopeSignature;
			loadedContactScopeSignature = responseScopeSignature;
			contactIndexStatus = 'ready';
			contactIndexError = null;
		} catch (error) {
			if (controller.signal.aborted) return;
			contactIndexStatus = 'error';
			loadedContactScopeSignature = null;
			contactIndexError =
				error instanceof Error ? error.message : 'Could not load talent contacts.';
		} finally {
			if (contactIndexAbortController === controller) {
				contactIndexAbortController = null;
			}
		}
	};

	$effect(() => {
		if (!needsContactIndex) {
			if (contactIndexStatus === 'loading') {
				contactIndexAbortController?.abort();
				contactIndexAbortController = null;
			}
			contactIndexStatus = 'idle';
			contactIndexError = null;
			return;
		}

		void loadContactIndexForScope(contactScopeSignature, contactScopeOrgIds);
	});

	onDestroy(() => {
		contactIndexAbortController?.abort();
		contactIndexAbortController = null;
	});

	const getTalentName = (talent: (typeof allTalents)[number]) =>
		[talent.first_name, talent.last_name].filter(Boolean).join(' ') || 'Unnamed Talent';
	const getTalentEmail = (talentId: string) => activeContactByTalentId[talentId] ?? null;
	const getCardAvatarSrc = (url: string | null | undefined) =>
		transformSupabasePublicUrl(url, supabaseImagePresets.avatarCard);
	const getCardAvatarSrcSet = (url: string | null | undefined) =>
		transformSupabasePublicUrlSrcSet(url, supabaseImageSrcsetWidths.avatarCard, {
			height: supabaseImagePresets.avatarCard.height,
			quality: supabaseImagePresets.avatarCard.quality,
			resize: supabaseImagePresets.avatarCard.resize
		});
	const getCardAvatarFallbackSrc = (url: string | null | undefined) => getOriginalImageUrl(url);

	type TalentsListRow = {
		id: string;
		name: string;
		avatar_url: string | null;
		email: string | null;
		organisation_name: string | null;
		organisation_logo_url: string | null;
		can_edit: boolean;
		source: LoadTalent;
	};

	const talentsListHeadings: SuperListHead<TalentsListRow>[] = [
		{ heading: null, width: 6 },
		{ heading: 'Name', sortable: 'name', filterable: 'name', width: 34 },
		{ heading: 'Email', sortable: 'email', filterable: 'email', width: 28 },
		{ heading: 'Organisation', sortable: 'organisation_name', width: 24 },
		{ heading: null, width: 8 }
	];

	const toTalentListRows = (items: typeof talents): TalentsListRow[] =>
		items.map((t) => ({
			id: t.id,
			name: getTalentName(t),
			avatar_url: t.avatar_url ?? null,
			email: getTalentEmail(t.id),
			organisation_name: t.organisation_name ?? null,
			organisation_logo_url: t.organisation_logo_url ?? null,
			can_edit: t.can_edit,
			source: t
		}));

	const talentListHandler = $derived.by(() => {
		const handler = new ListHandler<TalentsListRow>(talentsListHeadings, toTalentListRows(talents));
		handler.query = searchQuery;
		return handler;
	});

	const searchFilteredTalents = $derived.by(() => {
		if (!searchQuery.trim()) return talents;
		const q = searchQuery.trim().toLowerCase();
		return talents.filter((t) => {
			const name = getTalentName(t).toLowerCase();
			const title = (t.title ?? '').toLowerCase();
			const email = (getTalentEmail(t.id) ?? '').toLowerCase();
			return name.includes(q) || title.includes(q) || email.includes(q);
		});
	});
	const selectedTalent = $derived(
		selectedTalentId ? (allTalents.find((talent) => talent.id === selectedTalentId) ?? null) : null
	);

	const setTalentsViewMode = (mode: ViewMode) => {
		void userSettingsStore.setViewMode('talents', mode);
	};

	function toggleFilters() {
		filtersOpen = !filtersOpen;
	}

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

	const canEditTalent = (talent: LoadTalent | null | undefined) =>
		Boolean(canManageTalents && talent?.id && talent.can_edit);

	const openCreateDrawer = () => {
		feedback = null;
		selectedTalentId = null;
		isCreateDrawerOpen = true;
	};

	const openEditDrawer = (talent: LoadTalent) => {
		if (!canEditTalent(talent)) return;
		feedback = null;
		selectedTalentId = talent.id;
		isEditDrawerOpen = true;
	};

	const handleDrawerSuccess = async (
		event: CustomEvent<{ message: string; action: 'create' | 'update' | 'delete' }>
	) => {
		feedback = {
			type: 'success',
			message: event.detail.message
		};
		isCreateDrawerOpen = false;
		isEditDrawerOpen = false;
		selectedTalentId = null;
		await invalidateAll();
	};

	const handleDrawerError = (
		event: CustomEvent<{ message: string; action: 'create' | 'update' | 'delete' }>
	) => {
		feedback = {
			type: 'error',
			message: event.detail.message
		};
	};

	const getTalentWorkspaceHref = (talentId: string) =>
		`${resolve('/resumes/[personId]', { personId: talentId })}?from=talents`;

	const openTalentWorkspace = async (talentId: string) => {
		await goto(getTalentWorkspaceHref(talentId));
	};

	$effect(() => {
		if (!isEditDrawerOpen && selectedTalentId) {
			selectedTalentId = null;
		}
	});
</script>

<div class="relative space-y-6">
	<div class="absolute right-0 top-0 z-10 flex items-center gap-2">
		{#if canManageTalents}
			<div class="bg-primary inline-flex items-center rounded-sm p-1">
				<Button type="button" variant="primary" size="sm" class="px-3" onclick={openCreateDrawer}>
					Create talent
				</Button>
			</div>
		{/if}
		<div class="border-border bg-card inline-flex rounded-sm border p-1">
			<button
				type="button"
				onclick={toggleFilters}
				class="rounded-xs relative inline-flex cursor-pointer items-center justify-center p-1.5 transition-colors {filtersOpen
					? 'border-primary bg-primary hover:bg-primary/90 text-white'
					: 'text-primary hover:bg-primary/20 border-transparent bg-transparent'}"
				aria-label="Toggle filters"
			>
				<SlidersHorizontal size={16} />
			</button>
		</div>
		<div class="border-border bg-card inline-flex rounded-sm border p-1">
			<Button
				type="button"
				variant="outline"
				size="sm"
				onclick={() => setTalentsViewMode('grid')}
				class={`px-2 ${
					talentsViewMode === 'grid'
						? 'border-primary bg-primary hover:bg-primary/90 text-white hover:text-white'
						: 'border-transparent bg-transparent'
				}`}
			>
				<LayoutGrid size={16} />
			</Button>
			<Button
				type="button"
				variant="outline"
				size="sm"
				onclick={() => setTalentsViewMode('list')}
				class={`px-2 ${
					talentsViewMode === 'list'
						? 'border-primary bg-primary hover:bg-primary/90 text-white hover:text-white'
						: 'border-transparent bg-transparent'
				}`}
			>
				<List size={16} />
			</Button>
		</div>
	</div>

	<header>
		<h1 class="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">Talents</h1>
		<p class="text-muted-fg mt-3 text-lg">Browse all talents and open their resume workspace.</p>
	</header>

	{#if filtersOpen}
		<div
			transition:slide={{ duration: 300, easing: cubicOut }}
			class="border-border bg-card rounded-none border p-6"
		>
			<div class="space-y-6">
				{#if organisationFilterOptions.length > 0}
					<div>
						<h2 class="text-muted-fg mb-3 text-xs font-semibold uppercase tracking-wide">
							Organisation
						</h2>
						<div class="w-64">
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
					</div>
				{/if}
			</div>
		</div>
	{/if}

	{#if feedback}
		<Alert variant={feedback.type === 'error' ? 'destructive' : 'success'} size="sm">
			<p class="text-foreground text-sm font-medium">{feedback.message}</p>
		</Alert>
	{/if}
	{#if needsContactIndex && contactIndexLoadingForScope}
		<p class="text-muted-fg text-sm">Loading contact emails...</p>
	{:else if contactIndexError && needsContactIndex}
		<Alert variant="destructive" size="sm">
			<p class="text-foreground text-sm font-medium">{contactIndexError}</p>
		</Alert>
	{/if}

	{#if canManageTalents}
		<TalentFormDrawer
			bind:open={isCreateDrawerOpen}
			mode="create"
			on:success={handleDrawerSuccess}
			on:error={handleDrawerError}
		/>
		<TalentFormDrawer
			bind:open={isEditDrawerOpen}
			mode="edit"
			talent={selectedTalent}
			on:success={handleDrawerSuccess}
			on:error={handleDrawerError}
		/>
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
		<div class="mb-2">
			<Input icon={Search} bind:value={searchQuery} placeholder="Search..." class="pl-9" />
		</div>
		<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{#each searchFilteredTalents as talent (talent.id)}
				<div class="relative h-full">
					<a href={getTalentWorkspaceHref(talent.id)} class="block h-full">
						<Card
							class="flex h-full flex-col overflow-hidden rounded-none transition-all hover:shadow-md"
						>
							<div class="bg-muted hidden aspect-square w-full overflow-hidden sm:block">
								{#if talent.avatar_url}
									<img
										src={getCardAvatarSrc(talent.avatar_url)}
										srcset={getCardAvatarSrcSet(talent.avatar_url)}
										sizes={supabaseImageSizes.avatarCard}
										alt={getTalentName(talent)}
										class="h-full w-full object-cover object-center transition-transform duration-500 hover:scale-105"
										loading="lazy"
										decoding="async"
										onerror={(event) =>
											applyImageFallbackOnce(event, getCardAvatarFallbackSrc(talent.avatar_url))}
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
								{#if getTalentEmail(talent.id)}
									<p class="text-muted-fg mt-2 hidden text-xs sm:block">
										{getTalentEmail(talent.id)}
									</p>
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
					{#if canEditTalent(talent)}
						<div class="absolute right-3 top-3">
							<Button
								variant="outline"
								size="sm"
								type="button"
								aria-label={`Edit ${getTalentName(talent)}`}
								onclick={(event) => {
									event.preventDefault();
									event.stopPropagation();
									openEditDrawer(talent);
								}}
								class="bg-background/95 gap-0 sm:gap-1.5"
							>
								<Pencil size={14} />
								<span class="sr-only sm:not-sr-only">Edit</span>
							</Button>
						</div>
					{/if}
				</div>
			{/each}
		</div>
		{#if searchQuery && searchFilteredTalents.length === 0}
			<div class="text-muted-fg flex justify-center p-6 text-sm font-medium">
				No results for: {searchQuery}
			</div>
		{/if}
	{:else}
		<SuperList instance={talentListHandler} emptyMessage="No talents found">
			{#each talentListHandler.data as row (row.id)}
				<Row.Root
					onclick={() => {
						void openTalentWorkspace(row.id);
					}}
					class="cursor-pointer"
				>
					<Cell.Value width={6} class="hidden sm:block">
						<Cell.Avatar src={row.avatar_url} alt={row.name} size={36} />
					</Cell.Value>
					<Cell.Value width={34} class="mobile-fill-cell">
						<span class="text-foreground truncate text-sm font-semibold">{row.name}</span>
					</Cell.Value>
					<Cell.Value width={28} class="hidden sm:block">
						{#if row.email}
							<span class="text-muted-fg truncate text-xs">{row.email}</span>
						{/if}
					</Cell.Value>
					<Cell.Value width={24} class="mobile-logo-cell">
						{#if row.organisation_logo_url}
							<img
								src={row.organisation_logo_url}
								alt={row.organisation_name ?? 'Organisation'}
								class="h-5 w-auto object-contain"
							/>
						{:else if row.organisation_name}
							<span class="text-muted-fg text-xs font-medium">{row.organisation_name}</span>
						{/if}
					</Cell.Value>
					<Cell.Value width={8} class="mobile-action-cell">
						{#if canEditTalent(row.source)}
							<div class="flex justify-end gap-2 pl-2">
								<Button
									variant="outline"
									size="sm"
									type="button"
									aria-label={`Edit ${row.name}`}
									onclick={(event) => {
										event.stopPropagation();
										openEditDrawer(row.source);
									}}
									class="gap-0 sm:gap-1.5"
								>
									<Pencil size={14} />
									<span class="sr-only sm:not-sr-only">Edit</span>
								</Button>
							</div>
						{/if}
					</Cell.Value>
				</Row.Root>
			{/each}
		</SuperList>
	{/if}
</div>

<style>
	@media (max-width: 639px) {
		:global(.mobile-fill-cell) {
			width: auto !important;
			flex: 1 1 0% !important;
		}

		:global(.mobile-logo-cell) {
			width: auto !important;
			flex: 0 0 auto !important;
		}

		:global(.mobile-action-cell) {
			width: auto !important;
			flex: 0 0 auto !important;
		}
	}
</style>
