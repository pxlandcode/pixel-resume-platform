<script lang="ts">
	import type { ExperienceItem, ExperienceLibraryItem } from '$lib/types/resume';
	import { Button, Input, FormControl } from '@pixelcode_/blocks/components';
	import { QuillEditor, TechStackSelector } from '$lib/components';
	import { ResumeAiWriterDrawer } from '../ResumeAiWriterDrawer';
	import { SvelteSet } from 'svelte/reactivity';
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
		libraryExperiences = [],
		onAdd,
		onAddFromLibrary,
		onRemove,
		onMove,
		onReorder,
		onGenerateDescription
	}: {
		experiences: ExperienceItem[];
		isEditing?: boolean;
		language?: Language;
		libraryExperiences?: ExperienceLibraryItem[];
		onAdd?: () => void;
		onAddFromLibrary?: (libraryId: string) => void;
		onRemove?: (index: number) => void;
		onMove?: (index: number, direction: 'up' | 'down') => void;
		onReorder?: (fromIndex: number, toIndex: number) => void;
		onGenerateDescription?: (params: ResumeAiGenerateParams) => Promise<ResumeAiGenerateResult>;
	} = $props();
	const debugLoggingEnabled = import.meta.env.DEV;

	// Collapse state - track which items are expanded
	let expandedIds = new SvelteSet<string>();
	let allCollapsed = $state(true);
	let aiDescriptionRevisionByRow = $state<Record<string, number>>({});
	let showLibraryPicker = $state(false);
	let librarySearch = $state('');

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
	};

	const toggleAll = () => {
		if (allCollapsed) {
			// Expand all
			expandedIds.clear();
			for (const exp of experiences) {
				const id = exp._id ?? '';
				if (id) expandedIds.add(id);
			}
			allCollapsed = false;
		} else {
			// Collapse all
			expandedIds.clear();
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

	const filteredLibraryExperiences = $derived.by(() => {
		const needle = librarySearch.trim().toLowerCase();
		if (!needle) return libraryExperiences;
		return libraryExperiences.filter((entry) => {
			const company = (entry.company ?? '').toLowerCase();
			const roleSv = getLocalizedValue(entry.role, 'sv').toLowerCase();
			const roleEn = getLocalizedValue(entry.role, 'en').toLowerCase();
			const techs = (entry.technologies ?? []).join(' ').toLowerCase();
			return (
				company.includes(needle) ||
				roleSv.includes(needle) ||
				roleEn.includes(needle) ||
				techs.includes(needle)
			);
		});
	});
</script>

{#if isEditing || experiences.length > 0}
	<section class="resume-print-section mt-8">
		<!-- Section Header with dividers -->
		<div class="grid gap-6 md:grid-cols-[18%_1fr]">
			<h2 class="text-base font-bold uppercase text-foreground">
				{language === 'sv' ? 'Tidigare Erfarenheter' : 'Previous Experience'}
			</h2>
			<div class="flex items-center">
				<div class="h-px flex-1 bg-border"></div>
			</div>
		</div>

		<div class="mt-4 space-y-3">
			{#if isEditing}
				<div class="flex gap-2">
					<Button
						variant="outline"
						class="flex-1 border-dashed border-border text-secondary-text hover:bg-muted"
						onclick={onAdd}
					>
						+ Add Experience
					</Button>
					<Button
						variant="outline"
						class="border-border text-secondary-text hover:bg-muted"
						onclick={() => (showLibraryPicker = !showLibraryPicker)}
					>
						Add from Library
					</Button>
					<Button variant="ghost" size="sm" class="text-secondary-text" onclick={toggleAll}>
						{allCollapsed ? 'Expand All' : 'Collapse All'}
					</Button>
				</div>
				{#if showLibraryPicker}
					<div class="rounded-xs border border-border bg-card p-3">
						<div class="mb-2 flex items-center justify-between gap-2">
							<p class="text-xs font-semibold uppercase tracking-wide text-secondary-text">
								Experience Library
							</p>
							<Button variant="ghost" size="sm" onclick={() => (showLibraryPicker = false)}>
								Close
							</Button>
						</div>
						<Input
							placeholder="Search company, role, or tech..."
							bind:value={librarySearch}
							class="mb-3"
						/>
						<div class="max-h-56 space-y-2 overflow-auto">
							{#if filteredLibraryExperiences.length === 0}
								<p class="text-sm text-secondary-text">No saved experiences found.</p>
							{:else}
								{#each filteredLibraryExperiences as entry (entry.id)}
									<div
										class="rounded-xs flex items-center justify-between border border-border px-3 py-2"
									>
										<div class="min-w-0">
											<p class="truncate text-sm font-semibold text-foreground">
												{entry.company || 'Untitled'}
											</p>
											<p class="truncate text-xs text-secondary-text">
												{getLocalizedValue(entry.role, language) ||
													getLocalizedValue(entry.role, 'en')}
											</p>
										</div>
										<Button
											size="sm"
											variant="outline"
											onclick={() => onAddFromLibrary?.(entry.id)}
										>
											Add
										</Button>
									</div>
								{/each}
							{/if}
						</div>
					</div>
				{/if}
				{#each experiences as exp, index (exp._id ?? index)}
					{@const rowId = getRowId(exp, index)}
					<div
						class="rounded-xs border border-border bg-muted transition-all {draggedIndex ===
						index
							? 'opacity-50'
							: ''} {dragOverIndex === index && draggedIndex !== index
							? 'border-primary border-2'
							: ''}"
						ondragover={handleDragOver(index)}
						ondragleave={handleDragLeave}
						ondrop={handleDrop(index)}
					>
						<!-- Collapsed header - always visible -->
						<div
							class="flex items-center justify-between p-3 {isExpanded(exp._id)
								? 'border-b border-border'
								: ''}"
						>
							<div class="flex min-w-0 flex-1 items-center gap-2">
								<!-- Drag handle -->
								<div
									class="flex-shrink-0 cursor-grab rounded p-1 text-secondary-text hover:bg-muted hover:text-foreground active:cursor-grabbing"
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
									class="flex-shrink-0 rounded p-1 text-secondary-text hover:bg-muted hover:text-foreground"
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
									<span class="truncate font-semibold text-secondary-text">
										{exp.company || `Experience ${index + 1}`}
									</span>
									<span class="ml-2 text-sm text-secondary-text">
										{exp.startDate || '...'} - {exp.endDate || 'Present'}
									</span>
									{#if exp.hidden}
										<span class="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-secondary-text">
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
											class="border-border bg-card text-foreground"
										/>
									</FormControl>
									<FormControl label="End Date (empty = Present)">
										<Input
											bind:value={exp.endDate}
											placeholder="Leave empty for 'Present'"
											class="border-border bg-card text-foreground"
										/>
									</FormControl>
								</div>
								<div class="grid grid-cols-2 gap-4">
									<FormControl label="Company">
										<Input
											bind:value={exp.company}
											placeholder="Company"
											class="border-border bg-card text-foreground"
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
												class="border-border bg-card text-foreground"
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
												class="border-border bg-card text-foreground"
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
											class="border-border bg-card text-foreground"
										/>
									</FormControl>
									<FormControl label="Role (EN)">
										<Input
											value={getLocalizedValue(exp.role, 'en')}
											oninput={(e) =>
												(exp.role = setLocalizedValue(exp.role, 'en', e.currentTarget.value))}
											placeholder="Role (EN)"
											class="border-border bg-card text-foreground"
										/>
									</FormControl>
								</div>
								<div>
									<p class="mb-1 text-sm font-medium text-secondary-text">Description (SV)</p>
									<div class="rounded-xs border border-border bg-card">
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
									<p class="mb-1 text-sm font-medium text-secondary-text">Description (EN)</p>
									<div class="rounded-xs border border-border bg-card">
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
									<p class="mb-1 text-sm font-medium text-secondary-text">Key Technologies</p>
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
				{#each experiences.filter((exp) => !exp.hidden) as exp, index (`view-experience-${exp._id ?? exp.libraryId ?? exp.company}-${index}`)}
					<div class="grid gap-6 md:grid-cols-[18%_1fr]">
						<!-- Column 1: Period, Company, Location -->
						<div class="space-y-1">
							<p class="text-sm font-semibold text-foreground">
								<span class="whitespace-nowrap">{formatDate(exp.startDate, language)}</span>
								<span> - </span>
								<span class="whitespace-nowrap">{formatDate(exp.endDate, language)}</span>
							</p>
							<p class="text-sm font-semibold text-foreground">{exp.company}</p>
							{#if exp.location}
								<p class="text-sm text-secondary-text">{t(exp.location, language)}</p>
							{/if}
						</div>

						<!-- Column 2: Role, Description, Technologies -->
						<div class="space-y-3">
							<h3 class="hyphens-auto break-words text-base font-bold text-foreground" lang="en">
								{t(exp.role, language)}
							</h3>
							<div
								class="hyphens-auto break-words text-sm leading-relaxed text-secondary-text"
								lang="en"
							>
								<!-- eslint-disable-next-line svelte/no-at-html-tags -->
								{@html t(exp.description, language)}
							</div>
							{#if exp.technologies.length > 0}
								<div class="flex flex-wrap gap-2">
									{#each exp.technologies as tech, techIndex (`${tech}-${techIndex}`)}
										<span class="rounded-xs bg-muted px-3 py-1 text-xs text-foreground"
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
