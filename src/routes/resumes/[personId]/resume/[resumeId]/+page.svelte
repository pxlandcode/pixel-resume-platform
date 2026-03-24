<script lang="ts">
	import { Button, Card, Icon, Toaster, toast } from '@pixelcode_/blocks/components';
	import { ArrowLeft, Download, Edit, Save, X } from 'lucide-svelte';
	import ResumeView from '$lib/components/resumes/ResumeView.svelte';
	import { fly } from 'svelte/transition';
	import { invalidateAll } from '$app/navigation';
	import { loading } from '$lib/stores/loading';
	import { resumeDownloadStore } from '$lib/stores/resumeDownloadStore';
	import {
		DEFAULT_ORGANISATION_BRANDING_THEME,
		organisationBrandingThemeToInlineStyle
	} from '$lib/branding/theme';
	import type { ExperienceLibraryItem } from '$lib/types/resume';
	import type {
		ResumeAiGenerateParams,
		ResumeAiGenerateResult
	} from '$lib/components/resumes/components/utils';

	let { data } = $props();

	const canEdit = $derived(data.canEdit ?? false);
	let showDownloadOptions = $state(false);
	let viewLanguage: 'sv' | 'en' = $state((data.language as 'sv' | 'en') ?? 'sv');
	let downloadLanguageOverride: 'sv' | 'en' | null = $state(null);
	const downloadLanguage = $derived(downloadLanguageOverride ?? viewLanguage);
	let isEditing = $state(false);
	let saving = $state(false);
	let downloading: 'pdf' | 'word' | null = $state(null);
	let errorMessage = $state<string | null>(null);
	let resumeViewRef: ReturnType<typeof ResumeView> | null = $state(null);
	let experienceLibrary = $state<ExperienceLibraryItem[]>(data.experienceLibrary ?? []);
	let experienceLibraryLoaded = $state(Boolean(data.experienceLibraryLoaded));
	let loadingExperienceLibrary = $state(false);
	let previousResumeId = $state<string | null>(null);

	$effect(() => {
		const nextResumeId = data.resume.id;
		if (nextResumeId === previousResumeId) return;
		previousResumeId = nextResumeId;
		showDownloadOptions = false;
		viewLanguage = (data.language as 'sv' | 'en') ?? 'sv';
		downloadLanguageOverride = null;
		isEditing = false;
		saving = false;
		downloading = null;
		errorMessage = null;
		resumeViewRef = null;
		experienceLibrary = data.experienceLibrary ?? [];
		experienceLibraryLoaded = Boolean(data.experienceLibraryLoaded);
		loadingExperienceLibrary = false;
	});

	$effect(() => {
		if (!canEdit) {
			isEditing = false;
		}
	});

	const personName = $derived(data.resumePerson?.name ?? 'Resume');
	const avatarImage = $derived(data.avatarUrl ?? data.resumePerson?.avatar_url ?? null);
	const resumeTemplateBrandingStyle = $derived.by(() => {
		const theme = data.templateContext?.brandingTheme ?? DEFAULT_ORGANISATION_BRANDING_THEME;
		const inlineVars = organisationBrandingThemeToInlineStyle(theme);
		return `${inlineVars}; --color-primary: ${theme.light.primary};`;
	});
	const downloadBaseName = $derived(() => {
		const name = (personName ?? 'Resume').trim();
		const kind = downloadLanguage === 'sv' ? 'CV' : 'Resume';
		return `${name} - Pixel&Code - ${kind}`;
	});

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

	const handleCancel = () => {
		if (!canEdit) return;
		if (confirm('Are you sure you want to cancel? Unsaved changes will be lost.')) {
			window.location.reload();
		}
	};

	const handleSave = async () => {
		if (!canEdit) return;
		if (!resumeViewRef) return;
		saving = true;
		errorMessage = null;
		loading(true, 'Saving resume...');
		try {
			const content = resumeViewRef.getEditedData();
			const formData = new FormData();
			formData.set('content', JSON.stringify(content));
			const response = await fetch('?/saveResume', {
				method: 'POST',
				body: formData
			});
			if (!response.ok) {
				const detail = await response.json().catch(() => null);
				throw new Error(detail?.message ?? 'Failed to save resume');
			}
			isEditing = false;
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
		const debugParam = type === 'pdf' ? '&debug=1' : '';
		const url = `/api/resumes/${data.resume.id}/${type}?lang=${downloadLanguage}${debugParam}`;
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
		<Button variant="ghost" href="/resumes" class=" hover:text-primary pl-0 hover:bg-transparent">
			<ArrowLeft size={16} class="mr-2" />
			Back to resumes
		</Button>

		{#if errorMessage}
			<p class="text-red text-xs">{errorMessage}</p>
		{/if}
	</div>
</div>

<Toaster richColors position="top-center" closeButton />

<!-- Fixed Edit/Save/Download Buttons in Bottom Right -->
<div class="fixed bottom-6 right-6 z-50 flex gap-2 print:hidden">
	{#if isEditing && canEdit}
		<Button variant="inverted" onclick={handleCancel}>
			<Icon icon={X} size="sm" />
			Cancel
		</Button>
		<Button variant="primary" onclick={handleSave} loading={saving} loading-text="Saving…">
			<Icon icon={Save} size="sm" />
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
							onclick={() => downloadFile('pdf')}
						>
							<Icon icon={Download} size="sm" />
							PDF
						</Button>
					</div>
				</div>
			{/if}

			<Button variant="inverted" onclick={() => (showDownloadOptions = !showDownloadOptions)}>
				<Icon icon={Download} size="sm" />
				Download
			</Button>
			{#if canEdit}
				<Button
					variant="primary"
					onclick={() => {
						isEditing = true;
					}}
				>
					<Icon icon={Edit} size="sm" />
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
				bind:this={resumeViewRef}
				bind:language={viewLanguage}
				person={data.resumePerson ?? undefined}
				image={avatarImage ?? undefined}
				profileTechStack={data.resumePerson?.techStack}
				templateMainLogotypeUrl={data.templateContext?.mainLogotypeUrl}
				templateAccentLogoUrl={data.templateContext?.accentLogoUrl}
				templateEndLogoUrl={data.templateContext?.endLogoUrl}
				templateHomepageUrl={data.templateContext?.homepageUrl}
				templateMainFontCssStack={data.templateContext?.mainFontCssStack}
				templateIsPixelCode={data.templateContext?.isPixelCode}
				{experienceLibrary}
				onGenerateDescription={generateDescription}
				{isEditing}
			/>
		</div>
	</Card>
</div>
