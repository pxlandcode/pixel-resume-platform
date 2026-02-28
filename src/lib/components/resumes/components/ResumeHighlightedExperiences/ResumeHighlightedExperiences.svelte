<script lang="ts">
	import type { HighlightedExperience, ExperienceLibraryItem } from '$lib/types/resume';
	import { Button, Input, FormControl } from '@pixelcode_/blocks/components';
	import { QuillEditor, TechStackSelector } from '$lib/components';
	import { ResumeAiWriterDrawer } from '../ResumeAiWriterDrawer';
	import { SvelteSet } from 'svelte/reactivity';
	import {
		t,
		getLocalizedValue,
		setLocalizedValue,
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
		experiences: HighlightedExperience[];
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
	let aiDescriptionRevisionByRow = $state<Record<string, number>>({});
	let showLibraryPicker = $state(false);
	let librarySearch = $state('');

	// Collapse state - track which items are expanded
	let expandedIds = new SvelteSet<string>();
	let allCollapsed = $state(true);

	const getRowId = (exp: HighlightedExperience, index: number) => exp._id ?? `row-${index}`;
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
			expandedIds.clear();
			for (const exp of experiences) {
				const id = exp._id ?? '';
				if (id) expandedIds.add(id);
			}
			allCollapsed = false;
		} else {
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

<div class="space-y-4">
	{#if !isEditing && experiences.length > 0}
		<h3 class="pt-4 text-base font-bold uppercase tracking-wide text-foreground">
			{language === 'sv' ? 'Utvald Erfarenhet' : 'Highlighted Experience'}
		</h3>
	{/if}

	{#if isEditing}
		<div class="rounded-xs border border-border bg-muted p-4">
			<h3 class="mb-4 text-sm font-semibold text-secondary-text">Highlighted Experiences</h3>
			<div class="mb-4 flex gap-2">
				<Button
					variant="outline"
					class="flex-1 border-dashed border-border text-secondary-text hover:bg-card"
					onclick={onAdd}
				>
					+ Add Highlighted Experience
				</Button>
				<Button
					variant="outline"
					class="border-border text-secondary-text hover:bg-card"
					onclick={() => (showLibraryPicker = !showLibraryPicker)}
				>
					Add from Library
				</Button>
				<Button variant="ghost" size="sm" class="text-secondary-text" onclick={toggleAll}>
					{allCollapsed ? 'Expand All' : 'Collapse All'}
				</Button>
			</div>
			{#if showLibraryPicker}
				<div class="rounded-xs mb-4 border border-border bg-muted p-3">
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
									class="rounded-xs flex items-center justify-between border border-border bg-card px-3 py-2"
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
									<Button size="sm" variant="outline" onclick={() => onAddFromLibrary?.(entry.id)}>
										Add
									</Button>
								</div>
							{/each}
						{/if}
					</div>
				</div>
			{/if}
			<div class="space-y-3">
				{#each experiences as exp, index (exp._id ?? index)}
					{@const rowId = getRowId(exp, index)}
					<div
						class="rounded-xs border border-border bg-card transition-all {draggedIndex ===
						index
							? 'opacity-50'
							: ''} {dragOverIndex === index && draggedIndex !== index
							? 'border-primary border-2'
							: ''}"
						ondragover={handleDragOver(index)}
						ondragleave={handleDragLeave}
						ondrop={handleDrop(index)}
					>
						<div
							class="flex items-center justify-between p-3 {isExpanded(exp._id)
								? 'border-b border-border'
								: ''}"
						>
							<div class="flex min-w-0 flex-1 items-center gap-2">
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
								<div class="min-w-0 flex-1">
									<span class="truncate font-semibold text-secondary-text">
										{exp.company || `Experience ${index + 1}`}
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
										sectionType="highlighted"
										{language}
										company={exp.company}
										roleSv={getLocalizedValue(exp.role, 'sv')}
										roleEn={getLocalizedValue(exp.role, 'en')}
										descriptionSv={getLocalizedValue(exp.description, 'sv')}
										descriptionEn={getLocalizedValue(exp.description, 'en')}
										technologies={exp.technologies}
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

											const nextExp: HighlightedExperience = {
												...exp,
												description: nextDescription,
												role: nextRole,
												company: payload.drafts.company,
												technologies: [...payload.drafts.technologies]
											};

											experiences = experiences.map((item, itemIndex) =>
												itemIndex === index ? nextExp : item
											);
											bumpDescriptionRevision(rowId);
											if (debugLoggingEnabled) {
												console.info('[resume-ai] apply:highlighted-row', {
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
								<Button variant="ghost" size="sm" onclick={() => onRemove?.(index)}>✕</Button>
							</div>
						</div>

						{#if isExpanded(exp._id)}
							<div class="space-y-3 p-4">
								<FormControl label="Company">
									<Input
										bind:value={exp.company}
										placeholder="Company"
										class="border-border bg-card text-foreground"
									/>
								</FormControl>
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
									<label class="mb-1 block text-sm font-medium text-secondary-text"
										>Description (SV)</label
									>
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
									<label class="mb-1 block text-sm font-medium text-secondary-text"
										>Description (EN)</label
									>
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
									<label class="mb-1 block text-sm font-medium text-secondary-text"
										>Key Technologies</label
									>
									<TechStackSelector
										bind:value={exp.technologies}
										onchange={(techs) => (exp.technologies = techs ?? [])}
									/>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{:else}
		{#each experiences.filter((exp) => !exp.hidden) as exp, index (`view-highlighted-${exp._id ?? exp.libraryId ?? exp.company}-${index}`)}
			<div class="border-primary space-y-3 border-l pl-4">
				<div>
					<p class="text-sm font-semibold text-foreground">{exp.company}</p>
					<p class="text-sm italic text-secondary-text">{t(exp.role, language)}</p>
				</div>
				<div class="experience-description text-sm leading-relaxed text-secondary-text">
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					{@html t(exp.description, language)}
				</div>
				{#if exp.technologies.length > 0}
					<div class="space-y-1">
						<p class="text-xs font-semibold uppercase tracking-wide text-secondary-text">
							{language === 'sv' ? 'Nyckeltekniker' : 'Key Technologies'}
						</p>
						<div class="flex flex-wrap gap-2">
							{#each exp.technologies as tech, techIndex (`${tech}-${techIndex}`)}
								<span class="rounded-xs bg-muted px-3 py-1 text-xs text-foreground">{tech}</span>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{/each}
	{/if}
</div>

<style>
	:global(.experience-description blockquote) {
		border-left-width: 2px;
		border-color: rgb(251 146 60);
		padding-left: 0.75rem;
		font-size: 0.875rem;
		color: rgb(51 65 85);
		font-style: italic;
		margin-top: 0.5rem;
		margin-bottom: 0.5rem;
		position: relative;
	}
	:global(.experience-description blockquote::before) {
		content: '"';
	}
	:global(.experience-description blockquote::after) {
		content: '"';
	}
</style>
