<script lang="ts">
	import { page } from '$app/stores';
	import { Button } from '@pixelcode_/blocks/components';
	import { TechStackSelector } from '$lib/components';
	import { loadTechCatalog, peekTechCatalogCache } from '$lib/stores/techCatalogStore';
	import X from 'lucide-svelte/icons/x';
	import Plus from 'lucide-svelte/icons/plus';
	import GripVertical from 'lucide-svelte/icons/grip-vertical';
	import type { TechCategory } from '$lib/types/resume';
	import type { EffectiveTechCatalogCategory, TechCatalogScopeMode } from '$lib/types/techCatalog';

	let {
		categories = $bindable([] as TechCategory[]),
		isEditing = false,
		catalogScope = 'auto',
		organisationId = null
	} = $props<{
		categories: TechCategory[];
		isEditing?: boolean;
		catalogScope?: TechCatalogScopeMode;
		organisationId?: string | null;
	}>();

	let catalogCategories = $state<EffectiveTechCatalogCategory[]>([]);
	const fallbackOrganisationId = $derived(
		(($page.data as { effectiveHomeOrganisationId?: string | null } | undefined)
			?.effectiveHomeOrganisationId ?? null) as string | null
	);
	const effectiveCatalogueRequest = $derived.by(() => {
		if (catalogScope === 'global') {
			return { scope: 'global' as const, organisationId: null as string | null };
		}
		if (organisationId?.trim()) {
			return { scope: 'organisation' as const, organisationId: organisationId.trim() };
		}
		return {
			scope: catalogScope,
			organisationId: fallbackOrganisationId
		};
	});
	const effectiveCatalogueKey = $derived(
		`${effectiveCatalogueRequest.scope}:${effectiveCatalogueRequest.organisationId ?? ''}`
	);

	const loadCatalog = async (force = false) => {
		const cached = !force ? peekTechCatalogCache(effectiveCatalogueRequest) : null;
		if (cached) {
			catalogCategories = cached.categories ?? [];
			return;
		}

		try {
			const payload = await loadTechCatalog(effectiveCatalogueRequest, fetch, force);
			catalogCategories = payload.categories ?? [];
		} catch {
			catalogCategories = [];
		}
	};

	$effect(() => {
		effectiveCatalogueKey;
		void loadCatalog();
	});

	$effect(() => {
		if (!isEditing) return;

		const normalizedCategories = categories.map((category: TechCategory) => {
			if (category.id === 'methodologies' || category.name.toLowerCase() === 'methodologies') {
				return { ...category, id: 'methods', name: 'Methods' };
			}
			return category;
		});

		const existingById = new Map<string, TechCategory>(
			normalizedCategories.map((category: TechCategory) => [category.id, category] as const)
		);
		const nextCategories: TechCategory[] = catalogCategories.map((category) => ({
			id: category.id,
			name: category.name,
			skills: [...(existingById.get(category.id)?.skills ?? [])]
		}));
		const knownIds = new Set(nextCategories.map((category: TechCategory) => category.id));
		for (const category of normalizedCategories) {
			if (knownIds.has(category.id)) continue;
			nextCategories.push({
				id: category.id,
				name: category.name,
				skills: [...category.skills]
			});
		}

		if (JSON.stringify(nextCategories) !== JSON.stringify(categories)) {
			categories = nextCategories;
		}
	});

	let draggingItem = $state<{ categoryId: string; index: number } | null>(null);
	let dragOverCategory = $state<string | null>(null);
	let dragOverItemIndex = $state<number | null>(null);

	// State for adding new tech
	let addingToCategory = $state<string | null>(null);

	const handleDragStart = (e: DragEvent, categoryId: string, index: number) => {
		draggingItem = { categoryId, index };
		e.dataTransfer?.setData('text/plain', JSON.stringify({ categoryId, index }));
		e.dataTransfer!.effectAllowed = 'move';
	};

	const handleDragOver = (e: DragEvent, categoryId: string, index?: number) => {
		e.preventDefault();
		dragOverCategory = categoryId;
		dragOverItemIndex = index ?? null;
	};

	const handleDrop = (e: DragEvent, targetCategoryId: string, targetIndex?: number) => {
		e.preventDefault();
		const data = e.dataTransfer?.getData('text/plain');
		if (!data) return;

		const source = JSON.parse(data) as { categoryId: string; index: number };

		// Don't do anything if dropping on itself
		if (source.categoryId === targetCategoryId && source.index === targetIndex) {
			resetDragState();
			return;
		}

		const sourceCategoryIndex = categories.findIndex(
			(c: TechCategory) => c.id === source.categoryId
		);
		const targetCategoryIndex = categories.findIndex(
			(c: TechCategory) => c.id === targetCategoryId
		);

		if (sourceCategoryIndex === -1 || targetCategoryIndex === -1) return;

		// Create shallow copy of categories
		const newCategories = [...categories];

		// Clone source category
		const sourceCategory = { ...newCategories[sourceCategoryIndex] };
		sourceCategory.skills = [...sourceCategory.skills];

		// Remove from source
		const [item] = sourceCategory.skills.splice(source.index, 1);
		newCategories[sourceCategoryIndex] = sourceCategory;

		// Clone target category (might be the same as source if reordering within same category)
		// If same category, use the already cloned one
		const targetCategory =
			sourceCategoryIndex === targetCategoryIndex
				? sourceCategory
				: {
						...newCategories[targetCategoryIndex],
						skills: [...newCategories[targetCategoryIndex].skills]
					};

		// Add to target
		if (targetIndex !== undefined && targetIndex !== null) {
			targetCategory.skills.splice(targetIndex, 0, item);
		} else {
			targetCategory.skills.push(item);
		}

		if (sourceCategoryIndex !== targetCategoryIndex) {
			newCategories[targetCategoryIndex] = targetCategory;
		}

		// Update state
		categories = newCategories;

		resetDragState();
	};

	const resetDragState = () => {
		draggingItem = null;
		dragOverCategory = null;
		dragOverItemIndex = null;
	};

	const removeSkill = (categoryId: string, skillIndex: number) => {
		const categoryIndex = categories.findIndex((c: TechCategory) => c.id === categoryId);
		if (categoryIndex !== -1) {
			const newCategories = [...categories];
			const category = { ...newCategories[categoryIndex] };
			category.skills = category.skills.filter((_: string, i: number) => i !== skillIndex);
			newCategories[categoryIndex] = category;
			categories = newCategories;
		}
	};
</script>

<div class="tech-stack space-y-6 py-4">
	{#each categories as category (category.id)}
		{#if isEditing || category.skills.length > 0}
			<div
				class="flex flex-col gap-2 rounded-lg transition-colors"
				class:p-4={isEditing}
				class:bg-muted={isEditing || dragOverCategory === category.id}
				ondragover={(e) => handleDragOver(e, category.id)}
				ondrop={(e) => handleDrop(e, category.id)}
				role="region"
				aria-label={category.name}
			>
				<h3 class="text-muted-fg text-xs font-semibold uppercase tracking-wide">
					{category.name}
				</h3>

				<div class="flex flex-wrap gap-2">
					{#each category.skills as skill, index}
						<div
							class="border-primary text-primary group relative inline-flex items-center border bg-transparent px-2.5 py-1 text-sm font-medium"
							class:cursor-move={isEditing}
							class:opacity-50={draggingItem?.categoryId === category.id &&
								draggingItem?.index === index}
							draggable={isEditing}
							ondragstart={(e) => handleDragStart(e, category.id, index)}
							ondragover={(e) => handleDragOver(e, category.id, index)}
							ondrop={(e) => handleDrop(e, category.id, index)}
							role="listitem"
						>
							{#if isEditing}
								<GripVertical
									class="text-muted-fg mr-1 h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100"
								/>
							{/if}
							{skill}
							{#if isEditing}
								<button
									class="text-muted-fg hover:bg-muted ml-1 rounded-full p-0.5 opacity-0 hover:text-red-500 group-hover:opacity-100"
									onclick={() => removeSkill(category.id, index)}
								>
									<X class="h-3 w-3" />
								</button>
							{/if}
						</div>
					{/each}

					{#if isEditing}
						{#if addingToCategory === category.id}
							<div class="w-full min-w-[200px] max-w-sm">
								<TechStackSelector
									value={[]}
									{catalogScope}
									{organisationId}
									onchange={(newSkills) => {
										if (newSkills.length > 0) {
											const categoryIndex = categories.findIndex(
												(c: TechCategory) => c.id === category.id
											);
											if (categoryIndex !== -1) {
												const newCategories = [...categories];
												const updatedCategory = { ...newCategories[categoryIndex] };
												updatedCategory.skills = [...updatedCategory.skills, ...newSkills];
												newCategories[categoryIndex] = updatedCategory;
												categories = newCategories;
											}
											addingToCategory = null;
										}
									}}
								/>
								<Button
									variant="ghost"
									size="sm"
									class="text-muted-fg mt-1 h-6 text-xs"
									onclick={() => (addingToCategory = null)}
								>
									Cancel
								</Button>
							</div>
						{:else}
							<button
								class="border-border text-muted-fg hover:bg-muted hover:text-foreground inline-flex items-center rounded-md border border-dashed px-2.5 py-1 text-sm"
								onclick={() => (addingToCategory = category.id)}
							>
								<Plus class="mr-1 h-3 w-3" /> Add
							</button>
						{/if}
					{/if}
				</div>
			</div>
		{/if}
	{/each}
</div>
