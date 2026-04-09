<script lang="ts">
	import type { LabeledItem } from '$lib/types/resume';
	import { Button, Input } from '@pixelcode_/blocks/components';
	import { t, getLocalizedValue, setLocalizedValue, type Language } from '../utils';

	let {
		languages = $bindable(),
		education = $bindable(),
		portfolio = $bindable([]),
		isEditing = false,
		language = 'sv',
		onAddLanguage,
		onRemoveLanguage,
		onAddEducation,
		onRemoveEducation,
		onAddPortfolioUrl,
		onRemovePortfolioUrl
	}: {
		languages: LabeledItem[];
		education: LabeledItem[];
		portfolio?: string[];
		isEditing?: boolean;
		language?: Language;
		onAddLanguage?: () => void;
		onRemoveLanguage?: (index: number) => void;
		onAddEducation?: () => void;
		onRemoveEducation?: (index: number) => void;
		onAddPortfolioUrl?: () => void;
		onRemovePortfolioUrl?: (index: number) => void;
	} = $props();
</script>

{#if isEditing || languages.length > 0 || education.length > 0 || (portfolio && portfolio.length > 0)}
	<section class="resume-print-section mt-8">
		<!-- Section Header with dividers -->
		<div class="grid gap-6 md:grid-cols-[18%_1fr]">
			<h2 class="text-base font-bold text-foreground uppercase">
				{language === 'sv' ? 'Övrigt' : 'Other'}
			</h2>
			<div class="flex items-center">
				<div class="h-px flex-1 bg-border"></div>
			</div>
		</div>

		<div class="mt-4 space-y-4">
			{#if isEditing}
				<!-- Languages Editor -->
				<div class="rounded-xs border border-border bg-muted p-4">
					<p class="mb-2 text-sm font-semibold text-secondary-text">
						{language === 'sv' ? 'Språk' : 'Languages'}
					</p>
					<div class="space-y-3">
						{#each languages as lang, index}
							<div class="rounded-xs border border-border bg-card p-3">
								<div class="mb-2 flex justify-end">
									<Button variant="ghost" size="sm" onclick={() => onRemoveLanguage?.(index)}
										>Remove</Button
									>
								</div>
								<div class="grid grid-cols-2 gap-4">
									<div class="space-y-2">
										<Input
											value={getLocalizedValue(lang.label, 'sv')}
											oninput={(e) =>
												(lang.label = setLocalizedValue(lang.label, 'sv', e.currentTarget.value))}
											placeholder="Language (SV)"
											class="border-border bg-card"
										/>
										<Input
											value={getLocalizedValue(lang.label, 'en')}
											oninput={(e) =>
												(lang.label = setLocalizedValue(lang.label, 'en', e.currentTarget.value))}
											placeholder="Language (EN)"
											class="border-border bg-card"
										/>
									</div>
									<div class="space-y-2">
										<Input
											value={getLocalizedValue(lang.value, 'sv')}
											oninput={(e) =>
												(lang.value = setLocalizedValue(lang.value, 'sv', e.currentTarget.value))}
											placeholder="Proficiency (SV)"
											class="border-border bg-card"
										/>
										<Input
											value={getLocalizedValue(lang.value, 'en')}
											oninput={(e) =>
												(lang.value = setLocalizedValue(lang.value, 'en', e.currentTarget.value))}
											placeholder="Proficiency (EN)"
											class="border-border bg-card"
										/>
									</div>
								</div>
							</div>
						{/each}
						<Button variant="outline" size="sm" onclick={onAddLanguage}>+ Add Language</Button>
					</div>
				</div>

				<!-- Education Editor -->
				<div class="rounded-xs border border-border bg-muted p-4">
					<p class="mb-2 text-sm font-semibold text-secondary-text">
						{language === 'sv' ? 'Utbildning' : 'Education'}
					</p>
					<div class="space-y-3">
						{#each education as edu, index}
							<div class="rounded-xs border border-border bg-card p-3">
								<div class="mb-2 flex justify-end">
									<Button variant="ghost" size="sm" onclick={() => onRemoveEducation?.(index)}
										>Remove</Button
									>
								</div>
								<div class="grid grid-cols-2 gap-4">
									<Input
										value={typeof edu.label === 'string' ? edu.label : edu.label.sv}
										oninput={(e) => (edu.label = e.currentTarget.value)}
										placeholder="Institution"
										class="border-border bg-card"
									/>
									<div class="space-y-2">
										<Input
											value={getLocalizedValue(edu.value, 'sv')}
											oninput={(e) =>
												(edu.value = setLocalizedValue(edu.value, 'sv', e.currentTarget.value))}
											placeholder="Program (SV)"
											class="border-border bg-card"
										/>
										<Input
											value={getLocalizedValue(edu.value, 'en')}
											oninput={(e) =>
												(edu.value = setLocalizedValue(edu.value, 'en', e.currentTarget.value))}
											placeholder="Program (EN)"
											class="border-border bg-card"
										/>
									</div>
								</div>
							</div>
						{/each}
						<Button variant="outline" size="sm" onclick={onAddEducation}>+ Add Education</Button>
					</div>
				</div>

				<!-- Portfolio Editor -->
				<div class="rounded-xs border border-border bg-muted p-4">
					<p class="mb-2 text-sm font-semibold text-secondary-text">Portfolio</p>
					<div class="space-y-2">
						{#each portfolio ?? [] as url, index}
							<div class="flex gap-2">
								<Input
									value={url}
									oninput={(e) => {
										portfolio[index] = e.currentTarget.value;
									}}
									placeholder="https://..."
									class="flex-1 border-border bg-card"
								/>
								<Button variant="ghost" size="sm" onclick={() => onRemovePortfolioUrl?.(index)}
									>Remove</Button
								>
							</div>
						{/each}
						<Button variant="outline" size="sm" onclick={onAddPortfolioUrl}>+ Add URL</Button>
					</div>
				</div>
			{:else}
				{#if languages.length > 0}
					<!-- Languages Row -->
					<div class="grid gap-6 md:grid-cols-[18%_1fr]">
						<p class="pt-1 text-xs font-bold tracking-wide text-secondary-text uppercase">
							{language === 'sv' ? 'Språk' : 'Languages'}
						</p>
						<div class="flex flex-col gap-1 text-sm text-foreground">
							{#each languages as lang}
								<p>
									<span class="font-bold">{t(lang.label, language)}</span>: {t(
										lang.value,
										language
									)}
								</p>
							{/each}
						</div>
					</div>
				{/if}

				{#if education.length > 0}
					<!-- Education Row -->
					<div class="grid gap-6 md:grid-cols-[18%_1fr]">
						<p class="pt-1 text-xs font-bold tracking-wide text-secondary-text uppercase">
							{language === 'sv' ? 'Utbildning' : 'Education'}
						</p>
						<div class="flex flex-col gap-1 text-sm text-foreground">
							{#each education as edu}
								<p>
									<span class="font-semibold">{t(edu.label, language)}</span>
									{#if t(edu.value, language)}<span>: {t(edu.value, language)}</span>{/if}
								</p>
							{/each}
						</div>
					</div>
				{/if}

				{#if portfolio && portfolio.length > 0}
					<!-- Portfolio Row -->
					<div class="grid gap-6 md:grid-cols-[18%_1fr]">
						<p class="pt-1 text-xs font-bold tracking-wide text-secondary-text uppercase">Portfolio</p>
						<div class="flex flex-wrap gap-2 text-sm text-foreground">
							{#each portfolio as url}
								<a
									href={url}
									target="_blank"
									rel="noopener noreferrer"
									class="underline decoration-slate-400 underline-offset-2 hover:decoration-slate-700"
									>{url}</a
								>
							{/each}
						</div>
					</div>
				{/if}
			{/if}
		</div>
	</section>
{/if}
