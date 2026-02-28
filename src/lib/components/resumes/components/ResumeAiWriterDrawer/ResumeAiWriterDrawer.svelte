<script lang="ts">
	import { Button, FormControl, Input } from '@pixelcode_/blocks/components';
	import Lock from 'lucide-svelte/icons/lock';
	import LockOpen from 'lucide-svelte/icons/lock-open';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	import { QuillEditor, TechStackSelector } from '$lib/components';
	import Drawer from '$lib/components/drawer/drawer.svelte';
	import { confirm } from '$lib/utils/confirm';
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
	const debugLoggingEnabled = import.meta.env.DEV;

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
		onAccept
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

	const syncDraftFromSource = () => {
		draftByLanguage = {
			sv: sourceByLanguage.sv,
			en: sourceByLanguage.en
		};
		roleByLanguage = {
			sv: sourceRoleByLanguage.sv,
			en: sourceRoleByLanguage.en
		};
		locationByLanguage = {
			sv: sourceLocationByLanguage.sv,
			en: sourceLocationByLanguage.en
		};
		sharedDraft = {
			company: sourceSharedDraft.company,
			technologies: [...sourceSharedDraft.technologies],
			startDate: sourceSharedDraft.startDate,
			endDate: sourceSharedDraft.endDate
		};
		hasGeneratedOnce = false;
		descriptionLocked = false;
		descriptionRevisionByLanguage = { sv: 0, en: 0 };
		lockByField = createDefaultLocks();
	};

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
			? 'border-border bg-muted text-muted-fg'
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
		if (debugLoggingEnabled) {
			console.info('[resume-ai] generate:start', {
				targetLanguage,
				sectionType,
				unlockedFields,
				currentTextLength: draftByLanguage[targetLanguage]?.length ?? 0
			});
		}

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
			if (debugLoggingEnabled) {
				console.info('[resume-ai] generate:result', {
					targetLanguage,
					descriptionLength: generated.descriptionHtml?.length ?? 0,
					hasRole: typeof generated.role === 'string' && generated.role.trim().length > 0,
					hasLocation:
						typeof generated.location === 'string' && generated.location.trim().length > 0
				});
			}
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
		if (debugLoggingEnabled) {
			console.info('[resume-ai] translate:start', {
				sourceLanguage: sourceLanguageForRequest,
				targetLanguage,
				sectionType,
				shouldTranslateDescription,
				shouldTranslateRole,
				shouldTranslateLocation,
				sourceDescriptionLength: sourceDescriptionHtml?.length ?? 0
			});
		}

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
			if (debugLoggingEnabled) {
				console.info('[resume-ai] translate:result', {
					sourceLanguage: sourceLanguageForRequest,
					targetLanguage,
					descriptionLength: generated.descriptionHtml?.length ?? 0,
					hasRole: typeof generated.role === 'string' && generated.role.trim().length > 0,
					hasLocation:
						typeof generated.location === 'string' && generated.location.trim().length > 0
				});
			}
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
		} catch (error) {
			const fallback = 'Could not translate fields right now.';
			errorMessage = error instanceof Error && error.message ? error.message : fallback;
		} finally {
			translating = false;
		}
	};

	const accept = () => {
		if (debugLoggingEnabled) {
			console.info('[resume-ai] apply', {
				activeLanguage,
				sectionType,
				descriptionLength: draftByLanguage[activeLanguage]?.length ?? 0,
				svLength: draftByLanguage.sv?.length ?? 0,
				enLength: draftByLanguage.en?.length ?? 0
			});
		}
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
	<div class="relative flex min-h-0 flex-1 flex-col gap-4">
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
		/>

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
							? 'rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white'
							: 'rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-fg'}
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
							? 'rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white'
							: 'rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-fg'}
						disabled={generating || translating}
						onclick={() => {
							activeLanguage = 'en';
							errorMessage = '';
						}}
					>
						EN
					</button>
				</div>
				<p class="text-xs text-muted-fg">
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
					class="rounded-xs w-full resize-y border border-border bg-card p-3 text-sm text-foreground outline-none focus:border-primary"
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
				<div class="rounded-xs grid gap-3 border border-border bg-muted p-3">
					<div class="flex items-center justify-between gap-3">
						<p class="text-sm font-medium text-muted-fg">Fields</p>
						<div class="flex gap-2">
							<Button type="button" size="sm" variant="ghost" onclick={unlockAllVisibleFields}
								>Unlock all</Button
							>
							<Button type="button" size="sm" variant="ghost" onclick={lockAllVisibleFields}
								>Lock all</Button
							>
						</div>
					</div>
					<p class="text-xs text-muted-fg">
						AI can only update unlocked fields. Locked fields remain unchanged.
					</p>

					<div class="space-y-1">
						<div class="flex items-center justify-between gap-3">
							<label class="text-xs font-medium text-muted-fg">Company</label>
							<button
								type="button"
								class="rounded-xs inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-muted-fg hover:bg-muted"
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
							<label class="text-xs font-medium text-muted-fg"
								>Role ({activeLanguage.toUpperCase()})</label
							>
							<button
								type="button"
								class="rounded-xs inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-muted-fg hover:bg-muted"
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
								<label class="text-xs font-medium text-muted-fg"
									>Location ({activeLanguage.toUpperCase()})</label
								>
								<button
									type="button"
									class="rounded-xs inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-muted-fg hover:bg-muted"
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
									<label class="text-xs font-medium text-muted-fg">Start Date (YYYY-MM-DD)</label>
									<button
										type="button"
										class="rounded-xs inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-muted-fg hover:bg-muted"
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
									<label class="text-xs font-medium text-muted-fg"
										>End Date (empty = Present)</label
									>
									<button
										type="button"
										class="rounded-xs inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-muted-fg hover:bg-muted"
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
							<label class="text-xs font-medium text-muted-fg"
								>Description ({activeLanguage.toUpperCase()})</label
							>
							<button
								type="button"
								class="rounded-xs inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-muted-fg hover:bg-muted"
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
								? 'rounded-xs border border-border bg-muted text-muted-fg'
								: 'rounded-xs border border-border bg-card'}
						>
							{#if descriptionLocked}
								{#if normalizeDescription(draftByLanguage[activeLanguage])}
									<div class="p-3 text-sm text-muted-fg">
										<!-- eslint-disable-next-line svelte/no-at-html-tags -->
										{@html draftByLanguage[activeLanguage]}
									</div>
								{:else}
									<p class="p-3 text-sm text-muted-fg">No description yet.</p>
								{/if}
							{:else}
								{#key `${activeLanguage}-${descriptionRevisionByLanguage[activeLanguage]}`}
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
							<label class="text-xs font-medium text-muted-fg">Key Technologies</label>
							<button
								type="button"
								class="rounded-xs inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-muted-fg hover:bg-muted"
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
							<TechStackSelector
								value={sharedDraft.technologies}
								onchange={(techs) => setTechnologies(techs ?? [])}
							/>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<div class="flex justify-end gap-2 border-t border-border pt-4">
			<Button type="button" variant="ghost" onclick={closeDrawer}>Close</Button>
			<Button type="button" variant="primary" disabled={generating || translating} onclick={accept}
				>Apply changes</Button
			>
		</div>
	</div>
</Drawer>
