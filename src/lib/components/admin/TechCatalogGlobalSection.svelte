<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button, Input } from '@pixelcode_/blocks/components';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import Eye from 'lucide-svelte/icons/eye';
	import EyeOff from 'lucide-svelte/icons/eye-off';
	import GripVertical from 'lucide-svelte/icons/grip-vertical';
	import Pencil from 'lucide-svelte/icons/pencil';
	import Plus from 'lucide-svelte/icons/plus';
	import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
	import type {
		CategoryCard,
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
		selectedOrganisationId?: string;
		status?: TechCatalogLoadStatus;
		error?: string | null;
		categoryCards?: CategoryCard[];
		createSubmitHandler: TechCatalogSubmitHandlerFactory;
		onReorderCategories: (categoryIds: string[]) => Promise<boolean>;
		onReorderItems: (categoryId: string, itemIds: string[]) => Promise<boolean>;
	};

	let {
		selectedOrganisationId = '',
		status = 'idle',
		error = null,
		categoryCards = [],
		createSubmitHandler,
		onReorderCategories,
		onReorderItems
	}: Props = $props();

	let openCategoryIds = $state<string[]>([]);
	let expandedItemIds = $state<string[]>([]);
	let showNewCategoryForm = $state(false);
	let addingItemCategoryId = $state<string | null>(null);

	let draggedCategoryId = $state<string | null>(null);
	let draggedItem = $state<{ categoryId: string; itemId: string } | null>(null);
	let dragOverCategoryId = $state<string | null>(null);
	let dragOverItemId = $state<string | null>(null);
	let optimisticCategoryOrder = $state<string[] | null>(null);
	let optimisticItemOrdersByCategoryId = $state<Record<string, string[]>>({});

	const orderedCategoryCards = $derived.by(() =>
		applyOrderedIds(
			categoryCards.map((category) => ({
				...category,
				items: applyOrderedIds(
					category.items,
					optimisticItemOrdersByCategoryId[category.id] ?? null
				)
			})),
			optimisticCategoryOrder
		)
	);

	const toggleOpenCategory = (categoryId: string) => {
		openCategoryIds = toggleCollection(openCategoryIds, categoryId);
	};

	const toggleExpandedItem = (itemId: string) => {
		expandedItemIds = toggleCollection(expandedItemIds, itemId);
	};

	const handleCategoryDrop = async (targetCategoryId: string) => {
		if (!draggedCategoryId || draggedCategoryId === targetCategoryId) return;
		const previousOrder = optimisticCategoryOrder;
		const nextIds = moveWithinList(
			orderedCategoryCards.map((category) => category.id),
			draggedCategoryId,
			targetCategoryId
		);
		draggedCategoryId = null;
		dragOverCategoryId = null;
		optimisticCategoryOrder = nextIds;
		const saved = await onReorderCategories(nextIds);
		if (!saved) {
			optimisticCategoryOrder = previousOrder;
		}
	};

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

	const newCategorySubmitHandler = createSubmitHandler(({ actionType, submittedCategoryId }) => {
		if (actionType === 'upsertTechCategory' && !submittedCategoryId) {
			showNewCategoryForm = false;
		}
	});

	const createItemSubmitHandler = (categoryId: string) =>
		createSubmitHandler(({ actionType, submittedCategoryId, submittedItemId }) => {
			if (
				actionType === 'upsertGlobalTechCatalogItem' &&
				submittedCategoryId === categoryId &&
				!submittedItemId
			) {
				addingItemCategoryId = null;
			}
		});

	const editItemSubmitHandler = (itemId: string) =>
		createSubmitHandler(({ actionType, submittedItemId }) => {
			if (actionType === 'upsertGlobalTechCatalogItem' && submittedItemId === itemId) {
				expandedItemIds = expandedItemIds.filter((entry) => entry !== itemId);
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
		if (optimisticCategoryOrder) {
			const nextOptimisticCategoryOrder = optimisticCategoryOrder.filter((categoryId) =>
				categoryIds.has(categoryId)
			);
			const normalizedOptimisticCategoryOrder =
				nextOptimisticCategoryOrder.length > 0 ? nextOptimisticCategoryOrder : null;
			if (
				(normalizedOptimisticCategoryOrder === null && optimisticCategoryOrder !== null) ||
				(normalizedOptimisticCategoryOrder !== null &&
					!areStringArraysEqual(optimisticCategoryOrder, normalizedOptimisticCategoryOrder))
			) {
				optimisticCategoryOrder = normalizedOptimisticCategoryOrder;
			}
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
	<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h3 class="text-foreground text-lg font-semibold">Global standard</h3>
			<p class="text-muted-fg mt-1 text-sm">
				Drag categories and technologies to reorder. Open a card only when you need to edit it.
			</p>
		</div>
		<Button
			type="button"
			size="sm"
			variant={showNewCategoryForm ? 'outline' : 'primary'}
			onclick={() => (showNewCategoryForm = !showNewCategoryForm)}
		>
			<Plus class="mr-1 h-4 w-4" />
			New category
		</Button>
	</div>

	{#if showNewCategoryForm}
		<form
			method="POST"
			action="?/upsertTechCategory"
			class="border-border bg-background rounded-sm border p-4"
			use:enhance={newCategorySubmitHandler}
		>
			<input type="hidden" name="tech_context_id" value={selectedOrganisationId} />
			<div class="grid gap-3 sm:grid-cols-[minmax(0,1fr),auto] sm:items-end">
				<div class="space-y-2">
					<p class="text-foreground text-sm font-medium">Create category</p>
					<Input name="name" placeholder="Category name" />
				</div>
				<div class="flex gap-2">
					<Button type="button" variant="outline" onclick={() => (showNewCategoryForm = false)}>
						Cancel
					</Button>
					<Button type="submit">Save</Button>
				</div>
			</div>
		</form>
	{/if}

	{#if status === 'loading' && categoryCards.length === 0}
		<p class="text-muted-fg text-sm">Loading global technology catalog...</p>
	{:else if error}
		<p class="text-sm text-red-600">{error}</p>
	{:else}
		<div class="space-y-3" role="list" aria-label="Global technology categories">
			{#each orderedCategoryCards as category (category.id)}
				<div
					role="listitem"
					class={`border-border bg-background rounded-sm border transition ${
						dragOverCategoryId === category.id ? 'border-primary ring-primary/20 ring-2' : ''
					}`}
					ondragover={(event) => {
						if (!draggedCategoryId || draggedCategoryId === category.id) return;
						event.preventDefault();
						dragOverCategoryId = category.id;
					}}
					ondragleave={() => {
						if (dragOverCategoryId === category.id) dragOverCategoryId = null;
					}}
					ondrop={async (event) => {
						event.preventDefault();
						await handleCategoryDrop(category.id);
					}}
				>
					<div class="flex items-center gap-3 px-4 py-4">
						<button
							type="button"
							draggable="true"
							aria-label={`Drag ${category.name}`}
							class="text-muted-fg hover:text-foreground cursor-grab rounded-sm p-1 active:cursor-grabbing"
							ondragstart={(event) => {
								draggedCategoryId = category.id;
								event.dataTransfer?.setData('text/plain', category.id);
							}}
							ondragend={() => {
								draggedCategoryId = null;
								dragOverCategoryId = null;
							}}
						>
							<GripVertical class="h-4 w-4" />
						</button>

						<button
							type="button"
							class="flex min-w-0 flex-1 items-center justify-between gap-4 text-left"
							onclick={() => toggleOpenCategory(category.id)}
						>
							<div class="min-w-0">
								<div class="flex flex-wrap items-center gap-2">
									<p class="text-foreground truncate text-sm font-semibold">{category.name}</p>
									<span
										class="bg-muted text-muted-fg rounded-full px-2 py-0.5 text-[11px] font-medium"
									>
										{category.items.length} techs
									</span>
									{#if !category.isActive}
										<span
											class="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700"
										>
											Hidden
										</span>
									{/if}
								</div>
								<p class="text-muted-fg mt-1 text-xs">
									{category.activeItemCount} active
									{#if category.archivedItemCount > 0}
										• {category.archivedItemCount} archived
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
							<div class="space-y-4">
								<form
									method="POST"
									action="?/upsertTechCategory"
									class="space-y-3"
									use:enhance={createSubmitHandler()}
								>
									<input type="hidden" name="tech_context_id" value={selectedOrganisationId} />
									<input type="hidden" name="category_id" value={category.id} />
									<input
										type="hidden"
										name="next_is_active"
										value={category.isActive ? 'false' : 'true'}
									/>
									<div class="grid gap-3 sm:grid-cols-[minmax(0,1fr),auto] sm:items-end">
										<div class="space-y-2">
											<p class="text-muted-fg text-xs font-semibold uppercase tracking-wide">
												Category
											</p>
											<Input name="name" value={category.name} />
										</div>
										<div class="flex flex-wrap gap-2">
											<Button type="submit" size="sm">
												<Pencil class="mr-1 h-3.5 w-3.5" />
												Save
											</Button>
											<Button
												type="submit"
												variant="outline"
												size="sm"
												formaction="?/setTechCategoryStatus"
												formmethod="POST"
											>
												{#if category.isActive}
													<EyeOff class="mr-1 h-3.5 w-3.5" />
													Hide
												{:else}
													<Eye class="mr-1 h-3.5 w-3.5" />
													Show
												{/if}
											</Button>
										</div>
									</div>
								</form>

								<div class="space-y-3">
									<div class="flex items-center justify-between gap-3">
										<p class="text-foreground text-sm font-medium">Technologies</p>
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
											Add tech
										</Button>
									</div>

									{#if addingItemCategoryId === category.id}
										<form
											method="POST"
											action="?/upsertGlobalTechCatalogItem"
											class="border-border bg-card rounded-sm border p-3"
											use:enhance={createItemSubmitHandler(category.id)}
										>
											<input type="hidden" name="tech_context_id" value={selectedOrganisationId} />
											<input type="hidden" name="category_id" value={category.id} />
											<div
												class="grid gap-3 lg:grid-cols-[minmax(0,1fr),minmax(0,1fr),auto] lg:items-end"
											>
												<div class="space-y-2">
													<p class="text-muted-fg text-xs font-semibold uppercase tracking-wide">
														Name
													</p>
													<Input name="label" placeholder="Technology name" />
												</div>
												<div class="space-y-2">
													<p class="text-muted-fg text-xs font-semibold uppercase tracking-wide">
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
										<div class="space-y-2" role="list" aria-label={`${category.name} technologies`}>
											{#each category.items as item (item.id)}
												<div
													role="listitem"
													class={`border-border bg-card rounded-sm border transition ${
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
																{#if !item.isActive}
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
															<Button
																type="button"
																variant="ghost"
																size="sm"
																onclick={() => toggleExpandedItem(item.id)}
															>
																<Pencil class="mr-1 h-3.5 w-3.5" />
																{expandedItemIds.includes(item.id) ? 'Close' : 'Edit'}
															</Button>
														</div>
													</div>

													{#if expandedItemIds.includes(item.id)}
														<form
															method="POST"
															action="?/upsertGlobalTechCatalogItem"
															class="border-border border-t px-3 py-3"
															use:enhance={editItemSubmitHandler(item.id)}
														>
															<input
																type="hidden"
																name="tech_context_id"
																value={selectedOrganisationId}
															/>
															<input type="hidden" name="item_id" value={item.id} />
															<input type="hidden" name="category_id" value={category.id} />
															<input
																type="hidden"
																name="next_is_active"
																value={item.isActive ? 'false' : 'true'}
															/>
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
																	<Button
																		type="submit"
																		variant="outline"
																		size="sm"
																		formaction="?/setGlobalTechCatalogItemStatus"
																		formmethod="POST"
																	>
																		{item.isActive ? 'Archive' : 'Restore'}
																	</Button>
																</div>
															</div>
														</form>
													{/if}
												</div>
											{/each}
										</div>
									{/if}
								</div>
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</section>
