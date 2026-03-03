<script lang="ts">
	import { Alert, Button } from '@pixelcode_/blocks/components';
	import { SuperList, ListHandler, Cell, Row } from '$lib/components/super-list';
	import type { SuperListHead } from '$lib/components/super-list';
	import OrganisationCreateDrawer from '$lib/components/admin/OrganisationCreateDrawer.svelte';
	import OrganisationDetailsDrawer from '$lib/components/admin/OrganisationDetailsDrawer.svelte';
	import OrganisationBrandingDrawer from '$lib/components/admin/OrganisationBrandingDrawer.svelte';
	import OrganisationMembershipDrawer from '$lib/components/admin/OrganisationMembershipDrawer.svelte';
	import { Globe, Settings, Palette, Users } from 'lucide-svelte';
	import { SvelteMap } from 'svelte/reactivity';

	let { data, form } = $props();

	type Role = 'admin' | 'broker' | 'talent' | 'employer';
	type Organisation = {
		id: string;
		name: string;
		slug: string;
		homepage_url: string | null;
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
		accessGrants: Array<{
			id: string;
			grantee_user_id: string;
			created_at: string | null;
			created_by_user_id: string | null;
		}>;
		dataSharingPermissions: Array<{
			id: string;
			source_organisation_id: string;
			target_organisation_id: string;
			sharing_scope: 'view' | 'export_org_template' | 'export_broker_template';
			approved_by_admin_id: string;
			approved_at: string | null;
		}>;
		organisations: Array<{ id: string; name: string }>;
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
		userHomeOrgNames: Record<string, string>;
		generatedAt: string;
	};

	const organisations = $derived((data.organisations ?? []) as Organisation[]);
	const actionMessage = $derived(typeof form?.message === 'string' ? form.message : null);
	const actionFailed = $derived(form?.ok === false);

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

	const membershipOrganisations = $derived(
		selectedOrganisationContext?.organisations ??
			organisations.map((org) => ({ id: org.id, name: org.name }))
	);
	const membershipUsers = $derived(selectedOrganisationContext?.users ?? []);
	const membershipTalents = $derived(selectedOrganisationContext?.talents ?? []);
	const membershipUserRows = $derived(selectedOrganisationContext?.membershipsUsers ?? []);
	const membershipTalentRows = $derived(selectedOrganisationContext?.membershipsTalents ?? []);
	const membershipAccessGrants = $derived(selectedOrganisationContext?.accessGrants ?? []);
	const membershipSharingPermissions = $derived(
		selectedOrganisationContext?.dataSharingPermissions ?? []
	);
	const eligibleGrantUsers = $derived(
		membershipUsers.filter(
			(user) => user.roles.includes('broker') || user.roles.includes('employer')
		)
	);
	const usersWithHomeOrg = $derived(
		new Set(selectedOrganisationContext?.usersWithHomeOrgIds ?? [])
	);
	const talentsWithHomeOrg = $derived(
		new Set(selectedOrganisationContext?.talentsWithHomeOrgIds ?? [])
	);
	const userHomeOrgNames = $derived.by(() => {
		const map = new SvelteMap<string, string>();
		for (const [userId, orgName] of Object.entries(
			selectedOrganisationContext?.userHomeOrgNames ?? {}
		)) {
			map.set(userId, orgName);
		}
		return map;
	});
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
</script>

<div class="relative space-y-6">
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
			Manage organisation templates, home memberships, and cross-organisation access grants.
		</p>
	</header>

	{#if actionMessage}
		<Alert variant={actionFailed ? 'destructive' : 'success'} size="sm">
			<p class="text-foreground text-sm font-medium">{actionMessage}</p>
		</Alert>
	{/if}
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
								aria-label={`Open access for ${row.displayName}`}
								onclick={() => openMembershipDrawer(row.source)}
								class="gap-0 sm:gap-1.5"
							>
								<Users size={14} />
								<span class="sr-only sm:not-sr-only">Access</span>
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
	organisations={membershipOrganisations}
	users={membershipUsers}
	talents={membershipTalents}
	userMemberships={membershipUserRows}
	talentMemberships={membershipTalentRows}
	accessGrants={membershipAccessGrants}
	dataSharingPermissions={membershipSharingPermissions}
	{eligibleGrantUsers}
	{usersWithHomeOrg}
	{talentsWithHomeOrg}
	{userHomeOrgNames}
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
