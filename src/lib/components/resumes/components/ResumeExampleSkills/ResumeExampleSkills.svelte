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
		onGenerateDescription,
		organisationId = null
	}: {
		skills: string[];
		isEditing?: boolean;
		language?: Language;
		resumeContextSv?: string;
		resumeContextEn?: string;
		onGenerateDescription?: (params: ResumeAiGenerateParams) => Promise<ResumeAiGenerateResult>;
		organisationId?: string | null;
	} = $props();
</script>

{#if isEditing}
	<div class="rounded-xs border-border bg-muted border p-4">
		<div class="mb-3 flex items-center justify-between gap-2">
			<p class="text-secondary-text text-xs font-semibold uppercase tracking-wide">
				Examples of skills
			</p>
			{#if onGenerateDescription}
				<ResumeExampleSkillsAiWriterDrawer
					rowTitle="Examples of skills"
					{language}
					{resumeContextSv}
					{resumeContextEn}
					{onGenerateDescription}
					{skills}
					{organisationId}
					onAccept={(payload) => {
						skills = payload.skills;
					}}
				/>
			{/if}
		</div>
		<TechStackSelector bind:value={skills} {organisationId} onchange={(s) => (skills = s ?? [])} />
	</div>
{:else if skills.length > 0}
	<div class="rounded-xs flex-shrink-0 p-4">
		<p class="text-secondary-text mb-3 text-xs font-semibold uppercase tracking-wide">
			{language === 'sv' ? 'Exempel på färdigheter' : 'Examples of skills'}
		</p>
		<div class="flex flex-wrap gap-1">
			{#each skills as skill}
				<span class="rounded-xs bg-muted text-secondary-text px-2 py-0.5 text-xs">{skill}</span>
			{/each}
		</div>
	</div>
{/if}
