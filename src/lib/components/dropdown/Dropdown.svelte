<script lang="ts">
	import { clickOutside } from '$lib/utils/clickOutside';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import type { Icon as IconType } from 'lucide-svelte';
	import type { ClassNameValue } from 'tailwind-merge';
	import { clsx } from 'clsx';
	import { twMerge } from 'tailwind-merge';
	import {
		dropdownButtonVariants,
		dropdownListVariants,
		dropdownItemVariants,
		type DropdownOption,
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
		options?: DropdownOption<T>[];
		disabled?: boolean;
		variant?: DropdownVariant;
		size?: DropdownSize;
		value?: T;
		search?: boolean;
		searchPlaceholder?: string;
		maxSuggestions?: number;
		infiniteScroll?: boolean;
		openPosition?: DropdownPosition | null;
		hideLabel?: boolean;
		error?: string;
		labelIcon?: typeof IconType;
		class?: ClassNameValue;
		onchange?: (value: T) => void;
	};

	let {
		id = crypto.randomUUID(),
		name,
		label = '',
		placeholder = 'Select an option',
		options = [],
		disabled = false,
		variant = 'default',
		size = 'md',
		value = $bindable(),
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

	// Helper to check if option is an object
	function isObjectOption<T>(
		option: DropdownOption<T>
	): option is { label: string; value: T; unavailable?: boolean } {
		return typeof option === 'object' && option !== null && 'label' in option && 'value' in option;
	}

	// Values equality check (handles string/number comparison)
	function valuesEqual(a: unknown, b: unknown): boolean {
		if (a === b) return true;
		const na = Number(a);
		const nb = Number(b);
		return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
	}

	// Get label for a value
	function getLabel(val: unknown): string {
		const option = options.find((opt) =>
			isObjectOption(opt) ? valuesEqual(opt.value, val) : valuesEqual(opt, val)
		);
		if (!option) return placeholder;
		return isObjectOption(option) ? option.label : (option as string);
	}

	// Get option value
	function getOptionValue<T>(option: DropdownOption<T>): T | string {
		return isObjectOption(option) ? option.value : option;
	}

	// Get option label
	function getOptionLabel<T>(option: DropdownOption<T>): string {
		return isObjectOption(option) ? option.label : option;
	}

	// Check if option is unavailable
	function isOptionUnavailable<T>(option: DropdownOption<T>): boolean {
		return isObjectOption(option) && option.unavailable === true;
	}

	// Get icons for an option
	function getOptionIcons(option: DropdownOption): { icon: typeof IconType; size: number }[] {
		if (!isObjectOption(option)) return [];

		const iconSize = option.iconSize ?? 14;

		if (Array.isArray(option.icons)) {
			return option.icons
				.map((entry) => {
					if (!entry) return null;
					if (typeof entry === 'function')
						return { icon: entry as typeof IconType, size: iconSize };
					if (typeof entry === 'object' && 'icon' in entry) {
						return { icon: entry.icon, size: entry.size ?? iconSize };
					}
					return null;
				})
				.filter((item): item is { icon: typeof IconType; size: number } => Boolean(item));
		}

		if (option.icon) return [{ icon: option.icon, size: iconSize }];

		return [];
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

	// Selected option
	const selectedOption = $derived(
		options.find((opt) =>
			isObjectOption(opt) ? valuesEqual(opt.value, value) : valuesEqual(opt, value)
		)
	);

	// Is selected value unavailable
	const isSelectedUnavailable = $derived(
		selectedOption ? isOptionUnavailable(selectedOption) : false
	);

	// Icons for selected option
	const selectedIcons = $derived(selectedOption ? getOptionIcons(selectedOption) : []);

	// Select an option
	function selectOption(option: DropdownOption) {
		const newValue = getOptionValue(option);
		value = newValue as typeof value;
		open = false;
		activeIndex = -1;
		searchQuery = '';
		if (value !== undefined) {
			onchange?.(value);
		}
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
			selectOption(filteredOptions[activeIndex]);
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

	<!-- Hidden input for form submission -->
	{#if name}
		<input type="hidden" {name} value={value ?? ''} />
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
		<div class="flex min-w-0 items-center gap-2">
			<span class={cn('truncate', isSelectedUnavailable && 'text-destructive')}>
				{getLabel(value)}
			</span>
			{#if selectedIcons.length > 0}
				<div class="flex shrink-0 items-center gap-1">
					{#each selectedIcons as iconDef}
						{@const Icon = iconDef.icon}
						<Icon size={iconDef.size} />
					{/each}
				</div>
			{/if}
		</div>
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
			onkeydown={handleKeydown}
			onscroll={handleScroll}
			aria-labelledby={id}
			tabindex="-1"
		>
			{#if search}
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
				{@const isUnavailable = isOptionUnavailable(option)}
				{@const optionIcons = getOptionIcons(option)}
				{@const isSelected = valuesEqual(optionValue, value)}

				<li role="option" aria-selected={isSelected}>
					<button
						type="button"
						class={cn(
							dropdownItemVariants({
								active: i === activeIndex,
								unavailable: isUnavailable,
								selected: isSelected
							})
						)}
						onclick={() => selectOption(option)}
						aria-label={optionLabel}
					>
						<span>{optionLabel}</span>
						{#if optionIcons.length > 0}
							<div class="flex items-center gap-1">
								{#each optionIcons as iconDef}
									{@const Icon = iconDef.icon}
									<Icon size={iconDef.size} />
								{/each}
							</div>
						{/if}
					</button>
				</li>
			{/each}

			{#if filteredOptions.length === 0}
				<li class="text-muted-fg px-3 py-2 text-sm">No results found</li>
			{/if}
		</ul>
	{/if}
</div>
