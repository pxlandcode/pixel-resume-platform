<script lang="ts">
	import { Alert, Button } from '@pixelcode_/blocks/components';
	import OrganisationTable from '$lib/components/admin/OrganisationTable.svelte';
	import OrganisationCreateDrawer from '$lib/components/admin/OrganisationCreateDrawer.svelte';
	import OrganisationDetailsDrawer from '$lib/components/admin/OrganisationDetailsDrawer.svelte';
	import OrganisationBrandingDrawer from '$lib/components/admin/OrganisationBrandingDrawer.svelte';
	import OrganisationMembershipDrawer from '$lib/components/admin/OrganisationMembershipDrawer.svelte';

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
</script>

<div class="flex items-center justify-between">
	<div>
		<h1 class="text-2xl font-semibold text-gray-900">Organisations</h1>
		<p class="text-sm text-gray-700">
			Manage organisation templates, home memberships, and cross-organisation access grants.
		</p>
	</div>
	<Button variant="primary" size="md" type="button" onclick={openCreateDrawer}>
		Create organisation
	</Button>
</div>

{#if actionMessage}
	<Alert class="mt-4" variant={actionFailed ? 'destructive' : 'success'} size="sm">
		<p class="text-sm font-medium text-gray-900">{actionMessage}</p>
	</Alert>
{/if}

<div class="mt-6">
	<OrganisationTable
		{organisations}
		onEditDetails={openDetailsDrawer}
		onEditBranding={openBrandingDrawer}
		onEditMembership={openMembershipDrawer}
	/>
</div>

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
/>
