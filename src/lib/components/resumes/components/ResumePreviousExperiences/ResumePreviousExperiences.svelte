<script lang="ts">
	import type { ExperienceItem } from '$lib/types/resume';
	import { Button, Input, FormControl } from '@pixelcode_/blocks/components';
	import { QuillEditor, TechStackSelector } from '$lib/components';
	import { ResumeAiWriterDrawer } from '../ResumeAiWriterDrawer';
	import {
		t,
		getLocalizedValue,
		setLocalizedValue,
		formatDate,
		type Language,
		type ResumeAiGenerateParams,
		type ResumeAiGenerateResult
	} from '../utils';

	let {
		experiences = $bindable(),
		isEditing = false,
		language = 'sv',
		onAdd,
		onRemove,
		onMove,
		onReorder,
		onGenerateDescription
	}: {
		experiences: ExperienceItem[];
		isEditing?: boolean;
		language?: Language;
		onAdd?: () => void;
		onRemove?: (index: number) => void;
		onMove?: (index: number, direction: 'up' | 'down') => void;
		onReorder?: (fromIndex: number, toIndex: number) => void;
		onGenerateDescription?: (params: ResumeAiGenerateParams) => Promise<ResumeAiGenerateResult>;
	} = $props();
	const debugLoggingEnabled = import.meta.env.DEV;

	// Collapse state - track which items are expanded
	let expandedIds = $state<Set<string>>(new Set());
	let allCollapsed = $state(true);
	let aiDescriptionRevisionByRow = $state<Record<string, number>>({});

	const getRowId = (exp: ExperienceItem, index: number) => exp._id ?? `row-${index}`;
	const getDescriptionRevision = (rowId: string) => aiDescriptionRevisionByRow[rowId] ?? 0;
	const bumpDescriptionRevision = (rowId: string) => {
		aiDescriptionRevisionByRow = {
			...aiDescriptionRevisionByRow,
			[rowId]: (aiDescriptionRevisionByRow[rowId] ?? 0) + 1
		};
	};

	const toggleExpanded = (id: string) => {
		if (expandedIds.has(id)) {
			expandedIds.delete(id);
		} else {
			expandedIds.add(id);
		}
		expandedIds = new Set(expandedIds); // Trigger reactivity
	};

	const toggleAll = () => {
		if (allCollapsed) {
			// Expand all
			expandedIds = new Set(experiences.map((exp) => exp._id ?? ''));
			allCollapsed = false;
		} else {
			// Collapse all
			expandedIds = new Set();
			allCollapsed = true;
		}
	};

	const isExpanded = (id: string | undefined) => (id ? expandedIds.has(id) : false);

	// Drag and drop state
	let draggedIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);

	const handleDragStart = (index: number) => (e: DragEvent) => {
		draggedIndex = index;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', index.toString());
		}
	};

	const handleDragOver = (index: number) => (e: DragEvent) => {
		e.preventDefault();
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = 'move';
		}
		dragOverIndex = index;
	};

	const handleDragLeave = () => {
		dragOverIndex = null;
	};

	const handleDrop = (toIndex: number) => (e: DragEvent) => {
		e.preventDefault();
		if (draggedIndex !== null && draggedIndex !== toIndex) {
			onReorder?.(draggedIndex, toIndex);
		}
		draggedIndex = null;
		dragOverIndex = null;
	};

	const handleDragEnd = () => {
		draggedIndex = null;
		dragOverIndex = null;
	};
</script>

{#if isEditing || experiences.length > 0}
	<section class="resume-print-section mt-8">
		<!-- Section Header with dividers -->
		<div class="grid gap-6 md:grid-cols-[18%_1fr]">
			<h2 class="text-base font-bold text-slate-900 uppercase">
				{language === 'sv' ? 'Tidigare Erfarenheter' : 'Previous Experience'}
			</h2>
			<div class="flex items-center">
				<div class="h-px flex-1 bg-slate-300"></div>
			</div>
		</div>

		<div class="mt-4 space-y-3">
			{#if isEditing}
				<div class="flex gap-2">
					<Button
						variant="outline"
						class="flex-1 border-dashed border-slate-300 text-slate-700 hover:bg-slate-50"
						onclick={onAdd}
					>
						+ Add Experience
					</Button>
					<Button variant="ghost" size="sm" class="text-slate-600" onclick={toggleAll}>
						{allCollapsed ? 'Expand All' : 'Collapse All'}
					</Button>
				</div>
				{#each experiences as exp, index (exp._id ?? index)}
					{@const rowId = getRowId(exp, index)}
					<div
						class="rounded-xs border border-slate-200 bg-slate-50 transition-all {draggedIndex ===
						index
							? 'opacity-50'
							: ''} {dragOverIndex === index && draggedIndex !== index
							? 'border-2 border-primary'
							: ''}"
						ondragover={handleDragOver(index)}
						ondragleave={handleDragLeave}
						ondrop={handleDrop(index)}
					>
						<!-- Collapsed header - always visible -->
						<div
							class="flex items-center justify-between p-3 {isExpanded(exp._id)
								? 'border-b border-slate-200'
								: ''}"
						>
							<div class="flex min-w-0 flex-1 items-center gap-2">
								<!-- Drag handle -->
								<div
									class="flex-shrink-0 cursor-grab rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 active:cursor-grabbing"
									draggable="true"
									ondragstart={handleDragStart(index)}
									ondragend={handleDragEnd}
									role="button"
									tabindex="0"
									aria-label="Drag to reorder"
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<circle cx="9" cy="5" r="1" /><circle cx="9" cy="12" r="1" /><circle
											cx="9"
											cy="19"
											r="1"
										/>
										<circle cx="15" cy="5" r="1" /><circle cx="15" cy="12" r="1" /><circle
											cx="15"
											cy="19"
											r="1"
										/>
									</svg>
								</div>
								<!-- Expand/Collapse button -->
								<button
									class="flex-shrink-0 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
									onclick={() => toggleExpanded(exp._id ?? '')}
									aria-label={isExpanded(exp._id) ? 'Collapse' : 'Expand'}
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										width="16"
										height="16"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										class="transition-transform {isExpanded(exp._id) ? 'rotate-90' : ''}"
									>
										<polyline points="9 18 15 12 9 6"></polyline>
									</svg>
								</button>
								<!-- Company and dates -->
								<div class="min-w-0 flex-1">
									<span class="truncate font-semibold text-slate-700">
										{exp.company || `Experience ${index + 1}`}
									</span>
									<span class="ml-2 text-sm text-slate-500">
										{exp.startDate || '...'} - {exp.endDate || 'Present'}
									</span>
									{#if exp.hidden}
										<span class="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
											Hidden
										</span>
									{/if}
								</div>
							</div>
							<div class="flex flex-shrink-0 gap-1">
								{#if onGenerateDescription}
									<ResumeAiWriterDrawer
										rowTitle={exp.company || `Experience ${index + 1}`}
										sectionType="experience"
										{language}
										company={exp.company}
										roleSv={getLocalizedValue(exp.role, 'sv')}
										roleEn={getLocalizedValue(exp.role, 'en')}
										locationSv={getLocalizedValue(exp.location ?? '', 'sv')}
										locationEn={getLocalizedValue(exp.location ?? '', 'en')}
										startDate={exp.startDate}
										endDate={exp.endDate}
										technologies={exp.technologies}
										descriptionSv={getLocalizedValue(exp.description, 'sv')}
										descriptionEn={getLocalizedValue(exp.description, 'en')}
										{onGenerateDescription}
										onAccept={(payload) => {
											let nextDescription = setLocalizedValue(
												exp.description,
												'sv',
												payload.drafts.descriptionByLanguage.sv
											);
											nextDescription = setLocalizedValue(
												nextDescription,
												'en',
												payload.drafts.descriptionByLanguage.en
											);

											let nextRole = setLocalizedValue(
												exp.role,
												'sv',
												payload.drafts.roleByLanguage.sv
											);
											nextRole = setLocalizedValue(
												nextRole,
												'en',
												payload.drafts.roleByLanguage.en
											);

											let nextLocation = setLocalizedValue(
												exp.location ?? '',
												'sv',
												payload.drafts.locationByLanguage.sv
											);
											nextLocation = setLocalizedValue(
												nextLocation,
												'en',
												payload.drafts.locationByLanguage.en
											);

											const nextExp: ExperienceItem = {
												...exp,
												description: nextDescription,
												role: nextRole,
												location: nextLocation,
												company: payload.drafts.company,
												startDate: payload.drafts.startDate,
												endDate: payload.drafts.endDate,
												technologies: [...payload.drafts.technologies]
											};

											experiences = experiences.map((item, itemIndex) =>
												itemIndex === index ? nextExp : item
											);
											bumpDescriptionRevision(rowId);
											if (debugLoggingEnabled) {
												console.info('[resume-ai] apply:experience-row', {
													rowId,
													language: payload.language,
													svLength: payload.drafts.descriptionByLanguage.sv?.length ?? 0,
													enLength: payload.drafts.descriptionByLanguage.en?.length ?? 0
												});
											}
										}}
									/>
								{/if}
								<Button
									variant={exp.hidden ? 'outline' : 'ghost'}
									size="sm"
									onclick={() => (exp.hidden = !exp.hidden)}
								>
									{exp.hidden ? 'Show' : 'Hide'}
								</Button>
								<Button
									variant="ghost"
									size="sm"
									disabled={index === 0}
									onclick={() => onMove?.(index, 'up')}>↑</Button
								>
								<Button
									variant="ghost"
									size="sm"
									disabled={index === experiences.length - 1}
									onclick={() => onMove?.(index, 'down')}>↓</Button
								>
								<Button
									variant="ghost"
									size="sm"
									class="text-red-600 hover:bg-red-50"
									onclick={() => onRemove?.(index)}>✕</Button
								>
							</div>
						</div>

						<!-- Expanded content -->
						{#if isExpanded(exp._id)}
							<div class="space-y-3 p-4">
								<div class="grid grid-cols-2 gap-4">
									<FormControl label="Start Date (YYYY-MM-DD)">
										<Input
											bind:value={exp.startDate}
											placeholder="YYYY-MM-DD"
											class="border-slate-300 bg-white text-slate-900"
										/>
									</FormControl>
									<FormControl label="End Date (empty = Present)">
										<Input
											bind:value={exp.endDate}
											placeholder="Leave empty for 'Present'"
											class="border-slate-300 bg-white text-slate-900"
										/>
									</FormControl>
								</div>
								<div class="grid grid-cols-2 gap-4">
									<FormControl label="Company">
										<Input
											bind:value={exp.company}
											placeholder="Company"
											class="border-slate-300 bg-white text-slate-900"
										/>
									</FormControl>
									<div class="space-y-2">
										<FormControl label="Location (SV)">
											<Input
												value={getLocalizedValue(exp.location ?? '', 'sv')}
												oninput={(e) =>
													(exp.location = setLocalizedValue(
														exp.location ?? '',
														'sv',
														e.currentTarget.value
													))}
												placeholder="Location (SV)"
												class="border-slate-300 bg-white text-slate-900"
											/>
										</FormControl>
										<FormControl label="Location (EN)">
											<Input
												value={getLocalizedValue(exp.location ?? '', 'en')}
												oninput={(e) =>
													(exp.location = setLocalizedValue(
														exp.location ?? '',
														'en',
														e.currentTarget.value
													))}
												placeholder="Location (EN)"
												class="border-slate-300 bg-white text-slate-900"
											/>
										</FormControl>
									</div>
								</div>
								<div class="grid grid-cols-2 gap-4">
									<FormControl label="Role (SV)">
										<Input
											value={getLocalizedValue(exp.role, 'sv')}
											oninput={(e) =>
												(exp.role = setLocalizedValue(exp.role, 'sv', e.currentTarget.value))}
											placeholder="Role (SV)"
											class="border-slate-300 bg-white text-slate-900"
										/>
									</FormControl>
									<FormControl label="Role (EN)">
										<Input
											value={getLocalizedValue(exp.role, 'en')}
											oninput={(e) =>
												(exp.role = setLocalizedValue(exp.role, 'en', e.currentTarget.value))}
											placeholder="Role (EN)"
											class="border-slate-300 bg-white text-slate-900"
										/>
									</FormControl>
								</div>
								<div>
									<p class="mb-1 text-sm font-medium text-slate-700">Description (SV)</p>
									<div class="rounded-xs border border-slate-300 bg-white">
										{#key `sv-${rowId}-${getDescriptionRevision(rowId)}`}
											<QuillEditor
												content={getLocalizedValue(exp.description, 'sv')}
												placeholder="Description (SV)"
												onchange={(html) =>
													(exp.description = setLocalizedValue(exp.description, 'sv', html))}
											/>
										{/key}
									</div>
								</div>
								<div>
									<p class="mb-1 text-sm font-medium text-slate-700">Description (EN)</p>
									<div class="rounded-xs border border-slate-300 bg-white">
										{#key `en-${rowId}-${getDescriptionRevision(rowId)}`}
											<QuillEditor
												content={getLocalizedValue(exp.description, 'en')}
												placeholder="Description (EN)"
												onchange={(html) =>
													(exp.description = setLocalizedValue(exp.description, 'en', html))}
											/>
										{/key}
									</div>
								</div>
								<div>
									<p class="mb-1 text-sm font-medium text-slate-700">Key Technologies</p>
									<TechStackSelector
										bind:value={exp.technologies}
										onchange={(techs) => (exp.technologies = techs ?? [])}
									/>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			{:else}
				{#each experiences.filter((exp) => !exp.hidden) as exp}
					<div class="grid gap-6 md:grid-cols-[18%_1fr]">
						<!-- Column 1: Period, Company, Location -->
						<div class="space-y-1">
							<p class="text-sm font-semibold text-slate-900">
								<span class="whitespace-nowrap">{formatDate(exp.startDate, language)}</span>
								<span> - </span>
								<span class="whitespace-nowrap">{formatDate(exp.endDate, language)}</span>
							</p>
							<p class="text-sm font-semibold text-slate-900">{exp.company}</p>
							{#if exp.location}
								<p class="text-sm text-slate-700">{t(exp.location, language)}</p>
							{/if}
						</div>

						<!-- Column 2: Role, Description, Technologies -->
						<div class="space-y-3">
							<h3 class="text-base font-bold break-words hyphens-auto text-slate-900" lang="en">
								{t(exp.role, language)}
							</h3>
							<div
								class="text-sm leading-relaxed break-words hyphens-auto text-slate-700"
								lang="en"
							>
								<!-- eslint-disable-next-line svelte/no-at-html-tags -->
								{@html t(exp.description, language)}
							</div>
							{#if exp.technologies.length > 0}
								<div class="flex flex-wrap gap-2">
									{#each exp.technologies as tech}
										<span class="rounded-xs bg-slate-100 px-3 py-1 text-xs text-slate-800"
											>{tech}</span
										>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</section>
{/if}
