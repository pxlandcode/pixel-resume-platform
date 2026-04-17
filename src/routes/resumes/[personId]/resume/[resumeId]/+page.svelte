<script lang="ts">
	import { deserialize } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Button, Card, Toaster, toast } from '@pixelcode_/blocks/components';
	import { AlertCircle, ArrowLeft, Download, Edit, RotateCcw, Save, Share2, X } from 'lucide-svelte';
	import ResumeView from '$lib/components/resumes/ResumeView.svelte';
	import ResumeShareDrawer from '$lib/components/resumes/ResumeShareDrawer.svelte';
	import Drawer from '$lib/components/drawer/drawer.svelte';
	import { confirm } from '$lib/utils/confirm';
	import { fly } from 'svelte/transition';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { loading } from '$lib/stores/loading';
	import { resumeDownloadStore } from '$lib/stores/resumeDownloadStore';
	import { onMount } from 'svelte';
	import {
		DEFAULT_ORGANISATION_BRANDING_THEME,
		organisationBrandingThemeToInlineStyle
	} from '$lib/branding/theme';
	import type { ExperienceLibraryItem, ResumeData } from '$lib/types/resume';
	import {
		type ResumeDraftRecord,
		clearResumeDraft,
		normalizeResumeDraftData,
		readResumeDraft,
		writeResumeDraft
	} from '$lib/resumes/drafts';
	import { cloneResumeDataValue } from '$lib/resumes/clone';
	import type {
		ResumeAiGenerateParams,
		ResumeAiGenerateResult
	} from '$lib/components/resumes/components/utils';

	let { data } = $props();

	const canEdit = $derived(data.canEdit ?? false);
	let showDownloadOptions = $state(false);
	let viewLanguage: 'sv' | 'en' = $state((data.language as 'sv' | 'en') ?? 'sv');
	let downloadLanguageOverride: 'sv' | 'en' | null = $state(null);
	let downloadAnonymized = $state(false);
	let shareDrawerOpen = $state(false);
	const downloadLanguage = $derived(downloadLanguageOverride ?? viewLanguage);
	let isEditing = $state(false);
	let saving = $state(false);
	let downloading: 'pdf' | 'word' | null = $state(null);
	let errorMessage = $state<string | null>(null);
	let toasterHydrated = $state(false);
	let experienceLibrary = $state<ExperienceLibraryItem[]>(data.experienceLibrary ?? []);
	let experienceLibraryLoaded = $state(Boolean(data.experienceLibraryLoaded));
	let loadingExperienceLibrary = $state(false);
	let previousResumeId: string | null = null;
	let latestEditedResumeData: ResumeData = structuredClone(data.resume.data);
	let resumeViewEditingDataGetter: (() => ResumeData) | null = null;
	let resumeEditorSeed = $state<typeof data.resume.data | null>(null);
	let draftRestoreHandledForResumeId: string | null = null;
	let editingDataSeedKey = $state(0);
	let lastPersistedDraftSignature: string | null = null;
	type DraftRestorePromptState = {
		draft: ResumeDraftRecord;
		savedAtLabel: string | null;
		sourceChanged: boolean;
	};
	let draftRestorePrompt = $state<DraftRestorePromptState | null>(null);
	let draftRestoreDrawerOpen = $state(false);
	const registerEditingDataGetter = (getter: () => ResumeData) => {
		resumeViewEditingDataGetter = getter;
	};

	$effect(() => {
		const nextResumeId = data.resume.id;
		if (nextResumeId === previousResumeId) return;
		previousResumeId = nextResumeId;
		showDownloadOptions = false;
		viewLanguage = (data.language as 'sv' | 'en') ?? 'sv';
		downloadLanguageOverride = null;
		downloadAnonymized = false;
		shareDrawerOpen = false;
		isEditing = false;
		saving = false;
		downloading = null;
		errorMessage = null;
		experienceLibrary = data.experienceLibrary ?? [];
		experienceLibraryLoaded = Boolean(data.experienceLibraryLoaded);
		loadingExperienceLibrary = false;
		latestEditedResumeData = structuredClone(data.resume.data);
		resumeEditorSeed = null;
		draftRestoreHandledForResumeId = null;
		editingDataSeedKey = 0;
		lastPersistedDraftSignature = null;
		draftRestorePrompt = null;
		draftRestoreDrawerOpen = false;
	});

	$effect(() => {
		if (!canEdit) {
			isEditing = false;
		}
	});

	const navigationOrigin = $derived.by<'resumes' | 'talents'>(() =>
		$page.url.searchParams.get('from') === 'talents' ? 'talents' : 'resumes'
	);
	const personName = $derived(data.resumePerson?.name ?? 'Resume');
	const talentProfileHref = $derived.by(() => {
		const target = resolve('/resumes/[personId]', { personId: data.resume.personId });
		return navigationOrigin === 'talents' ? `${target}?from=talents` : target;
	});
	const authenticatedUserId = $derived(
		typeof $page.data.user?.id === 'string' ? $page.data.user.id : null
	);
	const avatarImage = $derived(data.avatarUrl ?? data.resumePerson?.avatar_url ?? null);
	const resumeTemplateBrandingStyle = $derived.by(() => {
		const theme = data.templateContext?.brandingTheme ?? DEFAULT_ORGANISATION_BRANDING_THEME;
		const inlineVars = organisationBrandingThemeToInlineStyle(theme);
		return `${inlineVars}; --color-primary: ${theme.light.primary};`;
	});
	const downloadBaseName = $derived(() => {
		if (downloadAnonymized) {
			return downloadLanguage === 'sv' ? 'anonymized-cv' : 'anonymized-resume';
		}
		const name = (personName ?? 'Resume').trim();
		const kind = downloadLanguage === 'sv' ? 'CV' : 'Resume';
		return `${name} - Pixel&Code - ${kind}`;
	});
	const serializeDraft = (value: ResumeData) => JSON.stringify(normalizeResumeDraftData(value));
	const savedResumeSignature = $derived(serializeDraft(data.resume.data));
	const clearCurrentDraft = () => clearResumeDraft(data.resume.id, authenticatedUserId);
	const getCurrentEditedResumeData = (): ResumeData => {
		const snapshot = resumeViewEditingDataGetter?.();
		if (snapshot) {
			latestEditedResumeData = snapshot;
		}
		return latestEditedResumeData;
	};
	const closeDraftRestoreDrawer = () => {
		draftRestoreDrawerOpen = false;
		draftRestorePrompt = null;
	};
	const discardStoredDraft = () => {
		clearCurrentDraft();
		closeDraftRestoreDrawer();
	};
	const restoreStoredDraft = () => {
		if (!draftRestorePrompt) return;
		const restoredDraft = cloneResumeDataValue(draftRestorePrompt.draft.data);
		latestEditedResumeData = restoredDraft;
		resumeEditorSeed = restoredDraft;
		editingDataSeedKey += 1;
		lastPersistedDraftSignature = serializeDraft(restoredDraft);
		isEditing = true;
		errorMessage = null;
		closeDraftRestoreDrawer();
		if (typeof toast.success === 'function') {
			toast.success('Restored unsaved resume draft.');
		} else {
			toast('Restored unsaved resume draft.');
		}
	};
	const persistCurrentDraft = () => {
		if (!canEdit || !isEditing) {
			clearCurrentDraft();
			lastPersistedDraftSignature = null;
			return;
		}

		const currentEditedResumeData = getCurrentEditedResumeData();
		const currentSignature = serializeDraft(currentEditedResumeData);
		if (currentSignature === savedResumeSignature) {
			clearCurrentDraft();
			lastPersistedDraftSignature = currentSignature;
			return;
		}

		writeResumeDraft(
			data.resume.id,
			authenticatedUserId,
			currentEditedResumeData,
			data.resume.updatedAt ?? null
		);
		lastPersistedDraftSignature = currentSignature;
	};

	const getErrorMessage = (payload: unknown, fallback: string) => {
		if (!payload || typeof payload !== 'object') return fallback;
		const asRecord = payload as Record<string, unknown>;
		if (typeof asRecord.message === 'string') return asRecord.message;
		if (typeof asRecord.error === 'string') return asRecord.error;
		const nested = asRecord.data;
		if (nested && typeof nested === 'object') {
			const nestedRecord = nested as Record<string, unknown>;
			if (typeof nestedRecord.message === 'string') return nestedRecord.message;
			if (typeof nestedRecord.error === 'string') return nestedRecord.error;
		}
		return fallback;
	};

	const parseActionResponse = async (response: Response, fallback: string) => {
		if (response.redirected && response.url) {
			return {
				type: 'redirect' as const,
				location: response.url,
				payload: null,
				message: fallback
			};
		}

		let result: {
			type?: string;
			data?: Record<string, unknown>;
			location?: string;
		};
		try {
			result = deserialize(await response.text()) as typeof result;
		} catch {
			return {
				type: 'error',
				location: null,
				payload: null,
				message: fallback
			};
		}
		const payload = result.data ?? null;

		return {
			type: result.type ?? 'error',
			location: typeof result.location === 'string' ? result.location : null,
			payload,
			message: getErrorMessage(payload, fallback)
		};
	};

	const parseGenerateResult = (payload: unknown): ResumeAiGenerateResult | null => {
		if (!payload || typeof payload !== 'object') return null;
		const record = payload as Record<string, unknown>;
		const result = record.result;
		if (!result || typeof result !== 'object') return null;

		const resultRecord = result as Record<string, unknown>;
		const parsed: ResumeAiGenerateResult = {
			descriptionHtml:
				typeof resultRecord.descriptionHtml === 'string' ? resultRecord.descriptionHtml : ''
		};

		if (Array.isArray(resultRecord.skills)) {
			const skills = resultRecord.skills
				.filter((entry): entry is string => typeof entry === 'string')
				.map((entry) => entry.trim())
				.filter(Boolean);
			if (skills.length > 0) {
				parsed.skills = skills;
			}
		}

		if (typeof resultRecord.company === 'string' && resultRecord.company.trim()) {
			parsed.company = resultRecord.company.trim();
		}
		if (typeof resultRecord.role === 'string' && resultRecord.role.trim()) {
			parsed.role = resultRecord.role.trim();
		}
		if (typeof resultRecord.location === 'string' && resultRecord.location.trim()) {
			parsed.location = resultRecord.location.trim();
		}
		if (Array.isArray(resultRecord.technologies)) {
			const technologies = resultRecord.technologies
				.filter((entry): entry is string => typeof entry === 'string')
				.map((entry) => entry.trim())
				.filter(Boolean);
			if (technologies.length > 0) {
				parsed.technologies = technologies;
			}
		}
		if (typeof resultRecord.startDate === 'string' && resultRecord.startDate.trim()) {
			parsed.startDate = resultRecord.startDate.trim();
		}
		if (resultRecord.endDate === null) {
			parsed.endDate = null;
		} else if (typeof resultRecord.endDate === 'string' && resultRecord.endDate.trim()) {
			parsed.endDate = resultRecord.endDate.trim();
		}

		const hasMeaningfulContent = Boolean(
			parsed.descriptionHtml.trim() ||
				(parsed.skills?.length ?? 0) > 0 ||
				parsed.company ||
				parsed.role ||
				parsed.location ||
				(parsed.technologies?.length ?? 0) > 0 ||
				parsed.startDate ||
				parsed.endDate !== undefined
		);
		if (!hasMeaningfulContent) {
			return null;
		}

		return parsed;
	};

	const generateDescription = async (
		input: ResumeAiGenerateParams
	): Promise<ResumeAiGenerateResult> => {
		const response = await fetch(`/api/resumes/${data.resume.id}/ai-write`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				...input,
				consultantName: personName
			})
		});
		const payload = await response.json().catch(() => null);
		if (!response.ok) {
			throw new Error(getErrorMessage(payload, 'Failed to generate text'));
		}

		const result = parseGenerateResult(payload);
		if (!result) {
			throw new Error('AI response was empty');
		}
		return result;
	};

	const loadExperienceLibrary = async () => {
		if (!canEdit || loadingExperienceLibrary || experienceLibraryLoaded) return;

		loadingExperienceLibrary = true;
		try {
			const response = await fetch(`/internal/api/resumes/${data.resume.id}/experience-library`, {
				method: 'GET',
				credentials: 'include'
			});
			const payload = await response.json().catch(() => null);
			if (!response.ok) {
				throw new Error(
					getErrorMessage(payload, 'Could not load experience library for this talent.')
				);
			}

			const items =
				payload &&
				typeof payload === 'object' &&
				Array.isArray((payload as { items?: unknown }).items)
					? (((payload as { items?: unknown }).items as ExperienceLibraryItem[] | undefined) ?? [])
					: [];
			experienceLibrary = items;
			experienceLibraryLoaded = true;
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: 'Could not load experience library for this talent.';
			if (typeof toast.error === 'function') {
				toast.error(message);
			} else {
				toast(message);
			}
		} finally {
			loadingExperienceLibrary = false;
		}
	};

	$effect(() => {
		if (!isEditing || !canEdit) return;
		void loadExperienceLibrary();
	});

	$effect(() => {
		if (!browser || !canEdit) return;
		const resumeId = data.resume.id;
		if (!resumeId || draftRestoreHandledForResumeId === resumeId) return;

		draftRestoreHandledForResumeId = resumeId;

		const draft = readResumeDraft(resumeId, authenticatedUserId);
		if (!draft) return;

		const draftSignature = serializeDraft(draft.data);
		if (draftSignature === savedResumeSignature) {
			clearCurrentDraft();
			return;
		}

		const savedAtLabel = draft.savedAt ? new Date(draft.savedAt).toLocaleString() : null;
		const sourceChanged =
			draft.sourceUpdatedAt !== null && draft.sourceUpdatedAt !== (data.resume.updatedAt ?? null);
		draftRestorePrompt = {
			draft,
			savedAtLabel,
			sourceChanged
		};
		draftRestoreDrawerOpen = true;
	});

	$effect(() => {
		if (!browser || !canEdit) return;
		const resumeId = data.resume.id;
		const userId = authenticatedUserId;
		const isRestorePending =
			draftRestoreHandledForResumeId !== resumeId || draftRestorePrompt !== null;

		if (!resumeId) return;
		if (!isEditing) {
			if (!isRestorePending) {
				clearResumeDraft(resumeId, userId);
			}
			lastPersistedDraftSignature = null;
			return;
		}

		const intervalId = window.setInterval(() => {
			const currentEditedResumeData = getCurrentEditedResumeData();
			const currentSignature = serializeDraft(currentEditedResumeData);
			const dirty = currentSignature !== savedResumeSignature;

			if (!dirty) {
				if (!isRestorePending) {
					clearResumeDraft(resumeId, userId);
				}
				lastPersistedDraftSignature = currentSignature;
				return;
			}

			if (currentSignature === lastPersistedDraftSignature) {
				return;
			}

			writeResumeDraft(resumeId, userId, currentEditedResumeData, data.resume.updatedAt ?? null);
			lastPersistedDraftSignature = currentSignature;
		}, 700);

		return () => {
			window.clearInterval(intervalId);
		};
	});

	onMount(() => {
		toasterHydrated = true;
	});

	const seedEditorFromSavedResume = () => {
		const savedResume = cloneResumeDataValue(data.resume.data);
		latestEditedResumeData = savedResume;
		resumeEditorSeed = savedResume;
		editingDataSeedKey += 1;
		errorMessage = null;
	};

	const startEditing = () => {
		if (!canEdit) return;
		seedEditorFromSavedResume();
		isEditing = true;
	};

	const discardEditing = () => {
		if (!canEdit) return;
		clearCurrentDraft();
		seedEditorFromSavedResume();
		isEditing = false;
	};

	const handleSave = async () => {
		if (!canEdit) return;
		saving = true;
		errorMessage = null;
		loading(true, 'Saving resume...');
		try {
			const currentEditedResumeData = getCurrentEditedResumeData();
			latestEditedResumeData = currentEditedResumeData;
			persistCurrentDraft();
			const formData = new FormData();
			formData.set('content', JSON.stringify(currentEditedResumeData));
			const response = await fetch('?/saveResume', {
				method: 'POST',
				body: formData
			});
			const result = await parseActionResponse(response, 'Failed to save resume');
			if (result.type === 'redirect' && result.location) {
				window.location.assign(result.location);
				return;
			}
			if (result.type !== 'success') {
				throw new Error(result.message);
			}
			isEditing = false;
			clearCurrentDraft();
			if (typeof toast.success === 'function') {
				toast.success('Resume saved!');
			} else {
				toast('Resume saved!');
			}
			// Refetch page data to update the view with saved content
			await invalidateAll();
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to save resume';
			if (typeof toast.error === 'function') {
				toast.error(errorMessage);
			} else {
				toast(errorMessage);
			}
		} finally {
			saving = false;
			loading(false);
		}
	};

	const downloadFile = async (type: 'pdf' | 'word') => {
		const extension = type === 'pdf' ? 'pdf' : 'doc';
		const label = type === 'pdf' ? 'Generating PDF...' : 'Generating Word file...';
		const params = new URLSearchParams({ lang: downloadLanguage });
		if (downloadAnonymized) {
			params.set('anonymize', '1');
		}
		if (type === 'pdf') {
			params.set('debug', '1');
		}
		const url = `/api/resumes/${data.resume.id}/${type}?${params.toString()}`;
		const filename = `${downloadBaseName}.${extension}`;
		const ensureExtension = (rawName: string, ext: string) => {
			const cleaned = rawName.trim();
			if (!cleaned) return filename;
			return cleaned.toLowerCase().endsWith(`.${ext}`) ? cleaned : `${cleaned}.${ext}`;
		};

		downloading = type;
		loading(true, label);
		resumeDownloadStore.start(type, label);
		showDownloadOptions = false;

		try {
			const response = await fetch(url, { credentials: 'include' });
			if (!response.ok) {
				const detail = await response.json().catch(() => null);
				throw new Error(detail?.message ?? 'Failed to download file');
			}
			const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
			if (type === 'pdf' && contentType.includes('application/json')) {
				const payload = await response.json().catch(() => null);
				const downloadUrl =
					payload && typeof payload === 'object' && typeof payload.downloadUrl === 'string'
						? payload.downloadUrl
						: '';
				const downloadFilename =
					payload && typeof payload === 'object' && typeof payload.filename === 'string'
						? payload.filename
						: filename;
				if (!downloadUrl) {
					throw new Error('Failed to prepare PDF download link');
				}
				const normalizedDownloadFilename = ensureExtension(downloadFilename, 'pdf');

				try {
					const downloadResponse = await fetch(downloadUrl);
					if (!downloadResponse.ok) {
						throw new Error(`Signed download failed (${downloadResponse.status})`);
					}
					const downloadBlob = await downloadResponse.blob();
					const objectUrl = URL.createObjectURL(downloadBlob);
					const link = document.createElement('a');
					link.href = objectUrl;
					link.download = normalizedDownloadFilename;
					link.rel = 'noopener';
					document.body.appendChild(link);
					link.click();
					link.remove();
					URL.revokeObjectURL(objectUrl);
				} catch (downloadError) {
					console.warn('[resume download] fallback to direct signed URL', downloadError);
					const link = document.createElement('a');
					link.href = downloadUrl;
					link.download = normalizedDownloadFilename;
					link.rel = 'noopener';
					document.body.appendChild(link);
					link.click();
					link.remove();
				}
			} else {
				const blob = await response.blob();
				const objectUrl = URL.createObjectURL(blob);
				const link = document.createElement('a');
				link.href = objectUrl;
				link.download = filename;
				link.rel = 'noopener';
				document.body.appendChild(link);
				link.click();
				link.remove();
				URL.revokeObjectURL(objectUrl);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to download file';
			if (typeof toast.error === 'function') {
				toast.error(message);
			} else {
				toast(message);
			}
		} finally {
			downloading = null;
			resumeDownloadStore.stop();
			loading(false);
		}
	};
</script>

<svelte:head>
	{#if data.templateContext?.mainFontFaceCss}
		{@html `<style id="resume-template-font-face">${data.templateContext.mainFontFaceCss}</style>`}
	{/if}
</svelte:head>

<div class="flex items-center justify-between">
	<div>
		<Button
			variant="ghost"
			href={talentProfileHref}
			class=" hover:text-primary pl-0 hover:bg-transparent"
		>
			<ArrowLeft size={16} class="mr-2" />
			Back to talent profile
		</Button>

		{#if errorMessage}
			<p class="text-red text-xs">{errorMessage}</p>
		{/if}
	</div>
</div>

{#if toasterHydrated}
	<Toaster />
{/if}

<!-- Fixed Edit/Save/Download Buttons in Bottom Right -->
<div class="fixed bottom-6 right-6 z-50 flex gap-2 print:hidden">
	{#if isEditing && canEdit}
		<span
			class="inline-flex"
			use:confirm={{
				title: 'Cancel editing?',
				description: 'Unsaved changes will be lost.',
				actionLabel: 'Discard changes',
				action: discardEditing
			}}
			>
				<Button variant="inverted" type="button" left={X}>Cancel</Button>
			</span>
			<Button
				variant="primary"
				onclick={handleSave}
				loading={saving}
				loading-text="Saving…"
				left={Save}
			>
				Save
			</Button>
	{:else}
		<div class="relative flex items-center gap-2">
			{#if showDownloadOptions}
				<div class="absolute bottom-14 right-0 flex flex-col items-end gap-2">
					<div transition:fly={{ y: 12, duration: 120 }}>
						<div
							class="border-border bg-card flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium shadow-sm"
						>
							<button
								type="button"
								class={downloadLanguage === 'sv'
									? 'bg-primary rounded-full px-2 py-0.5 text-white'
									: 'text-muted-fg hover:text-foreground px-2 py-0.5'}
								onclick={() => (downloadLanguageOverride = 'sv')}
							>
								SV
							</button>
							<button
								type="button"
								class={downloadLanguage === 'en'
									? 'bg-primary rounded-full px-2 py-0.5 text-white'
									: 'text-muted-fg hover:text-foreground px-2 py-0.5'}
								onclick={() => (downloadLanguageOverride = 'en')}
							>
								EN
							</button>
						</div>
					</div>
					<div transition:fly={{ y: 14, duration: 140 }}>
						<label
							class="border-border bg-card text-muted-fg flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium shadow-sm"
						>
							<input
								type="checkbox"
								class="accent-primary"
								checked={downloadAnonymized}
								onchange={(event) => (downloadAnonymized = event.currentTarget.checked)}
							/>
							Anonymize
						</label>
					</div>
					<div transition:fly={{ y: 16, duration: 160 }}>
						<Button
							size="sm"
							variant="outline"
							type="button"
							loading={downloading === 'word'}
							loading-text="Generating..."
							onclick={() => downloadFile('word')}
						>
							Word (Pre-beta)
						</Button>
					</div>
					<div transition:fly={{ y: 22, duration: 200 }}>
						<Button
							size="sm"
							variant="primary"
							type="button"
							loading={downloading === 'pdf'}
							loading-text="Generating..."
							left={Download}
							onclick={() => downloadFile('pdf')}
						>
							PDF
						</Button>
					</div>
				</div>
			{/if}

				<Button
					variant="inverted"
					left={Download}
					onclick={() => (showDownloadOptions = !showDownloadOptions)}
				>
					Download
				</Button>
				<Button variant="inverted" type="button" left={Share2} onclick={() => (shareDrawerOpen = true)}>
					Share
				</Button>
				{#if canEdit}
				<Button
					variant="primary"
					left={Edit}
					onclick={startEditing}
				>
					Edit
				</Button>
			{/if}
		</div>
	{/if}
</div>

<div class="mt-6 space-y-4">
	<Card class="bg-card text-foreground">
		<div class="mt-4" style={resumeTemplateBrandingStyle}>
			<ResumeView
				data={data.resume.data}
				bind:language={viewLanguage}
				person={data.resumePerson ?? undefined}
				image={avatarImage ?? undefined}
				profileTechStack={data.resumePerson?.techStack}
				techCatalogOrganisationId={data.talentOrganisationId}
				templateMainLogotypeUrl={data.templateContext?.mainLogotypeUrl}
				templateAccentLogoUrl={data.templateContext?.accentLogoUrl}
				templateEndLogoUrl={data.templateContext?.endLogoUrl}
				templateHomepageUrl={data.templateContext?.homepageUrl}
				templateMainFontCssStack={data.templateContext?.mainFontCssStack}
				templateIsPixelCode={data.templateContext?.isPixelCode}
				editingDataSeed={resumeEditorSeed}
				{editingDataSeedKey}
				{experienceLibrary}
				onGenerateDescription={generateDescription}
				{registerEditingDataGetter}
				{isEditing}
			/>
		</div>
	</Card>
</div>

<Drawer
	variant="modal"
	bind:open={draftRestoreDrawerOpen}
	title="Unsaved draft found"
	subtitle="A local copy of this resume was saved on this device."
	class="w-full max-w-xl"
	dismissable={false}
	beforeClose={() => false}
>
	<div class="space-y-5">
		<div class="border-border bg-card rounded-sm border px-5 py-5 shadow-sm">
			<div class="flex items-start gap-4">
				<div class="bg-primary/10 text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
					<RotateCcw size={18} />
				</div>
				<div class="min-w-0 flex-1 space-y-2">
					<div class="flex flex-wrap items-center gap-2">
						<p class="text-foreground text-base font-semibold">Restore local draft</p>
						{#if draftRestorePrompt?.savedAtLabel}
							<span
								class="border-border bg-background text-muted-fg rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em]"
							>
								{draftRestorePrompt.savedAtLabel}
							</span>
						{/if}
					</div>
					<p class="text-muted-fg text-sm leading-6">
						Restore the unsaved local draft to continue where you left off, or discard it and
						keep the current saved resume.
					</p>
				</div>
			</div>
		</div>

		{#if draftRestorePrompt?.sourceChanged}
			<div class="rounded-sm border border-amber-200 bg-amber-50 px-4 py-3">
				<div class="flex items-start gap-3">
					<AlertCircle size={18} class="mt-0.5 shrink-0 text-amber-700" />
					<div class="space-y-1">
						<p class="text-sm font-semibold text-amber-900">Saved resume changed</p>
						<p class="text-sm leading-6 text-amber-800">
							This draft was created from an older saved version. Restoring it may overwrite
							newer saved changes when you save next time.
						</p>
					</div>
				</div>
			</div>
		{/if}

		<div class="flex flex-wrap justify-end gap-3">
			<Button
				type="button"
				variant="outline"
				class="border-rose-200 text-rose-700 hover:bg-rose-50"
				onclick={discardStoredDraft}
			>
				Discard local draft
			</Button>
			<Button type="button" variant="primary" onclick={restoreStoredDraft}>
				Restore draft
			</Button>
		</div>
	</div>
</Drawer>

<ResumeShareDrawer bind:open={shareDrawerOpen} resumeId={data.resume.id} />
