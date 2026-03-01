<script lang="ts">
	import { Alert, Button } from '@pixelcode_/blocks/components';
	import { SuperList, ListHandler, Cell, Row } from '$lib/components/super-list';
	import type { SuperListHead } from '$lib/components/super-list';
	import OrganisationCreateDrawer from '$lib/components/admin/OrganisationCreateDrawer.svelte';
	import OrganisationDetailsDrawer from '$lib/components/admin/OrganisationDetailsDrawer.svelte';
	import OrganisationBrandingDrawer from '$lib/components/admin/OrganisationBrandingDrawer.svelte';
	import OrganisationMembershipDrawer from '$lib/components/admin/OrganisationMembershipDrawer.svelte';
	import { Globe, Settings, Palette, Users } from 'lucide-svelte';

	let { data, form } = $props();

	type Organisation = {
		id: string;
		name: string;
		slug: string;
		homepage_url: string | null;
		brand_settings: Record<string, unknown> | null;
		created_at: string | null;
		updated_at: string | null;
	};

	type UserRow = {
		user_id: string;
		first_name: string;
		last_name: string;
		email: string | null;
		roles: string[];
	};

	type TalentRow = {
		id: string;
		user_id: string | null;
		first_name: string | null;
		last_name: string | null;
	};

	const organisations = $derived(data.organisations ?? []);
	const templates = $derived(data.templates ?? []);
	const membershipsUsers = $derived(data.membershipsUsers ?? []);
	const membershipsTalents = $derived(data.membershipsTalents ?? []);
	const accessGrants = $derived(data.accessGrants ?? []);
	const users = $derived((data.users ?? []) as UserRow[]);
	const talents = $derived((data.talents ?? []) as TalentRow[]);

	const templateByOrgId = $derived(
		Object.fromEntries(
			templates.map((template) => [template.organisation_id, template] as const)
		) as Record<string, (typeof templates)[number]>
	);

	const userMembershipsByOrg = $derived.by(() => {
		const map: Record<string, Array<{ user_id: string }>> = {};
		for (const row of membershipsUsers as Array<{ organisation_id: string; user_id: string }>) {
			const list = map[row.organisation_id] ?? [];
			list.push({ user_id: row.user_id });
			map[row.organisation_id] = list;
		}
		return map;
	});

	const talentMembershipsByOrg = $derived.by(() => {
		const map: Record<string, Array<{ talent_id: string }>> = {};
		for (const row of membershipsTalents as Array<{ organisation_id: string; talent_id: string }>) {
			const list = map[row.organisation_id] ?? [];
			list.push({ talent_id: row.talent_id });
			map[row.organisation_id] = list;
		}
		return map;
	});

	const grantsByOrg = $derived.by(() => {
		const map: Record<
			string,
			Array<{
				id: string;
				grantee_user_id: string;
				created_at: string | null;
				created_by_user_id: string | null;
			}>
		> = {};
		for (const row of accessGrants as Array<{
			id: string;
			organisation_id: string;
			grantee_user_id: string;
			created_at: string | null;
			created_by_user_id: string | null;
		}>) {
			const list = map[row.organisation_id] ?? [];
			list.push({
				id: row.id,
				grantee_user_id: row.grantee_user_id,
				created_at: row.created_at ?? null,
				created_by_user_id: row.created_by_user_id ?? null
			});
			map[row.organisation_id] = list;
		}
		return map;
	});

	const eligibleGrantUsers = $derived(
		users.filter((user) => user.roles.includes('broker') || user.roles.includes('employer'))
	);

	// Users/talents that already have any home organisation
	const usersWithHomeOrg = $derived(
		new Set((membershipsUsers as Array<{ user_id: string }>).map((m) => m.user_id))
	);
	const talentsWithHomeOrg = $derived(
		new Set((membershipsTalents as Array<{ talent_id: string }>).map((m) => m.talent_id))
	);

	// Map user_id to their home organisation name
	const orgById = $derived(
		Object.fromEntries(organisations.map((org) => [org.id, org] as const)) as Record<
			string,
			(typeof organisations)[number]
		>
	);
	const userHomeOrgNames = $derived.by(() => {
		const map = new Map<string, string>();
		for (const m of membershipsUsers as Array<{ organisation_id: string; user_id: string }>) {
			const org = orgById[m.organisation_id];
			if (org) {
				map.set(m.user_id, org.name);
			}
		}
		return map;
	});

	const actionMessage = $derived(typeof form?.message === 'string' ? form.message : null);
	const actionFailed = $derived(form?.ok === false);

	// Drawer states
	let isCreateDrawerOpen = $state(false);
	let isDetailsDrawerOpen = $state(false);
	let isBrandingDrawerOpen = $state(false);
	let isMembershipDrawerOpen = $state(false);
	let selectedOrganisation = $state<Organisation | undefined>(undefined);

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
	};

	const openMembershipDrawer = (organisation: Organisation) => {
		selectedOrganisation = organisation;
		isMembershipDrawerOpen = true;
	};

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

<div class="flex items-center justify-between">
	<div>
		<h1 class="text-foreground text-2xl font-semibold">Organisations</h1>
		<p class="text-muted-fg text-sm">
			Manage organisation templates, home memberships, and cross-organisation access grants.
		</p>
	</div>
	<Button variant="primary" size="md" type="button" onclick={openCreateDrawer}>
		Create organisation
	</Button>
</div>

{#if actionMessage}
	<Alert class="mt-4" variant={actionFailed ? 'destructive' : 'success'} size="sm">
		<p class="text-foreground text-sm font-medium">{actionMessage}</p>
	</Alert>
{/if}

{#if organisations.length === 0}
	<div class="mt-6">
		<p class="text-muted-fg text-sm font-medium">
			No organisations yet. Create your first organisation to get started.
		</p>
	</div>
{:else}
	<div class="mt-6">
		<SuperList instance={orgListHandler} emptyMessage="No organisations found">
			{#each orgListHandler.data as row (row.id)}
				<Row.Root>
					<Cell.Value width={30}>
						<span class="text-foreground text-sm font-semibold">{row.displayName}</span>
					</Cell.Value>
					<Cell.Value width={16}>
						<span class="text-muted-fg font-mono text-sm">{row.slug}</span>
					</Cell.Value>
					<Cell.Value width={22}>
						{#if row.homepage_url}
							<a
								href={row.homepage_url}
								target="_blank"
								rel="noopener noreferrer"
								class="text-primary hover:text-primary/80 inline-flex items-center gap-1 text-sm hover:underline"
							>
								<Globe size={14} />
								<span class="max-w-[180px] truncate">{row.homepage_url}</span>
							</a>
						{:else}
							<span class="text-muted-fg text-xs">Not set</span>
						{/if}
					</Cell.Value>
					<Cell.Value width={32}>
						<div class="flex justify-end gap-2">
							<Button
								variant="outline"
								size="sm"
								type="button"
								onclick={() => openDetailsDrawer(row.source)}
								class="gap-1.5"
							>
								<Settings size={14} />
								Details
							</Button>
							<Button
								variant="outline"
								size="sm"
								type="button"
								onclick={() => openBrandingDrawer(row.source)}
								class="gap-1.5"
							>
								<Palette size={14} />
								Branding
							</Button>
							<Button
								variant="outline"
								size="sm"
								type="button"
								onclick={() => openMembershipDrawer(row.source)}
								class="gap-1.5"
							>
								<Users size={14} />
								Access
							</Button>
						</div>
					</Cell.Value>
				</Row.Root>
			{/each}
		</SuperList>
	</div>
{/if}

<OrganisationCreateDrawer bind:open={isCreateDrawerOpen} />

<OrganisationDetailsDrawer bind:open={isDetailsDrawerOpen} organisation={selectedOrganisation} />

<OrganisationBrandingDrawer
	bind:open={isBrandingDrawerOpen}
	organisation={selectedOrganisation}
	template={selectedOrganisation ? templateByOrgId[selectedOrganisation.id] : undefined}
/>

<OrganisationMembershipDrawer
	bind:open={isMembershipDrawerOpen}
	organisation={selectedOrganisation}
	{users}
	{talents}
	userMemberships={selectedOrganisation
		? (userMembershipsByOrg[selectedOrganisation.id] ?? [])
		: []}
	talentMemberships={selectedOrganisation
		? (talentMembershipsByOrg[selectedOrganisation.id] ?? [])
		: []}
	accessGrants={selectedOrganisation ? (grantsByOrg[selectedOrganisation.id] ?? []) : []}
	{eligibleGrantUsers}
	{usersWithHomeOrg}
	{talentsWithHomeOrg}
	{userHomeOrgNames}
/>
