<script lang="ts">
	import { toast } from '@pixelcode_/blocks/components';
	import { invalidateTechCatalogCache, loadTechCatalog } from '$lib/stores/techCatalogStore';
	import type {
		TechCatalogApiResponse,
		TechCatalogManagementCategory,
		TechCatalogManagementItem
	} from '$lib/types/techCatalog';
	import TechCatalogGlobalSection from './TechCatalogGlobalSection.svelte';
	import TechCatalogOrganisationSection from './TechCatalogOrganisationSection.svelte';
	import {
		buildCategoryCards,
		sortCategories,
		type OrganisationOption,
		type TechCatalogLoadStatus,
		type TechCatalogSubmitHandlerFactory
	} from './techCatalogManagerShared';

	let {
		canManageGlobal = false,
		canManageOrganisation = false,
		organisationOptions = [],
		defaultOrganisationId = '',
		formTechContextId = '',
		refreshToken = ''
	}: {
		canManageGlobal?: boolean;
		canManageOrganisation?: boolean;
		organisationOptions?: OrganisationOption[];
		defaultOrganisationId?: string;
		formTechContextId?: string;
		refreshToken?: string;
	} = $props();

	const getTextValue = (value: FormDataEntryValue | null) =>
		typeof value === 'string' ? value.trim() : '';

	const showToast = (kind: 'success' | 'error', message: string) => {
		if (kind === 'error' && typeof toast.error === 'function') {
			toast.error(message);
			return;
		}
		if (kind === 'success' && typeof toast.success === 'function') {
			toast.success(message);
			return;
		}
		toast(message);
	};

	const parseActionResult = async (response: Response) => {
		const payload = (await response.json().catch(() => null)) as {
			message?: unknown;
			ok?: unknown;
			data?: { message?: unknown; ok?: unknown } | null;
		} | null;
		return {
			ok:
				typeof payload?.ok === 'boolean'
					? payload.ok
					: typeof payload?.data?.ok === 'boolean'
						? payload.data.ok
						: response.ok,
			message:
				typeof payload?.message === 'string'
					? payload.message
					: typeof payload?.data?.message === 'string'
						? payload.data.message
						: null
		};
	};

	let selectedOrganisationId = $state(
		formTechContextId || defaultOrganisationId || organisationOptions[0]?.id || ''
	);
	let globalSnapshot = $state<TechCatalogApiResponse | null>(null);
	let globalStatus = $state<TechCatalogLoadStatus>('idle');
	let globalError = $state<string | null>(null);
	let organisationSnapshot = $state<TechCatalogApiResponse | null>(null);
	let organisationStatus = $state<TechCatalogLoadStatus>('idle');
	let organisationError = $state<string | null>(null);
	let reorderPendingKey = $state<string | null>(null);

	const managementCategories = $derived(
		(
			(globalSnapshot?.management?.categories ??
				organisationSnapshot?.management?.categories ??
				[]) as TechCatalogManagementCategory[]
		)
			.slice()
			.sort(sortCategories)
	);
	const globalCategories = $derived(
		(globalSnapshot?.management?.categories ?? []) as TechCatalogManagementCategory[]
	);
	const globalItems = $derived(
		(globalSnapshot?.management?.globalItems ?? []) as TechCatalogManagementItem[]
	);
	const organisationItems = $derived(
		(organisationSnapshot?.management?.organisationItems ?? []) as TechCatalogManagementItem[]
	);

	const globalCategoryCards = $derived.by(() =>
		buildCategoryCards(globalCategories, globalItems, { includeEmpty: true })
	);
	const organisationCategoryCards = $derived.by(() =>
		buildCategoryCards(managementCategories, organisationItems, { includeEmpty: true })
	);

	const loadGlobalSnapshot = async (force = false) => {
		if (!canManageGlobal) return;
		globalStatus = 'loading';
		globalError = null;
		try {
			globalSnapshot = await loadTechCatalog(
				{ scope: 'global', includeManagement: true },
				fetch,
				force
			);
			globalStatus = 'ready';
		} catch (error) {
			globalStatus = 'error';
			globalError =
				error instanceof Error ? error.message : 'Could not load global technology catalog.';
		}
	};

	const loadOrganisationSnapshot = async (force = false) => {
		if (!canManageOrganisation || !selectedOrganisationId) {
			organisationSnapshot = null;
			organisationStatus = 'idle';
			organisationError = null;
			return;
		}
		organisationStatus = 'loading';
		organisationError = null;
		try {
			organisationSnapshot = await loadTechCatalog(
				{
					scope: 'organisation',
					organisationId: selectedOrganisationId,
					includeManagement: true
				},
				fetch,
				force
			);
			organisationStatus = 'ready';
		} catch (error) {
			organisationStatus = 'error';
			organisationError =
				error instanceof Error ? error.message : 'Could not load organisation technology catalog.';
		}
	};

	const reloadSnapshots = async () => {
		invalidateTechCatalogCache();
		await Promise.all([loadGlobalSnapshot(true), loadOrganisationSnapshot(true)]);
	};

	const postAction = async (action: string, formData: FormData) => {
		const response = await fetch(`?/${action}`, {
			method: 'POST',
			body: formData
		});
		const result = await parseActionResult(response);
		if (!response.ok || !result.ok) {
			throw new Error(result.message ?? 'Could not update technology catalog.');
		}
		return result;
	};

	const createSubmitHandler: TechCatalogSubmitHandlerFactory =
		(onSuccess) =>
		async ({ formData }) => {
			const submittedCategoryId = getTextValue(formData.get('category_id'));
			const submittedItemId = getTextValue(formData.get('item_id'));

			return async ({ result }) => {
				if (result.type === 'redirect') {
					window.location.href = result.location;
					return;
				}

				if (result.type === 'error') {
					showToast('error', 'Could not update technology catalog.');
					return;
				}

				const payload =
					result.type === 'success' || result.type === 'failure'
						? ((result.data as {
								type?: unknown;
								message?: unknown;
							} | null) ?? null)
						: null;

				const actionType = typeof payload?.type === 'string' ? payload.type : '';
				const message =
					typeof payload?.message === 'string'
						? payload.message
						: result.type === 'success'
							? 'Technology catalog updated.'
							: 'Could not update technology catalog.';

				if (result.type !== 'success') {
					showToast('error', message);
					return;
				}

				await reloadSnapshots();
				await onSuccess?.({
					actionType,
					submittedCategoryId,
					submittedItemId,
					message
				});
				showToast('success', message);
			};
		};

	const reorderGlobalCategories = async (categoryIds: string[]) => {
		reorderPendingKey = 'global-categories';
		try {
			const formData = new FormData();
			formData.set('tech_context_id', selectedOrganisationId);
			formData.set('category_ids', JSON.stringify(categoryIds));
			const result = await postAction('reorderTechCategories', formData);
			await reloadSnapshots();
			showToast('success', result.message ?? 'Category order updated.');
			return true;
		} catch (error) {
			showToast('error', error instanceof Error ? error.message : 'Could not reorder categories.');
			return false;
		} finally {
			reorderPendingKey = null;
		}
	};

	const reorderGlobalItems = async (categoryId: string, itemIds: string[]) => {
		reorderPendingKey = `global-items:${categoryId}`;
		try {
			const formData = new FormData();
			formData.set('tech_context_id', selectedOrganisationId);
			formData.set('category_id', categoryId);
			formData.set('item_ids', JSON.stringify(itemIds));
			const result = await postAction('reorderGlobalTechCatalogItems', formData);
			await reloadSnapshots();
			showToast('success', result.message ?? 'Technology order updated.');
			return true;
		} catch (error) {
			showToast(
				'error',
				error instanceof Error ? error.message : 'Could not reorder technologies.'
			);
			return false;
		} finally {
			reorderPendingKey = null;
		}
	};

	const reorderOrganisationItems = async (categoryId: string, itemIds: string[]) => {
		if (!selectedOrganisationId) return false;
		reorderPendingKey = `organisation-items:${categoryId}`;
		try {
			const formData = new FormData();
			formData.set('tech_context_id', selectedOrganisationId);
			formData.set('organisation_id', selectedOrganisationId);
			formData.set('category_id', categoryId);
			formData.set('item_ids', JSON.stringify(itemIds));
			const result = await postAction('reorderOrganisationTechCatalogItems', formData);
			await reloadSnapshots();
			showToast('success', result.message ?? 'Organisation catalog order updated.');
			return true;
		} catch (error) {
			showToast(
				'error',
				error instanceof Error
					? error.message
					: 'Could not reorder organisation-specific technologies.'
			);
			return false;
		} finally {
			reorderPendingKey = null;
		}
	};

	$effect(() => {
		if (formTechContextId && formTechContextId !== selectedOrganisationId) {
			selectedOrganisationId = formTechContextId;
		}
	});

	$effect(() => {
		refreshToken;
		void loadGlobalSnapshot(true);
	});

	$effect(() => {
		selectedOrganisationId;
		refreshToken;
		void loadOrganisationSnapshot(true);
	});
</script>

<div class="space-y-6">
	{#if reorderPendingKey}
		<p class="text-muted-fg text-xs">Saving order...</p>
	{/if}

	{#if canManageGlobal}
		<TechCatalogGlobalSection
			{selectedOrganisationId}
			status={globalStatus}
			error={globalError}
			categoryCards={globalCategoryCards}
			{createSubmitHandler}
			onReorderCategories={reorderGlobalCategories}
			onReorderItems={reorderGlobalItems}
		/>
	{/if}

	{#if canManageOrganisation}
		<TechCatalogOrganisationSection
			canSelectOrganisation={canManageGlobal && organisationOptions.length > 1}
			{organisationOptions}
			bind:selectedOrganisationId
			status={organisationStatus}
			error={organisationError}
			categoryCards={organisationCategoryCards}
			{createSubmitHandler}
			onReorderItems={reorderOrganisationItems}
		/>
	{/if}
</div>
