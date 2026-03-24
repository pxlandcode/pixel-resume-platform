<script lang="ts">
	import { TextArea } from '@pixelcode_/blocks/components';
	import { cn } from '@pixelcode_/blocks/utils';
	import { Loader2, Search } from 'lucide-svelte';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { ClassNameValue } from 'tailwind-merge';
	import { clickOutside } from '$lib/utils/clickOutside';
	import {
		resumeFreeTextSearchFieldVariants,
		resumeFreeTextSearchIconVariants,
		resumeFreeTextSearchRootVariants,
		resumeFreeTextSearchTrailingVariants
	} from './index.js';

	type Props = {
		value: string;
		active?: boolean;
		loading?: boolean;
		disabled?: boolean;
		placeholder?: string;
		helperText?: string;
		class?: ClassNameValue;
		oninput?: (value: string) => void;
		oncommit?: (value: string) => void;
		onclear?: () => void;
	};

	let {
		value = '',
		active = false,
		loading = false,
		disabled = false,
		placeholder = 'Search by free text or paste an assignment description...',
		helperText = 'Searches profiles, summaries, assignments, and tech.',
		class: className,
		oninput,
		oncommit,
		onclear
	}: Props = $props();

	let expanded = $state(false);
	let wrapperEl: HTMLDivElement | undefined = $state();

	const showClear = $derived(value.trim().length > 0 || active);

	function expand() {
		if (disabled) return;
		expanded = true;
	}

	function collapse() {
		if (!expanded) return;
		oncommit?.(value);
		expanded = false;
	}

	function handleFocusOut(event: FocusEvent) {
		const nextTarget = event.relatedTarget;
		if (nextTarget instanceof Node && wrapperEl?.contains(nextTarget)) return;
		collapse();
	}

	function handleOutsideClick() {
		collapse();
	}

	function handleInput(event: Event) {
		oninput?.((event.currentTarget as HTMLTextAreaElement).value);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		(event.currentTarget as HTMLTextAreaElement).blur();
		collapse();
	}

	function preventClearMouseDown(event: MouseEvent) {
		event.preventDefault();
	}

	function handleClearClick(event: MouseEvent) {
		event.stopPropagation();
		onclear?.();
		if (expanded) {
			wrapperEl?.querySelector('textarea')?.focus();
		}
	}
</script>

<div
	bind:this={wrapperEl}
	use:clickOutside={handleOutsideClick}
	onfocusout={handleFocusOut}
	class={cn(resumeFreeTextSearchRootVariants(), className)}
>
	<div class="relative">
		<div class={resumeFreeTextSearchIconVariants({ expanded })}>
			<Search class="h-4 w-4 shrink-0" />
		</div>

		<TextArea
			rows={expanded ? 5 : 1}
			{value}
			{disabled}
			class={resumeFreeTextSearchFieldVariants({
				expanded,
				loading
			})}
			{placeholder}
			onfocus={expand}
			oninput={handleInput}
			onkeydown={handleKeydown}
		/>

		<div class={resumeFreeTextSearchTrailingVariants({ expanded })}>
			{#if loading}
				<span class="text-primary flex shrink-0 items-center gap-1 text-xs font-medium">
					<Loader2 class="h-3.5 w-3.5 animate-spin" />
					{#if expanded}Analyzing{/if}
				</span>
			{/if}

			{#if showClear}
				<button
					type="button"
					class="text-muted-fg hover:text-foreground rounded-sm px-1.5 py-0.5 text-xs transition-colors"
					onmousedown={preventClearMouseDown}
					onclick={handleClearClick}
				>
					Clear
				</button>
			{/if}
		</div>
	</div>

	{#if expanded}
		<p transition:slide={{ duration: 180, easing: cubicOut }} class="text-muted-fg text-sm">
			{helperText}
		</p>
	{/if}
</div>
