<script lang="ts">
	import { Button, FormControl } from '@pixelcode_/blocks/components';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	import Drawer from '$lib/components/drawer/drawer.svelte';
	import { QuillEditor } from '$lib/components';
	import ResumeAiRevisionPanel from '../ResumeAiRevisionPanel.svelte';
	import { confirm } from '$lib/utils/confirm';
	import {
		type ResumeAiDiffField,
		type ResumeAiRevisionState,
		createResumeAiRevisionState,
		getResumeAiRevisionSnapshot,
		nextResumeAiRevisionLabel,
		pushResumeAiRevisionSnapshot,
		replaceCurrentResumeAiRevisionSnapshot
	} from '../aiRevisions';
	import type { Language, ResumeAiGenerateParams, ResumeAiGenerateResult } from '../utils';

	type AcceptPayload = {
		language: Language;
		generated: ResumeAiGenerateResult;
		summaryByLanguage: LocalizedDraft;
	};

	type LocalizedDraft = {
		sv: string;
		en: string;
	};

	type RevisionByLanguage = {
		sv: number;
		en: number;
	};

	let {
		rowTitle = 'Summary',
		summarySv = '',
		summaryEn = '',
		resumeContextSv = '',
		resumeContextEn = '',
		onGenerateDescription,
		onAccept
	}: {
		rowTitle?: string;
		summarySv?: string;
		summaryEn?: string;
		resumeContextSv?: string;
		resumeContextEn?: string;
		onGenerateDescription?: (params: ResumeAiGenerateParams) => Promise<ResumeAiGenerateResult>;
		onAccept?: (payload: AcceptPayload) => void;
	} = $props();

	let open = $state(false);
	let prompt = $state('');
	let errorMessage = $state('');
	let generating = $state(false);
	let translating = $state(false);
	let creatingFromResume = $state(false);
	let hasGeneratedOnce = $state(false);
	let activeLanguage = $state<Language>('sv');
	let closeConfirmTrigger = $state<HTMLButtonElement | null>(null);
	let scrollContainer: HTMLDivElement | null = null;
	let descriptionRevisionByLanguage = $state<RevisionByLanguage>({ sv: 0, en: 0 });
	let draftByLanguage = $state<LocalizedDraft>({
		sv: summarySv ?? '',
		en: summaryEn ?? ''
	});
	let revisionState = $state<ResumeAiRevisionState<LocalizedDraft> | null>(null);
	let applyingRevisionSnapshot = false;

	const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
	const normalizeDescription = (value: string) => normalize(value.replace(/<[^>]*>/g, ' '));
	const oppositeLanguage = (value: Language): Language => (value === 'sv' ? 'en' : 'sv');
	const languageName = (value: Language): string => (value === 'sv' ? 'Swedish' : 'English');
	const createSourceSnapshot = (): LocalizedDraft => ({
		sv: sourceByLanguage.sv,
		en: sourceByLanguage.en
	});
	const createDraftSnapshot = (): LocalizedDraft => ({
		sv: draftByLanguage.sv,
		en: draftByLanguage.en
	});
	const applyDraftSnapshot = (snapshot: LocalizedDraft) => {
		draftByLanguage = {
			sv: snapshot.sv,
			en: snapshot.en
		};
	};
	const serializeDraftSnapshot = (snapshot: LocalizedDraft): string =>
		JSON.stringify({
			sv: normalizeDescription(snapshot.sv),
			en: normalizeDescription(snapshot.en)
		});
	const resetRevisionState = (snapshot: LocalizedDraft = createDraftSnapshot()) => {
		revisionState = createResumeAiRevisionState(snapshot);
	};
	const commitRevision = (baseLabel: string, beforeSnapshot: LocalizedDraft) => {
		const afterSnapshot = createDraftSnapshot();
		if (serializeDraftSnapshot(beforeSnapshot) === serializeDraftSnapshot(afterSnapshot)) {
			errorMessage = 'AI did not change the summary draft.';
			return false;
		}

		const currentState = revisionState ?? createResumeAiRevisionState(beforeSnapshot);
		const syncedState = replaceCurrentResumeAiRevisionSnapshot(currentState, beforeSnapshot);
		revisionState = pushResumeAiRevisionSnapshot(
			syncedState,
			afterSnapshot,
			nextResumeAiRevisionLabel(syncedState, baseLabel)
		);
		return true;
	};
	const restoreRevision = (nextIndex: number) => {
		if (!revisionState) return;
		const snapshot = getResumeAiRevisionSnapshot(revisionState, nextIndex);
		if (!snapshot) return;
		applyingRevisionSnapshot = true;
		applyDraftSnapshot(snapshot);
		revisionState = {
			...revisionState,
			index: nextIndex
		};
		errorMessage = '';
		queueMicrotask(() => {
			applyingRevisionSnapshot = false;
		});
	};

	const sourceByLanguage = $derived<LocalizedDraft>({
		sv: summarySv ?? '',
		en: summaryEn ?? ''
	});
	const sourceLanguage = $derived<Language>(oppositeLanguage(activeLanguage));
	const hasAnySummaryValue = $derived(
		Boolean(normalizeDescription(draftByLanguage.sv) || normalizeDescription(draftByLanguage.en))
	);
	const showSummaryPanel = $derived(hasAnySummaryValue || hasGeneratedOnce);
	const hasSourceForTranslation = $derived(
		Boolean(normalizeDescription(draftByLanguage[sourceLanguage]))
	);
	const hasUnappliedChanges = $derived(
		normalize(prompt).length > 0 ||
			normalize(draftByLanguage.sv) !== normalize(sourceByLanguage.sv) ||
			normalize(draftByLanguage.en) !== normalize(sourceByLanguage.en)
	);
	const revisionDiffFields = $derived.by<ResumeAiDiffField[]>(() => {
		if (!revisionState || revisionState.index === 0) return [];
		const currentSnapshot = revisionState.entries[revisionState.index]?.snapshot;
		const previousSnapshot = revisionState.entries[revisionState.index - 1]?.snapshot;
		if (!currentSnapshot || !previousSnapshot) return [];
		return [
			{
				key: 'summary-sv',
				label: 'Summary (SV)',
				mode: 'html',
				before: previousSnapshot.sv,
				after: currentSnapshot.sv
			},
			{
				key: 'summary-en',
				label: 'Summary (EN)',
				mode: 'html',
				before: previousSnapshot.en,
				after: currentSnapshot.en
			}
		];
	});

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

	const syncDraftFromSource = () => {
		const sourceSnapshot = createSourceSnapshot();
		applyDraftSnapshot(sourceSnapshot);
		descriptionRevisionByLanguage = { sv: 0, en: 0 };
		hasGeneratedOnce = false;
		resetRevisionState(sourceSnapshot);
	};

	const openDrawer = () => {
		activeLanguage = 'sv';
		prompt = '';
		errorMessage = '';
		translating = false;
		generating = false;
		creatingFromResume = false;
		syncDraftFromSource();
		open = true;
		scheduleResetDrawerScroll();
	};

	const discardAndClose = () => {
		prompt = '';
		errorMessage = '';
		translating = false;
		generating = false;
		creatingFromResume = false;
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

	const currentResumeContext = (targetLanguage: Language) => {
		return targetLanguage === 'sv'
			? resumeContextSv || resumeContextEn
			: resumeContextEn || resumeContextSv;
	};

	const generateFromPrompt = async () => {
		if (!onGenerateDescription) return;
		if (generating || translating || creatingFromResume) return;
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
				sectionType: 'summary',
				currentText: draftByLanguage[targetLanguage],
				resumeContext: currentResumeContext(targetLanguage)
			});
			const beforeSnapshot = createDraftSnapshot();
			hasGeneratedOnce = true;
			setDraftFromAi(targetLanguage, generated.descriptionHtml);
			commitRevision('AI write', beforeSnapshot);
		} catch (error) {
			const fallback = 'Could not generate summary right now.';
			errorMessage = error instanceof Error && error.message ? error.message : fallback;
		} finally {
			generating = false;
		}
	};

	const translateFromSource = async () => {
		if (!onGenerateDescription) return;
		if (generating || translating || creatingFromResume) return;
		const targetLanguage = activeLanguage;
		const sourceLanguageForRequest = oppositeLanguage(targetLanguage);
		const sourceText = draftByLanguage[sourceLanguageForRequest];
		if (!normalizeDescription(sourceText)) {
			errorMessage = `No ${sourceLanguageForRequest.toUpperCase()} summary available to translate.`;
			return;
		}

		translating = true;
		errorMessage = '';

		const translationPrompt = [
			`Translate this resume summary from ${languageName(sourceLanguageForRequest)} to ${languageName(targetLanguage)}.`,
			'Preserve meaning, tone, and technical terminology.',
			'Do not add new facts and do not remove important details.'
		].join('\n');

		try {
			const generated = await onGenerateDescription({
				prompt: translationPrompt,
				language: targetLanguage,
				sectionType: 'summary',
				currentText: sourceText,
				resumeContext: currentResumeContext(targetLanguage)
			});
			const beforeSnapshot = createDraftSnapshot();
			hasGeneratedOnce = true;
			setDraftFromAi(targetLanguage, generated.descriptionHtml);
			commitRevision('Translation', beforeSnapshot);
		} catch (error) {
			const fallback = 'Could not translate summary right now.';
			errorMessage = error instanceof Error && error.message ? error.message : fallback;
		} finally {
			translating = false;
		}
	};

	const createSummaryFromResume = async () => {
		if (!onGenerateDescription) return;
		if (generating || translating || creatingFromResume) return;
		const targetLanguage = activeLanguage;
		const resumeContext = currentResumeContext(targetLanguage);

		if (!normalize(resumeContext)) {
			errorMessage = 'No resume context is available yet.';
			return;
		}

		creatingFromResume = true;
		errorMessage = '';

		const summaryPrompt =
			'Create a professional consultant summary based on the resume context. Prioritize highlighted and previous experiences first, with strongest weight on the most recent years to reflect the current role profile. Treat older roles as valuable background depth. Use skills as supporting context only. Keep it concise, practical, and factual.';

		try {
			const generated = await onGenerateDescription({
				prompt: summaryPrompt,
				language: targetLanguage,
				sectionType: 'summary',
				currentText: draftByLanguage[targetLanguage],
				resumeContext
			});
			const beforeSnapshot = createDraftSnapshot();
			hasGeneratedOnce = true;
			setDraftFromAi(targetLanguage, generated.descriptionHtml);
			commitRevision('Create from Resume', beforeSnapshot);
		} catch (error) {
			const fallback = 'Could not create summary from resume right now.';
			errorMessage = error instanceof Error && error.message ? error.message : fallback;
		} finally {
			creatingFromResume = false;
		}
	};

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

	const accept = () => {
		onAccept?.({
			language: activeLanguage,
			generated: {
				descriptionHtml: draftByLanguage[activeLanguage]
			},
			summaryByLanguage: {
				sv: draftByLanguage.sv,
				en: draftByLanguage.en
			}
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
		if (
			serializeDraftSnapshot(currentSnapshot) ===
			serializeDraftSnapshot(revisionState.entries[revisionState.index].snapshot)
		) {
			return;
		}
		revisionState = replaceCurrentResumeAiRevisionSnapshot(revisionState, currentSnapshot);
	});
</script>

<Button
	type="button"
	variant="ghost"
	size="sm"
	title="Open AI summary writer"
	aria-label="Open AI summary writer"
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
		></button>

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
							: 'rounded-full bg-muted px-3 py-1 text-xs font-semibold text-secondary-text'}
						disabled={generating || translating || creatingFromResume}
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
							: 'rounded-full bg-muted px-3 py-1 text-xs font-semibold text-secondary-text'}
						disabled={generating || translating || creatingFromResume}
						onclick={() => {
							activeLanguage = 'en';
							errorMessage = '';
						}}
					>
						EN
					</button>
				</div>
			</div>

			<FormControl label="Prompt">
				<textarea
					bind:value={prompt}
					rows="5"
					placeholder="Describe the summary you want..."
					class="rounded-xs w-full resize-y border border-border bg-card p-3 text-sm text-foreground outline-none focus:border-primary"
				></textarea>
			</FormControl>

			<div class="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="outline"
					disabled={generating || translating || creatingFromResume}
					loading={generating}
					loading-text="Writing…"
					onclick={generateFromPrompt}
				>
					<Sparkles size={14} />
					Write with AI
				</Button>
				<Button
					type="button"
					variant="outline"
					disabled={generating || translating || creatingFromResume || !hasSourceForTranslation}
					loading={translating}
					loading-text="Translating…"
					onclick={translateFromSource}
				>
					Translate from {sourceLanguage.toUpperCase()}
				</Button>
				<Button
					type="button"
					variant="outline"
					disabled={generating || translating || creatingFromResume}
					loading={creatingFromResume}
					loading-text="Creating…"
					onclick={createSummaryFromResume}
				>
					Create summary based on resume
				</Button>
				<Button
					type="button"
					variant="ghost"
					disabled={generating || translating || creatingFromResume}
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

			<ResumeAiRevisionPanel
				{revisionState}
				fields={revisionDiffFields}
				busy={generating || translating || creatingFromResume}
				helperText="AI revisions stay local until you click Apply changes."
				onUndo={() => revisionState && restoreRevision(revisionState.index - 1)}
				onRedo={() => revisionState && restoreRevision(revisionState.index + 1)}
			/>

			{#if showSummaryPanel}
				<div class="space-y-1">
					<p class="text-xs font-medium text-secondary-text">Summary ({activeLanguage.toUpperCase()})</p>
					<div class="rounded-xs border border-border bg-card">
						{#key `${activeLanguage}-${descriptionRevisionByLanguage[activeLanguage]}`}
							<QuillEditor
								content={draftByLanguage[activeLanguage]}
								placeholder="Summary appears here..."
								onchange={(html) => setDraft(activeLanguage, html)}
							/>
						{/key}
					</div>
				</div>
			{/if}
		</div>

		<div class="flex justify-end gap-2 border-t border-border pt-4">
			<Button type="button" variant="ghost" onclick={closeDrawer}>Close</Button>
			<Button
				type="button"
				variant="primary"
				disabled={generating || translating || creatingFromResume}
				onclick={accept}>Apply changes</Button
			>
		</div>
	</div>
</Drawer>
