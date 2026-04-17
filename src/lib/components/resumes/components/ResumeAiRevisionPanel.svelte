<script lang="ts">
	import { Button } from '@pixelcode_/blocks/components';
	import Redo2 from 'lucide-svelte/icons/redo-2';
	import ResumeAiRevisionDiff from './ResumeAiRevisionDiff.svelte';
	import Undo2 from 'lucide-svelte/icons/undo-2';
	import type { ResumeAiDiffField, ResumeAiRevisionState } from './aiRevisions';
	import { hasResumeAiDiffFieldChanges } from './aiRevisions';
	import { fly } from 'svelte/transition';
	import { clickOutside } from '$lib/utils/clickOutside';

	let {
		revisionState = null,
		fields = [],
		busy = false,
		onUndo,
		onRedo
	}: {
		revisionState?: ResumeAiRevisionState<unknown> | null;
		fields?: ResumeAiDiffField[];
		busy?: boolean;
		onUndo?: (() => void) | undefined;
		onRedo?: (() => void) | undefined;
	} = $props();

	const hasChanges = $derived(Boolean(revisionState && revisionState.entries.length > 1));
	const canUndo = $derived(Boolean(revisionState && revisionState.index > 0));
	const canRedo = $derived(
		Boolean(revisionState && revisionState.index < revisionState.entries.length - 1)
	);
	const currentChangeIndex = $derived(revisionState?.index ?? 0);
	const totalChanges = $derived(
		revisionState ? Math.max(revisionState.entries.length - 1, 0) : 0
	);
	const hasDiffContent = $derived(fields.some(hasResumeAiDiffFieldChanges));

	let diffExpanded = $state(false);
	let diffPanel = $state<HTMLDivElement | null>(null);
</script>

{#if hasChanges}
	<div class="pointer-events-none relative w-full">
		{#if diffExpanded && hasDiffContent}
			<div
				bind:this={diffPanel}
				class="pointer-events-auto absolute bottom-full left-0 z-10 mb-3 hidden w-full sm:block"
				transition:fly={{ y: 12, duration: 180, opacity: 0.14 }}
			>
				<ResumeAiRevisionDiff {fields} previousLabel="Before" currentLabel="After" />
			</div>
		{/if}

		<div
			class="pointer-events-auto inline-flex items-center gap-2"
			use:clickOutside={(event) => {
				if (!diffExpanded) return;
				if (diffPanel?.contains(event?.target as Node)) return;
				diffExpanded = false;
			}}
		>
				{#if hasDiffContent}
					<Button
						type="button"
						size="sm"
						variant="ghost"
						class="hidden w-[7.75rem] justify-center px-2 text-xs sm:inline-flex"
						disabled={busy}
						onclick={() => (diffExpanded = !diffExpanded)}
					>
					{diffExpanded ? 'Hide changes' : 'Show changes'}
				</Button>
			{:else}
				<span class="text-muted-fg text-xs font-medium">Changes</span>
			{/if}
			<span class="text-secondary-text text-[11px] font-medium">
				{currentChangeIndex}/{totalChanges}
			</span>
			<div class="ml-1 flex gap-1">
				<Button
					type="button"
					size="sm"
					variant="ghost"
					class="px-2"
					disabled={busy || !canUndo}
					aria-label="Undo change"
					title="Undo change"
					onclick={onUndo}
				>
					<Undo2 class="h-4 w-4" />
				</Button>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					class="px-2"
					disabled={busy || !canRedo}
					aria-label="Redo change"
					title="Redo change"
					onclick={onRedo}
				>
					<Redo2 class="h-4 w-4" />
				</Button>
			</div>
		</div>
	</div>
{/if}
