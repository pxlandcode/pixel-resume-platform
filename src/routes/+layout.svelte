<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/and.svg';
	import { page, navigating } from '$app/stores';
	import { siteMeta, withMetaDefaults } from '$lib/seo';
	import MenuLayout from '$lib/components/menu-layout/menu-layout.svelte';
	import type { AdminRole } from '$lib/components/menu-layout/types';
	import { Mode } from '@pixelcode_/blocks/components';
	import { loadingStore } from '$lib/stores/loading';
	import { userSettingsStore } from '$lib/stores/userSettings';
	import { brandingStore, DEFAULT_BRANDING_FONT_STACK } from '$lib/stores/branding';
	import { pdfImportStore, isImportSucceeded, importStatusLabel } from '$lib/stores/pdfImportStore';
	import { resumeDownloadStore } from '$lib/stores/resumeDownloadStore';
	import { onDestroy } from 'svelte';
	import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-svelte';
	import { resolve } from '$app/paths';
	import { browser } from '$app/environment';
	import {
		resolveOrganisationBrandingTheme,
		organisationBrandingThemeToInlineStyle,
		organisationBrandingThemeToVarEntries
	} from '$lib/branding/theme';
	import '$lib/styles/resume-app-overrides.css';
	import '$lib/styles/resume-app.css';

	let { data, children } = $props();

	const plainRoutes = new Set(['/login', '/reset-password']);
	const pathname = $derived($page.url.pathname);
	const isPrintRoute = $derived(pathname.startsWith('/print'));
	const isPlainRoute = $derived(plainRoutes.has(pathname) || pathname.startsWith('/legal/'));
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

	const importHasError = $derived(!!$pdfImportStore.error && $pdfImportStore.status === 'idle');
	const importIsSuccess = $derived($isImportSucceeded);
	const importIsWorking = $derived(
		$pdfImportStore.status !== 'idle' && $pdfImportStore.status !== 'succeeded'
	);
	const importTalentId = $derived($pdfImportStore.talentId);
	const importResumeId = $derived($pdfImportStore.resumeId);
	const importFilename = $derived($pdfImportStore.sourceFilename);
	const importError = $derived($pdfImportStore.error);
	const statusLabel = $derived($importStatusLabel);
	const downloadIsActive = $derived($resumeDownloadStore.isActive);
	const downloadLabel = $derived($resumeDownloadStore.label);
	const importSuccessHref = $derived.by(() => {
		if (!importTalentId || !importResumeId) return null;
		return resolve('/resumes/[personId]/resume/[resumeId]', {
			personId: importTalentId,
			resumeId: importResumeId
		});
	});
	const showImportSuccessIndicator = $derived(
		useAppShell &&
			importIsSuccess &&
			Boolean(importSuccessHref) &&
			!downloadIsActive &&
			!importIsWorking &&
			!importHasError
	);
	const hasImportActivityCard = $derived(importIsWorking || importHasError);
	const hasDownloadActivityCard = $derived(downloadIsActive);
	const showActivityIndicator = $derived(
		useAppShell && (hasDownloadActivityCard || hasImportActivityCard)
	);
	const indicatorIsErrorOnly = $derived(!downloadIsActive && !importIsWorking && importHasError);
	const importIndicatorHref = $derived.by(() => {
		if (!importTalentId) return null;
		return resolve('/resumes/[personId]', { personId: importTalentId });
	});
	const indicatorCanOpenImport = $derived(Boolean(importIndicatorHref) && hasImportActivityCard);
	const unauthorizedMessage = $derived(
		$page.url.searchParams.get('unauthorized')
			? 'You do not have permission to view that section.'
			: null
	);
	const layoutRole = $derived((data.role ?? null) as AdminRole | null);
	const layoutRoles = $derived((data.roles ?? []) as AdminRole[]);
	const authenticatedUserId = $derived(typeof data.user?.id === 'string' ? data.user.id : null);
	const brandingThemeFromData = $derived(
		resolveOrganisationBrandingTheme(data.brandingTheme ?? null)
	);
	const brandingFontFromData = $derived(data.brandingFont ?? null);
	const brandingTheme = $derived(
		$brandingStore.hydrated ? $brandingStore.theme : brandingThemeFromData
	);
	const brandingInlineStyle = $derived(organisationBrandingThemeToInlineStyle(brandingTheme));
	const brandingVarEntries = $derived(organisationBrandingThemeToVarEntries(brandingTheme));
	const brandingFontCssStack = $derived(
		$brandingStore.hydrated
			? $brandingStore.font.cssStack
			: typeof data.brandingFont?.cssStack === 'string' &&
				  data.brandingFont.cssStack.trim().length > 0
				? data.brandingFont.cssStack
				: DEFAULT_BRANDING_FONT_STACK
	);
	const brandingFontFaceCss = $derived(
		$brandingStore.hydrated
			? $brandingStore.font.fontFaceCss
			: typeof data.brandingFont?.fontFaceCss === 'string' &&
				  data.brandingFont.fontFaceCss.trim().length > 0
				? data.brandingFont.fontFaceCss
				: null
	);

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
		const userId = authenticatedUserId;
		userSettingsStore.setCurrentUser(userId);
		if (userId) {
			void userSettingsStore.syncFromServer(userId);
		}
	});

	$effect(() => {
		brandingStore.setFromLayoutData({
			brandingTheme: brandingThemeFromData,
			brandingFont: brandingFontFromData
		});
	});

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
		html.style.setProperty('--org-font-sans', brandingFontCssStack);
		for (const [name, value] of brandingVarEntries) {
			html.style.setProperty(name, value);
		}

		return () => {
			body.classList.remove('app-shell-theme');
			html.style.removeProperty('--org-font-sans');
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
	{#if brandingFontFaceCss}
		{@html `<style id="org-uploaded-font-face">${brandingFontFaceCss}</style>`}
	{/if}
	{#if jsonLdScripts.length}
		{#each jsonLdIndexes as index (`jsonld-${index}`)}
			{@html `<script type="application/ld+json">${jsonLdScripts[index]}</script>`}
		{/each}
	{/if}
</svelte:head>

<Mode.Watcher defaultMode="light" />

{#if showImportSuccessIndicator}
	<div
		class={`fixed bottom-6 left-6 z-40 transition-all duration-300 ${successDismissing ? 'import-indicator-dismiss' : ''}`}
	>
		<a
			href={importSuccessHref ?? '#'}
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
	</div>
{/if}

{#if showActivityIndicator}
	<div class="fixed bottom-6 left-6 z-[60] sm:left-auto sm:right-6">
		<div class="group relative">
			{#if indicatorCanOpenImport}
				<a
					href={importIndicatorHref ?? '#'}
					class={`flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all hover:scale-105 ${
						indicatorIsErrorOnly
							? 'bg-red-500 text-white hover:bg-red-600'
							: 'bg-primary hover:bg-primary/90 text-white'
					}`}
					title="View import status"
				>
					{#if indicatorIsErrorOnly}
						<AlertCircle size={20} />
					{:else}
						<Loader2 size={20} class="animate-spin" />
					{/if}
				</a>
			{:else}
				<div
					class={`flex h-12 w-12 items-center justify-center rounded-full shadow-lg ${
						indicatorIsErrorOnly ? 'bg-red-500 text-white' : 'bg-primary text-white'
					}`}
				>
					{#if indicatorIsErrorOnly}
						<AlertCircle size={20} />
					{:else}
						<Loader2 size={20} class="animate-spin" />
					{/if}
				</div>
			{/if}

			<div
				class="border-border bg-card text-foreground pointer-events-none invisible absolute bottom-full left-0 mb-2 w-64 rounded-lg border p-3 text-left text-sm opacity-0 shadow-xl transition-all group-hover:visible group-hover:opacity-100 sm:left-auto sm:right-0"
			>
				<div class="flex flex-col gap-2">
					{#if hasDownloadActivityCard}
						<div class="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
							<p class="mb-1 font-semibold text-slate-900">Downloading Resume</p>
							<p class="text-xs text-slate-600">{downloadLabel ?? 'Preparing file download...'}</p>
						</div>
					{/if}

					{#if hasImportActivityCard}
						<div
							class={`rounded-md border px-3 py-2 ${
								importHasError ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50'
							}`}
						>
							<p class={`mb-1 font-semibold ${importHasError ? 'text-red-700' : 'text-slate-900'}`}>
								{importHasError ? 'Import Failed' : 'Importing PDF'}
							</p>
							{#if importFilename}
								<p class="mb-1 truncate text-xs text-slate-600">{importFilename}</p>
							{/if}
							{#if importError}
								<p class="text-xs text-red-600">{importError}</p>
							{:else}
								<p class="text-xs text-slate-600">{statusLabel || 'Processing...'}</p>
							{/if}
						</div>
					{/if}
				</div>
				{#if indicatorCanOpenImport}
					<p class="text-muted-fg mt-2 text-[11px]">Click to view import details</p>
				{/if}
			</div>
		</div>
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
		<MenuLayout
			profile={data.profile}
			role={layoutRole}
			roles={layoutRoles}
			currentTalentId={data.currentTalentId ?? null}
			userEmail={data.user?.email ?? null}
			{unauthorizedMessage}
		>
			{@render children?.()}
		</MenuLayout>
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
		background: linear-gradient(
			90deg,
			color-mix(in oklab, var(--color-primary) 65%, white) 0%,
			var(--color-primary) 45%,
			color-mix(in oklab, var(--color-primary) 82%, black) 100%
		);
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
