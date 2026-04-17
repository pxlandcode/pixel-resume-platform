<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { Button, FormControl } from '@pixelcode_/blocks/components';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	import { TechStackSelector } from '$lib/components';
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
	import type { Language, ResumeAiGenerateParams, ResumeAiGenerateResult } from '../utils';

	type AcceptPayload = {
		generated: ResumeAiGenerateResult;
		skills: string[];
	};

	type SkillsSnapshot = {
		skills: string[];
	};

	const DEFAULT_FILL_PROMPT =
		'Fill out the "Examples of skills" list based on the resume context. Prioritize skills that are strongly evidenced in highlighted experiences and recent previous experiences. Also include relevant items from the profile skill categories/tech stack lower in the resume. Return a concise, job-relevant list of concrete technologies, frameworks, platforms, databases, tools, and methods.';

	let {
		rowTitle = 'Examples of skills',
		language = 'en',
		skills = [],
		resumeContextSv = '',
		resumeContextEn = '',
		onGenerateDescription,
		onAccept,
		organisationId = null
	}: {
		rowTitle?: string;
		language?: Language;
		skills?: string[];
		resumeContextSv?: string;
		resumeContextEn?: string;
		onGenerateDescription?: (params: ResumeAiGenerateParams) => Promise<ResumeAiGenerateResult>;
		onAccept?: (payload: AcceptPayload) => void;
		organisationId?: string | null;
	} = $props();

	let open = $state(false);
	let activeLanguage = $state<Language>(language === 'sv' ? 'sv' : 'en');
	let prompt = $state('');
	let errorMessage = $state('');
	let generatingFromPrompt = $state(false);
	let creatingFromResume = $state(false);
	let draftSkills = $state<string[]>(Array.isArray(skills) ? [...skills] : []);
	let revisionRenderNonce = $state(0);
	let closeConfirmTrigger = $state<HTMLButtonElement | null>(null);
	let revisionState = $state<ResumeAiRevisionState<SkillsSnapshot> | null>(null);
	let applyingRevisionSnapshot = false;
	let manualRevisionTimer: ReturnType<typeof setTimeout> | null = null;

	const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
	const normalizeSkillArray = (items: string[]) =>
		items
			.map((item) => normalize(item))
			.filter(Boolean)
			.join('|');
	const dedupeSkills = (items: string[]) => {
		const seen = new Set<string>();
		const next: string[] = [];
		for (const item of items) {
			const cleaned = normalize(item);
			if (!cleaned) continue;
			const key = cleaned.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			next.push(cleaned);
			if (next.length >= 24) break;
		}
		return next;
	};
	const currentResumeContext = (targetLanguage: Language) =>
		targetLanguage === 'sv'
			? resumeContextSv || resumeContextEn
			: resumeContextEn || resumeContextSv;
	const createSourceSnapshot = (): SkillsSnapshot => ({
		skills: Array.isArray(skills) ? [...skills] : []
	});
	const createDraftSnapshot = (): SkillsSnapshot => ({
		skills: [...draftSkills]
	});
	const applyDraftSnapshot = (snapshot: SkillsSnapshot) => {
		draftSkills = [...snapshot.skills];
	};
	const serializeDraftSnapshot = (snapshot: SkillsSnapshot): string =>
		normalizeSkillArray(snapshot.skills);
	const resetRevisionState = (snapshot: SkillsSnapshot = createDraftSnapshot()) => {
		revisionState = createResumeAiRevisionState(snapshot);
	};
	const clearManualRevisionTimer = () => {
		if (manualRevisionTimer === null) return;
		clearTimeout(manualRevisionTimer);
		manualRevisionTimer = null;
	};
	const commitHumanRevision = (snapshot: SkillsSnapshot = createDraftSnapshot()) => {
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
	const commitRevision = (beforeSnapshot: SkillsSnapshot) => {
		clearManualRevisionTimer();
		const afterSnapshot = createDraftSnapshot();
		if (serializeDraftSnapshot(beforeSnapshot) === serializeDraftSnapshot(afterSnapshot)) {
			errorMessage = 'AI did not change the draft skills.';
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

	const sourceSkills = $derived<string[]>(Array.isArray(skills) ? [...skills] : []);
	const hasUnappliedChanges = $derived(
		normalize(prompt).length > 0 ||
			normalizeSkillArray(draftSkills) !== normalizeSkillArray(sourceSkills)
	);
	const isBusy = $derived(generatingFromPrompt || creatingFromResume);
	const revisionDiffFields = $derived.by<ResumeAiDiffField[]>(() => {
		if (!revisionState || revisionState.index === 0) return [];
		const currentSnapshot = revisionState.entries[revisionState.index]?.snapshot;
		const previousSnapshot = revisionState.entries[revisionState.index - 1]?.snapshot;
		if (!currentSnapshot || !previousSnapshot) return [];
		return [
			{
				key: 'skills',
				label: 'Example skills',
				mode: 'list',
				before: previousSnapshot.skills,
				after: currentSnapshot.skills
			}
		];
	});

	const syncDraftFromSource = () => {
		clearManualRevisionTimer();
		const sourceSnapshot = createSourceSnapshot();
		applyDraftSnapshot(sourceSnapshot);
		resetRevisionState(sourceSnapshot);
	};

	onDestroy(() => {
		clearManualRevisionTimer();
	});

	const openDrawer = () => {
		activeLanguage = language === 'sv' ? 'sv' : 'en';
		prompt = '';
		errorMessage = '';
		generatingFromPrompt = false;
		creatingFromResume = false;
		syncDraftFromSource();
		open = true;
	};

	const discardAndClose = () => {
		prompt = '';
		errorMessage = '';
		generatingFromPrompt = false;
		creatingFromResume = false;
		syncDraftFromSource();
		open = false;
	};

	const requestClose = () => {
		if (isBusy) return false;
		if (!hasUnappliedChanges) return true;
		closeConfirmTrigger?.click();
		return false;
	};

	const closeDrawer = () => {
		if (requestClose()) {
			open = false;
		}
	};

	const applyGeneratedSkills = (generated: ResumeAiGenerateResult) => {
		const nextSkills = dedupeSkills(generated.skills ?? generated.technologies ?? []);
		if (nextSkills.length === 0) {
			throw new Error('AI did not return any skills.');
		}
		draftSkills = nextSkills;
	};

	const requestSkills = async (mode: 'prompt' | 'resume') => {
		if (!onGenerateDescription) return;
		if (isBusy) return;

		const resumeContext = currentResumeContext(activeLanguage);
		if (!normalize(resumeContext)) {
			errorMessage = 'No resume context is available yet.';
			return;
		}

		const userPrompt = prompt.trim();
		if (mode === 'prompt' && !userPrompt) {
			errorMessage = 'Write a prompt first.';
			return;
		}

		const requestPrompt =
			mode === 'resume'
				? userPrompt
					? `${DEFAULT_FILL_PROMPT}\n\nRelevance context from user:\n${userPrompt}`
					: DEFAULT_FILL_PROMPT
				: userPrompt;

		errorMessage = '';
		if (mode === 'resume') {
			creatingFromResume = true;
		} else {
			generatingFromPrompt = true;
		}

		try {
			const generated = await onGenerateDescription({
				prompt: requestPrompt,
				language: activeLanguage,
				sectionType: 'exampleSkills',
				technologies: draftSkills,
				currentText: draftSkills.join(', '),
				resumeContext
			});
			const beforeSnapshot = createDraftSnapshot();
			applyGeneratedSkills(generated);
			commitRevision(beforeSnapshot);
		} catch (error) {
			const fallback =
				mode === 'resume'
					? 'Could not fill skills from the resume right now.'
					: 'Could not generate skills right now.';
			errorMessage = error instanceof Error && error.message ? error.message : fallback;
		} finally {
			if (mode === 'resume') {
				creatingFromResume = false;
			} else {
				generatingFromPrompt = false;
			}
		}
	};

	const accept = () => {
		const nextSkills = dedupeSkills(draftSkills);
		onAccept?.({
			generated: {
				descriptionHtml: '',
				skills: nextSkills
			},
			skills: nextSkills
		});
		prompt = '';
		errorMessage = '';
		open = false;
	};

	$effect(() => {
		if (!open) {
			activeLanguage = language === 'sv' ? 'sv' : 'en';
			syncDraftFromSource();
		}
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
	title="Open AI skills picker"
	aria-label="Open AI skills picker"
	onclick={openDrawer}
>
	<Sparkles size={16} />
</Button>

<Drawer
	bind:open
	variant="bottom"
	title={rowTitle}
	subtitle="AI skills picker"
	beforeClose={requestClose}
>
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
				title: 'Close AI skills picker?',
				description: 'Unsaved AI changes will be discarded.',
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

		<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
			<div class="flex items-center justify-between gap-3">
				<div class="flex items-center gap-2">
					<button
						type="button"
						class={activeLanguage === 'sv'
							? 'bg-primary rounded-full px-3 py-1 text-xs font-semibold text-white'
							: 'bg-muted text-secondary-text rounded-full px-3 py-1 text-xs font-semibold'}
						disabled={isBusy}
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
						disabled={isBusy}
						onclick={() => {
							activeLanguage = 'en';
							errorMessage = '';
						}}
					>
						EN
					</button>
				</div>
				<p class="text-secondary-text text-xs">
					AI uses resume experiences + skill profile as evidence
				</p>
			</div>

			<FormControl label="Prompt / relevance context">
				<textarea
					bind:value={prompt}
					rows="5"
					placeholder="Optional job focus, e.g. '.NET backend role with Angular frontend and Azure'"
					class="rounded-xs border-border bg-card text-foreground focus:border-primary w-full resize-y border p-3 text-sm outline-none"
				></textarea>
			</FormControl>

			<div class="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="outline"
					disabled={isBusy}
					loading={creatingFromResume}
					loading-text="Picking…"
					onclick={() => requestSkills('resume')}
				>
					<Sparkles size={14} />
					Fill out from Resume
				</Button>
				<Button
					type="button"
					variant="outline"
					disabled={isBusy}
					loading={generatingFromPrompt}
					loading-text="Generating…"
					onclick={() => requestSkills('prompt')}
				>
					Generate from Prompt
				</Button>
				<Button
					type="button"
					variant="ghost"
					disabled={isBusy}
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

			<div class="rounded-xs border-border bg-muted border p-4">
				<div class="mb-2 flex items-center justify-between gap-2">
					<p class="text-secondary-text text-xs font-semibold uppercase tracking-wide">
						Draft skills ({draftSkills.length})
					</p>
					<p class="text-secondary-text text-xs">Adjust before applying</p>
				</div>
				{#key revisionRenderNonce}
					<TechStackSelector
						bind:value={draftSkills}
						{organisationId}
						onchange={(next) => (draftSkills = next ?? [])}
					/>
				{/key}
			</div>
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
				<Button type="button" variant="primary" disabled={isBusy} onclick={accept}>
					Apply skills
				</Button>
			</div>
		</div>
	</div>
</Drawer>
