<script lang="ts">
	import type { LocalizedText } from '$lib/types/resume';
	import { QuillEditor } from '$lib/components';
	import { ResumeSummaryAiWriterDrawer } from '../ResumeSummaryAiWriterDrawer';
	import {
		t,
		getLocalizedValue,
		setLocalizedValue,
		type Language,
		type ResumeAiGenerateParams,
		type ResumeAiGenerateResult
	} from '../utils';

	let {
		summary = $bindable(),
		isEditing = false,
		language = 'sv',
		resumeContextSv = '',
		resumeContextEn = '',
		onGenerateDescription
	}: {
		summary: LocalizedText;
		isEditing?: boolean;
		language?: Language;
		resumeContextSv?: string;
		resumeContextEn?: string;
		onGenerateDescription?: (params: ResumeAiGenerateParams) => Promise<ResumeAiGenerateResult>;
	} = $props();

	let summaryRevisionByLanguage = $state({ sv: 0, en: 0 });

	const bumpSummaryRevision = (lang: Language) => {
		summaryRevisionByLanguage = {
			...summaryRevisionByLanguage,
			[lang]: summaryRevisionByLanguage[lang] + 1
		};
	};
</script>

{#if isEditing}
	<div class="space-y-3">
		<div class="flex items-center justify-between">
			<p class="text-sm font-semibold text-slate-700">Summary</p>
			{#if onGenerateDescription}
				<ResumeSummaryAiWriterDrawer
					rowTitle="Summary"
					summarySv={getLocalizedValue(summary, 'sv')}
					summaryEn={getLocalizedValue(summary, 'en')}
					{resumeContextSv}
					{resumeContextEn}
					{onGenerateDescription}
					onAccept={(payload) => {
						let nextSummary = setLocalizedValue(summary, 'sv', payload.summaryByLanguage.sv);
						nextSummary = setLocalizedValue(nextSummary, 'en', payload.summaryByLanguage.en);
						summary = nextSummary;
						bumpSummaryRevision('sv');
						bumpSummaryRevision('en');
					}}
				/>
			{/if}
		</div>
		<div class="rounded-xs border border-slate-200 bg-white p-2">
			<p class="mb-1 text-sm font-medium text-slate-700">Summary (SV)</p>
			{#key `sv-${summaryRevisionByLanguage.sv}`}
				<QuillEditor
					content={getLocalizedValue(summary, 'sv')}
					placeholder="Summary (SV)"
					onchange={(html) => (summary = setLocalizedValue(summary, 'sv', html))}
				/>
			{/key}
		</div>
		<div class="rounded-xs border border-slate-200 bg-white p-2">
			<p class="mb-1 text-sm font-medium text-slate-700">Summary (EN)</p>
			{#key `en-${summaryRevisionByLanguage.en}`}
				<QuillEditor
					content={getLocalizedValue(summary, 'en')}
					placeholder="Summary (EN)"
					onchange={(html) => (summary = setLocalizedValue(summary, 'en', html))}
				/>
			{/key}
		</div>
	</div>
{:else}
	<div class="text-sm leading-relaxed text-slate-700">
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html t(summary, language)}
	</div>
{/if}
