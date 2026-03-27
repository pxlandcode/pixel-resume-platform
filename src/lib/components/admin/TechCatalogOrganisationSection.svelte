<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button, Input } from '@pixelcode_/blocks/components';
	import { Dropdown } from '$lib/components/dropdown';
	import { confirm } from '$lib/utils/confirm';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import Eye from 'lucide-svelte/icons/eye';
	import EyeOff from 'lucide-svelte/icons/eye-off';
	import GripVertical from 'lucide-svelte/icons/grip-vertical';
	import Pencil from 'lucide-svelte/icons/pencil';
	import Plus from 'lucide-svelte/icons/plus';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import type {
		CategoryCard,
		OrganisationOption,
		TechCatalogLoadStatus,
		TechCatalogSubmitHandlerFactory
	} from './techCatalogManagerShared';
	import {
		applyOrderedIds,
		aliasesPreview,
		areStringArraysEqual,
		moveWithinList,
		toggleCollection
	} from './techCatalogManagerShared';

	type Props = {
		canSelectOrganisation?: boolean;
		organisationOptions?: OrganisationOption[];
		selectedOrganisationId?: string;
		status?: TechCatalogLoadStatus;
		error?: string | null;
		categoryCards?: CategoryCard[];
		createSubmitHandler: TechCatalogSubmitHandlerFactory;
		onReorderItems: (categoryId: string, itemIds: string[]) => Promise<boolean>;
	};

	let {
		canSelectOrganisation = false,
		organisationOptions = [],
		selectedOrganisationId = $bindable(''),
		status = 'idle',
		error = null,
		categoryCards = [],
		createSubmitHandler,
		onReorderItems
	}: Props = $props();

	let panelOpen = $state(false);
	let openCategoryIds = $state<string[]>([]);
	let expandedItemIds = $state<string[]>([]);
	let addingItemCategoryId = $state<string | null>(null);

	let draggedItem = $state<{ categoryId: string; itemId: string } | null>(null);
	let dragOverItemId = $state<string | null>(null);
	let optimisticItemOrdersByCategoryId = $state<Record<string, string[]>>({});

	let previousSelectedOrganisationId = $state('');

	const orderedCategoryCards = $derived.by(() =>
		categoryCards.map((category) => ({
			...category,
			items: applyOrderedIds(category.items, optimisticItemOrdersByCategoryId[category.id] ?? null)
		}))
	);

	const selectedOrganisationName = $derived(
		organisationOptions.find((option) => option.id === selectedOrganisationId)?.name ??
			'Organisation'
	);
	const organisationDropdownOptions = $derived(
		organisationOptions.map((option) => ({
			label: option.name,
			value: option.id
		}))
	);
	const hiddenItemCount = $derived(
		orderedCategoryCards.reduce((total, category) => total + category.hiddenItemCount, 0)
	);
	const organisationItemCount = $derived(
		orderedCategoryCards.reduce(
			(total, category) =>
				total + category.items.filter((item) => item.scope === 'organisation').length,
			0
		)
	);
	const totalItemCount = $derived(
		orderedCategoryCards.reduce((total, category) => total + category.items.length, 0)
	);

	const toggleOpenCategory = (categoryId: string) => {
		openCategoryIds = toggleCollection(openCategoryIds, categoryId);
	};

	const toggleExpandedItem = (itemId: string) => {
		expandedItemIds = toggleCollection(expandedItemIds, itemId);
	};

	const isItemHidden = (item: CategoryCard['items'][number]) =>
		Boolean(item.excludedByOrganisation || (item.scope === 'organisation' && !item.isActive));

	const handleItemDrop = async (categoryId: string, targetItemId: string) => {
		if (!draggedItem || draggedItem.categoryId !== categoryId) return;
		if (draggedItem.itemId === targetItemId) return;
		const category = orderedCategoryCards.find((entry) => entry.id === categoryId);
		if (!category) return;
		const previousOrder = optimisticItemOrdersByCategoryId[categoryId] ?? null;
		const nextIds = moveWithinList(
			category.items.map((item) => item.id),
			draggedItem.itemId,
			targetItemId
		);
		draggedItem = null;
		dragOverItemId = null;
		optimisticItemOrdersByCategoryId = {
			...optimisticItemOrdersByCategoryId,
			[categoryId]: nextIds
		};
		const saved = await onReorderItems(categoryId, nextIds);
		if (!saved) {
			if (previousOrder) {
				optimisticItemOrdersByCategoryId = {
					...optimisticItemOrdersByCategoryId,
					[categoryId]: previousOrder
				};
			} else {
				const nextItemOrdersByCategoryId = { ...optimisticItemOrdersByCategoryId };
				delete nextItemOrdersByCategoryId[categoryId];
				optimisticItemOrdersByCategoryId = nextItemOrdersByCategoryId;
			}
		}
	};

	const visibilitySubmitHandler = createSubmitHandler();

	const createItemSubmitHandler = (categoryId: string) =>
		createSubmitHandler(({ actionType, submittedCategoryId, submittedItemId }) => {
			if (
				actionType === 'upsertOrganisationTechCatalogItem' &&
				submittedCategoryId === categoryId &&
				!submittedItemId
			) {
				addingItemCategoryId = null;
			}
		});

	const editItemSubmitHandler = (itemId: string) =>
		createSubmitHandler(({ actionType, submittedItemId }) => {
			if (actionType === 'upsertOrganisationTechCatalogItem' && submittedItemId === itemId) {
				expandedItemIds = expandedItemIds.filter((entry) => entry !== itemId);
			}
		});

	const deleteItemSubmitHandler = (itemId: string) =>
		createSubmitHandler(({ actionType, submittedItemId }) => {
			if (actionType === 'deleteOrganisationTechCatalogItem' && submittedItemId === itemId) {
				expandedItemIds = expandedItemIds.filter((entry) => entry !== itemId);
			}
		});

	$effect(() => {
		if (selectedOrganisationId !== previousSelectedOrganisationId) {
			previousSelectedOrganisationId = selectedOrganisationId;
			openCategoryIds = [];
			expandedItemIds = [];
			addingItemCategoryId = null;
			optimisticItemOrdersByCategoryId = {};
		}
	});

	$effect(() => {
		const categoryIds = new Set(categoryCards.map((category) => category.id));
		const nextOpenCategoryIds = openCategoryIds.filter((categoryId) => categoryIds.has(categoryId));
		if (!areStringArraysEqual(openCategoryIds, nextOpenCategoryIds)) {
			openCategoryIds = nextOpenCategoryIds;
		}
		if (addingItemCategoryId && !categoryIds.has(addingItemCategoryId)) {
			addingItemCategoryId = null;
		}
		const nextOptimisticItemOrdersByCategoryId = Object.fromEntries(
			Object.entries(optimisticItemOrdersByCategoryId).filter(([categoryId]) =>
				categoryIds.has(categoryId)
			)
		);
		if (
			JSON.stringify(nextOptimisticItemOrdersByCategoryId) !==
			JSON.stringify(optimisticItemOrdersByCategoryId)
		) {
			optimisticItemOrdersByCategoryId = nextOptimisticItemOrdersByCategoryId;
		}
	});

	$effect(() => {
		const itemIds = new Set(
			orderedCategoryCards.flatMap((category) => category.items.map((item) => item.id))
		);
		const nextExpandedItemIds = expandedItemIds.filter((itemId) => itemIds.has(itemId));
		if (!areStringArraysEqual(expandedItemIds, nextExpandedItemIds)) {
			expandedItemIds = nextExpandedItemIds;
		}
	});
</script>

<section class="space-y-4">
	<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
		<div>
			<h3 class="text-foreground text-lg font-semibold">Organisation catalog</h3>
			<p class="text-muted-fg mt-1 text-sm">
				Manage one merged list per category. Global technologies can be hidden, and
				organisation-specific technologies can be edited, hidden, or deleted.
			</p>
		</div>
		{#if canSelectOrganisation && organisationDropdownOptions.length > 1}
			<div class="w-full sm:w-auto sm:min-w-[260px]">
				<Dropdown
					label="Organisation"
					bind:value={selectedOrganisationId}
					options={organisationDropdownOptions}
					placeholder="Choose organisation"
					search={organisationDropdownOptions.length > 6}
					searchPlaceholder="Search organisations"
					class="w-full"
				/>
			</div>
		{/if}
	</div>

	{#if !selectedOrganisationId}
		<p class="text-muted-fg text-sm">
			Connect this account to a home organisation before managing organisation technology settings.
		</p>
	{:else if status === 'loading' && categoryCards.length === 0}
		<p class="text-muted-fg text-sm">Loading organisation technology catalog...</p>
	{:else if error}
		<p class="text-sm text-red-600">{error}</p>
	{:else}
		<div class="border-border bg-background rounded-sm border">
			<button
				type="button"
				class="flex w-full items-start justify-between gap-4 px-4 py-4 text-left"
				onclick={() => (panelOpen = !panelOpen)}
			>
				<div class="min-w-0">
					<h4 class="text-foreground text-sm font-semibold">
						Organisation stack for {selectedOrganisationName}
					</h4>
					<p class="text-muted-fg mt-1 text-sm">
						Drag items inside a category to define the organisation-specific order.
					</p>
					<p class="text-muted-fg mt-2 text-xs">
						{orderedCategoryCards.length} categories • {totalItemCount} items • {organisationItemCount}
						organisation-specific technologies
						{#if hiddenItemCount > 0}
							• {hiddenItemCount} hidden
						{/if}
					</p>
				</div>
				{#if panelOpen}
					<ChevronDown class="text-muted-fg h-4 w-4 shrink-0" />
				{:else}
					<ChevronRight class="text-muted-fg h-4 w-4 shrink-0" />
				{/if}
			</button>

			{#if panelOpen}
				<div class="border-border border-t px-4 py-4">
					<div class="space-y-3">
						{#each orderedCategoryCards as category (category.id)}
							<div class="border-border bg-card rounded-sm border">
								<div class="flex items-center gap-3 px-4 py-4">
									<button
										type="button"
										class="flex min-w-0 flex-1 items-center justify-between gap-4 text-left"
										onclick={() => toggleOpenCategory(category.id)}
									>
										<div class="min-w-0">
											<div class="flex flex-wrap items-center gap-2">
												<p class="text-foreground truncate text-sm font-semibold">
													{category.name}
												</p>
												<span
													class="bg-muted text-muted-fg rounded-full px-2 py-0.5 text-[11px] font-medium"
												>
													{category.items.length} items
												</span>
											</div>
											<p class="text-muted-fg mt-1 text-xs">
												{category.items.filter((item) => item.scope === 'organisation').length}
												organisation-specific technologies
												{#if category.hiddenItemCount > 0}
													• {category.hiddenItemCount} hidden
												{/if}
											</p>
										</div>
										{#if openCategoryIds.includes(category.id)}
											<ChevronDown class="text-muted-fg h-4 w-4 shrink-0" />
										{:else}
											<ChevronRight class="text-muted-fg h-4 w-4 shrink-0" />
										{/if}
									</button>
								</div>

								{#if openCategoryIds.includes(category.id)}
									<div class="border-border border-t px-4 py-4">
										<div class="space-y-3">
											<div class="flex items-center justify-between gap-3">
												<p class="text-foreground text-sm font-medium">Category list</p>
												<Button
													type="button"
													variant={addingItemCategoryId === category.id ? 'outline' : 'ghost'}
													size="sm"
													onclick={() => {
														addingItemCategoryId =
															addingItemCategoryId === category.id ? null : category.id;
													}}
												>
													<Plus class="mr-1 h-3.5 w-3.5" />
													Add organisation-specific tech
												</Button>
											</div>

											{#if addingItemCategoryId === category.id}
												<form
													method="POST"
													action="?/upsertOrganisationTechCatalogItem"
													class="border-border bg-background rounded-sm border p-3"
													use:enhance={createItemSubmitHandler(category.id)}
												>
													<input
														type="hidden"
														name="tech_context_id"
														value={selectedOrganisationId}
													/>
													<input
														type="hidden"
														name="organisation_id"
														value={selectedOrganisationId}
													/>
													<input type="hidden" name="category_id" value={category.id} />
													<div
														class="grid gap-3 lg:grid-cols-[minmax(0,1fr),minmax(0,1fr),auto] lg:items-end"
													>
														<div class="space-y-2">
															<p
																class="text-muted-fg text-xs font-semibold uppercase tracking-wide"
															>
																Name
															</p>
															<Input name="label" placeholder="Technology name" />
														</div>
														<div class="space-y-2">
															<p
																class="text-muted-fg text-xs font-semibold uppercase tracking-wide"
															>
																Aliases
															</p>
															<Input name="aliases" placeholder="Comma separated aliases" />
														</div>
														<div class="flex gap-2">
															<Button
																type="button"
																variant="outline"
																onclick={() => (addingItemCategoryId = null)}
															>
																Cancel
															</Button>
															<Button type="submit">Save</Button>
														</div>
													</div>
												</form>
											{/if}

											{#if category.items.length === 0}
												<p class="text-muted-fg text-sm">No technologies in this category yet.</p>
											{:else}
												<div
													class="space-y-2"
													role="list"
													aria-label={`${category.name} organisation catalog`}
												>
													{#each category.items as item (item.id)}
														{@const itemHidden = isItemHidden(item)}
														{@const deleteFormId = `delete-org-tech-${item.id}`}
														<div
															role="listitem"
															class={`border-border bg-background rounded-sm border transition ${
																dragOverItemId === item.id
																	? 'border-primary ring-primary/20 ring-2'
																	: ''
															}`}
															ondragover={(event) => {
																if (
																	!draggedItem ||
																	draggedItem.categoryId !== category.id ||
																	draggedItem.itemId === item.id
																) {
																	return;
																}
																event.preventDefault();
																dragOverItemId = item.id;
															}}
															ondragleave={() => {
																if (dragOverItemId === item.id) dragOverItemId = null;
															}}
															ondrop={async (event) => {
																event.preventDefault();
																await handleItemDrop(category.id, item.id);
															}}
														>
															<div class="flex items-start gap-3 px-3 py-3">
																<button
																	type="button"
																	draggable="true"
																	aria-label={`Drag ${item.label}`}
																	class="text-muted-fg hover:text-foreground mt-0.5 cursor-grab rounded-sm p-1 active:cursor-grabbing"
																	ondragstart={(event) => {
																		draggedItem = { categoryId: category.id, itemId: item.id };
																		event.dataTransfer?.setData('text/plain', item.id);
																	}}
																	ondragend={() => {
																		draggedItem = null;
																		dragOverItemId = null;
																	}}
																>
																	<GripVertical class="h-4 w-4" />
																</button>

																<div class="min-w-0 flex-1">
																	<div class="flex flex-wrap items-center gap-2">
																		<p class="text-foreground truncate text-sm font-medium">
																			{item.label}
																		</p>
																		<span
																			class="bg-muted text-muted-fg rounded-full px-2 py-0.5 text-[11px] font-medium"
																		>
																			{item.scope === 'global' ? 'Global' : 'Organisation'}
																		</span>
																		{#if itemHidden}
																			<span
																				class="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700"
																			>
																				Hidden
																			</span>
																		{/if}
																		{#if item.scope === 'global' && !item.isActive}
																			<span
																				class="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700"
																			>
																				Archived
																			</span>
																		{/if}
																	</div>
																	<p class="text-muted-fg mt-1 text-xs">
																		{aliasesPreview(item.aliases)}
																	</p>
																</div>

																<div class="flex flex-wrap justify-end gap-2">
																	{#if item.scope === 'global'}
																		<form
																			method="POST"
																			action="?/setOrganisationTechCatalogExclusion"
																			use:enhance={visibilitySubmitHandler}
																		>
																			<input
																				type="hidden"
																				name="tech_context_id"
																				value={selectedOrganisationId}
																			/>
																			<input
																				type="hidden"
																				name="organisation_id"
																				value={selectedOrganisationId}
																			/>
																			<input type="hidden" name="item_id" value={item.id} />
																			<input
																				type="hidden"
																				name="hidden"
																				value={itemHidden ? 'false' : 'true'}
																			/>
																			<Button type="submit" variant="outline" size="sm">
																				{#if itemHidden}
																					<Eye class="mr-1 h-3.5 w-3.5" />
																					Restore
																				{:else}
																					<EyeOff class="mr-1 h-3.5 w-3.5" />
																					Hide
																				{/if}
																			</Button>
																		</form>
																	{:else}
																		<Button
																			type="button"
																			variant="ghost"
																			size="sm"
																			onclick={() => toggleExpandedItem(item.id)}
																		>
																			<Pencil class="mr-1 h-3.5 w-3.5" />
																			{expandedItemIds.includes(item.id) ? 'Close' : 'Edit'}
																		</Button>
																		<form
																			method="POST"
																			action="?/setOrganisationTechCatalogExclusion"
																			use:enhance={visibilitySubmitHandler}
																		>
																			<input
																				type="hidden"
																				name="tech_context_id"
																				value={selectedOrganisationId}
																			/>
																			<input
																				type="hidden"
																				name="organisation_id"
																				value={selectedOrganisationId}
																			/>
																			<input type="hidden" name="item_id" value={item.id} />
																			<input
																				type="hidden"
																				name="hidden"
																				value={itemHidden ? 'false' : 'true'}
																			/>
																			<Button type="submit" variant="outline" size="sm">
																				{#if itemHidden}
																					<Eye class="mr-1 h-3.5 w-3.5" />
																					Restore
																				{:else}
																					<EyeOff class="mr-1 h-3.5 w-3.5" />
																					Hide
																				{/if}
																			</Button>
																		</form>
																	{/if}
																</div>
															</div>

															{#if item.scope === 'organisation' && expandedItemIds.includes(item.id)}
																<div class="border-border border-t px-3 py-3">
																	<div class="space-y-3">
																		<form
																			method="POST"
																			action="?/upsertOrganisationTechCatalogItem"
																			use:enhance={editItemSubmitHandler(item.id)}
																		>
																			<input
																				type="hidden"
																				name="tech_context_id"
																				value={selectedOrganisationId}
																			/>
																			<input
																				type="hidden"
																				name="organisation_id"
																				value={selectedOrganisationId}
																			/>
																			<input type="hidden" name="item_id" value={item.id} />
																			<input type="hidden" name="category_id" value={category.id} />
																			<div
																				class="grid gap-3 lg:grid-cols-[minmax(0,1fr),minmax(0,1fr),auto] lg:items-end"
																			>
																				<div class="space-y-2">
																					<p
																						class="text-muted-fg text-xs font-semibold uppercase tracking-wide"
																					>
																						Name
																					</p>
																					<Input name="label" value={item.label} />
																				</div>
																				<div class="space-y-2">
																					<p
																						class="text-muted-fg text-xs font-semibold uppercase tracking-wide"
																					>
																						Aliases
																					</p>
																					<Input
																						name="aliases"
																						value={item.aliases.join(', ')}
																						placeholder="Comma separated aliases"
																					/>
																				</div>
																				<div class="flex flex-wrap gap-2">
																					<Button type="submit" size="sm">Save</Button>
																				</div>
																			</div>
																		</form>

																		<div class="flex justify-end">
																			<form
																				id={deleteFormId}
																				method="POST"
																				action="?/deleteOrganisationTechCatalogItem"
																				use:enhance={deleteItemSubmitHandler(item.id)}
																			>
																				<input
																					type="hidden"
																					name="tech_context_id"
																					value={selectedOrganisationId}
																				/>
																				<input
																					type="hidden"
																					name="organisation_id"
																					value={selectedOrganisationId}
																				/>
																				<input type="hidden" name="item_id" value={item.id} />
																				<button
																					type="button"
																					class="inline-flex items-center gap-1 rounded-sm border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100"
																					use:confirm={{
																						title: `Delete ${item.label}?`,
																						description:
																							'This removes the organisation-specific technology from the catalog. This cannot be undone.',
																						actionLabel: 'Delete',
																						action: () => {
																							const deleteForm =
																								document.getElementById(deleteFormId);
																							if (deleteForm instanceof HTMLFormElement) {
																								deleteForm.requestSubmit();
																							}
																						}
																					}}
																				>
																					<Trash2 class="h-3.5 w-3.5" />
																					Delete
																				</button>
																			</form>
																		</div>
																	</div>
																</div>
															{/if}
														</div>
													{/each}
												</div>
											{/if}
										</div>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}
</section>
