<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { Button, FormControl, Input } from '@pixelcode_/blocks/components';
	import Lock from 'lucide-svelte/icons/lock';
	import LockOpen from 'lucide-svelte/icons/lock-open';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	import { QuillEditor, TechStackSelector } from '$lib/components';
	import Drawer from '$lib/components/drawer/drawer.svelte';
	import ResumeAiRevisionPanel from '../ResumeAiRevisionPanel.svelte';
	import { confirm } from '$lib/utils/confirm';
	import {
		type ResumeAiDiffField,
		type ResumeAiRevisionState,
		RESUME_AI_HUMAN_REVISION_DEBOUNCE_MS,
		RESUME_AI_REVISION_LABEL,
		createResumeAiRevisionState,
		getResumeAiRevisionSnapshot,
		nextResumeAiRevisionLabel,
		pushResumeAiRevisionSnapshot
	} from '../aiRevisions';
	import type {
		Language,
		ResumeAiFieldKey,
		ResumeAiGenerateParams,
		ResumeAiGenerateResult,
		ResumeAiSectionType
	} from '../utils';

	type AcceptPayload = {
		language: Language;
		generated: ResumeAiGenerateResult;
		drafts: {
			descriptionByLanguage: LocalizedDraft;
			roleByLanguage: LocalizedDraft;
			locationByLanguage: LocalizedDraft;
			company: string;
			technologies: string[];
			startDate: string;
			endDate: string | null;
		};
	};

	type LocalizedDraft = {
		sv: string;
		en: string;
	};

	type SharedDraft = {
		company: string;
		technologies: string[];
		startDate: string;
		endDate: string | null;
	};

	type DraftSnapshot = AcceptPayload['drafts'];

	type RevisionByLanguage = {
		sv: number;
		en: number;
	};

	type FieldLockState = Record<ResumeAiFieldKey, boolean>;

	const createDefaultLocks = (): FieldLockState => ({
		company: false,
		role: false,
		location: false,
		technologies: false,
		startDate: false,
		endDate: false
	});

	let {
		rowTitle,
		sectionType,
		language = 'sv',
		company = '',
		roleSv = '',
		roleEn = '',
		locationSv = '',
		locationEn = '',
		technologies = [],
		startDate = '',
		endDate = null,
		descriptionSv = '',
		descriptionEn = '',
		onGenerateDescription,
		onAccept,
		organisationId = null
	}: {
		rowTitle: string;
		sectionType: ResumeAiSectionType;
		language?: Language;
		company?: string;
		roleSv?: string;
		roleEn?: string;
		locationSv?: string;
		locationEn?: string;
		technologies?: string[];
		startDate?: string;
		endDate?: string | null;
		descriptionSv?: string;
		descriptionEn?: string;
		onGenerateDescription?: (params: ResumeAiGenerateParams) => Promise<ResumeAiGenerateResult>;
		onAccept?: (payload: AcceptPayload) => void;
		organisationId?: string | null;
	} = $props();

	let open = $state(false);
	let prompt = $state('');
	let errorMessage = $state('');
	let generating = $state(false);
	let translating = $state(false);
	let activeLanguage = $state<Language>(language);
	let closeConfirmTrigger = $state<HTMLButtonElement | null>(null);
	let scrollContainer: HTMLDivElement | null = null;
	let hasGeneratedOnce = $state(false);
	let descriptionLocked = $state(false);
	let descriptionRevisionByLanguage = $state<RevisionByLanguage>({ sv: 0, en: 0 });
	let revisionRenderNonce = $state(0);
	let lockByField = $state<FieldLockState>(createDefaultLocks());
	let draftByLanguage = $state<LocalizedDraft>({
		sv: descriptionSv ?? '',
		en: descriptionEn ?? ''
	});
	let roleByLanguage = $state<LocalizedDraft>({
		sv: roleSv ?? '',
		en: roleEn ?? ''
	});
	let locationByLanguage = $state<LocalizedDraft>({
		sv: locationSv ?? '',
		en: locationEn ?? ''
	});
	let sharedDraft = $state<SharedDraft>({
		company: company ?? '',
		technologies: Array.isArray(technologies) ? [...technologies] : [],
		startDate: startDate ?? '',
		endDate: typeof endDate === 'string' ? endDate : null
	});
	let revisionState = $state<ResumeAiRevisionState<DraftSnapshot> | null>(null);
	let applyingRevisionSnapshot = false;
	let manualRevisionTimer: ReturnType<typeof setTimeout> | null = null;

	const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
	const normalizeNullable = (value: string | null | undefined) => normalize(value ?? '');
	const normalizeTechs = (items: string[]) =>
		items
			.map((item) => normalize(item))
			.filter(Boolean)
			.join('|');
	const normalizeDescription = (value: string) => normalize(value.replace(/<[^>]*>/g, ' '));
	const oppositeLanguage = (value: Language): Language => (value === 'sv' ? 'en' : 'sv');
	const languageName = (value: Language): string => (value === 'sv' ? 'Swedish' : 'English');
	const isLocked = (field: ResumeAiFieldKey) => lockByField[field];
	const sourceLanguage = $derived<Language>(oppositeLanguage(activeLanguage));

	const visibleFieldKeys = $derived<ResumeAiFieldKey[]>(
		sectionType === 'experience'
			? ['company', 'role', 'location', 'startDate', 'endDate', 'technologies']
			: ['company', 'role', 'technologies']
	);

	const unlockedFields = $derived<ResumeAiFieldKey[]>(
		visibleFieldKeys.filter((field) => !lockByField[field])
	);
	const hasSourceRoleForTranslation = $derived(
		!isLocked('role') && Boolean(normalize(roleByLanguage[sourceLanguage]))
	);
	const hasSourceLocationForTranslation = $derived(
		sectionType === 'experience' &&
			!isLocked('location') &&
			Boolean(normalize(locationByLanguage[sourceLanguage]))
	);
	const hasSourceDescriptionForTranslation = $derived(
		!descriptionLocked && Boolean(normalizeDescription(draftByLanguage[sourceLanguage]))
	);
	const canTranslateFromSource = $derived(
		hasSourceRoleForTranslation ||
			hasSourceLocationForTranslation ||
			hasSourceDescriptionForTranslation
	);
	const hasAnyStructuredFieldValue = $derived(
		Boolean(
			normalize(sharedDraft.company) ||
				normalize(roleByLanguage.sv) ||
				normalize(roleByLanguage.en) ||
				(sharedDraft.technologies.length > 0 ? '1' : '') ||
				(sectionType === 'experience'
					? normalize(locationByLanguage.sv) ||
						normalize(locationByLanguage.en) ||
						normalize(sharedDraft.startDate) ||
						normalizeNullable(sharedDraft.endDate)
					: '')
		)
	);
	const hasAnyDescriptionValue = $derived(
		Boolean(normalizeDescription(draftByLanguage.sv) || normalizeDescription(draftByLanguage.en))
	);
	const showFieldPanel = $derived(
		hasAnyStructuredFieldValue || hasAnyDescriptionValue || hasGeneratedOnce
	);

	const sourceByLanguage = $derived<LocalizedDraft>({
		sv: descriptionSv ?? '',
		en: descriptionEn ?? ''
	});
	const sourceRoleByLanguage = $derived<LocalizedDraft>({
		sv: roleSv ?? '',
		en: roleEn ?? ''
	});
	const sourceLocationByLanguage = $derived<LocalizedDraft>({
		sv: locationSv ?? '',
		en: locationEn ?? ''
	});
	const sourceSharedDraft = $derived<SharedDraft>({
		company: company ?? '',
		technologies: Array.isArray(technologies) ? [...technologies] : [],
		startDate: startDate ?? '',
		endDate: typeof endDate === 'string' ? endDate : null
	});
	const createSourceSnapshot = (): DraftSnapshot => ({
		descriptionByLanguage: {
			sv: sourceByLanguage.sv,
			en: sourceByLanguage.en
		},
		roleByLanguage: {
			sv: sourceRoleByLanguage.sv,
			en: sourceRoleByLanguage.en
		},
		locationByLanguage: {
			sv: sourceLocationByLanguage.sv,
			en: sourceLocationByLanguage.en
		},
		company: sourceSharedDraft.company,
		technologies: [...sourceSharedDraft.technologies],
		startDate: sourceSharedDraft.startDate,
		endDate: sourceSharedDraft.endDate
	});

	const createDraftSnapshot = (): DraftSnapshot => ({
		descriptionByLanguage: {
			sv: draftByLanguage.sv,
			en: draftByLanguage.en
		},
		roleByLanguage: {
			sv: roleByLanguage.sv,
			en: roleByLanguage.en
		},
		locationByLanguage: {
			sv: locationByLanguage.sv,
			en: locationByLanguage.en
		},
		company: sharedDraft.company,
		technologies: [...sharedDraft.technologies],
		startDate: sharedDraft.startDate,
		endDate: sharedDraft.endDate
	});

	const applyDraftSnapshot = (snapshot: DraftSnapshot) => {
		draftByLanguage = {
			sv: snapshot.descriptionByLanguage.sv,
			en: snapshot.descriptionByLanguage.en
		};
		roleByLanguage = {
			sv: snapshot.roleByLanguage.sv,
			en: snapshot.roleByLanguage.en
		};
		locationByLanguage = {
			sv: snapshot.locationByLanguage.sv,
			en: snapshot.locationByLanguage.en
		};
		sharedDraft = {
			company: snapshot.company,
			technologies: [...snapshot.technologies],
			startDate: snapshot.startDate,
			endDate: snapshot.endDate
		};
	};

	const serializeDraftSnapshot = (snapshot: DraftSnapshot): string =>
		JSON.stringify({
			descriptionByLanguage: {
				sv: normalizeDescription(snapshot.descriptionByLanguage.sv),
				en: normalizeDescription(snapshot.descriptionByLanguage.en)
			},
			roleByLanguage: {
				sv: normalize(snapshot.roleByLanguage.sv),
				en: normalize(snapshot.roleByLanguage.en)
			},
			locationByLanguage: {
				sv: normalize(snapshot.locationByLanguage.sv),
				en: normalize(snapshot.locationByLanguage.en)
			},
			company: normalize(snapshot.company),
			technologies: snapshot.technologies.map((item) => normalize(item)).filter(Boolean),
			startDate: normalize(snapshot.startDate),
			endDate: normalizeNullable(snapshot.endDate)
		});

	const resetRevisionState = (snapshot: DraftSnapshot = createDraftSnapshot()) => {
		revisionState = createResumeAiRevisionState(snapshot);
	};
	const clearManualRevisionTimer = () => {
		if (manualRevisionTimer === null) return;
		clearTimeout(manualRevisionTimer);
		manualRevisionTimer = null;
	};
	const commitHumanRevision = (snapshot: DraftSnapshot = createDraftSnapshot()) => {
		if (!revisionState) return false;
		const currentEntry = revisionState.entries[revisionState.index];
		if (!currentEntry) return false;
		if (serializeDraftSnapshot(snapshot) === serializeDraftSnapshot(currentEntry.snapshot)) {
			return false;
		}
		revisionState = pushResumeAiRevisionSnapshot(
			revisionState,
			snapshot,
			nextResumeAiRevisionLabel(revisionState, RESUME_AI_REVISION_LABEL)
		);
		return true;
	};

	const commitRevision = (beforeSnapshot: DraftSnapshot) => {
		clearManualRevisionTimer();
		const afterSnapshot = createDraftSnapshot();
		if (serializeDraftSnapshot(beforeSnapshot) === serializeDraftSnapshot(afterSnapshot)) {
			errorMessage = 'AI did not change any draft content.';
			return false;
		}

		let currentState = revisionState ?? createResumeAiRevisionState(beforeSnapshot);
		const currentEntry = currentState.entries[currentState.index];
		if (
			currentEntry &&
			serializeDraftSnapshot(beforeSnapshot) !== serializeDraftSnapshot(currentEntry.snapshot)
		) {
			currentState = pushResumeAiRevisionSnapshot(
				currentState,
				beforeSnapshot,
				nextResumeAiRevisionLabel(currentState, RESUME_AI_REVISION_LABEL)
			);
		}
		revisionState = pushResumeAiRevisionSnapshot(
			currentState,
			afterSnapshot,
			nextResumeAiRevisionLabel(currentState, RESUME_AI_REVISION_LABEL)
		);
		return true;
	};

	const restoreRevision = (nextIndex: number) => {
		if (!revisionState) return;
		const snapshot = getResumeAiRevisionSnapshot(revisionState, nextIndex);
		if (!snapshot) return;
		clearManualRevisionTimer();
		applyingRevisionSnapshot = true;
		applyDraftSnapshot(snapshot);
		revisionState = {
			...revisionState,
			index: nextIndex
		};
		revisionRenderNonce += 1;
		errorMessage = '';
		void tick().then(() => {
			applyingRevisionSnapshot = false;
		});
	};

	const revisionDiffFields = $derived.by<ResumeAiDiffField[]>(() => {
		if (!revisionState || revisionState.index === 0) return [];
		const currentSnapshot = revisionState.entries[revisionState.index]?.snapshot;
		const previousSnapshot = revisionState.entries[revisionState.index - 1]?.snapshot;
		if (!currentSnapshot || !previousSnapshot) return [];
		return [
			{
				key: 'company',
				label: 'Company',
				before: previousSnapshot.company,
				after: currentSnapshot.company
			},
			{
				key: 'role-sv',
				label: 'Role (SV)',
				before: previousSnapshot.roleByLanguage.sv,
				after: currentSnapshot.roleByLanguage.sv
			},
			{
				key: 'role-en',
				label: 'Role (EN)',
				before: previousSnapshot.roleByLanguage.en,
				after: currentSnapshot.roleByLanguage.en
			},
			{
				key: 'location-sv',
				label: 'Location (SV)',
				before: previousSnapshot.locationByLanguage.sv,
				after: currentSnapshot.locationByLanguage.sv
			},
			{
				key: 'location-en',
				label: 'Location (EN)',
				before: previousSnapshot.locationByLanguage.en,
				after: currentSnapshot.locationByLanguage.en
			},
			{
				key: 'start-date',
				label: 'Start date',
				before: previousSnapshot.startDate,
				after: currentSnapshot.startDate
			},
			{
				key: 'end-date',
				label: 'End date',
				before: previousSnapshot.endDate ?? '',
				after: currentSnapshot.endDate ?? ''
			},
			{
				key: 'technologies',
				label: 'Technologies',
				mode: 'list',
				before: previousSnapshot.technologies,
				after: currentSnapshot.technologies
			},
			{
				key: 'description-sv',
				label: 'Description (SV)',
				mode: 'html',
				before: previousSnapshot.descriptionByLanguage.sv,
				after: currentSnapshot.descriptionByLanguage.sv
			},
			{
				key: 'description-en',
				label: 'Description (EN)',
				mode: 'html',
				before: previousSnapshot.descriptionByLanguage.en,
				after: currentSnapshot.descriptionByLanguage.en
			}
		];
	});

	const hasUnappliedStructuredChanges = () => {
		if (normalize(sharedDraft.company) !== normalize(sourceSharedDraft.company)) return true;
		if (normalize(roleByLanguage.sv) !== normalize(sourceRoleByLanguage.sv)) return true;
		if (normalize(roleByLanguage.en) !== normalize(sourceRoleByLanguage.en)) return true;
		if (
			normalizeTechs(sharedDraft.technologies) !== normalizeTechs(sourceSharedDraft.technologies)
		) {
			return true;
		}
		if (sectionType === 'experience') {
			if (normalize(locationByLanguage.sv) !== normalize(sourceLocationByLanguage.sv)) return true;
			if (normalize(locationByLanguage.en) !== normalize(sourceLocationByLanguage.en)) return true;
			if (normalize(sharedDraft.startDate) !== normalize(sourceSharedDraft.startDate)) return true;
			if (normalizeNullable(sharedDraft.endDate) !== normalizeNullable(sourceSharedDraft.endDate)) {
				return true;
			}
		}
		return false;
	};

	const hasUnappliedChanges = $derived(
		normalize(prompt).length > 0 ||
			normalize(draftByLanguage.sv) !== normalize(sourceByLanguage.sv) ||
			normalize(draftByLanguage.en) !== normalize(sourceByLanguage.en) ||
			hasUnappliedStructuredChanges()
	);
	const isBusy = $derived(generating || translating);

	const syncDraftFromSource = () => {
		clearManualRevisionTimer();
		const sourceSnapshot = createSourceSnapshot();
		applyDraftSnapshot(sourceSnapshot);
		hasGeneratedOnce = false;
		descriptionLocked = false;
		descriptionRevisionByLanguage = { sv: 0, en: 0 };
		lockByField = createDefaultLocks();
		resetRevisionState(sourceSnapshot);
	};

	onDestroy(() => {
		clearManualRevisionTimer();
	});

	const openDrawer = () => {
		activeLanguage = 'sv';
		prompt = '';
		errorMessage = '';
		translating = false;
		syncDraftFromSource();
		open = true;
		scheduleResetDrawerScroll();
	};

	const discardAndClose = () => {
		prompt = '';
		errorMessage = '';
		translating = false;
		syncDraftFromSource();
		open = false;
	};

	const requestClose = () => {
		if (isBusy) {
			return false;
		}
		if (!hasUnappliedChanges) {
			return true;
		}
		closeConfirmTrigger?.click();
		return false;
	};

	const closeDrawer = () => {
		if (requestClose()) {
			open = false;
		}
	};

	const toggleFieldLock = (field: ResumeAiFieldKey) => {
		lockByField = { ...lockByField, [field]: !lockByField[field] };
	};

	const lockAllVisibleFields = () => {
		const next = { ...lockByField };
		for (const field of visibleFieldKeys) {
			next[field] = true;
		}
		lockByField = next;
		descriptionLocked = true;
	};

	const unlockAllVisibleFields = () => {
		const next = { ...lockByField };
		for (const field of visibleFieldKeys) {
			next[field] = false;
		}
		lockByField = next;
		descriptionLocked = false;
	};

	const setDraft = (targetLanguage: Language, html: string) => {
		draftByLanguage = { ...draftByLanguage, [targetLanguage]: html };
	};

	const setDraftFromAi = (targetLanguage: Language, html: string) => {
		setDraft(targetLanguage, html);
		descriptionRevisionByLanguage = {
			...descriptionRevisionByLanguage,
			[targetLanguage]: descriptionRevisionByLanguage[targetLanguage] + 1
		};
	};

	const setRole = (targetLanguage: Language, value: string) => {
		roleByLanguage = { ...roleByLanguage, [targetLanguage]: value };
	};

	const setLocation = (targetLanguage: Language, value: string) => {
		locationByLanguage = { ...locationByLanguage, [targetLanguage]: value };
	};

	const setTechnologies = (values: string[]) => {
		sharedDraft = { ...sharedDraft, technologies: values };
	};

	const getInputClass = (field: ResumeAiFieldKey) =>
		isLocked(field)
			? 'border-border bg-muted text-secondary-text'
			: 'border-border bg-card text-foreground';

	const handleBodyWheel = (event: WheelEvent) => {
		if (!scrollContainer) return;

		const maxScrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight;
		if (maxScrollTop <= 0) return;

		const nextScrollTop = Math.min(
			maxScrollTop,
			Math.max(0, scrollContainer.scrollTop + event.deltaY)
		);

		if (nextScrollTop !== scrollContainer.scrollTop) {
			event.preventDefault();
			scrollContainer.scrollTop = nextScrollTop;
		}
	};

	const resetDrawerScroll = () => {
		if (!scrollContainer) return;
		scrollContainer.scrollTop = 0;
	};

	const scheduleResetDrawerScroll = () => {
		queueMicrotask(() => {
			resetDrawerScroll();
			if (typeof window !== 'undefined') {
				window.requestAnimationFrame(() => {
					resetDrawerScroll();
				});
			}
		});
	};

	const generate = async () => {
		if (!onGenerateDescription) return;
		if (generating || translating) return;
		const targetLanguage = activeLanguage;

		const trimmedPrompt = prompt.trim();
		if (!trimmedPrompt) {
			errorMessage = 'Write a prompt first.';
			return;
		}

		generating = true;
		errorMessage = '';

		try {
			const generated = await onGenerateDescription({
				prompt: trimmedPrompt,
				language: targetLanguage,
				sectionType,
				company: sharedDraft.company,
				role: roleByLanguage[targetLanguage],
				location: locationByLanguage[targetLanguage],
				technologies: sharedDraft.technologies,
				startDate: sharedDraft.startDate,
				endDate: sharedDraft.endDate,
				unlockedFields,
				currentText: draftByLanguage[targetLanguage]
			});
			const beforeSnapshot = createDraftSnapshot();
			hasGeneratedOnce = true;

			if (!descriptionLocked) {
				setDraftFromAi(targetLanguage, generated.descriptionHtml);
			}

			if (!isLocked('company') && generated.company !== undefined) {
				sharedDraft = { ...sharedDraft, company: generated.company };
			}
			if (!isLocked('role') && generated.role !== undefined) {
				setRole(targetLanguage, generated.role);
			}
			if (
				sectionType === 'experience' &&
				!isLocked('location') &&
				generated.location !== undefined
			) {
				setLocation(targetLanguage, generated.location);
			}
			if (!isLocked('technologies') && generated.technologies !== undefined) {
				setTechnologies(generated.technologies);
			}
			if (
				sectionType === 'experience' &&
				!isLocked('startDate') &&
				generated.startDate !== undefined
			) {
				sharedDraft = { ...sharedDraft, startDate: generated.startDate };
			}
			if (sectionType === 'experience' && !isLocked('endDate') && generated.endDate !== undefined) {
				sharedDraft = { ...sharedDraft, endDate: generated.endDate };
			}
			commitRevision(beforeSnapshot);
		} catch (error) {
			const fallback = 'Could not generate text right now.';
			errorMessage = error instanceof Error && error.message ? error.message : fallback;
		} finally {
			generating = false;
		}
	};

	const translateFromSource = async () => {
		if (!onGenerateDescription) return;
		if (generating || translating) return;
		const targetLanguage = activeLanguage;
		const sourceLanguageForRequest = oppositeLanguage(targetLanguage);
		if (!canTranslateFromSource) {
			errorMessage = `No ${sourceLanguageForRequest.toUpperCase()} content available in unlocked fields.`;
			return;
		}

		const sourceRole = roleByLanguage[sourceLanguageForRequest];
		const sourceLocation = locationByLanguage[sourceLanguageForRequest];
		const sourceDescriptionHtml = draftByLanguage[sourceLanguageForRequest];
		const shouldTranslateRole = !isLocked('role') && Boolean(normalize(sourceRole));
		const shouldTranslateLocation =
			sectionType === 'experience' && !isLocked('location') && Boolean(normalize(sourceLocation));
		const shouldTranslateDescription =
			!descriptionLocked && Boolean(normalizeDescription(sourceDescriptionHtml));

		const translationUnlockedFields: ResumeAiFieldKey[] = [];
		if (shouldTranslateRole) {
			translationUnlockedFields.push('role');
		}
		if (shouldTranslateLocation) {
			translationUnlockedFields.push('location');
		}

		const promptLines: string[] = [
			`Translate available resume fields from ${languageName(sourceLanguageForRequest)} to ${languageName(targetLanguage)}.`,
			'Translate only the source fields below.',
			'Preserve facts, titles, and technical terms.',
			'Do not invent missing information.',
			`Source role: ${normalize(sourceRole) || 'N/A'}`,
			`Source description: ${normalizeDescription(sourceDescriptionHtml) || 'N/A'}`
		];
		if (sectionType === 'experience') {
			promptLines.splice(5, 0, `Source location: ${normalize(sourceLocation) || 'N/A'}`);
		}

		translating = true;
		errorMessage = '';

		try {
			const generated = await onGenerateDescription({
				prompt: promptLines.join('\n'),
				language: targetLanguage,
				sectionType,
				company: sharedDraft.company,
				role: shouldTranslateRole ? sourceRole : roleByLanguage[targetLanguage],
				location:
					sectionType === 'experience'
						? shouldTranslateLocation
							? sourceLocation
							: locationByLanguage[targetLanguage]
						: undefined,
				technologies: sharedDraft.technologies,
				startDate: sharedDraft.startDate,
				endDate: sharedDraft.endDate,
				unlockedFields: translationUnlockedFields,
				currentText: shouldTranslateDescription
					? sourceDescriptionHtml
					: draftByLanguage[targetLanguage] || 'Placeholder context.'
			});
			const beforeSnapshot = createDraftSnapshot();
			hasGeneratedOnce = true;

			if (shouldTranslateDescription && !descriptionLocked) {
				setDraftFromAi(targetLanguage, generated.descriptionHtml);
			}
			if (shouldTranslateRole && generated.role !== undefined) {
				setRole(targetLanguage, generated.role);
			}
			if (shouldTranslateLocation && generated.location !== undefined) {
				setLocation(targetLanguage, generated.location);
			}
			commitRevision(beforeSnapshot);
		} catch (error) {
			const fallback = 'Could not translate fields right now.';
			errorMessage = error instanceof Error && error.message ? error.message : fallback;
		} finally {
			translating = false;
		}
	};

	const accept = () => {
		const drafts = {
			descriptionByLanguage: {
				sv: draftByLanguage.sv,
				en: draftByLanguage.en
			},
			roleByLanguage: {
				sv: roleByLanguage.sv,
				en: roleByLanguage.en
			},
			locationByLanguage: {
				sv: locationByLanguage.sv,
				en: locationByLanguage.en
			},
			company: sharedDraft.company,
			technologies: [...sharedDraft.technologies],
			startDate: sharedDraft.startDate,
			endDate: sharedDraft.endDate
		};

		const generated: ResumeAiGenerateResult = {
			descriptionHtml: draftByLanguage[activeLanguage],
			company: sharedDraft.company,
			role: roleByLanguage[activeLanguage],
			technologies: sharedDraft.technologies
		};

		if (sectionType === 'experience') {
			generated.location = locationByLanguage[activeLanguage];
			generated.startDate = sharedDraft.startDate;
			generated.endDate = sharedDraft.endDate;
		}

		onAccept?.({
			language: activeLanguage,
			generated,
			drafts
		});
		prompt = '';
		errorMessage = '';
		open = false;
	};

	$effect(() => {
		if (!open) {
			activeLanguage = 'sv';
			syncDraftFromSource();
			return;
		}
		scheduleResetDrawerScroll();
	});

	$effect(() => {
		if (!open || !revisionState || applyingRevisionSnapshot) return;
		const currentSnapshot = createDraftSnapshot();
		const currentEntry = revisionState.entries[revisionState.index];
		if (!currentEntry) return;
		if (serializeDraftSnapshot(currentSnapshot) === serializeDraftSnapshot(currentEntry.snapshot)) {
			clearManualRevisionTimer();
			return;
		}
		clearManualRevisionTimer();
		manualRevisionTimer = setTimeout(() => {
			manualRevisionTimer = null;
			if (!open || applyingRevisionSnapshot) return;
			commitHumanRevision();
		}, RESUME_AI_HUMAN_REVISION_DEBOUNCE_MS);
	});
</script>

<Button
	type="button"
	variant="ghost"
	size="sm"
	title="Open AI writer"
	aria-label={`Open AI writer for ${rowTitle}`}
	onclick={openDrawer}
>
	<Sparkles size={16} />
</Button>

<Drawer bind:open variant="bottom" title={rowTitle} subtitle="AI writer" beforeClose={requestClose}>
	<div
		class="relative flex min-h-0 flex-1 flex-col gap-4"
		inert={isBusy ? true : undefined}
		aria-busy={isBusy}
	>
		<button
			type="button"
			class="pointer-events-none absolute right-0 top-0 h-0 w-0 opacity-0"
			aria-hidden="true"
			bind:this={closeConfirmTrigger}
			use:confirm={{
				title: 'Close AI writer?',
				description: 'Do you want to close before applying? Unsaved AI changes will be discarded.',
				actionLabel: 'Close',
				action: discardAndClose
			}}
		></button>

		{#if isBusy}
			<div
				class="bg-card/75 absolute inset-0 z-20 flex items-center justify-center backdrop-blur-[1px]"
				role="status"
				aria-live="polite"
			>
				<p class="text-foreground text-sm font-medium">AI is working. Editing is temporarily disabled.</p>
			</div>
		{/if}

		<div
			class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1"
			bind:this={scrollContainer}
			onwheel={handleBodyWheel}
		>
			<div class="flex items-center justify-between gap-3">
				<div class="flex items-center gap-2">
					<button
						type="button"
						class={activeLanguage === 'sv'
							? 'bg-primary rounded-full px-3 py-1 text-xs font-semibold text-white'
							: 'bg-muted text-secondary-text rounded-full px-3 py-1 text-xs font-semibold'}
						disabled={generating || translating}
						onclick={() => {
							activeLanguage = 'sv';
							errorMessage = '';
						}}
					>
						SV
					</button>
					<button
						type="button"
						class={activeLanguage === 'en'
							? 'bg-primary rounded-full px-3 py-1 text-xs font-semibold text-white'
							: 'bg-muted text-secondary-text rounded-full px-3 py-1 text-xs font-semibold'}
						disabled={generating || translating}
						onclick={() => {
							activeLanguage = 'en';
							errorMessage = '';
						}}
					>
						EN
					</button>
				</div>
				<p class="text-secondary-text text-xs">
					{showFieldPanel
						? 'Locked fields and description still guide AI context.'
						: 'Fields and description appear after first generation.'}
				</p>
			</div>

			<FormControl label="Prompt">
				<textarea
					bind:value={prompt}
					rows="5"
					placeholder="Describe the project, ownership, solution, and outcomes..."
					class="rounded-xs border-border bg-card text-foreground focus:border-primary w-full resize-y border p-3 text-sm outline-none"
				></textarea>
			</FormControl>

			<div class="flex gap-2">
				<Button
					type="button"
					variant="outline"
					disabled={generating || translating}
					loading={generating}
					loading-text="Writing…"
					onclick={generate}
				>
					<Sparkles size={14} />
					Write with AI
				</Button>
				<Button
					type="button"
					variant="outline"
					disabled={generating || translating || !canTranslateFromSource}
					loading={translating}
					loading-text="Translating…"
					onclick={translateFromSource}
				>
					Translate from {sourceLanguage.toUpperCase()}
				</Button>
				<Button
					type="button"
					variant="ghost"
					disabled={generating || translating}
					onclick={() => {
						prompt = '';
						errorMessage = '';
					}}
				>
					Clear prompt
				</Button>
			</div>

			{#if errorMessage}
				<p class="text-sm text-red-600">{errorMessage}</p>
			{/if}

			{#if showFieldPanel}
				<div class="rounded-xs border-border bg-muted grid gap-3 border p-3">
					<div class="flex items-center justify-between gap-3">
						<p class="text-secondary-text text-sm font-medium">Fields</p>
						<div class="flex gap-2">
							<Button type="button" size="sm" variant="ghost" onclick={unlockAllVisibleFields}
								>Unlock all</Button
							>
							<Button type="button" size="sm" variant="ghost" onclick={lockAllVisibleFields}
								>Lock all</Button
							>
						</div>
					</div>
					<p class="text-secondary-text text-xs">
						AI can only update unlocked fields. Locked fields remain unchanged.
					</p>

					<div class="space-y-1">
						<div class="flex items-center justify-between gap-3">
							<label class="text-secondary-text text-xs font-medium">Company</label>
							<button
								type="button"
								class="rounded-xs text-secondary-text hover:bg-muted inline-flex items-center gap-1 px-2 py-1 text-xs font-medium"
								onclick={() => toggleFieldLock('company')}
							>
								{#if isLocked('company')}
									<Lock size={12} />
									Locked
								{:else}
									<LockOpen size={12} />
									Unlocked
								{/if}
							</button>
						</div>
						<Input
							bind:value={sharedDraft.company}
							readonly={isLocked('company')}
							placeholder="Company"
							class={getInputClass('company')}
						/>
					</div>

					<div class="space-y-1">
						<div class="flex items-center justify-between gap-3">
							<label class="text-secondary-text text-xs font-medium"
								>Role ({activeLanguage.toUpperCase()})</label
							>
							<button
								type="button"
								class="rounded-xs text-secondary-text hover:bg-muted inline-flex items-center gap-1 px-2 py-1 text-xs font-medium"
								onclick={() => toggleFieldLock('role')}
							>
								{#if isLocked('role')}
									<Lock size={12} />
									Locked
								{:else}
									<LockOpen size={12} />
									Unlocked
								{/if}
							</button>
						</div>
						<Input
							value={roleByLanguage[activeLanguage]}
							readonly={isLocked('role')}
							oninput={(e) => setRole(activeLanguage, e.currentTarget.value)}
							placeholder="Role"
							class={getInputClass('role')}
						/>
					</div>

					{#if sectionType === 'experience'}
						<div class="space-y-1">
							<div class="flex items-center justify-between gap-3">
								<label class="text-secondary-text text-xs font-medium"
									>Location ({activeLanguage.toUpperCase()})</label
								>
								<button
									type="button"
									class="rounded-xs text-secondary-text hover:bg-muted inline-flex items-center gap-1 px-2 py-1 text-xs font-medium"
									onclick={() => toggleFieldLock('location')}
								>
									{#if isLocked('location')}
										<Lock size={12} />
										Locked
									{:else}
										<LockOpen size={12} />
										Unlocked
									{/if}
								</button>
							</div>
							<Input
								value={locationByLanguage[activeLanguage]}
								readonly={isLocked('location')}
								oninput={(e) => setLocation(activeLanguage, e.currentTarget.value)}
								placeholder="Location"
								class={getInputClass('location')}
							/>
						</div>

						<div class="grid grid-cols-2 gap-3">
							<div class="space-y-1">
								<div class="flex items-center justify-between gap-3">
									<label class="text-secondary-text text-xs font-medium"
										>Start Date (YYYY-MM-DD)</label
									>
									<button
										type="button"
										class="rounded-xs text-secondary-text hover:bg-muted inline-flex items-center gap-1 px-2 py-1 text-xs font-medium"
										onclick={() => toggleFieldLock('startDate')}
									>
										{#if isLocked('startDate')}
											<Lock size={12} />
											Locked
										{:else}
											<LockOpen size={12} />
											Unlocked
										{/if}
									</button>
								</div>
								<Input
									bind:value={sharedDraft.startDate}
									readonly={isLocked('startDate')}
									placeholder="YYYY-MM-DD"
									class={getInputClass('startDate')}
								/>
							</div>
							<div class="space-y-1">
								<div class="flex items-center justify-between gap-3">
									<label class="text-secondary-text text-xs font-medium"
										>End Date (empty = Present)</label
									>
									<button
										type="button"
										class="rounded-xs text-secondary-text hover:bg-muted inline-flex items-center gap-1 px-2 py-1 text-xs font-medium"
										onclick={() => toggleFieldLock('endDate')}
									>
										{#if isLocked('endDate')}
											<Lock size={12} />
											Locked
										{:else}
											<LockOpen size={12} />
											Unlocked
										{/if}
									</button>
								</div>
								<Input
									value={sharedDraft.endDate ?? ''}
									readonly={isLocked('endDate')}
									oninput={(e) =>
										(sharedDraft = {
											...sharedDraft,
											endDate: e.currentTarget.value.trim() || null
										})}
									placeholder="Leave empty for 'Present'"
									class={getInputClass('endDate')}
								/>
							</div>
						</div>
					{/if}

					<div class="space-y-1">
						<div class="flex items-center justify-between gap-3">
							<label class="text-secondary-text text-xs font-medium"
								>Description ({activeLanguage.toUpperCase()})</label
							>
							<button
								type="button"
								class="rounded-xs text-secondary-text hover:bg-muted inline-flex items-center gap-1 px-2 py-1 text-xs font-medium"
								onclick={() => (descriptionLocked = !descriptionLocked)}
							>
								{#if descriptionLocked}
									<Lock size={12} />
									Locked
								{:else}
									<LockOpen size={12} />
									Unlocked
								{/if}
							</button>
						</div>
						<div
							class={descriptionLocked
								? 'rounded-xs border-border bg-muted text-secondary-text border'
								: 'rounded-xs border-border bg-card border'}
						>
							{#if descriptionLocked}
								{#if normalizeDescription(draftByLanguage[activeLanguage])}
									<div class="text-secondary-text p-3 text-sm">
										<!-- eslint-disable-next-line svelte/no-at-html-tags -->
										{@html draftByLanguage[activeLanguage]}
									</div>
								{:else}
									<p class="text-secondary-text p-3 text-sm">No description yet.</p>
								{/if}
							{:else}
								{#key `${activeLanguage}-${descriptionRevisionByLanguage[activeLanguage]}-${revisionRenderNonce}`}
									{@const editorLanguage = activeLanguage}
									<QuillEditor
										content={draftByLanguage[editorLanguage]}
										placeholder="Description appears here..."
										onchange={(html) => setDraft(editorLanguage, html)}
									/>
								{/key}
							{/if}
						</div>
					</div>

					<div class="space-y-1">
						<div class="flex items-center justify-between gap-3">
							<label class="text-secondary-text text-xs font-medium">Key Technologies</label>
							<button
								type="button"
								class="rounded-xs text-secondary-text hover:bg-muted inline-flex items-center gap-1 px-2 py-1 text-xs font-medium"
								onclick={() => toggleFieldLock('technologies')}
							>
								{#if isLocked('technologies')}
									<Lock size={12} />
									Locked
								{:else}
									<LockOpen size={12} />
									Unlocked
								{/if}
							</button>
						</div>
						{#if isLocked('technologies')}
							<Input
								readonly
								value={sharedDraft.technologies.join(', ')}
								placeholder="No technologies"
								class={getInputClass('technologies')}
							/>
						{:else}
							{#key revisionRenderNonce}
								<TechStackSelector
									value={sharedDraft.technologies}
									{organisationId}
									onchange={(techs) => setTechnologies(techs ?? [])}
								/>
							{/key}
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<div class="border-border relative flex items-center justify-end gap-3 border-t pt-4">
			<div class="pointer-events-none absolute inset-x-0 bottom-0 top-4">
				<ResumeAiRevisionPanel
					{revisionState}
					fields={revisionDiffFields}
					busy={isBusy}
					onUndo={() => revisionState && restoreRevision(revisionState.index - 1)}
					onRedo={() => revisionState && restoreRevision(revisionState.index + 1)}
				/>
			</div>
			<div class="relative z-10 flex justify-end gap-2">
				<Button type="button" variant="primary" disabled={isBusy} onclick={accept}
					>Apply changes</Button
				>
			</div>
		</div>
	</div>
</Drawer>
