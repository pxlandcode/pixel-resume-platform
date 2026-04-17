<script lang="ts">
	import { Alert } from '@pixelcode_/blocks/components';
	import OrganisationDetailsDrawer from '$lib/components/admin/OrganisationDetailsDrawer.svelte';
	import OrganisationBrandingDrawer from '$lib/components/admin/OrganisationBrandingDrawer.svelte';
	import OrganisationMembershipDrawer from '$lib/components/admin/OrganisationMembershipDrawer.svelte';
	import { Settings, Palette, Users, ArrowLeft } from 'lucide-svelte';

	let { data, form } = $props();

	type Role = 'admin' | 'broker' | 'talent' | 'employer';
	type Organisation = {
		id: string;
		name: string;
		slug: string;
		homepage_url: string | null;
		email_domains: string[];
		brand_settings: Record<string, unknown> | null;
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

	const organisation = $derived(data.organisation as Organisation);
	const actionMessage = $derived(typeof form?.message === 'string' ? form.message : null);
	const actionFailed = $derived(form?.ok === false);

	let isDetailsDrawerOpen = $state(false);
	let isBrandingDrawerOpen = $state(false);
	let isMembershipDrawerOpen = $state(false);
	let organisationContext = $state<OrganisationContext | null>(null);
	let contextStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let contextError = $state<string | null>(null);
	let contextEtag = $state<string | null>(null);
	let contextAbortController: AbortController | null = null;

	const loadOrganisationContext = async () => {
		if (!organisation?.id) return;
		if (contextStatus === 'loading') return;
		if (contextStatus === 'ready' && organisationContext) return;

		contextAbortController?.abort();
		const controller = new AbortController();
		contextAbortController = controller;
		contextStatus = 'loading';
		contextError = null;

		try {
			const endpoint = `/internal/api/organisations/context?org=${encodeURIComponent(organisation.id)}`;
			const response = await fetch(endpoint, {
				method: 'GET',
				credentials: 'include',
				signal: controller.signal,
				headers: contextEtag ? { 'If-None-Match': contextEtag } : undefined
			});

			if (response.status === 304) {
				if (!organisationContext) {
					throw new Error('Organisation context cache was empty after revalidation.');
				}
				if (controller.signal.aborted) return;
				contextStatus = 'ready';
				contextError = null;
				return;
			}

			if (!response.ok) {
				const message = await response.text().catch(() => '');
				throw new Error(message || 'Could not load organisation context.');
			}

			const payload = (await response.json()) as OrganisationContext;
			if (controller.signal.aborted) return;

			organisationContext = payload;
			contextEtag = response.headers.get('etag');
			contextStatus = 'ready';
			contextError = null;
		} catch (err) {
			if (controller.signal.aborted) return;
			contextStatus = 'error';
			contextError = err instanceof Error ? err.message : 'Could not load organisation context.';
		} finally {
			if (contextAbortController === controller) {
				contextAbortController = null;
			}
		}
	};

	const openDetailsDrawer = () => {
		isDetailsDrawerOpen = true;
	};

	const openBrandingDrawer = () => {
		isBrandingDrawerOpen = true;
		void loadOrganisationContext();
	};

	const openMembershipDrawer = () => {
		isMembershipDrawerOpen = true;
		void loadOrganisationContext();
	};

	const membershipUsers = $derived(organisationContext?.users ?? []);
	const membershipTalents = $derived(organisationContext?.talents ?? []);
	const membershipUserRows = $derived(organisationContext?.membershipsUsers ?? []);
	const membershipTalentRows = $derived(organisationContext?.membershipsTalents ?? []);
	const usersWithHomeOrg = $derived(new Set(organisationContext?.usersWithHomeOrgIds ?? []));
	const talentsWithHomeOrg = $derived(new Set(organisationContext?.talentsWithHomeOrgIds ?? []));
	const brandingOrganisation = $derived({
		id: organisation.id,
		name: organisation.name,
		brand_settings:
			organisationContext?.organisation.brand_settings ?? organisation.brand_settings ?? null
	});
	const brandingTemplate = $derived(organisationContext?.template ?? undefined);
</script>

<div class="space-y-6">
	<div class="flex items-center gap-3">
		<a
			href="/settings"
			class="text-muted-fg hover:text-foreground flex items-center gap-1 text-sm transition-colors"
		>
			<ArrowLeft size={16} />
			Settings
		</a>
	</div>

	<header>
		<h1 class="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">
			Organisation settings
		</h1>
		<p class="text-muted-fg mt-3 text-lg">
			Manage details, branding, and memberships for {organisation.name}.
		</p>
	</header>

	{#if actionMessage}
		<Alert variant={actionFailed ? 'destructive' : 'success'} size="sm">
			<p class="text-foreground text-sm font-medium">{actionMessage}</p>
		</Alert>
	{/if}

	{#if contextStatus === 'loading' && (isBrandingDrawerOpen || isMembershipDrawerOpen)}
		<p class="text-muted-fg text-sm">Loading organisation details…</p>
	{:else if contextError && (isBrandingDrawerOpen || isMembershipDrawerOpen)}
		<Alert variant="destructive" size="sm">
			<p class="text-foreground text-sm font-medium">{contextError}</p>
		</Alert>
	{/if}

	<div class="grid gap-4 sm:grid-cols-3">
		<button
			type="button"
			onclick={openDetailsDrawer}
			class="bg-card border-border hover:border-primary/50 flex flex-col items-start gap-3 rounded-sm border p-5 text-left transition-colors"
		>
			<div class="bg-muted text-muted-fg flex h-10 w-10 items-center justify-center rounded-sm">
				<Settings size={20} />
			</div>
			<div>
				<h2 class="text-foreground text-base font-semibold">Details</h2>
				<p class="text-muted-fg mt-1 text-sm">Name, slug, homepage URL, and sign-in domains.</p>
			</div>
		</button>

		<button
			type="button"
			onclick={openBrandingDrawer}
			class="bg-card border-border hover:border-primary/50 flex flex-col items-start gap-3 rounded-sm border p-5 text-left transition-colors"
		>
			<div class="bg-muted text-muted-fg flex h-10 w-10 items-center justify-center rounded-sm">
				<Palette size={20} />
			</div>
			<div>
				<h2 class="text-foreground text-base font-semibold">Branding</h2>
				<p class="text-muted-fg mt-1 text-sm">Theme colors, fonts, and logo assets.</p>
			</div>
		</button>

		<button
			type="button"
			onclick={openMembershipDrawer}
			class="bg-card border-border hover:border-primary/50 flex flex-col items-start gap-3 rounded-sm border p-5 text-left transition-colors"
		>
			<div class="bg-muted text-muted-fg flex h-10 w-10 items-center justify-center rounded-sm">
				<Users size={20} />
			</div>
			<div>
				<h2 class="text-foreground text-base font-semibold">Membership</h2>
				<p class="text-muted-fg mt-1 text-sm">Manage home users and talents.</p>
			</div>
		</button>
	</div>
</div>

<OrganisationDetailsDrawer bind:open={isDetailsDrawerOpen} {organisation} />

<OrganisationBrandingDrawer
	bind:open={isBrandingDrawerOpen}
	organisation={brandingOrganisation}
	template={brandingTemplate}
	{form}
/>

<OrganisationMembershipDrawer
	bind:open={isMembershipDrawerOpen}
	{organisation}
	users={membershipUsers}
	talents={membershipTalents}
	userMemberships={membershipUserRows}
	talentMemberships={membershipTalentRows}
	{usersWithHomeOrg}
	{talentsWithHomeOrg}
/>
