<script lang="ts">
	import { Button, Checkbox, Datepicker, Input, Radio } from '@pixelcode_/blocks/components';
	import {
		ArrowLeft,
		BriefcaseBusiness,
		Building2,
		CalendarClock,
		Camera,
		CheckCircle2,
		Copy,
		Download,
		FileText,
		Loader2,
		MessageSquare,
		MessageSquarePlus,
		Plus,
		Shield,
		Trash2,
		Upload,
		User,
		Workflow,
		AlertCircle
	} from 'lucide-svelte';
	import { deserialize } from '$app/forms';
	import { base, resolve } from '$app/paths';
	import { goto, invalidateAll, replaceState } from '$app/navigation';
	import { page } from '$app/stores';
	import TechStackEditor from '$lib/components/tech-stack-editor/tech-stack-editor.svelte';
	import Drawer from '$lib/components/drawer/drawer.svelte';
	import { Dropdown } from '$lib/components/dropdown';
	import { resumeDownloadStore } from '$lib/stores/resumeDownloadStore';
	import TalentCommentCard from '$lib/components/talent-comments/TalentCommentCard.svelte';
	import ConsultantAvailabilityPills from '$lib/components/resumes/ConsultantAvailabilityPills.svelte';
	import { confirm } from '$lib/utils/confirm';
	import { loading } from '$lib/stores/loading';
	import { pdfImportStore } from '$lib/stores/pdfImportStore';
	import {
		TALENT_COMMENT_BODY_MAX_LENGTH,
		type TalentComment,
		type TalentCommentType
	} from '$lib/types/talentComments';
	import {
		applyImageFallbackOnce,
		getOriginalImageUrl,
		supabaseImagePresets,
		supabaseImageSizes,
		supabaseImageSrcsetWidths,
		transformSupabasePublicUrl,
		transformSupabasePublicUrlSrcSet
	} from '$lib/images/supabaseImage';
	import { get } from 'svelte/store';
	import { onDestroy, onMount, tick } from 'svelte';
	import { fly } from 'svelte/transition';
	import type { UppyFile } from '@uppy/utils/lib/UppyFile';

	const { data, form } = $props();

	const profile = data.profile;
	const resumes = data.resumes ?? [];
	const availability = data.availability ?? null;
	const canEdit = data.canEdit ?? false;
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
	type ResumeListItem = (typeof resumes)[number];
	type TechCategory = { name?: string; skills?: string[] };
	const techStack = (profile?.tech_stack as TechCategory[]) ?? [];
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
	let commentsDrawerOpen = $state(false);
	let commentTypeId = $state('');
	let commentBody = $state('');
	let commentFormOpen = $state(false);
	let commentSubmitting = $state(false);
	let downloadingResumeId = $state<string | null>(null);
	let downloadMenuResumeId = $state<string | null>(null);
	let downloadLang = $state<'sv' | 'en'>('sv');
	let commentFeedback = $state<CommentFeedback | null>(null);
	let archivingCommentIds = $state<Record<string, boolean>>({});
	let expandedCommentIds = $state<Record<string, boolean>>({});
	let flashingCommentId = $state<string | null>(null);

	const commentTypeIcons = {
		'briefcase-business': BriefcaseBusiness,
		'calendar-clock': CalendarClock,
		workflow: Workflow,
		'message-square': MessageSquare
	} as const;
	const commentRoleIcons = {
		admin: Shield,
		broker: BriefcaseBusiness,
		employer: Building2,
		talent: User
	} as const;
	const resolveTypeIcon = (iconName: string) =>
		commentTypeIcons[iconName as keyof typeof commentTypeIcons] ?? MessageSquare;
	const resolveRoleIcon = (role: string) =>
		commentRoleIcons[role as keyof typeof commentRoleIcons] ?? User;
	const commentRoleLabels: Record<string, string> = {
		admin: 'Admin',
		broker: 'Broker',
		employer: 'Employer',
		talent: 'Talent'
	};
	const resolveRoleLabel = (role: string) => commentRoleLabels[role] ?? 'User';

	const techStackJson = $derived(JSON.stringify(editingTechStack ?? []));
	const commentCharactersUsed = $derived(commentBody.length);

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
	type UppyCtor = typeof import('@uppy/core').default;
	type DashboardPlugin = typeof import('@uppy/dashboard').default;
	type UppyInstance = InstanceType<UppyCtor>;

	let importStatus = $state<PdfImportPhase>('idle');
	let uppyContainer: HTMLDivElement | null = null;
	let uppy: UppyInstance | null = null;
	let uppyModulesPromise: Promise<{ Uppy: UppyCtor; Dashboard: DashboardPlugin }> | null = null;
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

	const VISIBLE_RESUME_COUNT = 3;
	const visibleResumes = $derived(sortedResumeList.slice(0, VISIBLE_RESUME_COUNT));
	const hasMoreResumes = $derived(sortedResumeList.length > VISIBLE_RESUME_COUNT);

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

	const downloadResume = async (
		resumeId: string,
		type: 'pdf' | 'word',
		lang: 'sv' | 'en' = 'sv'
	) => {
		if (downloadingResumeId) return;
		const resume = resumeList.find((r) => r.id === resumeId);
		const baseName = resume?.version_name ?? 'resume';
		const extension = type === 'pdf' ? 'pdf' : 'doc';
		const filename = `${baseName}.${extension}`;
		const label = type === 'pdf' ? 'Generating PDF...' : 'Generating Word file...';
		const debugParam = type === 'pdf' ? '&debug=1' : '';
		const url = `/api/resumes/${resumeId}/${type}?lang=${lang}${debugParam}`;

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
		<div class="mb-6 flex items-center justify-between">
			{#if !isTalentOnly}
				<Button
					variant="ghost"
					href="/resumes"
					class="hover:text-primary pl-0 hover:bg-transparent"
				>
					<ArrowLeft size={16} class="mr-2" />
					Back to all talents
				</Button>
			{/if}

			{#if profile && canEdit}
				<div class="ml-auto flex gap-2">
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
				<div class="w-32 flex-shrink-0 space-y-4 md:w-48">
					<div class="space-y-2">
						<div class="relative h-32 w-32 md:h-48 md:w-48">
							<input
								bind:this={avatarFileInput}
								type="file"
								accept="image/*"
								class="hidden"
								onchange={handleAvatarUpload}
								disabled={avatarUploading}
							/>

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
										src={displayedAvatarSrc}
										srcset={displayedAvatarSrcSet}
										sizes={supabaseImageSizes.avatarProfile}
										alt={[profile.first_name, profile.last_name].filter(Boolean).join(' ')}
										class="h-full w-full object-cover"
										loading="lazy"
										decoding="async"
										onerror={(event) =>
											applyImageFallbackOnce(
												event,
												displayedAvatarFallbackSrc || displayedAvatarUrl
											)}
									/>
								{:else}
									<div
										class="bg-muted text-muted-fg flex h-full w-full items-center justify-center"
									>
										<User size={48} />
									</div>
								{/if}

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
						</div>

						{#if isEditing && canEdit && editingAvatarUrl && !avatarUploading}
							<button
								type="button"
								class="w-full text-left text-xs text-red-400 transition-colors hover:text-red-500"
								onclick={() => {
									editingAvatarUrl = '';
									avatarUploadError = null;
								}}
							>
								Remove image
							</button>
						{/if}

						{#if avatarUploadError}
							<p class="text-xs text-red-600">{avatarUploadError}</p>
						{/if}

						{#if !isEditing}
							<p class="text-sm">Current status</p>
							<ConsultantAvailabilityPills {availability} compact />
						{/if}
					</div>
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

						{#if profileActionMessage}
							<div
								class="rounded border px-3 py-2 text-sm
									{!profileActionFailed
									? 'border-emerald-200 bg-emerald-50 text-emerald-700'
									: 'border-red-200 bg-red-50 text-red-700'}"
							>
								{profileActionMessage}
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
							{#if isEditing && canEdit}
								<h3 class="text-foreground mb-2 text-lg font-semibold">Availability</h3>
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
							{/if}
						</div>
					</form>

					<!-- Resumes -->
					<div class="pt-2">
						<div class="mb-2 flex items-center justify-between">
							<h3 class="text-foreground text-lg font-semibold">Resumes</h3>
							{#if canEdit}
								<div class="flex items-center gap-1">
									<Button size="sm" variant="outline" onclick={openImportDrawer}>
										<Upload size={14} />
										Create resume from PDF
									</Button>
									<Button size="sm" variant="outline" onclick={addResume}>
										<Plus size={14} />
										Add resume
									</Button>
								</div>
							{/if}
						</div>

						<div class="space-y-1.5">
							{#each visibleResumes as resume, index (resume.id)}
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
									role="button"
									tabindex="0"
									onclick={() =>
										goto(
											`/resumes/${encodeURIComponent(profile.id)}/resume/${encodeURIComponent(resume.id)}`
										)}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											goto(
												`/resumes/${encodeURIComponent(profile.id)}/resume/${encodeURIComponent(resume.id)}`
											);
										}
									}}
									class="border-border hover:border-primary/50 hover:bg-muted/50 group flex w-full cursor-pointer items-center gap-3 border px-4 py-3 transition-colors {dragOverIndex ===
									index
										? 'border-primary'
										: ''} {draggedResume?.id === resume.id ? 'opacity-50' : ''}"
								>
									<FileText size={16} class="text-muted-fg group-hover:text-primary shrink-0" />
									<div class="min-w-0 flex-1">
										<div class="flex items-center gap-2">
											<span class="text-foreground truncate text-sm font-medium">
												{resume.version_name ?? 'Main'}
											</span>
											{#if resume.is_main}
												<span
													class="inline-flex items-center gap-1 rounded-full bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-700"
												>
													<CheckCircle2 size={11} />
													Main
												</span>
											{/if}
										</div>
										<span class="text-muted-fg text-xs">
											{formatResumeCardDate(resume.updated_at ?? resume.created_at)}
										</span>
									</div>

									<div class="ml-auto flex shrink-0 items-center gap-1">
										<div class="relative">
											<Button
												type="button"
												variant="ghost"
												size="sm"
												class="min-h-[36px] min-w-[36px]"
												onclick={(e) => {
													e.stopPropagation();
													downloadMenuResumeId =
														downloadMenuResumeId === resume.id ? null : resume.id;
												}}
												loading={downloadingResumeId === resume.id}
												title="Download"
											>
												<Download size={14} />
											</Button>
											{#if downloadMenuResumeId === resume.id}
												<!-- svelte-ignore a11y_no_static_element_interactions -->
												<div
													class="border-border bg-card absolute right-0 top-full z-50 mt-1 flex flex-col gap-1.5 rounded border p-2 shadow-lg"
													onclick={(e) => e.stopPropagation()}
													transition:fly={{ y: -8, duration: 150 }}
												>
													<div
														class="border-border bg-card flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium"
													>
														<button
															type="button"
															class="cursor-pointer {downloadLang === 'sv'
																? 'bg-primary rounded-full px-2 py-0.5 text-white'
																: 'text-muted-fg hover:text-foreground px-2 py-0.5'}"
															onclick={() => (downloadLang = 'sv')}
														>
															SV
														</button>
														<button
															type="button"
															class="cursor-pointer {downloadLang === 'en'
																? 'bg-primary rounded-full px-2 py-0.5 text-white'
																: 'text-muted-fg hover:text-foreground px-2 py-0.5'}"
															onclick={() => (downloadLang = 'en')}
														>
															EN
														</button>
													</div>
													<Button
														type="button"
														variant="outline"
														size="sm"
														class="w-full cursor-pointer"
														loading={downloadingResumeId === resume.id}
														onclick={() => {
															downloadResume(resume.id, 'word', downloadLang);
															downloadMenuResumeId = null;
														}}
													>
														Word (Pre-beta)
													</Button>
													<Button
														type="button"
														variant="primary"
														size="sm"
														class="w-full cursor-pointer"
														loading={downloadingResumeId === resume.id}
														onclick={() => {
															downloadResume(resume.id, 'pdf', downloadLang);
															downloadMenuResumeId = null;
														}}
													>
														<Download size={14} />
														PDF
													</Button>
												</div>
											{/if}
										</div>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											class="min-h-[36px] min-w-[36px]"
											onclick={(e) => {
												e.stopPropagation();
												copyResume(resume.id);
											}}
											title="Duplicate resume"
										>
											<Copy size={14} />
										</Button>
										{#if canEdit && !resume.is_main}
											<Button
												type="button"
												variant="ghost"
												size="sm"
												class="min-h-[36px] text-xs"
												onclick={(e) => {
													e.stopPropagation();
													setMainResume(resume.id);
												}}
												title="Set as main"
											>
												Set main
											</Button>
											<button
												type="button"
												class="text-muted-fg inline-flex min-h-[36px] min-w-[36px] cursor-pointer items-center justify-center rounded-sm px-2 text-sm transition-colors hover:text-red-500"
												onclick={(e) => e.stopPropagation()}
												title="Delete resume"
												use:confirm={{
													title: 'Delete resume?',
													description: `Are you sure you want to delete "${resume.version_name}"? This cannot be undone.`,
													actionLabel: 'Delete',
													action: () => deleteResume(resume.id)
												}}
											>
												<Trash2 size={14} />
											</button>
										{/if}
									</div>
								</div>
							{/each}

							{#if hasMoreResumes}
								<button
									type="button"
									class="text-primary hover:text-primary/80 cursor-pointer pt-1 text-sm font-medium"
									onclick={() => {
										const el = document.getElementById('all-resumes-section');
										if (el) el.scrollIntoView({ behavior: 'smooth' });
									}}
								>
									See all {sortedResumeList.length} resumes
								</button>
							{/if}

							{#if sortedResumeList.length === 0}
								<div class="border-border rounded-none border border-dashed px-4 py-6 text-center">
									<FileText size={24} class="text-muted-fg mx-auto mb-2" />
									<p class="text-muted-fg text-sm">No resumes yet.</p>
								</div>
							{/if}
						</div>
					</div>

					<!-- Internal comments -->
					<div class="pt-2">
						<div class="mb-2 flex items-center justify-between">
							<h3 class="text-foreground text-lg font-semibold">Comments</h3>
							{#if canCreateComment}
								<Button
									type="button"
									variant="outline"
									size="sm"
									onclick={() => (commentFormOpen = !commentFormOpen)}
								>
									<MessageSquarePlus size={14} />
									Leave comment
								</Button>
							{/if}
						</div>

						{#if commentFeedback?.type === 'error'}
							<div
								class="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
							>
								{commentFeedback.message}
							</div>
						{/if}

						{#if commentFormOpen}
							<div class="border-border bg-card rounded border p-4">
								<form class="space-y-3" onsubmit={submitComment}>
									<input type="hidden" name="comment_type_id" value={commentTypeId} />
									<Dropdown
										id="comment-type"
										bind:value={commentTypeId}
										options={commentTypes.map((ct) => ({ label: ct.label, value: ct.id }))}
										placeholder="Comment type"
										size="sm"
										disabled={commentTypes.length === 0 || commentSubmitting}
									/>

									<textarea
										id="comment-body"
										name="comment_body"
										bind:value={commentBody}
										maxlength={TALENT_COMMENT_BODY_MAX_LENGTH}
										class="border-border bg-card text-foreground focus:border-primary min-h-20 w-full resize-y rounded-none border p-2.5 text-sm outline-none"
										placeholder="Internal note..."
										disabled={commentSubmitting}
										required
									></textarea>

									<div class="flex items-center justify-between gap-3">
										<p class="text-muted-fg text-xs">
											{commentCharactersUsed}/{TALENT_COMMENT_BODY_MAX_LENGTH}
										</p>
										<div class="flex gap-1.5">
											<Button
												type="button"
												variant="ghost"
												size="sm"
												onclick={() => {
													commentFormOpen = false;
													commentBody = '';
												}}
											>
												Cancel
											</Button>
											<Button
												type="submit"
												size="sm"
												loading={commentSubmitting}
												disabled={commentTypes.length === 0 || commentSubmitting}
											>
												Add
											</Button>
										</div>
									</div>
								</form>
							</div>
						{/if}

						{#if latestComments.length > 0}
							<div class="space-y-2">
								{#each latestComments as comment (comment.id)}
									{@const isExpanded = expandedCommentIds[comment.id] ?? false}
									{@const TypeIcon = resolveTypeIcon(comment.comment_type.icon_name)}
									{@const RoleIcon = resolveRoleIcon(comment.author_role)}
									<button
										type="button"
										class="border-border hover:bg-muted/50 w-full cursor-pointer border px-4 py-3 text-left transition-colors {flashingCommentId ===
										comment.id
											? 'animate-flash-highlight'
											: ''}"
										onclick={() => {
											expandedCommentIds = { ...expandedCommentIds, [comment.id]: !isExpanded };
										}}
									>
										<div class="mb-1 flex items-center gap-2">
											<span
												class="text-primary bg-primary/5 border-primary/30 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-semibold"
											>
												<TypeIcon size={12} />
												{comment.comment_type.label}
											</span>
											{#if comment.author_name}
												<span class="text-muted-fg inline-flex items-center gap-1 text-[11px]">
													<span title={resolveRoleLabel(comment.author_role)}>
														<RoleIcon size={12} />
													</span>
													{comment.author_name}
												</span>
											{/if}
											<span class="text-muted-fg ml-auto text-[11px]">
												{new Date(comment.created_at).toLocaleDateString(undefined, {
													year: 'numeric',
													month: 'short',
													day: 'numeric'
												})}
											</span>
										</div>
										<div
											class="relative overflow-hidden transition-[max-height] duration-300 ease-in-out"
											style="max-height: {isExpanded ? '40rem' : '3rem'};"
										>
											<p class="text-foreground whitespace-pre-wrap text-sm leading-6">
												{comment.body_text}
											</p>
											{#if !isExpanded && comment.body_text.length > 120}
												<div
													class="from-background pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t"
												></div>
											{/if}
										</div>
									</button>
								{/each}
							</div>

							{#if commentCount > latestComments.length}
								<div class="flex w-full justify-end">
									<button
										type="button"
										class="text-primary hover:text-primary/80 mt-1 cursor-pointer text-sm font-medium"
										onclick={() => (commentsDrawerOpen = true)}
									>
										See all {commentCount} comments
									</button>
								</div>
							{/if}
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
				</div>
			</div>
		{:else}
			<div class="rounded-lg bg-red-50 p-4 text-red-800">Talent not found.</div>
		{/if}
	</div>
</div>

{#if profile}
	<Drawer
		bind:open={commentsDrawerOpen}
		variant="bottom"
		title="Comment history"
		subtitle="Older internal comments for this talent."
	>
		{#if commentHistory.length === 0}
			<div class="border-border rounded-none border border-dashed p-4">
				<p class="text-muted-fg text-sm">No comments yet.</p>
			</div>
		{:else}
			<div class="space-y-3">
				{#each commentHistory as comment (comment.id)}
					<TalentCommentCard
						{comment}
						isArchiving={Boolean(archivingCommentIds[comment.id])}
						onArchive={archiveComment}
					/>
				{/each}
			</div>
		{/if}
	</Drawer>
{/if}

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
