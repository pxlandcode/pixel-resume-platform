import type { SubmitFunction } from '@sveltejs/kit';
import type {
	TechCatalogManagementCategory,
	TechCatalogManagementItem
} from '$lib/types/techCatalog';

export type OrganisationOption = {
	id: string;
	name: string;
};

export type CategoryCard = TechCatalogManagementCategory & {
	items: TechCatalogManagementItem[];
	activeItemCount: number;
	archivedItemCount: number;
	hiddenItemCount: number;
};

export type TechCatalogSubmitSuccessContext = {
	actionType: string;
	submittedCategoryId: string;
	submittedItemId: string;
	message: string;
};

export type TechCatalogLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export type TechCatalogSubmitHandlerFactory = (
	onSuccess?: (context: TechCatalogSubmitSuccessContext) => void | Promise<void>
) => SubmitFunction;

export const sortCategories = (
	left: TechCatalogManagementCategory,
	right: TechCatalogManagementCategory
) => {
	if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
	return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
};

export const sortItems = (left: TechCatalogManagementItem, right: TechCatalogManagementItem) => {
	if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
	if (left.scope !== right.scope) return left.scope === 'global' ? -1 : 1;
	return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' });
};

export const buildCategoryCards = (
	categories: TechCatalogManagementCategory[],
	items: TechCatalogManagementItem[],
	options?: { includeEmpty?: boolean }
): CategoryCard[] => {
	const itemsByCategoryId = new Map<string, TechCatalogManagementItem[]>();
	for (const item of items) {
		const bucket = itemsByCategoryId.get(item.categoryId) ?? [];
		bucket.push(item);
		itemsByCategoryId.set(item.categoryId, bucket);
	}

	return [...categories]
		.sort(sortCategories)
		.map((category) => {
			const categoryItems = [...(itemsByCategoryId.get(category.id) ?? [])].sort(sortItems);
			return {
				...category,
				items: categoryItems,
				activeItemCount: categoryItems.filter((item) => item.isActive).length,
				archivedItemCount: categoryItems.filter((item) => !item.isActive).length,
				hiddenItemCount: categoryItems.filter((item) => item.excludedByOrganisation).length
			};
		})
		.filter((category) => options?.includeEmpty !== false || category.items.length > 0);
};

export const toggleCollection = (values: string[], value: string) =>
	values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];

export const areStringArraysEqual = (left: string[], right: string[]) =>
	left.length === right.length && left.every((value, index) => value === right[index]);

export const moveWithinList = (values: string[], fromValue: string, toValue: string) => {
	if (fromValue === toValue) return values;
	const fromIndex = values.indexOf(fromValue);
	const toIndex = values.indexOf(toValue);
	if (fromIndex === -1 || toIndex === -1) return values;
	const next = [...values];
	const [moved] = next.splice(fromIndex, 1);
	next.splice(toIndex, 0, moved);
	return next;
};

export const applyOrderedIds = <T extends { id: string }>(
	values: T[],
	orderedIds: string[] | null | undefined
) => {
	if (!orderedIds || orderedIds.length === 0) return values;
	const valuesById = new Map(values.map((value) => [value.id, value] as const));
	const orderedValues: T[] = [];

	for (const id of orderedIds) {
		const value = valuesById.get(id);
		if (!value) continue;
		orderedValues.push(value);
		valuesById.delete(id);
	}

	return [...orderedValues, ...valuesById.values()];
};

export const aliasesPreview = (aliases: string[]) => {
	if (aliases.length === 0) return 'No aliases';
	if (aliases.length <= 3) return aliases.join(', ');
	return `${aliases.slice(0, 3).join(', ')} +${aliases.length - 3}`;
};
