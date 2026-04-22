<script lang="ts">
	import { cn } from '@pixelcode_/blocks/utils';
	import Plus from 'lucide-svelte/icons/plus';
	import { clickOutside } from '$lib/utils/clickOutside';
	import { tooltip } from '$lib/utils/tooltip';
	import type { TalentLabelDefinition } from '$lib/types/talentLabels';

	type Props = {
		talentId: string;
		labels?: TalentLabelDefinition[];
		labelDefinitions?: TalentLabelDefinition[];
		canManage?: boolean;
		busy?: boolean;
		menuAlign?: 'left' | 'right';
		class?: string;
		onAssign?: (talentId: string, labelDefinitionId: string) => void;
		onRemove?: (talentId: string, labelDefinitionId: string) => void;
	};

	let {
		talentId,
		labels = [],
		labelDefinitions = [],
		canManage = false,
		busy = false,
		menuAlign = 'left',
		class: className,
		onAssign,
		onRemove
	}: Props = $props();

	let menuOpen = $state(false);

	const assignedLabelIds = $derived(new Set(labels.map((label) => label.id)));
	const availableDefinitions = $derived(
		labelDefinitions.filter((definition) => !assignedLabelIds.has(definition.id))
	);

	const stopAnchorNavigation = (event: Event) => {
		event.preventDefault();
		event.stopPropagation();
	};

	const toggleMenu = (event: MouseEvent) => {
		stopAnchorNavigation(event);
		if (!canManage || busy) return;
		menuOpen = !menuOpen;
	};

	const closeMenu = () => {
		menuOpen = false;
	};

	const handleAssign = (event: MouseEvent, labelDefinitionId: string) => {
		stopAnchorNavigation(event);
		menuOpen = false;
		if (!canManage || busy) return;
		onAssign?.(talentId, labelDefinitionId);
	};

	const handleRemove = (event: MouseEvent, labelDefinitionId: string) => {
		stopAnchorNavigation(event);
		if (!canManage || busy) return;
		onRemove?.(talentId, labelDefinitionId);
	};

	const getTooltipTextColor = (hexColor: string) => {
		const normalized = hexColor.trim().replace('#', '');
		if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return '#0f172a';

		const r = Number.parseInt(normalized.slice(0, 2), 16);
		const g = Number.parseInt(normalized.slice(2, 4), 16);
		const b = Number.parseInt(normalized.slice(4, 6), 16);
		const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

		return luminance > 0.62 ? '#0f172a' : '#ffffff';
	};
</script>

{#if labels.length > 0 || canManage}
	<div
		class={cn('label-cluster relative flex items-center', className)}
		data-count={labels.length}
		use:clickOutside={closeMenu}
	>
		{#each labels as label (label.id)}
			{#if canManage}
				<button
					type="button"
					class="label-dot ring-border/20 h-4 w-4 cursor-pointer rounded-full ring-1 transition-transform disabled:cursor-default disabled:opacity-60"
					style={`background-color: ${label.color_hex}; --tooltip-bg: ${label.color_hex}; --tooltip-fg: ${getTooltipTextColor(label.color_hex)};`}
					use:tooltip={{ text: label.name, position: 'top' }}
					onclick={(event) => handleRemove(event, label.id)}
					disabled={busy}
					aria-label={`Remove ${label.name} label`}
				></button>
			{:else}
				<span
					class="label-dot ring-border/20 h-4 w-4 rounded-full ring-1"
					style={`background-color: ${label.color_hex}; --tooltip-bg: ${label.color_hex}; --tooltip-fg: ${getTooltipTextColor(label.color_hex)};`}
					use:tooltip={{ text: label.name, position: 'top' }}
					aria-label={label.name}
				></span>
			{/if}
		{/each}

		{#if canManage}
			<button
				type="button"
				class="label-dot label-add-dot ring-border/20 text-foreground/75 hover:text-foreground flex h-4 w-4 cursor-pointer items-center justify-center rounded-full ring-1 transition-colors disabled:cursor-default disabled:opacity-60"
				class:label-add-dot-open={menuOpen}
				onclick={toggleMenu}
				disabled={busy}
				aria-label="Add label"
				aria-expanded={menuOpen}
			>
				<Plus size={10} strokeWidth={2.5} />
			</button>

			<div class="label-picker" data-open={menuOpen} aria-hidden={!menuOpen}>
				{#each availableDefinitions as definition, index (definition.id)}
					<button
						type="button"
						class="label-dot label-picker-dot ring-border/20 h-4 w-4 cursor-pointer rounded-full ring-1 disabled:cursor-default disabled:opacity-60"
						style={`background-color: ${definition.color_hex}; --tooltip-bg: ${definition.color_hex}; --tooltip-fg: ${getTooltipTextColor(definition.color_hex)}; --picker-delay: ${index * 28}ms;`}
						use:tooltip={{ text: definition.name, position: 'top' }}
						onclick={(event) => handleAssign(event, definition.id)}
						disabled={busy || !menuOpen}
						aria-label={`Assign ${definition.name} label`}
					></button>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.label-cluster {
		--label-overlap: 0.22rem;
	}

	.label-dot {
		position: relative;
		z-index: 1;
		margin-left: calc(var(--label-overlap) * -1);
		transition: transform 140ms ease;
	}

	.label-dot:first-child {
		margin-left: 0;
	}

	.label-dot:hover,
	.label-dot:focus-visible {
		transform: scale(1.1);
		z-index: 20;
	}

	.label-add-dot {
		background-color: var(--color-card);
	}

	.label-add-dot-open {
		transform: rotate(45deg);
		z-index: 20;
	}

	.label-picker {
		display: inline-flex;
		align-items: center;
		gap: 0.18rem;
		margin-left: 0.2rem;
		max-width: 0;
		opacity: 0;
		overflow: hidden;
		transform: translateX(-0.35rem);
		pointer-events: none;
		transition:
			max-width 200ms ease,
			opacity 160ms ease,
			transform 200ms ease;
	}

	.label-picker[data-open='true'] {
		max-width: 14rem;
		opacity: 1;
		transform: translateX(0);
		pointer-events: auto;
	}

	.label-picker-dot {
		margin-left: 0;
		opacity: 0;
		transform: translateX(-0.2rem) scale(0.94);
		transition:
			transform 180ms ease,
			opacity 140ms ease;
		transition-delay: var(--picker-delay, 0ms);
	}

	.label-picker[data-open='true'] .label-picker-dot {
		opacity: 1;
		transform: translateX(0) scale(1);
	}
</style>
