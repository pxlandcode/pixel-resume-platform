<script lang="ts">
	import { Button } from '@pixelcode_/blocks/components';
	import { TechStackSelector } from '$lib/components';
	import X from 'lucide-svelte/icons/x';
	import Plus from 'lucide-svelte/icons/plus';
	import GripVertical from 'lucide-svelte/icons/grip-vertical';
	import type { TechCategory } from '$lib/types/resume';

	let { categories = $bindable([]), isEditing = false } = $props<{
		categories: TechCategory[];
		isEditing?: boolean;
	}>();

	// Predefined categories from TechStackSelector
	const PREDEFINED_CATEGORIES = [
		'Frontend',
		'Backend',
		'Database',
		'DevOps',
		'Methods',
		'Architecture',
		'Design',
		'Soft Skills'
	];

	// Ensure all predefined categories exist in the data
	$effect(() => {
		if (isEditing) {
			let hasChanges = false;

			// Normalize legacy "Methodologies" to "Methods"
			const normalizedCategories = categories.map((c) => {
				if (c.id === 'methodologies' || c.name.toLowerCase() === 'methodologies') {
					hasChanges = true;
					return { ...c, id: 'methods', name: 'Methods' };
				}
				return c;
			});

			const existingIds = new Set(normalizedCategories.map((c) => c.id));
			const newCategories = [...normalizedCategories];

			PREDEFINED_CATEGORIES.forEach((catName) => {
				const id = catName.toLowerCase().replace(/\s+/g, '-');
				if (!existingIds.has(id)) {
					newCategories.push({
						id,
						name: catName,
						skills: []
					});
					hasChanges = true;
				}
			});

			if (hasChanges) {
				categories = newCategories;
			}
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

		const sourceCategoryIndex = categories.findIndex((c) => c.id === source.categoryId);
		const targetCategoryIndex = categories.findIndex((c) => c.id === targetCategoryId);

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
		const categoryIndex = categories.findIndex((c) => c.id === categoryId);
		if (categoryIndex !== -1) {
			const newCategories = [...categories];
			const category = { ...newCategories[categoryIndex] };
			category.skills = category.skills.filter((_, i) => i !== skillIndex);
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
				class:bg-slate-50={isEditing}
				class:bg-slate-100={dragOverCategory === category.id}
				ondragover={(e) => handleDragOver(e, category.id)}
				ondrop={(e) => handleDrop(e, category.id)}
				role="region"
				aria-label={category.name}
			>
				<h3 class="text-xs font-semibold tracking-wide text-slate-500 uppercase">
					{category.name}
				</h3>

				<div class="flex flex-wrap gap-2">
					{#each category.skills as skill, index}
						<div
							class="group relative inline-flex items-center border border-primary bg-transparent px-2.5 py-1 text-sm font-medium text-primary"
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
									class="mr-1 h-3 w-3 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100"
								/>
							{/if}
							{skill}
							{#if isEditing}
								<button
									class="ml-1 rounded-full p-0.5 text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-200 hover:text-red-500"
									onclick={() => removeSkill(category.id, index)}
								>
									<X class="h-3 w-3" />
								</button>
							{/if}
						</div>
					{/each}

					{#if isEditing}
						{#if addingToCategory === category.id}
							<div class="w-full max-w-sm min-w-[200px]">
								<TechStackSelector
									value={[]}
									onchange={(newSkills) => {
										if (newSkills.length > 0) {
											const categoryIndex = categories.findIndex((c) => c.id === category.id);
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
									class="mt-1 h-6 text-xs text-slate-500"
									onclick={() => (addingToCategory = null)}
								>
									Cancel
								</Button>
							</div>
						{:else}
							<button
								class="inline-flex items-center rounded-md border border-dashed border-slate-300 px-2.5 py-1 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-700"
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
