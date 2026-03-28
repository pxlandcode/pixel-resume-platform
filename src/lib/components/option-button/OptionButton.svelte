<script lang="ts">
	import Check from 'lucide-svelte/icons/check';
	import Loader2 from 'lucide-svelte/icons/loader-2';
	import { ripple } from '$lib/utils/ripple';
	import type { Icon as IconType } from 'lucide-svelte';
	import type { ClassNameValue } from 'tailwind-merge';
	import { clsx } from 'clsx';
	import { twMerge } from 'tailwind-merge';
	import {
		optionButtonGroupVariants,
		optionButtonItemVariants,
		type OptionButtonOption,
		type OptionButtonOptionValue,
		type OptionButtonSize,
		type OptionButtonVariant
	} from './index.js';

	function cn(...inputs: ClassNameValue[]) {
		return twMerge(clsx(inputs));
	}

	type Props<T extends OptionButtonOptionValue = string> = {
		id?: string;
		name?: string;
		label?: string;
		hideLabel?: boolean;
		options?: OptionButtonOption<T>[];
		value?: T;
		variant?: OptionButtonVariant;
		size?: OptionButtonSize;
		disabled?: boolean;
		loadingValue?: T | null;
		error?: string;
		labelIcon?: typeof IconType;
		class?: ClassNameValue;
		onchange?: (value: T) => void;
	};

	let {
		id = crypto.randomUUID(),
		name,
		label = '',
		hideLabel = false,
		options = [],
		value = $bindable(),
		variant = 'default',
		size = 'md',
		disabled = false,
		loadingValue = null,
		error = '',
		labelIcon,
		class: className,
		onchange
	}: Props = $props();

	function valuesEqual(a: unknown, b: unknown): boolean {
		if (a === b) return true;
		const na = Number(a);
		const nb = Number(b);
		return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
	}

	function isSelected<T extends OptionButtonOptionValue>(option: OptionButtonOption<T>) {
		return valuesEqual(option.value, value);
	}

	function selectOption<T extends OptionButtonOptionValue>(option: OptionButtonOption<T>) {
		if (disabled || option.disabled) return;
		value = option.value as typeof value;
		if (value !== undefined) {
			onchange?.(value);
		}
	}

	const accessibleLabel = $derived(label || name || 'Option selector');
</script>

<div class={cn('flex w-full flex-col gap-1', className)}>
	{#if label && !hideLabel}
		<div id={`${id}-label`} class="text-muted-fg mb-1 flex items-center gap-2 text-sm font-medium">
			{#if labelIcon}
				{@const Icon = labelIcon}
				<Icon class="size-5" />
			{/if}
			{label}
		</div>
	{/if}

	{#if name}
		<input type="hidden" {name} value={value === undefined ? '' : String(value)} />
	{/if}

	<div
		{id}
		role="radiogroup"
		aria-label={accessibleLabel}
		aria-labelledby={label && !hideLabel ? `${id}-label` : undefined}
		aria-invalid={Boolean(error)}
		class={cn(
			optionButtonGroupVariants({
				variant,
				error: Boolean(error)
			})
		)}
	>
		{#each options as option (String(option.value))}
			{@const selected = isSelected(option)}
			{@const buttonDisabled = disabled || option.disabled === true}
			{@const optionHasDescription = Boolean(option.description)}
			<button
				type="button"
				role="radio"
				aria-checked={selected}
				aria-disabled={buttonDisabled}
				use:ripple
				class={cn(
					optionButtonItemVariants({
						size,
						selected,
						disabled: buttonDisabled,
						described: optionHasDescription
					})
				)}
				disabled={buttonDisabled}
				onclick={() => selectOption(option)}
			>
				<span
					class={cn(
						'relative z-10 min-w-0',
						optionHasDescription
							? 'flex flex-col items-start gap-0.5 text-left'
							: 'flex items-center justify-center gap-2'
					)}
				>
						<span class="flex min-w-0 items-center gap-2">
						{#if valuesEqual(option.value, loadingValue)}
							<Loader2 class="size-4 shrink-0 animate-spin" />
						{:else if option.icon}
							{@const Icon = option.icon}
							<Icon class="size-4 shrink-0" />
						{:else if selected}
							<Check class="size-4 shrink-0" />
						{/if}
						<span class="truncate">{option.label}</span>
					</span>

					{#if optionHasDescription}
						<span
							class={cn(
								'whitespace-normal text-[11px] leading-snug',
								selected ? 'text-primary-fg/80' : 'text-muted-fg'
							)}
						>
							{option.description}
						</span>
					{/if}
				</span>
			</button>
		{/each}
	</div>

	{#if error}
		<p class="text-destructive mt-1 text-sm">{error}</p>
	{/if}
</div>
