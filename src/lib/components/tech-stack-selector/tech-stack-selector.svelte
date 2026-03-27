<script lang="ts">
	import { page } from '$app/stores';
	import ArrowDown from 'lucide-svelte/icons/arrow-down';
	import Check from 'lucide-svelte/icons/check';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import X from 'lucide-svelte/icons/x';
	import { Input } from '@pixelcode_/blocks/components';
	import { loadTechCatalog, peekTechCatalogCache } from '$lib/stores/techCatalogStore';
	import type {
		EffectiveTechCatalogCategory,
		EffectiveTechCatalogItem,
		TechCatalogScopeMode
	} from '$lib/types/techCatalog';

	type Technology = EffectiveTechCatalogItem & {
		category: string;
		categorySortOrder: number;
	};

	let {
		value = $bindable([]),
		showSelectedChips = true,
		onchange,
		catalogScope = 'auto',
		organisationId = null,
		organisationIds = []
	}: {
		value?: string[];
		showSelectedChips?: boolean;
		onchange?: (techs: string[]) => void;
		catalogScope?: TechCatalogScopeMode;
		organisationId?: string | null;
		organisationIds?: string[];
	} = $props();

	let searchTerm = $state('');
	let isOpen = $state(false);
	let activeIndex = $state<number | null>(null);
	let draggingIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);
	let wrapperRef: HTMLElement | null = null;
	let inputRef = $state<HTMLInputElement | undefined>(undefined);
	let catalogStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let catalogError = $state<string | null>(null);
	let catalogCategories = $state<EffectiveTechCatalogCategory[]>([]);

	const fallbackOrganisationId = $derived(
		(($page.data as { effectiveHomeOrganisationId?: string | null } | undefined)
			?.effectiveHomeOrganisationId ?? null) as string | null
	);
	const explicitOrganisationIds = $derived.by(() =>
		Array.from(new Set(organisationIds.map((id) => id.trim()).filter(Boolean)))
	);
	const effectiveCatalogueRequests = $derived.by(() => {
		if (explicitOrganisationIds.length > 1) {
			return explicitOrganisationIds.map((id) => ({
				scope: 'organisation' as const,
				organisationId: id
			}));
		}

		if (explicitOrganisationIds.length === 1) {
			return [
				{
					scope: 'organisation' as const,
					organisationId: explicitOrganisationIds[0]
				}
			];
		}

		const requestedOrganisationId = organisationId?.trim() || fallbackOrganisationId;
		if (catalogScope === 'global') {
			return [{ scope: 'global' as const, organisationId: null as string | null }];
		}
		if (organisationId?.trim()) {
			return [
				{
					scope: 'organisation' as const,
					organisationId: organisationId.trim()
				}
			];
		}
		return [
			{
				scope: catalogScope,
				organisationId: requestedOrganisationId
			}
		];
	});
	const effectiveCatalogueKey = $derived(
		effectiveCatalogueRequests
			.map((request) => `${request.scope}:${request.organisationId ?? ''}`)
			.join('|')
	);

	const sortMergedTechnologies = (left: Technology, right: Technology) => {
		if (left.categorySortOrder !== right.categorySortOrder) {
			return left.categorySortOrder - right.categorySortOrder;
		}
		if (left.category !== right.category) {
			return left.category.localeCompare(right.category, undefined, { sensitivity: 'base' });
		}
		if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
		return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' });
	};

	const mergeCatalogCategories = (
		payloads: Array<{ categories?: EffectiveTechCatalogCategory[] }>
	) => {
		const categoriesById = new Map<
			string,
			Omit<EffectiveTechCatalogCategory, 'items'> & { items: EffectiveTechCatalogCategory['items'] }
		>();
		const seenItemKeys = new Set<string>();

		for (const payload of payloads) {
			for (const category of payload.categories ?? []) {
				if (!categoriesById.has(category.id)) {
					categoriesById.set(category.id, {
						...category,
						items: []
					});
				}

				const targetCategory = categoriesById.get(category.id);
				if (!targetCategory) continue;

				for (const item of category.items ?? []) {
					const dedupeKey = item.normalizedLabel || item.slug || item.id;
					if (!dedupeKey || seenItemKeys.has(dedupeKey)) continue;
					seenItemKeys.add(dedupeKey);
					targetCategory.items.push(item);
				}
			}
		}

		return Array.from(categoriesById.values())
			.map((category) => ({
				...category,
				items: category.items.sort((left, right) => {
					if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
					return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' });
				})
			}))
			.filter((category) => category.items.length > 0)
			.sort((left, right) => {
				if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
				return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
			});
	};

	const catalogTechnologies = $derived.by<Technology[]>(() =>
		catalogCategories.flatMap((category) =>
			category.items.map((item) => ({
				...item,
				category: category.name,
				categorySortOrder: category.sortOrder
			}))
		)
	);

	const matchesSearch = (tech: Technology, term: string) =>
		tech.label.toLowerCase().includes(term) ||
		tech.aliases.some((alias) => alias.toLowerCase().includes(term));

	const filteredTechnologies = $derived.by<Technology[]>(() => {
		const term = searchTerm.trim().toLowerCase();
		const technologies = term
			? catalogTechnologies.filter((tech) => matchesSearch(tech, term))
			: catalogTechnologies;
		return [...technologies].sort(sortMergedTechnologies);
	});

	const groupedOptions = $derived.by<{ category: string; items: Technology[] }[]>(() => {
		const groups = new Map<string, Technology[]>();
		for (const tech of filteredTechnologies) {
			if (!groups.has(tech.category)) {
				groups.set(tech.category, []);
			}
			groups.get(tech.category)!.push(tech);
		}
		return Array.from(groups.entries()).map(([category, items]) => ({ category, items }));
	});

	const valueIncludes = (name: string) =>
		value.some((tech) => tech.toLowerCase() === name.toLowerCase());

	const updateValue = (next: string[]) => {
		value = next;
		onchange?.(next);
	};

	const moveTechnology = (from: number, to: number) => {
		if (from === to || from < 0 || to < 0 || from >= value.length || to >= value.length) return;
		const next = [...value];
		const [item] = next.splice(from, 1);
		next.splice(to, 0, item);
		updateValue(next);
	};

	const addTechnology = (rawName: string) => {
		const trimmed = rawName.trim();
		if (!trimmed) return;

		const normalizedInput = trimmed.toLowerCase();
		const existing = catalogTechnologies.find(
			(tech) =>
				tech.label.toLowerCase() === normalizedInput ||
				tech.aliases.some((alias) => alias.toLowerCase() === normalizedInput)
		);
		const normalized = existing?.label ?? trimmed;

		if (valueIncludes(normalized)) {
			searchTerm = '';
			isOpen = false;
			return;
		}

		updateValue([...value, normalized]);
		searchTerm = '';
		isOpen = false;
	};

	const handleSelect = (name: string) => {
		activeIndex = null;
		addTechnology(name);
		inputRef?.focus();
	};

	const commitFromInput = () => {
		const term = searchTerm.replace(/,$/, '').trim();
		if (!term) return;

		if (activeIndex !== null && filteredTechnologies[activeIndex]) {
			addTechnology(filteredTechnologies[activeIndex].label);
			activeIndex = null;
			return;
		}

		const exactMatch = catalogTechnologies.find(
			(tech) =>
				tech.label.toLowerCase() === term.toLowerCase() ||
				tech.aliases.some((alias) => alias.toLowerCase() === term.toLowerCase())
		);

		if (exactMatch) {
			addTechnology(exactMatch.label);
			return;
		}

		addTechnology(term);
	};

	const handleKeydown = (event: KeyboardEvent) => {
		const hasOptions = filteredTechnologies.length > 0;

		if (event.key === 'Enter' || event.key === ',') {
			event.preventDefault();
			commitFromInput();
			return;
		}

		if (event.key === 'Escape') {
			isOpen = false;
			activeIndex = null;
			return;
		}

		if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) {
			if (!hasOptions) return;
			event.preventDefault();
			isOpen = true;
			activeIndex =
				activeIndex === null ? 0 : Math.min(activeIndex + 1, filteredTechnologies.length - 1);
			return;
		}

		if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
			if (!hasOptions) return;
			event.preventDefault();
			isOpen = true;
			activeIndex =
				activeIndex === null ? filteredTechnologies.length - 1 : Math.max(activeIndex - 1, 0);
		}
	};

	const removeTechnology = (name: string) => {
		if (!valueIncludes(name)) return;
		updateValue(value.filter((tech) => tech.toLowerCase() !== name.toLowerCase()));
	};

	const handleDragStart = (event: DragEvent, index: number) => {
		draggingIndex = index;
		event.dataTransfer?.setData('text/plain', String(index));
	};

	const handleDragOver = (event: DragEvent, index: number) => {
		if (draggingIndex === null || draggingIndex === index) return;
		event.preventDefault();
		dragOverIndex = index;
	};

	const handleDragEnter = (event: DragEvent, index: number) => {
		if (draggingIndex === null || draggingIndex === index) return;
		event.preventDefault();
		dragOverIndex = index;
	};

	const handleDragLeave = (event: DragEvent, index: number) => {
		if (dragOverIndex === index) {
			dragOverIndex = null;
		}
	};

	const handleDrop = (event: DragEvent, index: number) => {
		event.preventDefault();
		if (draggingIndex === null || draggingIndex === index) return;
		moveTechnology(draggingIndex, index);
		draggingIndex = null;
		dragOverIndex = null;
	};

	const handleDragEnd = () => {
		draggingIndex = null;
		dragOverIndex = null;
	};

	const handleClickOutside = (event: MouseEvent) => {
		if (wrapperRef && !wrapperRef.contains(event.target as Node)) {
			isOpen = false;
			activeIndex = null;
		}
	};

	const toggleDropdown = () => {
		isOpen = !isOpen;
		if (isOpen) {
			inputRef?.focus();
		}
		activeIndex = null;
	};

	const loadCatalog = async (force = false) => {
		const cachedPayloads = !force
			? effectiveCatalogueRequests
					.map((request) => peekTechCatalogCache(request))
					.filter((payload) => payload !== null)
			: [];
		if (cachedPayloads.length === effectiveCatalogueRequests.length && cachedPayloads.length > 0) {
			catalogCategories = mergeCatalogCategories(cachedPayloads);
			catalogStatus = 'ready';
			catalogError = null;
			return;
		}

		catalogStatus = 'loading';
		catalogError = null;
		try {
			const payloads = await Promise.all(
				effectiveCatalogueRequests.map((request) => loadTechCatalog(request, fetch, force))
			);
			catalogCategories = mergeCatalogCategories(payloads);
			catalogStatus = 'ready';
		} catch (error) {
			catalogCategories = [];
			catalogStatus = 'error';
			catalogError = error instanceof Error ? error.message : 'Could not load technology catalog.';
		}
	};

	$effect(() => {
		if (!inputRef) return;

		const handleKey = (event: KeyboardEvent) => handleKeydown(event);
		const handleInput = () => {
			isOpen = true;
			activeIndex = null;
		};
		const handleFocus = () => {
			isOpen = true;
			activeIndex = null;
		};

		inputRef.addEventListener('keydown', handleKey);
		inputRef.addEventListener('input', handleInput);
		inputRef.addEventListener('focus', handleFocus);

		return () => {
			inputRef?.removeEventListener('keydown', handleKey);
			inputRef?.removeEventListener('input', handleInput);
			inputRef?.removeEventListener('focus', handleFocus);
		};
	});

	$effect(() => {
		// Reset active option whenever the search term or dropdown state changes
		searchTerm;
		isOpen;
		activeIndex = null;
	});

	$effect(() => {
		effectiveCatalogueKey;
		void loadCatalog();
	});
</script>

<svelte:window on:click={handleClickOutside} />

<div class="space-y-2" bind:this={wrapperRef}>
	{#if showSelectedChips && value.length}
		<div class="flex flex-wrap gap-2">
			{#each value as tech, index (tech.toLowerCase())}
				<span
					class={`bg-muted text-foreground rounded-xs inline-flex cursor-move items-center gap-2 px-3 py-1 text-xs ${
						dragOverIndex === index
							? 'bg-primary/10 ring-primary/60 ring-offset-background ring-2 ring-offset-1'
							: ''
					}`}
					role="listitem"
					aria-grabbed={draggingIndex === index}
					draggable="true"
					ondragstart={(event) => handleDragStart(event, index)}
					ondragover={(event) => handleDragOver(event, index)}
					ondragenter={(event) => handleDragEnter(event, index)}
					ondragleave={(event) => handleDragLeave(event, index)}
					ondrop={(event) => handleDrop(event, index)}
					ondragend={handleDragEnd}
				>
					{tech}
					<button
						type="button"
						aria-label={`Remove ${tech}`}
						class="text-muted-fg hover:bg-muted hover:text-foreground rounded-xs p-1 transition"
						onclick={() => removeTechnology(tech)}
					>
						<X class="h-3 w-3" />
					</button>
				</span>
			{/each}
		</div>
	{/if}

	<div class="relative">
		<Input
			bind:node={inputRef}
			bind:value={searchTerm}
			placeholder="Search or add technologies"
			class="border-border bg-input text-foreground pr-10"
			onclick={() => (isOpen = true)}
		/>
		<button
			type="button"
			aria-label="Toggle technologies"
			class="text-border hover:text-foreground absolute inset-y-0 right-0 flex items-center px-3 transition"
			onclick={toggleDropdown}
		>
			<ChevronDown class={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
		</button>

		{#if isOpen}
			<div
				class="bg-card absolute z-40 mt-2 max-h-72 w-full overflow-hidden rounded-md border shadow-md shadow-black/5"
			>
				{#if groupedOptions.length}
					<div class="max-h-72 overflow-y-auto">
						{#each groupedOptions as group, index (group.category)}
							<div
								class={`border-border/80 ${index < groupedOptions.length - 1 ? 'border-b' : ''}`}
							>
								<div
									class="bg-muted text-foreground/70 flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide"
								>
									<ArrowDown class="h-3.5 w-3.5 shrink-0 opacity-60" />
									{group.category}
								</div>
								<div class="flex flex-col">
									{#each group.items as tech}
										{@const optionIndex = filteredTechnologies.findIndex(
											(item) => item.id === tech.id
										)}
										{@const isActive = activeIndex === optionIndex}
										<button
											type="button"
											class={`hover:bg-primary/10 flex w-full items-center justify-between px-3 py-2 text-left text-sm transition ${
												isActive ? 'bg-primary/10 text-primary' : ''
											}`}
											onclick={() => handleSelect(tech.label)}
										>
											<span class="truncate">{tech.label}</span>
											{#if valueIncludes(tech.label)}
												<Check class="text-primary h-4 w-4" />
											{/if}
										</button>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div class="text-muted-fg px-3 py-3 text-sm">
						{#if catalogStatus === 'loading' && !searchTerm.trim()}
							Loading technologies...
						{:else if catalogStatus === 'error' && !searchTerm.trim()}
							{catalogError ?? 'Could not load technology catalog.'}
						{:else if searchTerm.trim()}
							Press Enter to add "{searchTerm.trim()}"
						{:else}
							Start typing to search technologies
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
