<script lang="ts">
	import { TechStackSelector } from '$lib/components';
	import { ResumeExampleSkillsAiWriterDrawer } from '../ResumeExampleSkillsAiWriterDrawer';
	import type { ResumeAiGenerateParams, ResumeAiGenerateResult } from '../utils';
	import type { Language } from '../utils';

	let {
		skills = $bindable(),
		isEditing = false,
		language = 'sv',
		resumeContextSv = '',
		resumeContextEn = '',
		onGenerateDescription
	}: {
		skills: string[];
		isEditing?: boolean;
		language?: Language;
		resumeContextSv?: string;
		resumeContextEn?: string;
		onGenerateDescription?: (params: ResumeAiGenerateParams) => Promise<ResumeAiGenerateResult>;
	} = $props();
</script>

{#if isEditing}
	<div class="rounded-xs border border-slate-200 bg-slate-50 p-4">
		<div class="mb-3 flex items-center justify-between gap-2">
			<p class="text-xs font-semibold tracking-wide text-slate-700 uppercase">Examples of skills</p>
			{#if onGenerateDescription}
				<ResumeExampleSkillsAiWriterDrawer
					rowTitle="Examples of skills"
					{language}
					{resumeContextSv}
					{resumeContextEn}
					{onGenerateDescription}
					{skills}
					onAccept={(payload) => {
						skills = payload.skills;
					}}
				/>
			{/if}
		</div>
		<TechStackSelector bind:value={skills} onchange={(s) => (skills = s ?? [])} />
	</div>
{:else if skills.length > 0}
	<div class="flex-shrink-0 rounded-xs p-4">
		<p class="mb-3 text-xs font-semibold tracking-wide text-slate-700 uppercase">
			{language === 'sv' ? 'Exempel på färdigheter' : 'Examples of skills'}
		</p>
		<div class="flex flex-wrap gap-1">
			{#each skills as skill}
				<span class="rounded-xs bg-slate-200 px-2 py-0.5 text-xs text-slate-700">{skill}</span>
			{/each}
		</div>
	</div>
{/if}
