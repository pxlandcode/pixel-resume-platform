<script lang="ts">
	import { Alert, Toaster, toast } from '@pixelcode_/blocks/components';
	import OrganisationDetailsDrawer from '$lib/components/admin/OrganisationDetailsDrawer.svelte';
	import OrganisationBrandingDrawer from '$lib/components/admin/OrganisationBrandingDrawer.svelte';
	import OrganisationMembershipDrawer from '$lib/components/admin/OrganisationMembershipDrawer.svelte';
	import OrganisationTalentLabelsDrawer from '$lib/components/admin/OrganisationTalentLabelsDrawer.svelte';
	import { Dropdown } from '$lib/components/dropdown';
	import type { TalentLabelDefinition } from '$lib/types/talentLabels';
	import { Settings, Palette, Users, ArrowLeft, Tags } from 'lucide-svelte';

	let { data, form } = $props();

	type Role = 'admin' | 'organisation_admin' | 'broker' | 'talent' | 'employer';
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
			email_domains: string[];
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
		talentLabelDefinitions: TalentLabelDefinition[];
		membershipContextLoaded: boolean;
		generatedAt: string;
	};
	type OrganisationOption = {
		id: string;
		name: string;
	};

	const isTalentLabelActionType = (value: string | null | undefined) =>
		value === 'createTalentLabelDefinition' ||
		value === 'updateTalentLabelDefinition' ||
		value === 'deleteTalentLabelDefinition';

	const initialOrganisation = data.organisation as Organisation;
	const organisation = $derived(data.organisation as Organisation);
	const organisationOptions = $derived(
		(data.organisationOptions as OrganisationOption[] | undefined) ?? []
	);
	const selectedOrganisationIdFromForm =
		form &&
		'organisation_id' in form &&
		typeof form.organisation_id === 'string' &&
		form.organisation_id.length > 0
			? form.organisation_id
			: null;
	const initialSelectedOrganisationId =
		selectedOrganisationIdFromForm ??
		(typeof data.selectedOrganisationId === 'string' ? data.selectedOrganisationId : null) ??
		initialOrganisation.id;
	const canSelectOrganisation = $derived(
		Boolean(data.canSelectOrganisation) && organisationOptions.length > 1
	);
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

	let isDetailsDrawerOpen = $state(false);
	let isBrandingDrawerOpen = $state(false);
	let isMembershipDrawerOpen = $state(false);
	let isLabelsDrawerOpen = $state(false);
	let selectedOrganisationId = $state(initialSelectedOrganisationId);
	let organisationContext = $state<OrganisationContext | null>(null);
	let contextStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let contextError = $state<string | null>(null);
	let contextEtag = $state<string | null>(null);
	let contextLoadingOrganisationId = $state<string | null>(null);
	let contextLoadingIncludesMembership = $state(false);
	let contextHasMembership = $state(false);
	let contextAbortController: AbortController | null = null;
	let lastActionToastKey = $state<string | null>(null);

	const loadOrganisationContext = async (
		options: { force?: boolean; organisationId?: string; includeMembership?: boolean } = {}
	) => {
		const force = options.force ?? false;
		const includeMembership = options.includeMembership ?? false;
		const organisationId = options.organisationId ?? selectedOrganisationId;
		if (!organisationId) return;
		const contextMatchesSelection = organisationContext?.organisation.id === organisationId;
		if (
			!force &&
			contextStatus === 'loading' &&
			contextLoadingOrganisationId === organisationId &&
			(!includeMembership || contextLoadingIncludesMembership)
		) {
			return;
		}
		if (
			!force &&
			contextStatus === 'ready' &&
			contextMatchesSelection &&
			(!includeMembership || contextHasMembership)
		) {
			return;
		}

		contextAbortController?.abort();
		const controller = new AbortController();
		contextAbortController = controller;
		contextLoadingOrganisationId = organisationId;
		contextLoadingIncludesMembership = includeMembership;
		contextStatus = 'loading';
		contextError = null;

		try {
			const endpoint = `/internal/api/organisations/context?org=${encodeURIComponent(
				organisationId
			)}&membership=${includeMembership ? '1' : '0'}`;
			const response = await fetch(endpoint, {
				method: 'GET',
				credentials: 'include',
				signal: controller.signal,
				headers:
					!force && contextEtag && contextMatchesSelection
						? { 'If-None-Match': contextEtag }
						: undefined
			});

			if (response.status === 304) {
				if (!organisationContext) {
					throw new Error('Organisation context cache was empty after revalidation.');
				}
				if (controller.signal.aborted) return;
				if (includeMembership) contextHasMembership = true;
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
			if (selectedOrganisationId !== organisationId) {
				if (contextAbortController === controller) contextStatus = 'idle';
				return;
			}

			const membershipContextToPreserve =
				!payload.membershipContextLoaded &&
				contextHasMembership &&
				organisationContext?.organisation.id === organisationId
					? organisationContext
					: null;
			organisationContext = membershipContextToPreserve
				? {
						...payload,
						membershipsUsers: membershipContextToPreserve.membershipsUsers,
						membershipsTalents: membershipContextToPreserve.membershipsTalents,
						users: membershipContextToPreserve.users,
						talents: membershipContextToPreserve.talents,
						usersWithHomeOrgIds: membershipContextToPreserve.usersWithHomeOrgIds,
						talentsWithHomeOrgIds: membershipContextToPreserve.talentsWithHomeOrgIds,
						membershipContextLoaded: true
					}
				: payload;
			contextHasMembership =
				payload.membershipContextLoaded || Boolean(membershipContextToPreserve);
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
				contextLoadingOrganisationId = null;
				contextLoadingIncludesMembership = false;
			}
		}
	};

	const resetSelectedOrganisationContext = () => {
		contextAbortController?.abort();
		contextAbortController = null;
		contextLoadingOrganisationId = null;
		contextLoadingIncludesMembership = false;
		contextHasMembership = false;
		organisationContext = null;
		contextStatus = 'idle';
		contextError = null;
		contextEtag = null;
	};

	const handleOrganisationSelection = (organisationId: string) => {
		if (!organisationId) return;
		selectedOrganisationId = organisationId;
		resetSelectedOrganisationContext();
		void loadOrganisationContext({ force: true, organisationId });
	};

	const openDetailsDrawer = () => {
		isDetailsDrawerOpen = true;
		void loadOrganisationContext();
	};

	const openBrandingDrawer = () => {
		isBrandingDrawerOpen = true;
		void loadOrganisationContext();
	};

	const openMembershipDrawer = () => {
		isMembershipDrawerOpen = true;
		void loadOrganisationContext({ includeMembership: true });
	};

	const openLabelsDrawer = () => {
		isLabelsDrawerOpen = true;
		void loadOrganisationContext();
	};

	const refreshOrganisationContext = async () => {
		await loadOrganisationContext({ force: true, includeMembership: isMembershipDrawerOpen });
	};

	const selectedOrganisationName = $derived(
		organisationOptions.find((option) => option.id === selectedOrganisationId)?.name ??
			organisation.name
	);
	const selectedOrganisationContext = $derived(
		organisationContext?.organisation.id === selectedOrganisationId ? organisationContext : null
	);
	const selectedOrganisationDetails = $derived.by(() => {
		if (selectedOrganisationContext) {
			return {
				...selectedOrganisationContext.organisation,
				created_at: null,
				updated_at: null
			};
		}
		if (organisation.id === selectedOrganisationId) return organisation;
		return undefined;
	});
	const hasSelectedOrganisationContext = $derived(
		organisation.id === selectedOrganisationId || Boolean(selectedOrganisationContext)
	);

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
	const canManagePixelCode = $derived(
		(Array.isArray(data.roles) ? data.roles : []).includes('admin')
	);
	const brandingOrganisation = $derived(
		selectedOrganisationDetails
			? {
					id: selectedOrganisationDetails.id,
					name: selectedOrganisationDetails.name,
					brand_settings:
						selectedOrganisationDetails.brand_settings ??
						selectedOrganisationContext?.organisation.brand_settings ??
						null
				}
			: undefined
	);
	const brandingTemplate = $derived(selectedOrganisationContext?.template ?? undefined);
	const talentLabelDefinitions = $derived(
		selectedOrganisationContext?.talentLabelDefinitions ?? []
	);

	$effect(() => {
		if (
			selectedOrganisationId &&
			!organisationOptions.some((option) => option.id === selectedOrganisationId)
		) {
			selectedOrganisationId = organisationOptions[0]?.id ?? '';
			resetSelectedOrganisationContext();
		}
	});

	$effect(() => {
		if (
			isTalentLabelActionType(form?.type) ||
			typeof form?.message !== 'string' ||
			form.message.length === 0
		) {
			return;
		}
		const key = `${form?.type ?? 'unknown'}:${form?.ok === false ? 'error' : 'success'}:${form.message}`;
		if (lastActionToastKey === key) return;
		lastActionToastKey = key;
		showToast(form?.ok === false ? 'error' : 'success', form.message);
	});
</script>

<div class="space-y-6">
	<Toaster />

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
			Manage details, branding, and memberships for {selectedOrganisationName}.
		</p>
	</header>

	{#if canSelectOrganisation}
		<div class="bg-card border-border rounded-sm border p-4 sm:max-w-xl">
			<Dropdown
				label="Organisation"
				bind:value={selectedOrganisationId}
				options={organisationOptions.map((option) => ({
					label: option.name,
					value: option.id
				}))}
				placeholder="Choose organisation"
				search={organisationOptions.length > 6}
				searchPlaceholder="Search organisations"
				onchange={handleOrganisationSelection}
				class="w-full"
			/>
		</div>
	{/if}

	{#if contextStatus === 'loading' && (isDetailsDrawerOpen || isBrandingDrawerOpen || isMembershipDrawerOpen || isLabelsDrawerOpen)}
		<p class="text-muted-fg text-sm">Loading organisation details…</p>
	{:else if contextError && (isDetailsDrawerOpen || isBrandingDrawerOpen || isMembershipDrawerOpen || isLabelsDrawerOpen)}
		<Alert variant="destructive" size="sm">
			<p class="text-foreground text-sm font-medium">{contextError}</p>
		</Alert>
	{/if}

	<div class="grid gap-4 sm:grid-cols-4">
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

		<button
			type="button"
			onclick={openLabelsDrawer}
			class="bg-card border-border hover:border-primary/50 flex flex-col items-start gap-3 rounded-sm border p-5 text-left transition-colors"
		>
			<div class="bg-muted text-muted-fg flex h-10 w-10 items-center justify-center rounded-sm">
				<Tags size={20} />
			</div>
			<div>
				<h2 class="text-foreground text-base font-semibold">Labels</h2>
				<p class="text-muted-fg mt-1 text-sm">Manage Finder-style talent labels and colors.</p>
			</div>
		</button>
	</div>
</div>

<OrganisationDetailsDrawer
	bind:open={isDetailsDrawerOpen}
	organisation={hasSelectedOrganisationContext ? selectedOrganisationDetails : undefined}
/>

<OrganisationBrandingDrawer
	bind:open={isBrandingDrawerOpen}
	organisation={brandingOrganisation}
	template={brandingTemplate}
	loading={contextStatus === 'loading' && !brandingTemplate}
	loadError={!brandingTemplate ? contextError : null}
	{canManagePixelCode}
	{form}
/>

<OrganisationMembershipDrawer
	bind:open={isMembershipDrawerOpen}
	organisation={hasSelectedOrganisationContext ? selectedOrganisationDetails : undefined}
	users={membershipUsers}
	talents={membershipTalents}
	userMemberships={membershipUserRows}
	talentMemberships={membershipTalentRows}
	{usersWithHomeOrg}
	{talentsWithHomeOrg}
/>

<OrganisationTalentLabelsDrawer
	bind:open={isLabelsDrawerOpen}
	organisation={hasSelectedOrganisationContext ? selectedOrganisationDetails : undefined}
	{talentLabelDefinitions}
	{refreshOrganisationContext}
/>
