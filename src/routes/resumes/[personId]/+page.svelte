<script lang="ts">
	import { deserialize } from '$app/forms';
	import { base, resolve } from '$app/paths';
	import { goto, invalidateAll, replaceState } from '$app/navigation';
	import { page } from '$app/stores';
	import {
		TalentProfileAvatar,
		TalentProfileCommentsDrawer,
		TalentProfileCommentsSection,
		TalentProfileHeader,
		TalentProfileImportCloseConfirm,
		TalentProfileImportDrawer,
		TalentProfileProfileForm,
		TalentProfileResumesSection,
		TalentProfileTechStackSection
	} from '$lib/components/resumes/components/TalentProfile';
	import { resumeDownloadStore } from '$lib/stores/resumeDownloadStore';
	import { loading } from '$lib/stores/loading';
	import { pdfImportStore } from '$lib/stores/pdfImportStore';
	import { type TalentComment, type TalentCommentType } from '$lib/types/talentComments';
	import {
		getOriginalImageUrl,
		supabaseImagePresets,
		supabaseImageSrcsetWidths,
		transformSupabasePublicUrl,
		transformSupabasePublicUrlSrcSet
	} from '$lib/images/supabaseImage';
	import { get } from 'svelte/store';
	import { onDestroy, onMount, tick } from 'svelte';
	import type { UppyFile } from '@uppy/utils/lib/UppyFile';
	import type { TechCategory as ResumeTechCategory } from '$lib/types/resume';

	let { data, form } = $props();

	const profile = $derived(data.profile ?? null);
	const resumes = $derived(data.resumes ?? []);
	const availability = $derived(data.availability ?? null);
	const canEdit = $derived(data.canEdit ?? false);
	const actorRoles = $derived.by(() => {
		const fromRoles = Array.isArray($page.data?.roles) ? $page.data.roles : [];
		if (fromRoles.length > 0) return fromRoles;
		return typeof $page.data?.role === 'string' ? [$page.data.role] : [];
	});
	const isTalentOnly = $derived(actorRoles.length === 1 && actorRoles[0] === 'talent');
	const commentTypes = $derived((data.commentTypes ?? []) as TalentCommentType[]);
	const commentHistory = $derived((data.commentHistory ?? []) as TalentComment[]);
	const latestComments = $derived((data.latestComments ?? []) as TalentComment[]);
	const commentCount = $derived(
		typeof data.commentCount === 'number' ? data.commentCount : commentHistory.length
	);
	const canCreateComment = $derived(Boolean(data.canCreateComment));
	const navigationOrigin = $derived.by<'resumes' | 'talents'>(() =>
		$page.url.searchParams.get('from') === 'talents' ? 'talents' : 'resumes'
	);
	const talentProfileBackHref = $derived(navigationOrigin === 'talents' ? '/talents' : '/resumes');
	const talentProfileBackLabel = $derived(
		navigationOrigin === 'talents' ? 'Back to talent list' : 'Back to resume list'
	);
	type ResumeListItem = NonNullable<typeof data.resumes>[number];
	type ImportFile = UppyFile<Record<string, unknown>, Record<string, unknown>>;
	const techStack = $derived((profile?.tech_stack as ResumeTechCategory[]) ?? []);
	const viewCategories = $derived(
		(techStack ?? []).filter((cat) => Array.isArray(cat?.skills) && cat.skills.length > 0)
	);
	const profileActionMessage = $derived(
		form?.type === 'updateProfile' && typeof form?.message === 'string' ? form.message : null
	);
	const profileActionFailed = $derived(form?.type === 'updateProfile' && form?.ok === false);
	type CommentFeedback = {
		type: 'success' | 'error';
		message: string;
	};

	let isEditing = $state(false);
	let editingBio = $state(profile?.bio ?? '');
	let editingAvatarUrl = $state(profile?.avatar_url ?? '');
	let avatarUploadError = $state<string | null>(null);
	let avatarUploading = $state(false);
	let editingTechStack = $state(structuredClone(techStack));
	let editingHasAssignment = $state(true);
	let availabilityStatus = $state<'available-now' | 'on-assignment'>('on-assignment');
	let editingUseCustomAvailabilityPercentages = $state(false);
	let editingOpenToSwitchEarly = $state(false);
	let editingAvailabilityNowPercent = $state('');
	let editingAvailabilityFuturePercent = $state('');
	let editingAvailabilityNoticePeriodDays = $state('');
	let editingAvailabilityPlannedFromDate = $state('');
	let commentsDrawerOpen = $state(false);
	let commentTypeId = $state('');
	let commentBody = $state('');
	let commentFormOpen = $state(false);
	let commentSubmitting = $state(false);
	let downloadingResumeId = $state<string | null>(null);
	let downloadMenuResumeId = $state<string | null>(null);
	let downloadLang = $state<'sv' | 'en'>('sv');
	let downloadAnonymized = $state(false);
	let commentFeedback = $state<CommentFeedback | null>(null);
	let archivingCommentIds = $state<Record<string, boolean>>({});
	let expandedCommentIds = $state<Record<string, boolean>>({});
	let flashingCommentId = $state<string | null>(null);

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
	const displayedAvatarSrc = $derived(
		transformSupabasePublicUrl(displayedAvatarUrl, supabaseImagePresets.avatarProfile)
	);
	const displayedAvatarSrcSet = $derived(
		transformSupabasePublicUrlSrcSet(displayedAvatarUrl, supabaseImageSrcsetWidths.avatarProfile, {
			height: supabaseImagePresets.avatarProfile.height,
			quality: supabaseImagePresets.avatarProfile.quality,
			resize: supabaseImagePresets.avatarProfile.resize
		})
	);
	const displayedAvatarFallbackSrc = $derived(getOriginalImageUrl(displayedAvatarUrl));

	const clearAvatarImage = () => {
		editingAvatarUrl = '';
		avatarUploadError = null;
	};

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

	const startProfileEdit = () => {
		isEditing = true;
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
	type UppyCtor = typeof import('@uppy/core').default;
	type DashboardPlugin = typeof import('@uppy/dashboard').default;
	type UppyInstance = InstanceType<UppyCtor>;

	let importStatus = $state<PdfImportPhase>('idle');
	let uppyContainer = $state<HTMLDivElement | null>(null);
	let uppy: UppyInstance | null = null;
	let uppyModulesPromise: Promise<{ Uppy: UppyCtor; Dashboard: DashboardPlugin }> | null = null;
	let selectedImportFile = $state<ImportFile | null>(null);
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

	const VISIBLE_RESUME_COUNT = 3;
	const visibleResumes = $derived(sortedResumeList.slice(0, VISIBLE_RESUME_COUNT));
	const hasMoreResumes = $derived(sortedResumeList.length > VISIBLE_RESUME_COUNT);

	$effect(() => {
		resetProfileEditor();
		resumeList = [...(resumes ?? [])];
	});

	$effect(() => {
		const defaultCommentTypeId = commentTypes[0]?.id ?? '';
		if (!commentTypeId || !commentTypes.some((type) => type.id === commentTypeId)) {
			commentTypeId = defaultCommentTypeId;
		}
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
		const dragged = draggedResume;
		const currentIndex = resumeList.findIndex((r) => r.id === dragged.id);
		if (currentIndex === -1 || currentIndex === targetIndex) return;
		const next = [...resumeList];
		next.splice(currentIndex, 1);
		next.splice(targetIndex, 0, dragged);
		// mark main
		resumeList = next.map((r, idx) => ({ ...r, is_main: idx === 0 }));
	};

	const saveOrder = async () => {
		if (!canEdit || !profile) return;
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
		if (!canEdit || !profile) return;
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

	const downloadResume = async (
		resumeId: string,
		type: 'pdf' | 'word',
		lang: 'sv' | 'en' = 'sv'
	) => {
		if (downloadingResumeId) return;
		const resume = resumeList.find((r) => r.id === resumeId);
		const baseName = downloadAnonymized
			? lang === 'sv'
				? 'anonymized-cv'
				: 'anonymized-resume'
			: (resume?.version_name ?? 'resume');
		const extension = type === 'pdf' ? 'pdf' : 'doc';
		const filename = `${baseName}.${extension}`;
		const label = type === 'pdf' ? 'Generating PDF...' : 'Generating Word file...';
		const params = new URLSearchParams({ lang });
		if (downloadAnonymized) {
			params.set('anonymize', '1');
		}
		if (type === 'pdf') {
			params.set('debug', '1');
		}
		const url = `/api/resumes/${resumeId}/${type}?${params.toString()}`;

		downloadingResumeId = resumeId;
		loading(true, label);
		resumeDownloadStore.start(type, label);

		try {
			const response = await fetch(url, { credentials: 'include' });
			if (!response.ok) {
				const detail = await response.json().catch(() => null);
				throw new Error(detail?.message ?? 'Failed to download file');
			}
			const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
			if (type === 'pdf' && contentType.includes('application/json')) {
				const payload = await response.json().catch(() => null);
				const downloadUrl = payload?.downloadUrl ?? '';
				const downloadFilename =
					typeof payload?.filename === 'string' ? payload.filename : filename;
				if (!downloadUrl) throw new Error('Failed to prepare PDF download link');
				const normalizedFilename = downloadFilename.toLowerCase().endsWith(`.${extension}`)
					? downloadFilename
					: `${downloadFilename}.${extension}`;
				try {
					const downloadResponse = await fetch(downloadUrl);
					if (!downloadResponse.ok)
						throw new Error(`Signed download failed (${downloadResponse.status})`);
					const blob = await downloadResponse.blob();
					const objectUrl = URL.createObjectURL(blob);
					const link = document.createElement('a');
					link.href = objectUrl;
					link.download = normalizedFilename;
					document.body.appendChild(link);
					link.click();
					link.remove();
					URL.revokeObjectURL(objectUrl);
				} catch {
					const link = document.createElement('a');
					link.href = downloadUrl;
					link.download = normalizedFilename;
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
				document.body.appendChild(link);
				link.click();
				link.remove();
				URL.revokeObjectURL(objectUrl);
			}
		} catch (err) {
			console.error('Download failed:', err);
		} finally {
			downloadingResumeId = null;
			resumeDownloadStore.stop();
			loading(false);
		}
	};

	const parseActionResultMessage = async (response: Response) => {
		const result = deserialize(await response.text()) as {
			type?: string;
			data?: { message?: unknown };
		};

		return {
			type: result.type ?? 'error',
			message: typeof result.data?.message === 'string' ? result.data.message : 'Request failed.'
		};
	};

	const submitComment = async (
		event: SubmitEvent & { currentTarget: EventTarget & HTMLFormElement }
	) => {
		event.preventDefault();
		if (!profile || !canCreateComment || commentSubmitting) return;

		commentSubmitting = true;
		commentFeedback = null;

		try {
			const formData = new FormData(event.currentTarget);
			formData.set('talent_id', profile.id);

			const response = await fetch('?/createComment', {
				method: 'POST',
				body: formData
			});
			const result = await parseActionResultMessage(response);

			if (result.type === 'success') {
				commentBody = '';
				commentTypeId = commentTypes[0]?.id ?? '';
				commentFeedback = null;
				// Refresh data first, then close form so user sees it's working
				await invalidateAll();
				await tick();
				commentFormOpen = false;
				// Flash the newest comment
				const newest = latestComments[0];
				if (newest) {
					flashingCommentId = newest.id;
					setTimeout(() => {
						flashingCommentId = null;
					}, 1500);
				}
				return;
			}

			commentFeedback = {
				type: 'error',
				message: result.message || 'Could not add comment right now.'
			};
		} catch (error) {
			commentFeedback = {
				type: 'error',
				message: error instanceof Error ? error.message : 'Could not add comment right now.'
			};
		} finally {
			commentSubmitting = false;
		}
	};

	const archiveComment = async (commentId: string) => {
		if (!profile || archivingCommentIds[commentId]) return;

		archivingCommentIds = {
			...archivingCommentIds,
			[commentId]: true
		};
		commentFeedback = null;

		try {
			const formData = new FormData();
			formData.set('talent_id', profile.id);
			formData.set('comment_id', commentId);

			const response = await fetch('?/archiveComment', {
				method: 'POST',
				body: formData
			});
			const result = await parseActionResultMessage(response);

			if (result.type === 'success') {
				commentFeedback = { type: 'success', message: result.message || 'Comment archived.' };
				await invalidateAll();
				return;
			}

			commentFeedback = {
				type: 'error',
				message: result.message || 'Could not archive comment right now.'
			};
		} catch (error) {
			commentFeedback = {
				type: 'error',
				message: error instanceof Error ? error.message : 'Could not archive comment right now.'
			};
		} finally {
			const { [commentId]: _removed, ...rest } = archivingCommentIds;
			archivingCommentIds = rest;
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

	const runPdfImport = async (sourceFile: ImportFile) => {
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

	const loadUppyModules = async () => {
		if (!uppyModulesPromise) {
			uppyModulesPromise = Promise.all([import('@uppy/core'), import('@uppy/dashboard')]).then(
				([uppyModule, dashboardModule]) => ({
					Uppy: uppyModule.default,
					Dashboard: dashboardModule.default
				})
			);
		}

		return uppyModulesPromise;
	};

	const initializeUppy = async () => {
		if (!profile || !canEdit) return;
		if (!uppyContainer || uppy) return;
		const { Uppy, Dashboard } = await loadUppyModules();
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
			selectedImportFile = file as ImportFile;
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
		await initializeUppy();
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

	const openResume = (resumeId: string) => {
		if (!profile) return;
		const target = resolve('/resumes/[personId]/resume/[resumeId]', {
			personId: profile.id,
			resumeId
		});
		const query = navigationOrigin === 'talents' ? '?from=talents' : '';
		void goto(`${target}${query}`);
	};

	const handleResumeDragEnd = () => {
		draggedResume = null;
		dragOverIndex = null;
	};

	const toggleDownloadMenu = (resumeId: string) => {
		downloadMenuResumeId = downloadMenuResumeId === resumeId ? null : resumeId;
	};

	const handleDownloadResume = (resumeId: string, type: 'pdf' | 'word', lang: 'sv' | 'en') => {
		void downloadResume(resumeId, type, lang);
		downloadMenuResumeId = null;
	};

	const toggleExpandedComment = (commentId: string) => {
		const isExpanded = expandedCommentIds[commentId] ?? false;
		expandedCommentIds = { ...expandedCommentIds, [commentId]: !isExpanded };
	};

	const openCommentsDrawer = () => {
		commentsDrawerOpen = true;
	};

	$effect(() => {
		if (importDrawerOpen) {
			importDrawerWasOpened = true;
			void (async () => {
				await tick();
				await initializeUppy();
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
		<TalentProfileHeader
			hasProfile={Boolean(profile)}
			backHref={talentProfileBackHref}
			backLabel={talentProfileBackLabel}
			{canEdit}
			{isEditing}
			{avatarUploading}
			onStartEdit={startProfileEdit}
			onCancelEdit={cancelProfileEdit}
		/>

		{#if profile}
			<div class="flex flex-col gap-8 md:flex-row md:items-start">
				<div class="flex-shrink-0 md:w-48">
					<TalentProfileAvatar
						{profile}
						{availability}
						{canEdit}
						{isEditing}
						{avatarUploading}
						{editingAvatarUrl}
						{avatarUploadError}
						{displayedAvatarUrl}
						{displayedAvatarSrc}
						{displayedAvatarSrcSet}
						{displayedAvatarFallbackSrc}
						onAvatarUpload={handleAvatarUpload}
						onRemoveImage={clearAvatarImage}
					/>

					{#if !isEditing && viewCategories.length > 0}
						<div class="hidden md:block">
							<TalentProfileTechStackSection
								{isEditing}
								{canEdit}
								bind:editingTechStack
								{viewCategories}
								organisationId={data.organisation_id}
							/>
						</div>
					{/if}
				</div>
				<div class="flex-1 space-y-4">
					<TalentProfileProfileForm
						{profile}
						organisationName={data.organisation_name}
						organisationLogoUrl={data.organisation_logo_url}
						{isEditing}
						{canEdit}
						bind:editingBio
						{editingAvatarUrl}
						{techStackJson}
						{submittedAvailabilityNowPercent}
						{submittedAvailabilityFuturePercent}
						{submittedAvailabilityNoticePeriodDays}
						{submittedAvailabilityPlannedFromDate}
						{profileActionMessage}
						{profileActionFailed}
						bind:availabilityStatus
						{editingHasAssignment}
						bind:editingUseCustomAvailabilityPercentages
						bind:editingOpenToSwitchEarly
						bind:editingAvailabilityNowPercent
						bind:editingAvailabilityFuturePercent
						bind:editingAvailabilityNoticePeriodDays
						bind:editingAvailabilityPlannedFromDate
						{hasFutureAvailabilityTiming}
						{availabilityDatepickerOptions}
					/>

					<TalentProfileResumesSection
						{visibleResumes}
						totalResumeCount={sortedResumeList.length}
						{hasMoreResumes}
						{canEdit}
						{dragOverIndex}
						draggedResumeId={draggedResume?.id ?? null}
						{downloadMenuResumeId}
						{downloadingResumeId}
						{downloadLang}
						{downloadAnonymized}
						onOpenImportDrawer={openImportDrawer}
						onAddResume={addResume}
						onOpenResume={openResume}
						onDragStartResume={handleDragStart}
						onDragOverResume={handleDragOver}
						onDragLeaveResume={handleDragLeave}
						onDropResume={handleDrop}
						onDragEndResume={handleResumeDragEnd}
						onToggleDownloadMenu={toggleDownloadMenu}
						onSelectDownloadLang={(lang) => (downloadLang = lang)}
						onSetDownloadAnonymized={(value) => (downloadAnonymized = value)}
						onDownloadResume={handleDownloadResume}
						onCopyResume={copyResume}
						onSetMainResume={setMainResume}
						onDeleteResume={deleteResume}
					/>

					<TalentProfileCommentsSection
						{canCreateComment}
						{commentTypes}
						{latestComments}
						{commentCount}
						bind:commentTypeId
						bind:commentBody
						bind:commentFormOpen
						{commentSubmitting}
						{commentFeedback}
						{expandedCommentIds}
						{flashingCommentId}
						onSubmitComment={submitComment}
						onToggleCommentExpanded={toggleExpandedComment}
						onOpenCommentHistory={openCommentsDrawer}
					/>

					{#if isEditing && canEdit}
						<TalentProfileTechStackSection
							{isEditing}
							{canEdit}
							bind:editingTechStack
							{viewCategories}
							organisationId={data.organisation_id}
						/>
					{/if}

					{#if !isEditing && viewCategories.length > 0}
						<div class="md:hidden">
							<TalentProfileTechStackSection
								{isEditing}
								{canEdit}
								bind:editingTechStack
								{viewCategories}
								organisationId={data.organisation_id}
							/>
						</div>
					{/if}
				</div>
			</div>
		{:else}
			<div class="rounded-lg bg-red-50 p-4 text-red-800">Talent not found.</div>
		{/if}
	</div>
</div>

{#if profile}
	<TalentProfileCommentsDrawer
		bind:open={commentsDrawerOpen}
		{commentHistory}
		{archivingCommentIds}
		onArchive={archiveComment}
	/>
{/if}

{#if profile && canEdit}
	<TalentProfileImportDrawer
		bind:open={importDrawerOpen}
		bind:uppyContainer
		beforeClose={requestImportDrawerClose}
		{isBackgroundImporting}
		{importStatusLabel}
		{importSourceFilename}
		{importError}
		canImport={Boolean(selectedImportFile)}
		{isImportBusy}
		{isKickoffImporting}
		onCancel={closeImportDrawer}
		onImport={importSelectedPdf}
	/>

	<TalentProfileImportCloseConfirm
		open={showCloseConfirm}
		onCancel={cancelClose}
		onConfirm={confirmClose}
	/>
{/if}

<style>
	@keyframes flash-highlight {
		0% {
			background-color: var(--color-primary-light, #dbeafe);
		}
		100% {
			background-color: transparent;
		}
	}
	:global(.animate-flash-highlight) {
		animation: flash-highlight 1.5s ease-out;
	}
</style>
