<script lang="ts">
	import { clickOutside } from '$lib/utils/clickOutside';
	import { Checkbox } from '@pixelcode_/blocks/components';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import type { Icon as IconType } from 'lucide-svelte';
	import type { ClassNameValue } from 'tailwind-merge';
	import { clsx } from 'clsx';
	import { twMerge } from 'tailwind-merge';
	import {
		dropdownButtonVariants,
		dropdownListVariants,
		type DropdownCheckboxOption,
		type DropdownVariant,
		type DropdownSize,
		type DropdownPosition
	} from './index.js';

	function cn(...inputs: ClassNameValue[]) {
		return twMerge(clsx(inputs));
	}

	type Props<T = string> = {
		id?: string;
		name?: string;
		label?: string;
		placeholder?: string;
		options?: DropdownCheckboxOption<T>[];
		selectedValues?: T[];
		disabled?: boolean;
		variant?: DropdownVariant;
		size?: DropdownSize;
		search?: boolean;
		searchPlaceholder?: string;
		maxSuggestions?: number;
		infiniteScroll?: boolean;
		openPosition?: DropdownPosition | null;
		hideLabel?: boolean;
		error?: string;
		labelIcon?: typeof IconType;
		class?: ClassNameValue;
		onchange?: (selected: T[]) => void;
	};

	let {
		id = crypto.randomUUID(),
		name,
		label = '',
		placeholder = 'Select options',
		options = [],
		selectedValues = $bindable([]),
		disabled = false,
		variant = 'default',
		size = 'md',
		search = false,
		searchPlaceholder = 'Search...',
		maxSuggestions = 50,
		infiniteScroll = false,
		openPosition = null,
		hideLabel = false,
		error = '',
		labelIcon,
		class: className,
		onchange
	}: Props = $props();

	let open = $state(false);
	let dropdownPosition = $state<'up' | 'down'>('down');
	let activeIndex = $state(-1);
	let searchQuery = $state('');
	let currentMaxSuggestions = $state(maxSuggestions);
	let listElement: HTMLUListElement | undefined = $state();

	// Helper: is option an object with label/value?
	function isObjectOption<T>(
		option: DropdownCheckboxOption<T>
	): option is { label: string; value: T } {
		return typeof option === 'object' && option !== null && 'label' in option && 'value' in option;
	}

	// Values equality check (handles string/number comparison)
	function valuesEqual(a: unknown, b: unknown): boolean {
		if (a === b) return true;
		const na = Number(a);
		const nb = Number(b);
		return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
	}

	// Get option value
	function getOptionValue<T>(option: DropdownCheckboxOption<T>): T | string {
		return isObjectOption(option) ? option.value : option;
	}

	// Get option label
	function getOptionLabel<T>(option: DropdownCheckboxOption<T>): string {
		return isObjectOption(option) ? option.label : option;
	}

	// Check if a value is selected
	function isSelected(optionValue: unknown): boolean {
		return selectedValues.some((v) => valuesEqual(v, optionValue));
	}

	// Filtered options based on search
	const filteredOptions = $derived(
		options
			.filter((option) => {
				const optionLabel = getOptionLabel(option).toLowerCase();
				return optionLabel.includes(searchQuery.toLowerCase());
			})
			.slice(0, currentMaxSuggestions)
	);

	// Display text for the button
	const displayText = $derived(
		selectedValues.length > 0 ? `${selectedValues.length} selected` : placeholder
	);

	// Toggle a checkbox value
	function toggleValue(optionValue: unknown) {
		const val = optionValue as (typeof selectedValues)[number];
		const alreadySelected = isSelected(val);

		selectedValues = alreadySelected
			? selectedValues.filter((v) => !valuesEqual(v, val))
			: [...selectedValues, val];

		onchange?.(selectedValues);
	}

	// Toggle dropdown
	function toggleDropdown(event: MouseEvent) {
		if (disabled) return;
		event.stopPropagation();

		const buttonEl = event.currentTarget as HTMLElement;
		const rect = buttonEl.getBoundingClientRect();
		const spaceBelow = window.innerHeight - rect.bottom;
		const spaceAbove = rect.top;

		if (openPosition) {
			dropdownPosition = openPosition;
		} else {
			dropdownPosition = spaceBelow < 250 && spaceAbove > spaceBelow ? 'up' : 'down';
		}

		currentMaxSuggestions = maxSuggestions;
		searchQuery = '';
		open = !open;
		activeIndex = -1;
	}

	// Close dropdown
	function closeDropdown() {
		open = false;
		activeIndex = -1;
		searchQuery = '';
	}

	// Handle keyboard navigation
	function handleKeydown(event: KeyboardEvent) {
		if (!open) return;

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			activeIndex = (activeIndex + 1) % filteredOptions.length;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			activeIndex = (activeIndex - 1 + filteredOptions.length) % filteredOptions.length;
		} else if (event.key === 'Enter' && activeIndex >= 0) {
			event.preventDefault();
			const option = filteredOptions[activeIndex];
			if (option) toggleValue(getOptionValue(option));
		} else if (event.key === 'Escape') {
			closeDropdown();
		}
	}

	// Handle infinite scroll
	function handleScroll() {
		if (!infiniteScroll || !listElement) return;

		const { scrollTop, scrollHeight, clientHeight } = listElement;
		const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

		if (distanceFromBottom <= 5 && currentMaxSuggestions < options.length) {
			currentMaxSuggestions += 20;
		}
	}
</script>

<div class={cn('relative flex w-full flex-col gap-1', className)} use:clickOutside={closeDropdown}>
	{#if label && !hideLabel}
		<label for={id} class="text-muted-fg mb-1 flex items-center gap-2 text-sm font-medium">
			{#if labelIcon}
				{@const Icon = labelIcon}
				<Icon class="size-5" />
			{/if}
			{label}
		</label>
	{/if}

	<!-- Dropdown Button -->
	<button
		type="button"
		{id}
		class={cn(
			dropdownButtonVariants({
				variant,
				size,
				open,
				error: Boolean(error)
			})
		)}
		onclick={toggleDropdown}
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-label={label}
		{disabled}
		aria-disabled={disabled}
	>
		<span class="truncate">{displayText}</span>
		<ChevronDown
			class={cn(
				'text-muted-fg size-4 shrink-0 transition-transform duration-200',
				open && 'rotate-180'
			)}
		/>
	</button>

	<!-- Error Message -->
	{#if error}
		<p class="text-destructive mt-1 text-sm">{error}</p>
	{/if}

	<!-- Dropdown List -->
	{#if open && options.length > 0}
		<ul
			bind:this={listElement}
			class={cn(dropdownListVariants({ position: dropdownPosition }))}
			role="listbox"
			aria-multiselectable="true"
			onkeydown={handleKeydown}
			onscroll={handleScroll}
			aria-labelledby={id}
			tabindex="-1"
		>
			{#if search && options.length > 5}
				<li class="border-border border-b p-2">
					<input
						type="text"
						class="bg-input border-border text-foreground placeholder:text-muted-fg w-full rounded-sm border px-3 py-2 text-sm focus:outline-none"
						placeholder={searchPlaceholder}
						bind:value={searchQuery}
						onkeydown={handleKeydown}
					/>
				</li>
			{/if}

			{#each filteredOptions as option, i}
				{@const optionValue = getOptionValue(option)}
				{@const optionLabel = getOptionLabel(option)}
				{@const checked = isSelected(optionValue)}

				<li
					role="option"
					aria-selected={checked}
					tabindex="0"
					class={cn(
						'hover:bg-muted flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-sm transition-colors',
						i === activeIndex && 'bg-muted',
						checked && 'bg-muted/50'
					)}
					onclick={() => toggleValue(optionValue)}
					onkeydown={(e: KeyboardEvent) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							toggleValue(optionValue);
						}
					}}
				>
					<Checkbox
						{checked}
						size="sm"
						onclick={(e: Event) => {
							e.stopPropagation();
							toggleValue(optionValue);
						}}
					/>
					<span class="pointer-events-none select-none">{optionLabel}</span>
				</li>
			{/each}

			{#if filteredOptions.length === 0}
				<li class="text-muted-fg px-3 py-2 text-sm">No results found</li>
			{/if}
		</ul>
	{/if}
</div>
