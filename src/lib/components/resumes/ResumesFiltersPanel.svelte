<script lang="ts">
	import { Button, Input } from '@pixelcode_/blocks/components';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { DropdownCheckbox } from '$lib/components/dropdown-checkbox';
	import TechStackSelector from '$lib/components/tech-stack-selector/tech-stack-selector.svelte';
	import { clickOutside } from '$lib/utils/clickOutside';
	import { ResumeFreeTextSearchInput } from '$lib/components/resumes/resume-free-text-search-input';
	import type { AvailabilityMode, SelectedTechFilter } from './pageShared';
	import { formatYears } from './pageShared';

	type OrganisationFilterOption = {
		label: string;
		value: string;
	};

	type Props = {
		open: boolean;
		organisationFilterOptions: OrganisationFilterOption[];
		selectedOrganisationIds: string[];
		onOrganisationFilterChange: (selected: string[]) => void;
		availabilityMode: AvailabilityMode;
		onAvailabilityModeChange: (mode: AvailabilityMode) => void;
		availabilityWithinDaysInput: string;
		onAvailabilityWithinDaysInput: (value: string) => void;
		onAvailabilityWithinDaysCommit: (value: string) => void;
		onAvailabilityWithinDaysKeydown: (event: KeyboardEvent) => void;
		freeTextSearchInput: string;
		hasFreeTextSearch: boolean;
		freeTextSearchLoading: boolean;
		onFreeTextSearchInput: (value: string) => void;
		onFreeTextSearchCommit: (value: string) => void;
		onClearFreeTextSearch: () => void;
		selectedTechs: string[];
		onSelectedTechsChange: (techs: string[]) => void;
		selectedTechFilters: SelectedTechFilter[];
		openTechRequirementKey: string | null;
		techRequirementDraft: string;
		techRequirementError: string;
		onOpenTechRequirementPopover: (filter: SelectedTechFilter) => void;
		onCloseTechRequirementPopover: () => void;
		onRemoveSelectedTech: (techKey: string) => void;
		onClearSelectedTechFilters: () => void;
		onApplyTechRequirementDraft: (techKey: string, rawDraft?: string) => unknown;
		onClearTechRequirement: (techKey: string) => void;
		onTechRequirementKeydown: (event: KeyboardEvent, techKey: string) => void;
		summaryText: string;
	};

	let {
		open,
		organisationFilterOptions,
		selectedOrganisationIds,
		onOrganisationFilterChange,
		availabilityMode,
		onAvailabilityModeChange,
		availabilityWithinDaysInput,
		onAvailabilityWithinDaysInput,
		onAvailabilityWithinDaysCommit,
		onAvailabilityWithinDaysKeydown,
		freeTextSearchInput,
		hasFreeTextSearch,
		freeTextSearchLoading,
		onFreeTextSearchInput,
		onFreeTextSearchCommit,
		onClearFreeTextSearch,
		selectedTechs,
		onSelectedTechsChange,
		selectedTechFilters,
		openTechRequirementKey,
		techRequirementDraft,
		techRequirementError,
		onOpenTechRequirementPopover,
		onCloseTechRequirementPopover,
		onRemoveSelectedTech,
		onClearSelectedTechFilters,
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

			<div>
				<div class="mb-3 flex items-center justify-between gap-4">
					<h2 class="text-muted-fg text-xs font-semibold uppercase tracking-wide">
						Search by tech
					</h2>
					{#if selectedTechFilters.length > 0}
						<Button variant="ghost" size="sm" onclick={onClearSelectedTechFilters}>Clear</Button>
					{/if}
				</div>

				<TechStackSelector
					value={selectedTechs}
					showSelectedChips={false}
					onchange={onSelectedTechsChange}
				/>

				{#if selectedTechFilters.length > 0}
					<div class="mt-3 flex flex-wrap gap-2" use:clickOutside={onCloseTechRequirementPopover}>
						{#each selectedTechFilters as techFilter (techFilter.key)}
							<div class="relative">
								<button
									type="button"
									onclick={() => onOpenTechRequirementPopover(techFilter)}
									class="border-border bg-muted text-foreground inline-flex items-center gap-2 rounded-sm border px-3 py-1.5 pr-8 text-xs font-medium"
								>
									<span>{techFilter.label}</span>
									{#if techFilter.requiredYears !== null}
										<span class="text-muted-fg text-[10px]">
											{formatYears(techFilter.requiredYears)}
										</span>
									{:else}
										<span class="text-muted-fg text-[10px]">any years</span>
									{/if}
								</button>

								<button
									type="button"
									onclick={(event) => {
										event.stopPropagation();
										onRemoveSelectedTech(techFilter.key);
									}}
									class="text-muted-fg hover:text-foreground absolute right-1 top-1/2 -translate-y-1/2 rounded-sm px-1 text-xs"
									aria-label={`Remove ${techFilter.label}`}
								>
									×
								</button>

								{#if openTechRequirementKey === techFilter.key}
									<div
										class="border-border bg-card absolute left-0 top-full z-20 mt-2 w-52 rounded-sm border p-3 shadow-xl"
									>
										<p class="text-foreground text-xs font-semibold">
											Min years for {techFilter.label}
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
													techFilter.key,
													(event.currentTarget as HTMLInputElement).value
												)}
											onblur={(event) =>
												void onApplyTechRequirementDraft(
													techFilter.key,
													(event.currentTarget as HTMLInputElement).value
												)}
											onkeydown={(event) => onTechRequirementKeydown(event, techFilter.key)}
										/>

										{#if techRequirementError}
											<p class="mt-1 text-xs text-red-600">{techRequirementError}</p>
										{/if}

										<div class="mt-2 flex items-center justify-between gap-2">
											<Button
												type="button"
												size="sm"
												variant="ghost"
												onclick={() => onClearTechRequirement(techFilter.key)}
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
				{/if}

				<p class="text-muted-fg mt-3 text-sm">{summaryText}</p>
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
		</div>
	</div>
{/if}
