<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/and.svg';
	import { page, navigating } from '$app/stores';
	import { siteMeta, withMetaDefaults } from '$lib/seo';
	import ResumeLayout from '$lib/components/resume-layout/resume-layout.svelte';
	import type { AdminRole } from '$lib/components/resume-layout/resume-layout.svelte';
	import { Mode } from '@pixelcode_/blocks/components';
	import { loadingStore } from '$lib/stores/loading';
	import {
		pdfImportStore,
		isImportActive,
		isImportSucceeded,
		importStatusLabel
	} from '$lib/stores/pdfImportStore';
	import { onDestroy } from 'svelte';
	import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-svelte';
	import { resolve } from '$app/paths';
	import { browser } from '$app/environment';
	import {
		DEFAULT_ORGANISATION_BRANDING_THEME,
		organisationBrandingThemeToInlineStyle,
		organisationBrandingThemeToVarEntries,
		type OrganisationBrandingTheme
	} from '$lib/branding/theme';
	import '$lib/styles/resume-app-overrides.css';
	import '$lib/styles/resume-app.css';

	let { data, children } = $props();

	const plainRoutes = new Set(['/login', '/reset-password']);
	const pathname = $derived($page.url.pathname);
	const isPrintRoute = $derived(pathname.startsWith('/print'));
	const isPlainRoute = $derived(plainRoutes.has(pathname));
	const useAppShell = $derived(!isPrintRoute && !isPlainRoute);

	const resolvedMeta = $derived(withMetaDefaults($page.data?.meta, $page.url.pathname));
	const jsonLdEntries = $derived(
		resolvedMeta.jsonLd
			? Array.isArray(resolvedMeta.jsonLd)
				? resolvedMeta.jsonLd
				: [resolvedMeta.jsonLd]
			: []
	);
	const jsonLdScripts = $derived(jsonLdEntries.map((schema) => JSON.stringify(schema)));
	const jsonLdIndexes = $derived(jsonLdScripts.map((_schema, index) => index));

	const isBusy = $derived(useAppShell && ($navigating !== null || $loadingStore.isLoading));
	const loadingLabel = $derived(
		$loadingStore.loadingText ?? ($navigating !== null ? 'Loading page...' : 'Loading...')
	);

	const showImportIndicator = $derived(useAppShell && $isImportActive);
	const importHasError = $derived(!!$pdfImportStore.error && $pdfImportStore.status === 'idle');
	const importIsSuccess = $derived($isImportSucceeded);
	const importTalentId = $derived($pdfImportStore.talentId);
	const importResumeId = $derived($pdfImportStore.resumeId);
	const importFilename = $derived($pdfImportStore.sourceFilename);
	const importError = $derived($pdfImportStore.error);
	const statusLabel = $derived($importStatusLabel);
	const unauthorizedMessage = $derived(
		$page.url.searchParams.get('unauthorized')
			? 'You do not have permission to view that section.'
			: null
	);
	const layoutRole = $derived((data.role ?? null) as AdminRole | null);
	const layoutRoles = $derived((data.roles ?? []) as AdminRole[]);
	const brandingTheme = $derived(
		(data.brandingTheme ?? DEFAULT_ORGANISATION_BRANDING_THEME) as OrganisationBrandingTheme
	);
	const brandingInlineStyle = $derived(organisationBrandingThemeToInlineStyle(brandingTheme));
	const brandingVarEntries = $derived(organisationBrandingThemeToVarEntries(brandingTheme));

	let successDismissing = $state(false);
	let successDismissTimeout: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		if (importIsSuccess && !successDismissing) {
			if (successDismissTimeout) clearTimeout(successDismissTimeout);
			successDismissTimeout = setTimeout(() => {
				successDismissing = true;
				setTimeout(() => {
					pdfImportStore.clear();
					successDismissing = false;
				}, 400);
			}, 4000);
		}

		if (!importIsSuccess) {
			successDismissing = false;
			if (successDismissTimeout) {
				clearTimeout(successDismissTimeout);
				successDismissTimeout = null;
			}
		}
	});

	function handleSuccessClick() {
		if (successDismissTimeout) {
			clearTimeout(successDismissTimeout);
			successDismissTimeout = null;
		}
		pdfImportStore.clear();
	}

	type ResumeImportJobStatus = 'queued' | 'processing' | 'succeeded' | 'failed';
	type ResumeImportJobStatusResponse = {
		id: string;
		status: ResumeImportJobStatus;
		error_message: string | null;
		resume_id: string | null;
	};

	let importPollTimeoutId: ReturnType<typeof setTimeout> | null = null;
	let importPollAbortController: AbortController | null = null;
	let isPollingActive = $state(false);

	const stopImportPolling = () => {
		if (importPollTimeoutId !== null) {
			clearTimeout(importPollTimeoutId);
			importPollTimeoutId = null;
		}
		importPollAbortController?.abort();
		importPollAbortController = null;
		isPollingActive = false;
	};

	const scheduleImportJobPoll = (jobId: string) => {
		if ($pdfImportStore.jobId !== jobId) return;
		importPollTimeoutId = setTimeout(() => {
			void pollImportJob(jobId);
		}, 2000);
	};

	const pollImportJob = async (jobId: string) => {
		if (!browser || $pdfImportStore.jobId !== jobId) return;

		const controller = new AbortController();
		importPollAbortController = controller;

		try {
			const response = await fetch(
				resolve('/internal/api/resumes/import-from-pdf/jobs/[jobId]', { jobId }),
				{
					method: 'GET',
					credentials: 'include',
					signal: controller.signal
				}
			);

			if (!response.ok) {
				const text = await response.text().catch(() => '');
				throw new Error(text || 'Could not fetch PDF import status.');
			}

			const payload = (await response.json()) as ResumeImportJobStatusResponse;
			if ($pdfImportStore.jobId !== jobId) return;

			if (payload.status === 'queued') {
				pdfImportStore.setStatus('queued');
				scheduleImportJobPoll(jobId);
				return;
			}
			if (payload.status === 'processing') {
				pdfImportStore.setStatus('processing');
				scheduleImportJobPoll(jobId);
				return;
			}
			if (payload.status === 'failed') {
				stopImportPolling();
				pdfImportStore.setError(payload.error_message || 'Could not import resume from PDF.');
				return;
			}

			const resumeId = payload.resume_id?.trim() || '';
			if (!resumeId) throw new Error('PDF import finished but no resume ID was returned.');

			stopImportPolling();
			pdfImportStore.setSuccess(resumeId);
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return;
			stopImportPolling();
			pdfImportStore.setError(
				error instanceof TypeError
					? 'Network error while checking import status.'
					: error instanceof Error
						? error.message
						: 'Could not fetch PDF import status.'
			);
		} finally {
			if (importPollAbortController === controller) importPollAbortController = null;
		}
	};

	$effect(() => {
		if (!useAppShell) {
			if (isPollingActive) stopImportPolling();
			return;
		}

		const jobId = $pdfImportStore.jobId;
		const status = $pdfImportStore.status;
		const shouldPoll = status === 'queued' || status === 'processing';

		if (shouldPoll && jobId && !isPollingActive) {
			isPollingActive = true;
			void pollImportJob(jobId);
		}

		if (!shouldPoll && isPollingActive) {
			stopImportPolling();
		}
	});

	let barVisible = $state(false);
	let barCompleting = $state(false);
	let barKey = $state(0);
	let wasBusy = $state(false);
	let hideTimeout: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		if (isBusy && !wasBusy) {
			if (hideTimeout) {
				clearTimeout(hideTimeout);
				hideTimeout = null;
			}
			barVisible = true;
			barCompleting = false;
			barKey += 1;
		}

		if (!isBusy && wasBusy) {
			barCompleting = true;
			if (hideTimeout) clearTimeout(hideTimeout);
			hideTimeout = setTimeout(() => {
				barVisible = false;
				barCompleting = false;
				hideTimeout = null;
			}, 320);
		}

		wasBusy = isBusy;
	});

	$effect(() => {
		if (typeof document === 'undefined') return;
		const html = document.documentElement;
		const body = document.body;
		body.classList.toggle('app-shell-theme', useAppShell);
		for (const [name, value] of brandingVarEntries) {
			html.style.setProperty(name, value);
		}

		return () => {
			body.classList.remove('app-shell-theme');
			for (const [name] of brandingVarEntries) {
				html.style.removeProperty(name);
			}
		};
	});

	onDestroy(() => {
		if (hideTimeout) clearTimeout(hideTimeout);
		if (successDismissTimeout) clearTimeout(successDismissTimeout);
		stopImportPolling();
	});
</script>

<svelte:head>
	<meta charset="utf-8" />
	<title>{resolvedMeta.title}</title>
	<meta name="description" content={resolvedMeta.description} />
	<meta name="robots" content={resolvedMeta.noindex ? 'noindex,nofollow' : 'index,follow'} />
	<link rel="canonical" href={resolvedMeta.canonical} />
	<meta property="og:site_name" content={siteMeta.name} />
	<meta property="og:title" content={resolvedMeta.title} />
	<meta property="og:description" content={resolvedMeta.description} />
	<meta property="og:url" content={resolvedMeta.canonical} />
	<meta property="og:type" content={resolvedMeta.type} />
	{#if resolvedMeta.ogImage}
		<meta property="og:image" content={resolvedMeta.ogImage} />
	{/if}
	<meta name="twitter:card" content={resolvedMeta.twitterCard} />
	<meta name="twitter:title" content={resolvedMeta.title} />
	<meta name="twitter:description" content={resolvedMeta.description} />
	{#if resolvedMeta.ogImage}
		<meta name="twitter:image" content={resolvedMeta.ogImage} />
	{/if}
	<meta name="theme-color" content="#0f172a" />
	<link rel="icon" href={favicon} />
	{#if jsonLdScripts.length}
		{#each jsonLdIndexes as index (`jsonld-${index}`)}
			<script type="application/ld+json">
{@html jsonLdScripts[index]}
			</script>
		{/each}
	{/if}
</svelte:head>

<Mode.Watcher defaultMode="light" />

{#if showImportIndicator}
	<div
		class={`fixed bottom-6 left-6 z-40 transition-all duration-300 ${successDismissing ? 'import-indicator-dismiss' : ''}`}
	>
		{#if importIsSuccess}
			<a
				href={resolve('/resumes/[personId]/resume/[resumeId]', {
					personId: importTalentId ?? '',
					resumeId: importResumeId ?? ''
				})}
				onclick={handleSuccessClick}
				class="flex items-center gap-3 rounded-lg bg-emerald-500 px-4 py-3 text-white shadow-lg transition-all hover:scale-105 hover:bg-emerald-600"
				title="Click to open resume"
			>
				<CheckCircle2 size={24} />
				<div class="text-left">
					<p class="font-semibold">Import complete!</p>
					{#if importFilename}
						<p class="max-w-48 truncate text-xs text-emerald-100">{importFilename}</p>
					{/if}
				</div>
			</a>
		{:else}
			<div class="group relative">
				<a
					href={resolve('/resumes/[personId]', { personId: importTalentId ?? '' })}
					class={`flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all hover:scale-105 ${
						importHasError
							? 'bg-red-500 text-white hover:bg-red-600'
							: 'bg-primary hover:bg-primary/90 text-white'
					}`}
					title="View import status"
				>
					{#if importHasError}
						<AlertCircle size={20} />
					{:else}
						<Loader2 size={20} class="animate-spin" />
					{/if}
				</a>

				<div
					class="pointer-events-none invisible absolute bottom-full left-0 mb-2 w-56 rounded-lg border border-slate-200 bg-white p-3 text-left text-sm text-slate-700 opacity-0 shadow-xl transition-all group-hover:visible group-hover:opacity-100"
				>
					<p class="mb-1 font-semibold text-slate-900">
						{#if importHasError}
							Import Failed
						{:else}
							Importing PDF
						{/if}
					</p>
					{#if importFilename}
						<p class="mb-1 truncate text-xs text-slate-500">{importFilename}</p>
					{/if}
					{#if importError}
						<p class="text-xs text-red-600">{importError}</p>
					{:else}
						<p class="text-xs text-slate-500">{statusLabel || 'Processing...'}</p>
					{/if}
					<p class="mt-2 text-[11px] text-slate-400">Click to view details</p>
				</div>
			</div>
		{/if}
	</div>
{/if}

{#if useAppShell && barVisible}
	{#key barKey}
		<div
			class={`internal-loading-bar ${barCompleting ? 'is-complete' : ''}`}
			role="progressbar"
			aria-busy={isBusy}
			aria-label={loadingLabel}
		>
			<div class="internal-loading-bar__fill"></div>
		</div>
	{/key}
{/if}

{#if isPrintRoute}
	<main class="min-h-screen bg-white text-slate-900">
		{@render children?.()}
	</main>
{:else if isPlainRoute}
	{@render children?.()}
{:else}
	<div class="internal-root" style={brandingInlineStyle}>
		<ResumeLayout
			profile={data.profile}
			role={layoutRole}
			roles={layoutRoles}
			userEmail={data.user?.email ?? null}
			{unauthorizedMessage}
		>
			{@render children?.()}
		</ResumeLayout>
	</div>
{/if}

<style>
	:global(.internal-loading-bar) {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 9999;
		height: 4px;
		background: rgba(15, 23, 42, 0.08);
		pointer-events: none;
		opacity: 1;
		transition: opacity 150ms ease 120ms;
	}

	:global(.internal-loading-bar__fill) {
		height: 100%;
		width: 40%;
		background: linear-gradient(90deg, #ea7c5d 0%, #f08b66 45%, #f59f7a 100%);
		animation: internal-loading-bar 1.1s ease-in-out infinite;
		will-change: transform;
	}

	:global(.internal-loading-bar.is-complete) {
		opacity: 0;
	}

	:global(.internal-loading-bar.is-complete .internal-loading-bar__fill) {
		width: 100%;
		animation: none;
		transition: width 200ms ease;
	}

	@keyframes internal-loading-bar {
		0% {
			transform: translateX(-70%);
		}
		50% {
			transform: translateX(20%);
		}
		100% {
			transform: translateX(120%);
		}
	}

	:global(.import-indicator-dismiss) {
		animation: import-indicator-slide-out 400ms ease-in forwards;
	}

	@keyframes import-indicator-slide-out {
		0% {
			opacity: 1;
			transform: translateX(0);
		}
		100% {
			opacity: 0;
			transform: translateX(-100%);
		}
	}
</style>
