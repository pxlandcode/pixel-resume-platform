<script lang="ts">
	import { Alert, Button, Toaster, toast } from '@pixelcode_/blocks/components';
	import { SuperList, ListHandler, Cell, Row } from '$lib/components/super-list';
	import type { SuperListHead } from '$lib/components/super-list';
	import OrganisationCreateDrawer from '$lib/components/admin/OrganisationCreateDrawer.svelte';
	import OrganisationDetailsDrawer from '$lib/components/admin/OrganisationDetailsDrawer.svelte';
	import OrganisationBrandingDrawer from '$lib/components/admin/OrganisationBrandingDrawer.svelte';
	import OrganisationMembershipDrawer from '$lib/components/admin/OrganisationMembershipDrawer.svelte';
	import { Globe, Settings, Palette, Users } from 'lucide-svelte';

	let { data, form } = $props();

	type Role = 'admin' | 'organisation_admin' | 'broker' | 'talent' | 'employer';
	type Organisation = {
		id: string;
		name: string;
		slug: string;
		homepage_url: string | null;
		email_domains: string[];
		created_at: string | null;
		updated_at: string | null;
	};
	type OrganisationContext = {
		organisation: {
			id: string;
			name: string;
			slug: string;
			homepage_url: string | null;
			brand_settings: Record<string, unknown> | null;
		};
		template: {
			id: string;
			organisation_id: string;
			template_key: string;
			template_json: Record<string, unknown> | null;
			template_version: number;
			main_logotype_url: string | null;
			accent_logo_url: string | null;
			end_logo_url: string | null;
		} | null;
		membershipsUsers: Array<{ user_id: string }>;
		membershipsTalents: Array<{ talent_id: string }>;
		users: Array<{
			user_id: string;
			first_name: string;
			last_name: string;
			email: string | null;
			roles: Role[];
		}>;
		talents: Array<{
			id: string;
			user_id: string | null;
			first_name: string;
			last_name: string;
		}>;
		usersWithHomeOrgIds: string[];
		talentsWithHomeOrgIds: string[];
		generatedAt: string;
	};

	const organisations = $derived((data.organisations ?? []) as Organisation[]);
	const actionMessage = $derived(typeof form?.message === 'string' ? form.message : null);
	const actionFailed = $derived(form?.ok === false);

	const showToast = (kind: 'success' | 'error', message: string) => {
		if (kind === 'error' && typeof toast.error === 'function') {
			toast.error(message);
			return;
		}
		if (kind === 'success' && typeof toast.success === 'function') {
			toast.success(message);
			return;
		}
		toast(message);
	};

	let isCreateDrawerOpen = $state(false);
	let isDetailsDrawerOpen = $state(false);
	let isBrandingDrawerOpen = $state(false);
	let isMembershipDrawerOpen = $state(false);
	let selectedOrganisation = $state<Organisation | undefined>(undefined);
	let organisationContextById = $state<Record<string, OrganisationContext>>({});
	let contextStatusByOrgId = $state<Record<string, 'idle' | 'loading' | 'ready' | 'error'>>({});
	let contextErrorByOrgId = $state<Record<string, string | null>>({});
	let contextEtagByOrgId = $state<Record<string, string | null>>({});
	let contextAbortController: AbortController | null = null;
	let lastActionToastKey = $state<string | null>(null);

	const selectedOrganisationContext = $derived(
		selectedOrganisation ? (organisationContextById[selectedOrganisation.id] ?? null) : null
	);
	const selectedContextStatus = $derived(
		selectedOrganisation ? (contextStatusByOrgId[selectedOrganisation.id] ?? 'idle') : 'idle'
	);
	const selectedContextError = $derived(
		selectedOrganisation ? (contextErrorByOrgId[selectedOrganisation.id] ?? null) : null
	);

	const loadOrganisationContext = async (organisationId: string) => {
		if (!organisationId) return;
		if (contextStatusByOrgId[organisationId] === 'loading') return;
		if (
			contextStatusByOrgId[organisationId] === 'ready' &&
			organisationContextById[organisationId]
		) {
			return;
		}

		contextAbortController?.abort();
		const controller = new AbortController();
		contextAbortController = controller;
		contextStatusByOrgId = { ...contextStatusByOrgId, [organisationId]: 'loading' };
		contextErrorByOrgId = { ...contextErrorByOrgId, [organisationId]: null };

		try {
			const endpoint = `/internal/api/organisations/context?org=${encodeURIComponent(organisationId)}`;
			const response = await fetch(endpoint, {
				method: 'GET',
				credentials: 'include',
				signal: controller.signal,
				headers: contextEtagByOrgId[organisationId]
					? { 'If-None-Match': contextEtagByOrgId[organisationId] }
					: undefined
			});

			if (response.status === 304) {
				if (!organisationContextById[organisationId]) {
					throw new Error('Organisation context cache was empty after revalidation.');
				}
				if (controller.signal.aborted) return;
				contextStatusByOrgId = { ...contextStatusByOrgId, [organisationId]: 'ready' };
				contextErrorByOrgId = { ...contextErrorByOrgId, [organisationId]: null };
				return;
			}

			if (!response.ok) {
				const message = await response.text().catch(() => '');
				throw new Error(message || 'Could not load organisation context.');
			}

			const payload = (await response.json()) as OrganisationContext;
			if (controller.signal.aborted) return;

			organisationContextById = { ...organisationContextById, [organisationId]: payload };
			contextEtagByOrgId = {
				...contextEtagByOrgId,
				[organisationId]: response.headers.get('etag')
			};
			contextStatusByOrgId = { ...contextStatusByOrgId, [organisationId]: 'ready' };
			contextErrorByOrgId = { ...contextErrorByOrgId, [organisationId]: null };
		} catch (error) {
			if (controller.signal.aborted) return;
			contextStatusByOrgId = { ...contextStatusByOrgId, [organisationId]: 'error' };
			contextErrorByOrgId = {
				...contextErrorByOrgId,
				[organisationId]:
					error instanceof Error ? error.message : 'Could not load organisation context.'
			};
		} finally {
			if (contextAbortController === controller) {
				contextAbortController = null;
			}
		}
	};

	const openCreateDrawer = () => {
		isCreateDrawerOpen = true;
	};

	const openDetailsDrawer = (organisation: Organisation) => {
		selectedOrganisation = organisation;
		isDetailsDrawerOpen = true;
	};

	const openBrandingDrawer = (organisation: Organisation) => {
		selectedOrganisation = organisation;
		isBrandingDrawerOpen = true;
		void loadOrganisationContext(organisation.id);
	};

	const openMembershipDrawer = (organisation: Organisation) => {
		selectedOrganisation = organisation;
		isMembershipDrawerOpen = true;
		void loadOrganisationContext(organisation.id);
	};

	const membershipUsers = $derived(selectedOrganisationContext?.users ?? []);
	const membershipTalents = $derived(selectedOrganisationContext?.talents ?? []);
	const membershipUserRows = $derived(selectedOrganisationContext?.membershipsUsers ?? []);
	const membershipTalentRows = $derived(selectedOrganisationContext?.membershipsTalents ?? []);
	const usersWithHomeOrg = $derived(
		new Set(selectedOrganisationContext?.usersWithHomeOrgIds ?? [])
	);
	const talentsWithHomeOrg = $derived(
		new Set(selectedOrganisationContext?.talentsWithHomeOrgIds ?? [])
	);
	const brandingOrganisation = $derived.by(() => {
		if (!selectedOrganisation) return undefined;
		return {
			id: selectedOrganisation.id,
			name: selectedOrganisation.name,
			brand_settings: selectedOrganisationContext?.organisation.brand_settings ?? null
		};
	});
	const brandingTemplate = $derived(selectedOrganisationContext?.template ?? undefined);

	type OrgListRow = {
		id: string;
		displayName: string;
		slug: string;
		homepage_url: string | null;
		source: Organisation;
	};

	const orgListHeadings: SuperListHead<OrgListRow>[] = [
		{ heading: 'Organisation', sortable: 'displayName', filterable: 'displayName', width: 30 },
		{ heading: 'Slug', sortable: 'slug', width: 16 },
		{ heading: 'Homepage', width: 22 },
		{ heading: null, width: 32 }
	];

	const toOrgListRows = (items: Organisation[]): OrgListRow[] =>
		items.map((org) => ({
			id: org.id,
			displayName: org.name || 'Unnamed Organisation',
			slug: org.slug,
			homepage_url: org.homepage_url,
			source: org
		}));

	const orgListHandler = $derived(
		new ListHandler<OrgListRow>(orgListHeadings, toOrgListRows(organisations))
	);

	$effect(() => {
		if (!actionMessage) return;
		const key = `${form?.type ?? 'unknown'}:${form?.ok === false ? 'error' : 'success'}:${actionMessage}`;
		if (lastActionToastKey === key) return;
		lastActionToastKey = key;
		showToast(actionFailed ? 'error' : 'success', actionMessage);
	});
</script>

<div class="relative space-y-6">
	<Toaster />

	<div class="absolute right-0 top-0 z-10 flex items-center gap-2">
		<div class="bg-primary inline-flex items-center rounded-sm p-1">
			<Button variant="primary" size="sm" type="button" class="px-3" onclick={openCreateDrawer}>
				Create organisation
			</Button>
		</div>
	</div>

	<header>
		<h1 class="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">Organisations</h1>
		<p class="text-muted-fg mt-3 text-lg">
			Manage organisation templates, branding, and home memberships.
		</p>
	</header>

	{#if selectedOrganisation && (isBrandingDrawerOpen || isMembershipDrawerOpen)}
		{#if selectedContextStatus === 'loading'}
			<p class="text-muted-fg text-sm">Loading organisation details...</p>
		{:else if selectedContextError}
			<Alert variant="destructive" size="sm">
				<p class="text-foreground text-sm font-medium">{selectedContextError}</p>
			</Alert>
		{/if}
	{/if}

	{#if organisations.length === 0}
		<div class="border-border bg-card rounded-sm border p-6">
			<p class="text-muted-fg text-sm font-medium">
				No organisations yet. Create your first organisation to get started.
			</p>
		</div>
	{:else}
		<SuperList instance={orgListHandler} emptyMessage="No organisations found">
			{#each orgListHandler.data as row (row.id)}
				<Row.Root>
					<Cell.Value width={30} class="mobile-fill-cell">
						<span class="text-foreground text-sm font-semibold">{row.displayName}</span>
					</Cell.Value>
					<Cell.Value width={16} class="hidden sm:block">
						<span class="text-muted-fg font-mono text-sm">{row.slug}</span>
					</Cell.Value>
					<Cell.Value width={22} class="hidden sm:block">
						{#if row.homepage_url}
							<button
								type="button"
								onclick={() => window.open(row.homepage_url ?? '', '_blank', 'noopener,noreferrer')}
								class="text-primary hover:text-primary/80 inline-flex items-center gap-1 text-sm hover:underline"
							>
								<Globe size={14} />
								<span class="max-w-[180px] truncate">{row.homepage_url}</span>
							</button>
						{:else}
							<span class="text-muted-fg text-xs">Not set</span>
						{/if}
					</Cell.Value>
					<Cell.Value width={32} class="mobile-action-cell">
						<div class="flex justify-end gap-2">
							<Button
								variant="outline"
								size="sm"
								type="button"
								aria-label={`Open details for ${row.displayName}`}
								onclick={() => openDetailsDrawer(row.source)}
								class="gap-0 sm:gap-1.5"
							>
								<Settings size={14} />
								<span class="sr-only sm:not-sr-only">Details</span>
							</Button>
							<Button
								variant="outline"
								size="sm"
								type="button"
								aria-label={`Open branding for ${row.displayName}`}
								onclick={() => openBrandingDrawer(row.source)}
								class="gap-0 sm:gap-1.5"
							>
								<Palette size={14} />
								<span class="sr-only sm:not-sr-only">Branding</span>
							</Button>
							<Button
								variant="outline"
								size="sm"
								type="button"
								aria-label={`Open membership for ${row.displayName}`}
								onclick={() => openMembershipDrawer(row.source)}
								class="gap-0 sm:gap-1.5"
							>
								<Users size={14} />
								<span class="sr-only sm:not-sr-only">Membership</span>
							</Button>
						</div>
					</Cell.Value>
				</Row.Root>
			{/each}
		</SuperList>
	{/if}
</div>

<OrganisationCreateDrawer bind:open={isCreateDrawerOpen} />

<OrganisationDetailsDrawer bind:open={isDetailsDrawerOpen} organisation={selectedOrganisation} />

<OrganisationBrandingDrawer
	bind:open={isBrandingDrawerOpen}
	organisation={brandingOrganisation}
	template={brandingTemplate}
/>

<OrganisationMembershipDrawer
	bind:open={isMembershipDrawerOpen}
	organisation={selectedOrganisation}
	users={membershipUsers}
	talents={membershipTalents}
	userMemberships={membershipUserRows}
	talentMemberships={membershipTalentRows}
	{usersWithHomeOrg}
	{talentsWithHomeOrg}
/>

<style>
	@media (max-width: 639px) {
		:global(.mobile-fill-cell) {
			width: auto !important;
			flex: 1 1 0% !important;
		}

		:global(.mobile-action-cell) {
			width: auto !important;
			flex: 0 0 auto !important;
		}
	}
</style>
