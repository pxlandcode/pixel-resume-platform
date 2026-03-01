<script lang="ts">
	import { Button, Checkbox, Datepicker, Input, Radio } from '@pixelcode_/blocks/components';
	import {
		ArrowLeft,
		Calendar,
		Camera,
		CheckCircle2,
		Copy,
		FileText,
		Loader2,
		Trash2,
		Upload,
		User,
		AlertCircle
	} from 'lucide-svelte';
	import { base, resolve } from '$app/paths';
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/stores';
	import TechStackEditor from '$lib/components/tech-stack-editor/tech-stack-editor.svelte';
	import Drawer from '$lib/components/drawer/drawer.svelte';
	import ConsultantAvailabilityPills from '$lib/components/resumes/ConsultantAvailabilityPills.svelte';
	import { confirm } from '$lib/utils/confirm';
	import { loading } from '$lib/stores/loading';
	import { pdfImportStore } from '$lib/stores/pdfImportStore';
	import { get } from 'svelte/store';
	import { onDestroy, onMount, tick } from 'svelte';
	import Uppy from '@uppy/core';
	import Dashboard from '@uppy/dashboard';
	import type { UppyFile } from '@uppy/utils/lib/UppyFile';

	const { data, form } = $props();

	const profile = data.profile;
	const resumes = data.resumes ?? [];
	const availability = data.availability ?? null;
	const canEdit = data.canEdit ?? false;
	type ResumeListItem = (typeof resumes)[number];
	type TechCategory = { name?: string; skills?: string[] };
	const techStack = (profile?.tech_stack as TechCategory[]) ?? [];
	const viewCategories = $derived(
		(techStack ?? []).filter((cat) => Array.isArray(cat?.skills) && cat.skills.length > 0)
	);

	let isEditing = $state(false);
	let editingBio = $state(profile?.bio ?? '');
	let editingAvatarUrl = $state(profile?.avatar_url ?? '');
	let avatarUploadError = $state<string | null>(null);
	let avatarUploading = $state(false);
	let avatarFileInput = $state<HTMLInputElement | null>(null);
	let editingTechStack = $state(structuredClone(techStack));
	let editingHasAssignment = $state(true);
	let availabilityStatus = $state<'available-now' | 'on-assignment'>('on-assignment');
	let editingUseCustomAvailabilityPercentages = $state(false);
	let editingOpenToSwitchEarly = $state(false);
	let editingAvailabilityNowPercent = $state('');
	let editingAvailabilityFuturePercent = $state('');
	let editingAvailabilityNoticePeriodDays = $state('');
	let editingAvailabilityPlannedFromDate = $state('');
	const techStackJson = $derived(JSON.stringify(editingTechStack ?? []));

	const hasFutureAvailabilityTiming = $derived.by(() => {
		if (!editingHasAssignment) return false;
		if (editingAvailabilityPlannedFromDate.trim().length > 0) return true;
		if (!editingOpenToSwitchEarly) return false;
		return editingAvailabilityNoticePeriodDays.trim().length > 0;
	});

	const submittedAvailabilityNowPercent = $derived.by(() => {
		const defaultValue = editingHasAssignment ? '' : '100';
		if (!editingUseCustomAvailabilityPercentages) return defaultValue;
		const customValue = editingAvailabilityNowPercent.trim();
		return customValue.length > 0 ? customValue : defaultValue;
	});

	const submittedAvailabilityFuturePercent = $derived.by(() => {
		if (!editingHasAssignment) return '';
		if (!hasFutureAvailabilityTiming) return '';
		const defaultValue = '100';
		if (!editingUseCustomAvailabilityPercentages) return defaultValue;
		const customValue = editingAvailabilityFuturePercent.trim();
		return customValue.length > 0 ? customValue : defaultValue;
	});

	const submittedAvailabilityNoticePeriodDays = $derived.by(() => {
		if (!editingHasAssignment || !editingOpenToSwitchEarly) return '';
		return editingAvailabilityNoticePeriodDays.trim();
	});

	const submittedAvailabilityPlannedFromDate = $derived.by(() => {
		if (!editingHasAssignment) return '';
		return editingAvailabilityPlannedFromDate.trim();
	});
	const availabilityDatepickerOptions = {
		dateFormat: 'yyyy-MM-dd',
		clearButton: true
	};

	const resetAvailabilityEditor = () => {
		const nowPercent = availability?.nowPercent ?? null;
		const futurePercent = availability?.futurePercent ?? null;
		const noticePeriodDays = availability?.noticePeriodDays ?? null;
		const plannedFromDate = availability?.plannedFromDate ?? null;
		const hasFutureTiming = noticePeriodDays !== null || Boolean(plannedFromDate);
		const hasAssignment = !(nowPercent === 100 && noticePeriodDays === null && !plannedFromDate);

		editingHasAssignment = hasAssignment;
		availabilityStatus = hasAssignment ? 'on-assignment' : 'available-now';
		editingOpenToSwitchEarly = noticePeriodDays !== null;
		editingAvailabilityNowPercent = nowPercent === null ? '' : String(nowPercent);
		editingAvailabilityFuturePercent = futurePercent === null ? '' : String(futurePercent);
		editingAvailabilityNoticePeriodDays = noticePeriodDays === null ? '' : String(noticePeriodDays);
		editingAvailabilityPlannedFromDate = plannedFromDate ?? '';

		editingUseCustomAvailabilityPercentages = hasAssignment
			? nowPercent !== null || (hasFutureTiming && futurePercent !== null && futurePercent !== 100)
			: nowPercent !== null && nowPercent !== 100;
	};

	const resetProfileEditor = () => {
		editingBio = profile?.bio ?? '';
		editingAvatarUrl = profile?.avatar_url ?? '';
		avatarUploadError = null;
		avatarUploading = false;
		editingTechStack = structuredClone(techStack);
		resetAvailabilityEditor();
	};

	const displayedAvatarUrl = $derived(isEditing ? editingAvatarUrl : (profile?.avatar_url ?? ''));

	const handleAvatarUpload = async (
		event: Event & { currentTarget: EventTarget & HTMLInputElement }
	) => {
		const inputEl = event.currentTarget;
		const file = inputEl.files?.[0];
		if (!file) return;
		if (!file.type.startsWith('image/')) {
			avatarUploadError = 'Please choose an image file.';
			inputEl.value = '';
			return;
		}
		if (file.size > 5 * 1024 * 1024) {
			avatarUploadError = 'Image must be 5MB or smaller.';
			inputEl.value = '';
			return;
		}

		avatarUploadError = null;
		avatarUploading = true;

		try {
			const payload = new FormData();
			payload.set('file', file);

			const response = await fetch('/internal/api/users/upload-avatar', {
				method: 'POST',
				body: payload
			});
			const result = await response.json().catch(() => null);

			if (!response.ok || typeof result?.url !== 'string') {
				const message =
					typeof result?.message === 'string'
						? result.message
						: `Avatar upload failed (${response.status}).`;
				throw new Error(message);
			}

			editingAvatarUrl = result.url;
		} catch (error) {
			avatarUploadError = error instanceof Error ? error.message : 'Avatar upload failed.';
		} finally {
			avatarUploading = false;
			inputEl.value = '';
		}
	};

	$effect(() => {
		editingHasAssignment = availabilityStatus === 'on-assignment';
	});

	const cancelProfileEdit = () => {
		resetProfileEditor();
		isEditing = false;
	};

	let resumeList = $state<ResumeListItem[]>(resumes ?? []);
	let draggedResume: ResumeListItem | null = $state(null);
	let dragOverIndex: number | null = $state(null);
	let importDrawerOpen = $state(false);
	let importDrawerWasOpened = $state(false);
	let importError = $state<string | null>(null);
	let showCloseConfirm = $state(false);
	let pendingCloseAction = $state<(() => void) | null>(null);
	let handledOpenImportParam = $state(false);
	type PdfImportPhase =
		| 'idle'
		| 'creating-job'
		| 'staging-file'
		| 'starting-background'
		| 'queued'
		| 'processing';
	type ResumeImportJobStatus = 'queued' | 'processing' | 'succeeded' | 'failed';
	type ResumeImportJobStatusResponse = {
		id: string;
		status: ResumeImportJobStatus;
		error_message: string | null;
		resume_id: string | null;
		resume_version_name: string | null;
		created_at: string | null;
		started_at: string | null;
		completed_at: string | null;
	};

	let importStatus = $state<PdfImportPhase>('idle');
	let uppyContainer: HTMLDivElement | null = null;
	let uppy: InstanceType<typeof Uppy> | null = null;
	let selectedImportFile = $state<UppyFile<Record<string, unknown>, Blob> | null>(null);
	let importAbortController: AbortController | null = null;
	let importPollAbortController: AbortController | null = null;
	let importJobId = $state<string | null>(null);
	let importPollTimeoutId: number | null = null;
	let importSourceFilename = $state<string | null>(null);
	const isImportBusy = $derived(importStatus !== 'idle');
	const isKickoffImporting = $derived(
		importStatus === 'creating-job' ||
			importStatus === 'staging-file' ||
			importStatus === 'starting-background'
	);
	const isBackgroundImporting = $derived(
		importStatus === 'queued' || importStatus === 'processing'
	);
	const importStatusLabel = $derived(
		importStatus === 'creating-job'
			? 'Preparing import...'
			: importStatus === 'staging-file'
				? 'Uploading PDF to secure temp storage...'
				: importStatus === 'starting-background'
					? 'Starting background import...'
					: importStatus === 'queued'
						? 'Queued import...'
						: importStatus === 'processing'
							? 'Importing and building resume...'
							: ''
	);

	// Sort resumes: main first, then by updated_at descending
	const sortedResumeList = $derived(
		[...resumeList].sort((a, b) => {
			// Main resume always first
			if (a.is_main && !b.is_main) return -1;
			if (!a.is_main && b.is_main) return 1;
			// Then by updated_at descending
			const dateA = new Date(a.updated_at ?? a.created_at ?? 0).getTime();
			const dateB = new Date(b.updated_at ?? b.created_at ?? 0).getTime();
			return dateB - dateA;
		})
	);

	const formatResumeCardDate = (value: string | null | undefined): string => {
		if (!value) return '—';
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return value;
		return new Intl.DateTimeFormat(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		}).format(parsed);
	};

	$effect(() => {
		resetProfileEditor();
		resumeList = [...(resumes ?? [])];
	});

	$effect(() => {
		if (!canEdit) {
			isEditing = false;
		}
	});

	// Sync import state with global store (debounced to prevent loops)
	let lastSyncedState = $state<string | null>(null);
	$effect(() => {
		if (!profile || !canEdit) return;

		const stateKey = `${importJobId}-${importStatus}-${importError}`;
		if (stateKey === lastSyncedState) return;
		lastSyncedState = stateKey;

		if (importJobId && (isKickoffImporting || isBackgroundImporting)) {
			pdfImportStore.setImporting(profile.id, importJobId, importSourceFilename, importStatus);
		} else if (importError) {
			pdfImportStore.setError(importError);
		}
	});

	$effect(() => {
		if (!profile || !canEdit || handledOpenImportParam) return;
		const shouldOpen = $page.url.searchParams.get('openImport') === '1';
		if (shouldOpen) {
			handledOpenImportParam = true;
			replaceState(`/resumes/${encodeURIComponent(profile.id)}`, {});
			void openImportDrawer();
		}
	});

	const handleDragStart = (resume: ResumeListItem) => {
		if (!canEdit) return;
		draggedResume = resume;
	};

	const handleDragOver = (event: DragEvent, index: number) => {
		if (!canEdit) return;
		event.preventDefault();
		dragOverIndex = index;
	};

	const handleDragLeave = () => {
		dragOverIndex = null;
	};

	const reorderResumes = (targetIndex: number) => {
		if (!canEdit) return;
		if (!draggedResume) return;
		const currentIndex = resumeList.findIndex((r) => r.id === draggedResume.id);
		if (currentIndex === -1 || currentIndex === targetIndex) return;
		const next = [...resumeList];
		next.splice(currentIndex, 1);
		next.splice(targetIndex, 0, draggedResume);
		// mark main
		resumeList = next.map((r, idx) => ({ ...r, is_main: idx === 0 }));
	};

	const saveOrder = async () => {
		if (!canEdit) return;
		loading(true, 'Saving order...');
		try {
			const order = resumeList.map((r) => r.id);
			const formData = new FormData();
			formData.set('talent_id', profile.id);
			formData.set('resume_order', JSON.stringify(order));
			await fetch('?/updateResumeOrder', { method: 'POST', body: formData });
		} finally {
			loading(false);
		}
	};

	const handleDrop = async (event: DragEvent, index: number) => {
		if (!canEdit) return;
		event.preventDefault();
		reorderResumes(index);
		draggedResume = null;
		dragOverIndex = null;
		await saveOrder();
	};

	const addResume = async () => {
		if (!canEdit) return;
		loading(true, 'Creating resume...');
		try {
			const formData = new FormData();
			formData.set('talent_id', profile.id);
			const res = await fetch('?/createResume', { method: 'POST', body: formData });
			if (res.ok) {
				// Refresh list
				location.reload();
			}
		} finally {
			loading(false);
		}
	};

	const setMainResume = async (resumeId: string) => {
		if (!canEdit) return;
		loading(true, 'Setting main resume...');
		try {
			const formData = new FormData();
			formData.set('resume_id', resumeId);
			const res = await fetch('?/setMainResume', { method: 'POST', body: formData });
			if (res.ok) {
				resumeList = resumeList.map((resume) => ({
					...resume,
					is_main: resume.id === resumeId
				}));
			}
		} finally {
			loading(false);
		}
	};

	const deleteResume = async (resumeId: string) => {
		if (!canEdit) return;
		const resume = resumeList.find((item) => item.id === resumeId);
		if (resume?.is_main) return;
		loading(true, 'Deleting resume...');
		try {
			const formData = new FormData();
			formData.set('resume_id', resumeId);
			const res = await fetch('?/deleteResume', { method: 'POST', body: formData });
			if (res.ok) {
				// Remove from local list
				resumeList = resumeList.filter((r) => r.id !== resumeId);
			}
		} finally {
			loading(false);
		}
	};

	const copyResume = async (resumeId: string) => {
		if (!canEdit) return;
		loading(true, 'Copying resume...');
		try {
			const formData = new FormData();
			formData.set('resume_id', resumeId);
			const res = await fetch('?/copyResume', { method: 'POST', body: formData });
			if (res.ok) {
				location.reload();
			}
		} finally {
			loading(false);
		}
	};

	const destroyUppy = () => {
		if (!uppy) return;

		uppy.cancelAll();
		uppy.destroy();
		uppy = null;
	};

	const stopImportPolling = () => {
		if (importPollTimeoutId !== null) {
			window.clearTimeout(importPollTimeoutId);
			importPollTimeoutId = null;
		}
		importPollAbortController?.abort();
		importPollAbortController = null;
	};

	const clearPersistedImportJob = () => {
		pdfImportStore.clear();
	};

	const resetImportProcessState = () => {
		importAbortController?.abort();
		importAbortController = null;
		stopImportPolling();
		importStatus = 'idle';
		importError = null;
		importJobId = null;
		importSourceFilename = null;
		selectedImportFile = null;
		loading(false);
		pdfImportStore.clear();
	};

	const clearDrawerOnlyImportState = () => {
		importAbortController?.abort();
		importAbortController = null;
		selectedImportFile = null;
		loading(false);
	};

	const getErrorMessageFromResponse = async (response: Response, fallback: string) => {
		const contentType = response.headers.get('content-type') || '';
		if (contentType.includes('application/json')) {
			const payload = (await response.json().catch(() => null)) as { message?: unknown } | null;
			if (typeof payload?.message === 'string' && payload.message.trim()) {
				return payload.message;
			}
		}

		const text = (await response.text().catch(() => '')).trim();
		return text || fallback;
	};

	const createPdfImportJob = async (file: File): Promise<string> => {
		if (!profile) {
			throw new Error('Missing profile context.');
		}

		importStatus = 'creating-job';
		const controller = new AbortController();
		importAbortController = controller;

		const response = await fetch(resolve('/internal/api/resumes/import-from-pdf/jobs'), {
			method: 'POST',
			headers: {
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				talent_id: profile.id,
				filename: file.name,
				size_bytes: file.size
			}),
			credentials: 'include',
			signal: controller.signal
		});

		const payload = (await response.json().catch(() => null)) as {
			job_id?: unknown;
			message?: unknown;
		} | null;
		if (!response.ok) {
			const message =
				typeof payload?.message === 'string' && payload.message.trim()
					? payload.message
					: 'Could not start PDF import.';
			throw new Error(message);
		}

		const jobId = typeof payload?.job_id === 'string' ? payload.job_id : '';
		if (!jobId) {
			throw new Error('Import job created but no job ID was returned.');
		}

		return jobId;
	};

	const stagePdfImportFile = async (file: File, jobId: string) => {
		if (!profile) {
			throw new Error('Missing profile context.');
		}

		importStatus = 'staging-file';
		const controller = new AbortController();
		importAbortController = controller;

		const formData = new FormData();
		formData.set('talent_id', profile.id);
		formData.set('file', file);

		const response = await fetch(
			resolve('/internal/api/resumes/import-from-pdf/jobs/[jobId]/stage-file', { jobId }),
			{
				method: 'POST',
				body: formData,
				credentials: 'include',
				signal: controller.signal
			}
		);

		if (!response.ok) {
			const message = await getErrorMessageFromResponse(
				response,
				'Could not upload PDF to secure temp storage.'
			);
			throw new Error(message);
		}
	};

	const kickoffPdfImportBackground = async (jobId: string) => {
		if (!profile) {
			throw new Error('Missing profile context.');
		}

		importStatus = 'starting-background';
		const controller = new AbortController();
		importAbortController = controller;

		const response = await fetch(`${base}/.netlify/functions/resume-import-from-pdf-background`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json'
			},
			body: JSON.stringify({ job_id: jobId }),
			credentials: 'include',
			signal: controller.signal
		});

		if (!response.ok) {
			const message = await getErrorMessageFromResponse(
				response,
				'Could not start background PDF import.'
			);
			throw new Error(message);
		}
	};

	const handleImportJobSuccess = async (resumeId: string) => {
		if (!profile) return;
		stopImportPolling();
		importAbortController?.abort();
		importAbortController = null;
		loading(false);
		importDrawerOpen = false;
		importStatus = 'idle';
		importError = null;
		importJobId = null;
		importSourceFilename = null;
		selectedImportFile = null;
		destroyUppy();
		// Signal success to the store - this will show the success indicator in +layout.svelte
		pdfImportStore.setSuccess(resumeId);
	};

	const scheduleImportJobPoll = (jobId: string) => {
		if (importJobId !== jobId) return;
		importPollTimeoutId = window.setTimeout(() => {
			void pollImportJob(jobId);
		}, 2000);
	};

	const pollImportJob = async (jobId: string) => {
		if (!profile || importJobId !== jobId) return;

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
				const message = await getErrorMessageFromResponse(
					response,
					'Could not fetch PDF import status.'
				);
				throw new Error(message);
			}

			const payload = (await response.json()) as ResumeImportJobStatusResponse;
			if (importJobId !== jobId) return;

			if (payload.status === 'queued') {
				importStatus = 'queued';
				scheduleImportJobPoll(jobId);
				return;
			}

			if (payload.status === 'processing') {
				importStatus = 'processing';
				scheduleImportJobPoll(jobId);
				return;
			}

			if (payload.status === 'failed') {
				stopImportPolling();
				importStatus = 'idle';
				importJobId = null;
				clearPersistedImportJob();
				importError = payload.error_message || 'Could not import resume from PDF.';
				return;
			}

			const resumeId = payload.resume_id?.trim() || '';
			if (!resumeId) {
				throw new Error('PDF import finished but no resume ID was returned.');
			}

			await handleImportJobSuccess(resumeId);
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				return;
			}

			stopImportPolling();
			importStatus = 'idle';
			importJobId = null;
			clearPersistedImportJob();
			importError =
				error instanceof TypeError
					? 'Network error while checking import status. Please reopen the drawer and try again.'
					: error instanceof Error
						? error.message
						: 'Could not fetch PDF import status.';
		} finally {
			if (importPollAbortController === controller) {
				importPollAbortController = null;
			}
		}
	};

	const runPdfImport = async (sourceFile: UppyFile<Record<string, unknown>, Blob>) => {
		if (!profile || !canEdit || isImportBusy) return;
		const blob = sourceFile.data as Blob | undefined;
		if (!blob) {
			importError = 'Could not read selected PDF file.';
			return;
		}

		const file =
			blob instanceof File
				? blob
				: new File([blob], sourceFile.name || 'resume.pdf', {
						type: blob.type || 'application/pdf'
					});

		importError = null;
		importJobId = null;
		importSourceFilename = file.name || sourceFile.name || 'resume.pdf';
		loading(true, 'Starting PDF import...');

		try {
			const jobId = await createPdfImportJob(file);
			importJobId = jobId;

			await stagePdfImportFile(file, jobId);
			await kickoffPdfImportBackground(jobId);

			importAbortController = null;
			loading(false);
			importStatus = 'queued';
			await pollImportJob(jobId);
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				importError = 'Import cancelled.';
			} else if (error instanceof TypeError) {
				importError =
					'Network error while starting the PDF import. Check your proxy/firewall and browser Network tab.';
			} else {
				importError = error instanceof Error ? error.message : 'Could not import resume from PDF.';
			}
			importStatus = 'idle';
			importJobId = null;
			clearPersistedImportJob();
			stopImportPolling();
		} finally {
			importAbortController = null;
			loading(false);
		}
	};

	const initializeUppy = () => {
		if (!profile || !canEdit) return;
		if (!uppyContainer || uppy) return;

		uppy = new Uppy({
			autoProceed: false,
			allowMultipleUploads: false,
			restrictions: {
				maxNumberOfFiles: 1,
				maxFileSize: 10 * 1024 * 1024,
				allowedFileTypes: ['.pdf', 'application/pdf']
			}
		});

		uppy.use(Dashboard, {
			target: uppyContainer,
			inline: true,
			proudlyDisplayPoweredByUppy: false,
			hideUploadButton: true,
			disableStatusBar: true,
			showRemoveButtonAfterComplete: true,
			note: 'PDF up to 10MB'
		});

		uppy.on('file-added', (file) => {
			importError = null;
			selectedImportFile = file as UppyFile<Record<string, unknown>, Blob>;
		});

		uppy.on('file-removed', (file) => {
			if (selectedImportFile?.id === file.id) {
				selectedImportFile = null;
			}
		});

		uppy.on('restriction-failed', (_file, error) => {
			importError = error?.message || 'Invalid file. Please upload a PDF up to 10MB.';
		});
	};

	const importSelectedPdf = async () => {
		if (!selectedImportFile || isImportBusy) return;
		await runPdfImport(selectedImportFile);
	};

	const openImportDrawer = async () => {
		if (!profile || !canEdit) return;
		if (!isBackgroundImporting && !isKickoffImporting) {
			importError = null;
			importStatus = 'idle';
			importJobId = null;
			importSourceFilename = null;
		}
		selectedImportFile = null;
		importDrawerOpen = true;
		await tick();
		initializeUppy();
	};

	const closeImportDrawer = () => {
		if (!requestImportDrawerClose()) return;
		importDrawerOpen = false;
	};

	const requestImportDrawerClose = (): boolean => {
		if (isKickoffImporting) {
			showCloseConfirm = true;
			pendingCloseAction = () => {
				importAbortController?.abort();
				importDrawerOpen = false;
			};
			return false;
		}

		if (isBackgroundImporting) {
			// Just close - import continues in background
			return true;
		}

		return true;
	};

	const confirmClose = () => {
		showCloseConfirm = false;
		if (pendingCloseAction) {
			pendingCloseAction();
			pendingCloseAction = null;
		}
	};

	const cancelClose = () => {
		showCloseConfirm = false;
		pendingCloseAction = null;
	};

	$effect(() => {
		if (importDrawerOpen) {
			importDrawerWasOpened = true;
			void (async () => {
				await tick();
				initializeUppy();
			})();
			return;
		}

		// Only reset state if drawer was actually opened and then closed
		// (not on initial page load when drawer starts closed)
		if (!importDrawerWasOpened) return;

		if (isBackgroundImporting) {
			clearDrawerOnlyImportState();
			destroyUppy();
			return;
		}

		resetImportProcessState();
		destroyUppy();
	});

	onMount(() => {
		if (!profile || !canEdit) return;
		if (importJobId) return;

		// Check if store has a persisted job for this talent
		const storeState = get(pdfImportStore);
		if (storeState.talentId === profile.id && storeState.jobId && storeState.status !== 'idle') {
			importError = storeState.error;
			importJobId = storeState.jobId;
			importSourceFilename = storeState.sourceFilename;
			importStatus = storeState.status === 'processing' ? 'processing' : 'queued';

			void tick().then(() => {
				if (!importJobId || importJobId !== storeState.jobId) return;
				void pollImportJob(storeState.jobId);
			});
		}
	});

	onDestroy(() => {
		// Don't clear the store on destroy - let it persist across navigation
		importAbortController?.abort();
		importAbortController = null;
		stopImportPolling();
		loading(false);
		destroyUppy();
	});
</script>

<div class="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
	<div class="mb-8">
		<div class="mb-6 flex items-center justify-between">
			<Button variant="ghost" href="/resumes" class="hover:text-primary pl-0 hover:bg-transparent">
				<ArrowLeft size={16} class="mr-2" />
				Back to all talents
			</Button>

			{#if profile && canEdit}
				<div class="flex gap-2">
					{#if isEditing}
						<Button type="button" variant="ghost" onclick={cancelProfileEdit}>Cancel</Button>
						<Button form="profile-form" type="submit" variant="primary" disabled={avatarUploading}>
							Save profile
						</Button>
					{:else}
						<Button type="button" onclick={() => (isEditing = true)}>Edit profile</Button>
					{/if}
				</div>
			{/if}
		</div>

		{#if profile}
			<div class="flex flex-col gap-8 md:flex-row md:items-start">
				<div class="relative h-32 w-32 flex-shrink-0 md:h-48 md:w-48">
					<!-- Hidden file input for avatar upload -->
					<input
						bind:this={avatarFileInput}
						type="file"
						accept="image/*"
						class="hidden"
						onchange={handleAvatarUpload}
						disabled={avatarUploading}
					/>

					<!-- Avatar container -->
					<button
						type="button"
						class="border-border group relative h-full w-full overflow-hidden border-4 shadow-lg {isEditing &&
						canEdit
							? 'cursor-pointer'
							: 'cursor-default'}"
						onclick={() => isEditing && canEdit && !avatarUploading && avatarFileInput?.click()}
						disabled={!isEditing || !canEdit || avatarUploading}
					>
						{#if displayedAvatarUrl}
							<img
								src={displayedAvatarUrl}
								alt={[profile.first_name, profile.last_name].filter(Boolean).join(' ')}
								class="h-full w-full object-cover"
							/>
						{:else}
							<div class="bg-muted text-muted-fg flex h-full w-full items-center justify-center">
								<User size={48} />
							</div>
						{/if}

						<!-- Hover overlay when editing -->
						{#if isEditing && canEdit}
							<div
								class="absolute inset-0 flex flex-col items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 {avatarUploading
									? '!opacity-100'
									: ''}"
							>
								{#if avatarUploading}
									<Loader2 size={32} class="animate-spin text-white" />
									<span class="mt-2 text-xs font-medium text-white">Uploading...</span>
								{:else}
									<Camera size={32} class="text-white" />
									<span class="mt-2 text-xs font-medium text-white">
										{editingAvatarUrl ? 'Change photo' : 'Add photo'}
									</span>
								{/if}
							</div>
						{/if}
					</button>

					<!-- Remove avatar link -->
					{#if isEditing && canEdit && editingAvatarUrl && !avatarUploading}
						<button
							type="button"
							class="mt-2 w-full text-center text-xs text-red-400 transition-colors hover:text-red-500"
							onclick={() => {
								editingAvatarUrl = '';
								avatarUploadError = null;
							}}
						>
							Remove image
						</button>
					{/if}

					<!-- Avatar upload error -->
					{#if avatarUploadError}
						<p class="mt-2 text-center text-xs text-red-600">{avatarUploadError}</p>
					{/if}
				</div>

				<div class="flex-1 space-y-4">
					<form
						id="profile-form"
						method="POST"
						action="?/updateProfile"
						class="space-y-4"
						onsubmit={() => {
							// keep editing values
						}}
					>
						<input type="hidden" name="talent_id" value={profile.id} />
						<input type="hidden" name="tech_stack" value={techStackJson} />
						<input type="hidden" name="avatar_url" value={editingAvatarUrl} />
						<input
							type="hidden"
							name="availability_now_percent"
							value={submittedAvailabilityNowPercent}
						/>
						<input
							type="hidden"
							name="availability_future_percent"
							value={submittedAvailabilityFuturePercent}
						/>
						<input
							type="hidden"
							name="availability_notice_period_days"
							value={submittedAvailabilityNoticePeriodDays}
						/>
						<input
							type="hidden"
							name="availability_planned_from_date"
							value={submittedAvailabilityPlannedFromDate}
						/>

						{#if form?.message}
							<div
								class="rounded border px-3 py-2 text-sm
									{form.ok
									? 'border-emerald-200 bg-emerald-50 text-emerald-700'
									: 'border-red-200 bg-red-50 text-red-700'}"
							>
								{form.message}
							</div>
						{/if}

						<div>
							<h1 class="text-foreground text-3xl font-bold sm:text-4xl">
								{[profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'Unnamed'}
							</h1>
							{#if profile.title}
								<p class="text-primary mt-1 text-xl font-medium">{profile.title}</p>
							{/if}
							{#if data.organisation_logo_url || data.organisation_name}
								<div class="mt-3">
									{#if data.organisation_logo_url}
										<img
											src={data.organisation_logo_url}
											alt={data.organisation_name ?? 'Organisation'}
											class="h-5 w-auto object-contain"
										/>
									{:else}
										<span class="text-muted-fg text-xs font-medium">{data.organisation_name}</span>
									{/if}
								</div>
							{/if}
						</div>

						<div>
							{#if isEditing && canEdit}
								<textarea
									name="bio"
									bind:value={editingBio}
									class="border-border text-foreground w-full rounded border p-3 text-sm"
									rows="4"
									placeholder="Tell us about this talent"
								/>
							{:else if profile.bio}
								<p class="text-muted-fg max-w-2xl whitespace-pre-wrap text-sm leading-6">
									{profile.bio}
								</p>
							{:else}
								<p class="text-muted-fg text-sm">No bio yet.</p>
							{/if}
						</div>

						<div class="pt-2">
							<h3 class="text-foreground mb-2 text-lg font-semibold">Availability</h3>

							{#if isEditing && canEdit}
								<div class="space-y-4">
									<input
										type="hidden"
										name="availability_now_percent"
										value={submittedAvailabilityNowPercent}
									/>
									<input
										type="hidden"
										name="availability_future_percent"
										value={submittedAvailabilityFuturePercent}
									/>
									<input
										type="hidden"
										name="availability_notice_period_days"
										value={submittedAvailabilityNoticePeriodDays}
									/>
									<input
										type="hidden"
										name="availability_planned_from_date"
										value={submittedAvailabilityPlannedFromDate}
									/>

									<!-- Current status -->
									<div class="border-border bg-card rounded-lg border p-5">
										<p class="text-foreground mb-3 text-sm font-medium">Current status</p>
										<div class="flex flex-col gap-2" role="radiogroup" aria-label="Current status">
											<div
												class="hover:bg-muted flex cursor-pointer items-center gap-3 rounded-md p-2"
												role="radio"
												tabindex="0"
												aria-checked={availabilityStatus === 'available-now'}
												onclick={() => (availabilityStatus = 'available-now')}
												onkeydown={(event) => {
													if (event.key === 'Enter' || event.key === ' ') {
														event.preventDefault();
														availabilityStatus = 'available-now';
													}
												}}
											>
												<Radio
													name="availability-status"
													value="available-now"
													bind:group={availabilityStatus}
												/>
												<div>
													<span class="text-foreground text-sm font-medium">Available now</span>
													<span class="text-muted-fg ml-2 text-xs">100% available immediately</span>
												</div>
											</div>
											<div
												class="hover:bg-muted flex cursor-pointer items-center gap-3 rounded-md p-2"
												role="radio"
												tabindex="0"
												aria-checked={availabilityStatus === 'on-assignment'}
												onclick={() => (availabilityStatus = 'on-assignment')}
												onkeydown={(event) => {
													if (event.key === 'Enter' || event.key === ' ') {
														event.preventDefault();
														availabilityStatus = 'on-assignment';
													}
												}}
											>
												<Radio
													name="availability-status"
													value="on-assignment"
													bind:group={availabilityStatus}
												/>
												<div>
													<span class="text-foreground text-sm font-medium">On assignment</span>
													<span class="text-muted-fg ml-2 text-xs">Currently busy</span>
												</div>
											</div>
										</div>
									</div>

									<!-- Assignment details (only when on assignment) -->
									{#if editingHasAssignment}
										<div class="border-border bg-card rounded-lg border p-5">
											<p class="text-foreground mb-4 text-sm font-medium">Assignment details</p>
											<div class="space-y-4">
												<div>
													<label
														for="availability-planned-date"
														class="text-muted-fg mb-1.5 block text-sm font-medium"
													>
														Assignment end date
													</label>
													<Datepicker
														id="availability-planned-date"
														bind:value={editingAvailabilityPlannedFromDate}
														options={availabilityDatepickerOptions}
														class="bg-card text-foreground w-full max-w-xs !pl-11"
														placeholder="YYYY-MM-DD"
													/>
													<p class="text-muted-fg mt-1 text-xs">
														When will the current assignment end?
													</p>
												</div>

												<div class="border-border/70 border-t pt-4">
													<Checkbox bind:checked={editingOpenToSwitchEarly}>
														<span class="text-foreground text-sm font-medium">
															Open to switching early
														</span>
													</Checkbox>

													{#if editingOpenToSwitchEarly}
														<div class="ml-7 mt-3">
															<label
																for="availability-notice-period-days"
																class="text-muted-fg mb-1.5 block text-sm font-medium"
															>
																Notice period (days)
															</label>
															<Input
																id="availability-notice-period-days"
																type="text"
																inputmode="numeric"
																bind:value={editingAvailabilityNoticePeriodDays}
																class="bg-card text-foreground w-full max-w-[120px] text-sm"
																placeholder="e.g. 30"
															/>
														</div>
													{/if}
												</div>
											</div>
										</div>
									{/if}

									<!-- Advanced options toggle -->
									{#if !editingUseCustomAvailabilityPercentages}
										<button
											type="button"
											class="text-muted-fg hover:text-foreground text-sm font-medium"
											onclick={() => (editingUseCustomAvailabilityPercentages = true)}
										>
											+ Advanced options
										</button>
									{:else}
										<div class="border-border bg-muted rounded-lg border p-5">
											<div class="mb-4 flex items-center justify-between">
												<p class="text-foreground text-sm font-medium">
													Custom availability percentages
												</p>
												<button
													type="button"
													class="text-muted-fg hover:text-foreground text-xs font-medium"
													onclick={() => {
														editingUseCustomAvailabilityPercentages = false;
														editingAvailabilityNowPercent = '';
														editingAvailabilityFuturePercent = '';
													}}
												>
													Reset to defaults
												</button>
											</div>
											<div class="grid gap-4 sm:grid-cols-2">
												<div>
													<label
														for="availability-now-percent"
														class="text-muted-fg mb-1.5 block text-sm font-medium"
													>
														Available now
													</label>
													<div class="relative max-w-[120px]">
														<Input
															id="availability-now-percent"
															type="text"
															inputmode="numeric"
															bind:value={editingAvailabilityNowPercent}
															class="bg-card text-foreground w-full py-2 pr-8 text-sm"
															placeholder={editingHasAssignment ? '0' : '100'}
														/>
														<span
															class="text-muted-fg pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm"
															>%</span
														>
													</div>
												</div>
												{#if editingHasAssignment && hasFutureAvailabilityTiming}
													<div>
														<label
															for="availability-future-percent"
															class="text-muted-fg mb-1.5 block text-sm font-medium"
														>
															Future availability
														</label>
														<div class="relative max-w-[120px]">
															<Input
																id="availability-future-percent"
																type="text"
																inputmode="numeric"
																bind:value={editingAvailabilityFuturePercent}
																class="bg-card text-foreground w-full py-2 pr-8 text-sm"
																placeholder="100"
															/>
															<span
																class="text-muted-fg pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm"
																>%</span
															>
														</div>
													</div>
												{/if}
											</div>
											<p class="text-muted-fg mt-3 text-xs">
												Override default percentages for part-time or partial availability.
											</p>
										</div>
									{/if}
								</div>
							{:else}
								<ConsultantAvailabilityPills {availability} />
							{/if}
						</div>

						<div class="pt-2">
							<h3 class="text-foreground mb-2 text-lg font-semibold">Tech Stack</h3>
							{#if isEditing && canEdit}
								<TechStackEditor bind:categories={editingTechStack} isEditing />
							{:else if viewCategories.length === 0}
								<p class="text-muted-fg text-sm">No tech stack recorded yet.</p>
							{:else}
								<div class="space-y-3">
									{#each viewCategories as cat (cat.name ?? '')}
										<div class="space-y-1">
											<p class="text-foreground text-xs font-semibold uppercase tracking-wide">
												{cat.name}
											</p>
											<div class="flex flex-wrap gap-2">
												{#each cat.skills as skill, skillIndex (`${cat.name ?? 'cat'}-${skill}-${skillIndex}`)}
													<span
														class="border-primary text-primary inline-flex min-h-[28px] min-w-[28px] items-center justify-center border bg-transparent px-2 py-1 text-xs font-semibold"
													>
														{skill}
													</span>
												{/each}
											</div>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					</form>
				</div>
			</div>
		{:else}
			<div class="rounded-lg bg-red-50 p-4 text-red-800">Talent not found.</div>
		{/if}
	</div>

	{#if profile}
		<div class="border-border mt-12 border-t pt-12">
			<div class="mb-6 flex items-center justify-between">
				<h2 class="text-foreground text-2xl font-bold">Resumes</h2>
				{#if canEdit}
					<div class="flex items-center gap-2">
						<Button size="sm" variant="outline" onclick={openImportDrawer}>
							<Upload size={14} />
							Create resume from PDF
						</Button>
						<Button size="sm" variant="outline" onclick={addResume}>+ Add resume</Button>
					</div>
				{/if}
			</div>

			<div class="space-y-4">
				{#each sortedResumeList as resume, index (resume.id)}
					<div
						draggable={canEdit}
						ondragstart={() => handleDragStart(resume)}
						ondragover={(e) => handleDragOver(e, index)}
						ondragleave={handleDragLeave}
						ondrop={(e) => handleDrop(e, index)}
						ondragend={() => {
							draggedResume = null;
							dragOverIndex = null;
						}}
						onclick={() =>
							goto(
								`/resumes/${encodeURIComponent(profile.id)}/resume/${encodeURIComponent(resume.id)}`
							)}
						class={`flex cursor-pointer items-center justify-between rounded-none border p-6 shadow-sm transition-all duration-200 hover:scale-105 hover:shadow-md ${
							dragOverIndex === index ? 'border-primary' : 'border-border'
						} ${draggedResume?.id === resume.id ? 'opacity-50' : ''}`}
					>
						<div class="flex items-start gap-4">
							<div
								class="bg-primary/10 text-primary flex h-12 w-12 items-center justify-center rounded-lg"
							>
								<FileText size={24} />
							</div>
							<div>
								<div class="flex items-center gap-3">
									<h3 class="text-foreground text-lg font-semibold">
										{resume.version_name ?? 'Main'}
									</h3>
									{#if resume.is_main}
										<span
											class="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20"
										>
											<CheckCircle2 size={12} />
											Main Resume
										</span>
									{/if}
								</div>
								<div class="text-muted-fg mt-1 flex items-center gap-4 text-sm">
									<span class="flex items-center gap-1">
										<Calendar size={14} />
										Updated {formatResumeCardDate(resume.updated_at ?? resume.created_at)}
									</span>
								</div>
							</div>
						</div>
						{#if canEdit}
							<div class="flex items-center gap-1">
								{#if !resume.is_main}
									<button
										type="button"
										class="border-border text-muted-fg hover:bg-primary/10 hover:text-primary cursor-pointer rounded-md border px-2 py-1 text-xs font-medium transition-colors"
										onclick={(e) => {
											e.stopPropagation();
											setMainResume(resume.id);
										}}
										title="Set as main resume"
									>
										Set main
									</button>
								{/if}
								<button
									type="button"
									class="text-muted-fg hover:bg-primary/10 hover:text-primary cursor-pointer rounded-md p-2 transition-colors"
									onclick={(e) => {
										e.stopPropagation();
										copyResume(resume.id);
									}}
									title="Copy resume"
								>
									<Copy size={18} />
								</button>
								{#if !resume.is_main}
									<button
										type="button"
										class="text-muted-fg cursor-pointer rounded-md p-2 transition-colors hover:bg-red-50 hover:text-red-600"
										onclick={(e) => e.stopPropagation()}
										title="Delete resume"
										use:confirm={{
											title: 'Delete resume?',
											description: `Are you sure you want to delete "${resume.version_name}"? This cannot be undone.`,
											actionLabel: 'Delete',
											action: () => deleteResume(resume.id)
										}}
									>
										<Trash2 size={18} />
									</button>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
				{#if sortedResumeList.length === 0}
					<div class="border-border rounded-lg border-2 border-dashed p-12 text-center">
						<FileText size={48} class="text-muted-fg mx-auto mb-4" />
						<h3 class="text-foreground text-lg font-medium">No resumes found</h3>
						<p class="text-muted-fg mt-2">Connect this profile to a resume to see it here.</p>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

{#if profile && canEdit}
	<Drawer
		bind:open={importDrawerOpen}
		variant="bottom"
		title="Import from PDF"
		subtitle="Upload a resume PDF to create an editable draft."
		beforeClose={requestImportDrawerClose}
	>
		<div class="flex min-h-0 flex-1 flex-col">
			{#if isBackgroundImporting}
				<!-- Importing state -->
				<div class="flex flex-1 flex-col items-center justify-center py-8">
					<div class="bg-primary/10 mb-4 flex h-16 w-16 items-center justify-center rounded-full">
						<Loader2 size={32} class="text-primary animate-spin" />
					</div>
					<p class="text-foreground mb-1 text-lg font-medium">{importStatusLabel}</p>
					{#if importSourceFilename}
						<p class="text-muted-fg text-sm">{importSourceFilename}</p>
					{/if}
					<p class="text-muted-fg mt-4 text-xs">
						You can close this drawer. The import will continue in the background.
					</p>
				</div>
			{:else}
				<!-- Upload state -->
				<div bind:this={uppyContainer} class="uppy-container rounded-xs w-full flex-1" />

				{#if importError}
					<div class="mt-4 flex items-start gap-2 rounded-lg bg-red-50 p-3">
						<AlertCircle size={16} class="mt-0.5 shrink-0 text-red-500" />
						<p class="text-sm text-red-700">{importError}</p>
					</div>
				{/if}

				<div class="border-border mt-4 flex items-center justify-between gap-4 border-t pt-4">
					<p class="text-muted-fg text-xs">PDF only, max 10MB</p>
					<div class="flex gap-2">
						<Button type="button" variant="ghost" size="sm" onclick={closeImportDrawer}>
							Cancel
						</Button>
						<Button
							type="button"
							variant="primary"
							size="sm"
							onclick={importSelectedPdf}
							disabled={!selectedImportFile || isImportBusy}
							loading={isKickoffImporting}
						>
							Import
						</Button>
					</div>
				</div>
			{/if}
		</div>
	</Drawer>

	<!-- Close confirmation dialog -->
	{#if showCloseConfirm}
		<div
			class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
			onclick={cancelClose}
			onkeydown={(e) => e.key === 'Escape' && cancelClose()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<div
				class="bg-card w-full max-w-sm rounded-lg p-6 shadow-xl"
				onclick={(e) => e.stopPropagation()}
				role="document"
			>
				<h3 class="text-foreground mb-2 text-lg font-semibold">Cancel import?</h3>
				<p class="text-muted-fg mb-4 text-sm">
					The import is still starting. If you close now, it will be cancelled.
				</p>
				<div class="flex justify-end gap-2">
					<Button type="button" variant="ghost" size="sm" onclick={cancelClose}>
						Keep importing
					</Button>
					<Button type="button" variant="destructive" size="sm" onclick={confirmClose}>
						Cancel import
					</Button>
				</div>
			</div>
		</div>
	{/if}
{/if}

<style>
	:global(.uppy-container .uppy-Dashboard) {
		border: 1px dashed var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		background: var(--color-muted, #edf2f7);
		min-height: 160px;
	}
	:global(.uppy-container .uppy-Dashboard-inner) {
		background: transparent;
		border: none;
	}
	:global(.uppy-container .uppy-Dashboard-AddFiles) {
		border: none;
		border-radius: 0.5rem;
	}
	:global(.uppy-container .uppy-Dashboard-AddFiles-title) {
		font-size: 0.875rem;
		color: var(--color-muted-fg, #2e333a);
	}
	:global(.uppy-container .uppy-Dashboard-note) {
		display: none;
	}
</style>
