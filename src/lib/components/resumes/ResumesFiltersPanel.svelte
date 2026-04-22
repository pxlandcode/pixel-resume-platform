<script lang="ts">
	import { Button, Input } from '@pixelcode_/blocks/components';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { DropdownCheckbox } from '$lib/components/dropdown-checkbox';
	import TechStackSelector from '$lib/components/tech-stack-selector/tech-stack-selector.svelte';
	import { clickOutside } from '$lib/utils/clickOutside';
	import { ResumeFreeTextSearchInput } from '$lib/components/resumes/resume-free-text-search-input';
	import type { TalentLabelDefinition } from '$lib/types/talentLabels';
	import type { AvailabilityMode, SelectedSearchFilter } from './pageShared';
	import { formatYears } from './pageShared';

	type OrganisationFilterOption = {
		label: string;
		value: string;
	};

	type LabelFilterOption = {
		label: string;
		value: string;
	};

	type Props = {
		open: boolean;
		organisationFilterOptions: OrganisationFilterOption[];
		selectedOrganisationIds: string[];
		techCatalogOrganisationId: string | null;
		techCatalogScope: 'global' | 'organisation';
		onOrganisationFilterChange: (selected: string[]) => void;
		availabilityMode: AvailabilityMode;
		onAvailabilityModeChange: (mode: AvailabilityMode) => void;
		availabilityWithinDaysInput: string;
		onAvailabilityWithinDaysInput: (value: string) => void;
		onAvailabilityWithinDaysCommit: (value: string) => void;
		onAvailabilityWithinDaysKeydown: (event: KeyboardEvent) => void;
		labelFilterOptions: LabelFilterOption[];
		selectedLabelIds: string[];
		selectedLabelDefinitions: TalentLabelDefinition[];
		onSelectedLabelIdsChange: (selected: string[]) => void;
		onRemoveSelectedLabelFilter: (labelId: string) => void;
		freeTextSearchInput: string;
		hasFreeTextSearch: boolean;
		freeTextSearchLoading: boolean;
		onFreeTextSearchInput: (value: string) => void;
		onFreeTextSearchCommit: (value: string) => void;
		onClearFreeTextSearch: () => void;
		selectedTechs: string[];
		onSelectedTechsChange: (techs: string[]) => void;
		selectedSearchFilters: SelectedSearchFilter[];
		openTechRequirementKey: string | null;
		techRequirementDraft: string;
		techRequirementError: string;
		onOpenTechRequirementPopover: (filter: SelectedSearchFilter) => void;
		onCloseTechRequirementPopover: () => void;
		onRemoveSelectedSearchFilter: (filterKey: string) => void;
		onClearSelectedSearchFilters: () => void;
		onApplyTechRequirementDraft: (techKey: string, rawDraft?: string) => unknown;
		onClearTechRequirement: (techKey: string) => void;
		onTechRequirementKeydown: (event: KeyboardEvent, techKey: string) => void;
		summaryText: string;
	};

	let {
		open,
		organisationFilterOptions,
		selectedOrganisationIds,
		techCatalogOrganisationId,
		techCatalogScope,
		onOrganisationFilterChange,
		availabilityMode,
		onAvailabilityModeChange,
		availabilityWithinDaysInput,
		onAvailabilityWithinDaysInput,
		onAvailabilityWithinDaysCommit,
		onAvailabilityWithinDaysKeydown,
		labelFilterOptions,
		selectedLabelIds,
		selectedLabelDefinitions,
		onSelectedLabelIdsChange,
		onRemoveSelectedLabelFilter,
		freeTextSearchInput,
		hasFreeTextSearch,
		freeTextSearchLoading,
		onFreeTextSearchInput,
		onFreeTextSearchCommit,
		onClearFreeTextSearch,
		selectedTechs,
		onSelectedTechsChange,
		selectedSearchFilters,
		openTechRequirementKey,
		techRequirementDraft,
		techRequirementError,
		onOpenTechRequirementPopover,
		onCloseTechRequirementPopover,
		onRemoveSelectedSearchFilter,
		onClearSelectedSearchFilters,
		onApplyTechRequirementDraft,
		onClearTechRequirement,
		onTechRequirementKeydown,
		summaryText
	}: Props = $props();
</script>

{#if open}
	<div
		transition:slide={{ duration: 300, easing: cubicOut }}
		class="border-border bg-card rounded-none border p-6"
	>
		<div class="space-y-6">
			{#if organisationFilterOptions.length > 0}
				<div>
					<h2 class="text-muted-fg mb-3 text-xs font-semibold uppercase tracking-wide">
						Organisation
					</h2>
					<div class="w-64">
						<DropdownCheckbox
							label="Organisations"
							hideLabel
							placeholder="Organisations"
							options={organisationFilterOptions}
							selectedValues={selectedOrganisationIds}
							onchange={onOrganisationFilterChange}
							variant="outline"
							size="sm"
							search
							searchPlaceholder="Search organisations"
						/>
					</div>
				</div>
			{/if}

			<div>
				<h2 class="text-muted-fg mb-3 text-xs font-semibold uppercase tracking-wide">
					Availability
				</h2>
				<div class="flex flex-wrap items-center gap-2">
					<Button
						type="button"
						size="sm"
						variant={availabilityMode === 'all' ? 'primary' : 'outline'}
						onclick={() => onAvailabilityModeChange('all')}
					>
						All
					</Button>
					<Button
						type="button"
						size="sm"
						variant={availabilityMode === 'now' ? 'primary' : 'outline'}
						onclick={() => onAvailabilityModeChange('now')}
					>
						Available now
					</Button>
					<Button
						type="button"
						size="sm"
						variant={availabilityMode === 'within-days' ? 'primary' : 'outline'}
						onclick={() => onAvailabilityModeChange('within-days')}
					>
						Available within X days
					</Button>
				</div>

				{#if availabilityMode === 'within-days'}
					<div class="mt-3 flex items-center gap-2">
						<Input
							type="number"
							min="0"
							step="1"
							size="sm"
							class="w-24"
							value={availabilityWithinDaysInput}
							oninput={(event) =>
								onAvailabilityWithinDaysInput((event.currentTarget as HTMLInputElement).value)}
							onblur={(event) =>
								onAvailabilityWithinDaysCommit((event.currentTarget as HTMLInputElement).value)}
							onkeydown={onAvailabilityWithinDaysKeydown}
						/>
						<span class="text-muted-fg text-sm">days (including uppsägningstid)</span>
					</div>
				{/if}
			</div>

			{#if labelFilterOptions.length > 0}
				<div>
					<h2 class="text-muted-fg mb-3 text-xs font-semibold uppercase tracking-wide">Labels</h2>
					<div class="w-64">
						<DropdownCheckbox
							label="Labels"
							hideLabel
							placeholder="Labels"
							options={labelFilterOptions}
							selectedValues={selectedLabelIds}
							onchange={onSelectedLabelIdsChange}
							variant="outline"
							size="sm"
							search
							searchPlaceholder="Search labels"
						/>
					</div>
				</div>
			{/if}

			<div>
				<h2 class="text-muted-fg mb-3 text-xs font-semibold uppercase tracking-wide">
					Search by tech
				</h2>

				<TechStackSelector
					value={selectedTechs}
					showSelectedChips={false}
					catalogScope={techCatalogScope}
					organisationId={techCatalogOrganisationId}
					onchange={onSelectedTechsChange}
				/>
			</div>

			<div>
				<ResumeFreeTextSearchInput
					value={freeTextSearchInput}
					active={hasFreeTextSearch}
					loading={freeTextSearchLoading}
					placeholder="Search by free text or paste an assignment description..."
					helperText="Searches profiles, summaries, assignments, and tech."
					oninput={onFreeTextSearchInput}
					oncommit={onFreeTextSearchCommit}
					onclear={onClearFreeTextSearch}
				/>
			</div>

			<div>
				<div class="mb-3 flex items-center justify-between gap-4">
					<h2 class="text-muted-fg text-xs font-semibold uppercase tracking-wide">
						All active filters
					</h2>
					{#if selectedSearchFilters.length > 0 || selectedLabelDefinitions.length > 0}
						<Button variant="ghost" size="sm" onclick={onClearSelectedSearchFilters}>Clear</Button>
					{/if}
				</div>

				{#if selectedSearchFilters.length > 0 || selectedLabelDefinitions.length > 0}
					<div class="mt-3 flex flex-wrap gap-2" use:clickOutside={onCloseTechRequirementPopover}>
						{#each selectedLabelDefinitions as labelDefinition (labelDefinition.id)}
							<div class="relative">
								<span
									class="border-border bg-muted text-foreground inline-flex items-center gap-2 rounded-sm border px-3 py-1.5 pr-8 text-xs font-medium"
								>
									<span
										class="h-2.5 w-2.5 rounded-full"
										style={`background-color: ${labelDefinition.color_hex};`}
										aria-hidden="true"
									></span>
									<span>{labelDefinition.name}</span>
								</span>

								<button
									type="button"
									onclick={() => onRemoveSelectedLabelFilter(labelDefinition.id)}
									class="text-muted-fg hover:text-foreground absolute right-1 top-1/2 -translate-y-1/2 rounded-sm px-1 text-xs"
									aria-label={`Remove ${labelDefinition.name} label filter`}
								>
									×
								</button>
							</div>
						{/each}

						{#each selectedSearchFilters as searchFilter (searchFilter.key)}
							<div class="relative">
								<button
									type="button"
									onclick={() => onOpenTechRequirementPopover(searchFilter)}
									class="border-border bg-muted text-foreground inline-flex items-center gap-2 rounded-sm border px-3 py-1.5 pr-8 text-xs font-medium"
								>
									<span>{searchFilter.label}</span>
									{#if searchFilter.requiredYears !== null}
										<span class="text-muted-fg text-[10px]">
											{formatYears(searchFilter.requiredYears)}
										</span>
									{/if}
								</button>

								<button
									type="button"
									onclick={(event) => {
										event.stopPropagation();
										onRemoveSelectedSearchFilter(searchFilter.key);
									}}
									class="text-muted-fg hover:text-foreground absolute right-1 top-1/2 -translate-y-1/2 rounded-sm px-1 text-xs"
									aria-label={`Remove ${searchFilter.label}`}
								>
									×
								</button>

								{#if openTechRequirementKey === searchFilter.key}
									<div
										class="border-border bg-card absolute left-0 top-full z-20 mt-2 w-52 rounded-sm border p-3 shadow-xl"
									>
										<p class="text-foreground text-xs font-semibold">
											Min years for {searchFilter.label}
										</p>
										<Input
											type="number"
											min="0"
											step="0.5"
											size="sm"
											class="mt-2 w-full"
											value={techRequirementDraft}
											oninput={(event) =>
												void onApplyTechRequirementDraft(
													searchFilter.key,
													(event.currentTarget as HTMLInputElement).value
												)}
											onblur={(event) =>
												void onApplyTechRequirementDraft(
													searchFilter.key,
													(event.currentTarget as HTMLInputElement).value
												)}
											onkeydown={(event) => onTechRequirementKeydown(event, searchFilter.key)}
										/>

										{#if techRequirementError}
											<p class="mt-1 text-xs text-red-600">{techRequirementError}</p>
										{/if}

										<div class="mt-2 flex items-center justify-between gap-2">
											<Button
												type="button"
												size="sm"
												variant="ghost"
												onclick={() => onClearTechRequirement(searchFilter.key)}
											>
												Clear
											</Button>
											<span class="text-muted-fg text-[11px]">Auto-saved</span>
										</div>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{:else if hasFreeTextSearch}
					<p class="text-muted-fg text-sm">
						AI-picked filters will appear here after analysis. You can remove terms or add years
						once they show up.
					</p>
				{:else}
					<p class="text-muted-fg text-sm">No active filters yet.</p>
				{/if}

				<p class="text-muted-fg mt-3 text-sm">{summaryText}</p>
			</div>
		</div>
	</div>
{/if}
