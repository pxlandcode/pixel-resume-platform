<script lang="ts">
	import { untrack } from 'svelte';
	import DashboardHeader from '$lib/components/dashboard/DashboardHeader.svelte';
	import DashboardSearch from '$lib/components/dashboard/DashboardSearch.svelte';
	import DashboardStats from '$lib/components/dashboard/DashboardStats.svelte';
	import RecentResumes from '$lib/components/dashboard/RecentResumes.svelte';
	import AvailableNow from '$lib/components/dashboard/AvailableNow.svelte';
	import AvailableSoon from '$lib/components/dashboard/AvailableSoon.svelte';
	import DashboardTips from '$lib/components/dashboard/DashboardTips.svelte';
	import type { RecentResume } from '$lib/components/dashboard/RecentResumes.svelte';
	import type { AvailableConsultant } from '$lib/components/dashboard/AvailableSoon.svelte';

	const { data } = $props();
	const effectiveRoles = $derived.by(() => {
		const fromRoles = Array.isArray(data.roles) ? data.roles : [];
		if (fromRoles.length > 0) return fromRoles;
		return typeof data.role === 'string' ? [data.role] : [];
	});
	const isTalentOnly = $derived(effectiveRoles.length === 1 && effectiveRoles[0] === 'talent');
	const signedInUserName = $derived.by(() => {
		const firstName =
			typeof data.profile?.first_name === 'string' ? data.profile.first_name.trim() : '';
		const lastName =
			typeof data.profile?.last_name === 'string' ? data.profile.last_name.trim() : '';
		const fullName = [firstName, lastName].filter(Boolean).join(' ');
		if (fullName) return fullName;

		const email = typeof data.user?.email === 'string' ? data.user.email.trim() : '';
		if (email) return email;

		return 'there';
	});

	const stats = $derived(
		data.stats ?? { totalTalents: 0, totalResumes: 0, availableNow: 0, availableSoon: 0 }
	);
	let recentResumes = $state<RecentResume[]>([]);
	let availableNow = $state<AvailableConsultant[]>([]);
	let availableSoon = $state<AvailableConsultant[]>([]);
	let panelsStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let panelsError = $state<string | null>(null);
	let panelsEtag = $state<string | null>(null);
	let activePanelsKey = $state<string | null>(null);
	let loadedPanelsKey = $state<string | null>(null);

	const dashboardPanelsKey = $derived(
		JSON.stringify({
			userId: data.user?.id ?? null,
			roles: effectiveRoles,
			adminModeEnabled:
				typeof data.adminModeEnabled === 'boolean' ? data.adminModeEnabled : true,
			homeOrganisationId: data.effectiveHomeOrganisationId ?? null,
			talentId: data.currentTalentId ?? null
		})
	);

	const resetDashboardPanels = () => {
		recentResumes = [];
		availableNow = [];
		availableSoon = [];
		panelsStatus = 'idle';
		panelsError = null;
		panelsEtag = null;
		loadedPanelsKey = null;
	};

	const loadDashboardPanels = async (requestKey: string) => {
		if (panelsStatus === 'loading') return;
		if (panelsStatus === 'ready' && loadedPanelsKey === requestKey) return;

		panelsStatus = 'loading';
		panelsError = null;

		try {
			const response = await fetch('/internal/api/dashboard/panels', {
				method: 'GET',
				credentials: 'include',
				headers: panelsEtag ? { 'If-None-Match': panelsEtag } : undefined
			});

			if (response.status === 304) {
				if (activePanelsKey !== requestKey) return;
				panelsStatus = 'ready';
				loadedPanelsKey = requestKey;
				return;
			}

			if (!response.ok) {
				const message = await response.text().catch(() => '');
				throw new Error(message || 'Could not load dashboard panels.');
			}

			const payload = (await response.json()) as {
				recentResumes?: RecentResume[];
				availableNow?: AvailableConsultant[];
				availableSoon?: AvailableConsultant[];
			};

			if (activePanelsKey !== requestKey) return;
			recentResumes = Array.isArray(payload.recentResumes) ? payload.recentResumes : [];
			availableNow = Array.isArray(payload.availableNow) ? payload.availableNow : [];
			availableSoon = Array.isArray(payload.availableSoon) ? payload.availableSoon : [];
			panelsEtag = response.headers.get('etag');
			panelsStatus = 'ready';
			loadedPanelsKey = requestKey;
			panelsError = null;
		} catch (error) {
			if (activePanelsKey !== requestKey) return;
			panelsStatus = 'error';
			panelsError = error instanceof Error ? error.message : 'Could not load dashboard panels.';
		}
	};

	$effect(() => {
		const requestKey = dashboardPanelsKey;
		if (isTalentOnly) {
			if (activePanelsKey !== null) {
				activePanelsKey = null;
				resetDashboardPanels();
			}
			return;
		}
		if (activePanelsKey !== requestKey) {
			activePanelsKey = requestKey;
			resetDashboardPanels();
		}
		untrack(() => {
			void loadDashboardPanels(requestKey);
		});
	});
</script>

<section class="space-y-8">
	{#if !isTalentOnly}
		<!-- Hero: greeting + search -->
		<div class="space-y-5 pt-2">
			<div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-4">
				<DashboardHeader userName={signedInUserName} />
				<DashboardStats {stats} />
			</div>
			<DashboardSearch />
		</div>

		<!-- Panels grid -->
		<div class="grid gap-6 lg:grid-cols-3">
			<RecentResumes resumes={recentResumes} status={panelsStatus} error={panelsError} />
			<AvailableNow consultants={availableNow} status={panelsStatus} error={panelsError} />
			<AvailableSoon consultants={availableSoon} status={panelsStatus} error={panelsError} />
		</div>
	{:else}
		<div class="pt-2">
			<DashboardHeader userName={signedInUserName} />
		</div>
	{/if}

	<!-- Tips -->
	<DashboardTips />
</section>
