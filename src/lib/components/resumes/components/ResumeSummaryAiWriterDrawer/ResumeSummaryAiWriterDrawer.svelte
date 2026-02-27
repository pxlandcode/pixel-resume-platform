<script lang="ts">
	import { Button, FormControl } from '@pixelcode_/blocks/components';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	import Drawer from '$lib/components/drawer/drawer.svelte';
	import { QuillEditor } from '$lib/components';
	import { confirm } from '$lib/utils/confirm';
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
	const debugLoggingEnabled = import.meta.env.DEV;

	const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
	const normalizeDescription = (value: string) => normalize(value.replace(/<[^>]*>/g, ' '));
	const oppositeLanguage = (value: Language): Language => (value === 'sv' ? 'en' : 'sv');
	const languageName = (value: Language): string => (value === 'sv' ? 'Swedish' : 'English');

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
		draftByLanguage = {
			sv: sourceByLanguage.sv,
			en: sourceByLanguage.en
		};
		descriptionRevisionByLanguage = { sv: 0, en: 0 };
		hasGeneratedOnce = false;
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
			hasGeneratedOnce = true;
			setDraftFromAi(targetLanguage, generated.descriptionHtml);
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
			hasGeneratedOnce = true;
			setDraftFromAi(targetLanguage, generated.descriptionHtml);
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
			hasGeneratedOnce = true;
			if (debugLoggingEnabled) {
				console.info('[resume-ai] summary:from-resume', {
					targetLanguage,
					descriptionLength: generated.descriptionHtml?.length ?? 0
				});
			}
			setDraftFromAi(targetLanguage, generated.descriptionHtml);
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
							? 'rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold text-white'
							: 'rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600'}
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
							? 'rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold text-white'
							: 'rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600'}
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
					class="rounded-xs w-full resize-y border border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none focus:border-indigo-400"
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

			{#if showSummaryPanel}
				<div class="space-y-1">
					<label class="text-xs font-medium text-slate-700"
						>Summary ({activeLanguage.toUpperCase()})</label
					>
					<div class="rounded-xs border border-slate-300 bg-white">
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

		<div class="flex justify-end gap-2 border-t border-slate-200 pt-4">
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
