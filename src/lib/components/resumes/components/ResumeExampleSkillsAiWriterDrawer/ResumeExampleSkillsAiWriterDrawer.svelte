<script lang="ts">
	import { Button, FormControl } from '@pixelcode_/blocks/components';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	import { TechStackSelector } from '$lib/components';
	import Drawer from '$lib/components/drawer/drawer.svelte';
	import { confirm } from '$lib/utils/confirm';
	import type { Language, ResumeAiGenerateParams, ResumeAiGenerateResult } from '../utils';

	type AcceptPayload = {
		generated: ResumeAiGenerateResult;
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
		onAccept
	}: {
		rowTitle?: string;
		language?: Language;
		skills?: string[];
		resumeContextSv?: string;
		resumeContextEn?: string;
		onGenerateDescription?: (params: ResumeAiGenerateParams) => Promise<ResumeAiGenerateResult>;
		onAccept?: (payload: AcceptPayload) => void;
	} = $props();

	let open = $state(false);
	let activeLanguage = $state<Language>(language === 'sv' ? 'sv' : 'en');
	let prompt = $state('');
	let errorMessage = $state('');
	let generatingFromPrompt = $state(false);
	let creatingFromResume = $state(false);
	let draftSkills = $state<string[]>(Array.isArray(skills) ? [...skills] : []);
	let closeConfirmTrigger = $state<HTMLButtonElement | null>(null);

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

	const sourceSkills = $derived<string[]>(Array.isArray(skills) ? [...skills] : []);
	const hasUnappliedChanges = $derived(
		normalize(prompt).length > 0 ||
			normalizeSkillArray(draftSkills) !== normalizeSkillArray(sourceSkills)
	);
	const isBusy = $derived(generatingFromPrompt || creatingFromResume);

	const syncDraftFromSource = () => {
		draftSkills = Array.isArray(skills) ? [...skills] : [];
	};

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
			applyGeneratedSkills(generated);
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
	<div class="relative flex min-h-0 flex-1 flex-col gap-4">
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
		/>

		<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
			<div class="flex items-center justify-between gap-3">
				<div class="flex items-center gap-2">
					<button
						type="button"
						class={activeLanguage === 'sv'
							? 'rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white'
							: 'rounded-full bg-muted px-3 py-1 text-xs font-semibold text-secondary-text'}
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
							? 'rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white'
							: 'rounded-full bg-muted px-3 py-1 text-xs font-semibold text-secondary-text'}
						disabled={isBusy}
						onclick={() => {
							activeLanguage = 'en';
							errorMessage = '';
						}}
					>
						EN
					</button>
				</div>
				<p class="text-xs text-secondary-text">AI uses resume experiences + skill profile as evidence</p>
			</div>

			<FormControl label="Prompt / relevance context">
				<textarea
					bind:value={prompt}
					rows="5"
					placeholder="Optional job focus, e.g. '.NET backend role with Angular frontend and Azure'"
					class="rounded-xs w-full resize-y border border-border bg-card p-3 text-sm text-foreground outline-none focus:border-primary"
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

			<div class="rounded-xs border border-border bg-muted p-4">
				<div class="mb-2 flex items-center justify-between gap-2">
					<p class="text-xs font-semibold uppercase tracking-wide text-secondary-text">
						Draft skills ({draftSkills.length})
					</p>
					<p class="text-xs text-secondary-text">Adjust before applying</p>
				</div>
				<TechStackSelector
					bind:value={draftSkills}
					onchange={(next) => (draftSkills = next ?? [])}
				/>
			</div>
		</div>

		<div class="flex justify-end gap-2 border-t border-border pt-4">
			<Button type="button" variant="ghost" onclick={closeDrawer}>Close</Button>
			<Button type="button" variant="primary" disabled={isBusy} onclick={accept}>
				Apply skills
			</Button>
		</div>
	</div>
</Drawer>
