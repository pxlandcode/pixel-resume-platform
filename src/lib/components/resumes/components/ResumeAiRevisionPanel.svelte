<script lang="ts">
	import { Button } from '@pixelcode_/blocks/components';
	import ResumeAiRevisionDiff from './ResumeAiRevisionDiff.svelte';
	import type { ResumeAiDiffField, ResumeAiRevisionState } from './aiRevisions';

	let {
		revisionState = null,
		fields = [],
		busy = false,
		helperText = 'AI revisions stay local until you click Apply changes.',
		onUndo,
		onRedo
	}: {
		revisionState?: ResumeAiRevisionState<unknown> | null;
		fields?: ResumeAiDiffField[];
		busy?: boolean;
		helperText?: string;
		onUndo?: (() => void) | undefined;
		onRedo?: (() => void) | undefined;
	} = $props();

	const canUndo = $derived(Boolean(revisionState && revisionState.index > 0));
	const canRedo = $derived(
		Boolean(revisionState && revisionState.index < revisionState.entries.length - 1)
	);
	const currentLabel = $derived(revisionState?.entries[revisionState.index]?.label ?? 'Original');
	const previousLabel = $derived(
		revisionState && revisionState.index > 0
			? revisionState.entries[revisionState.index - 1]?.label ?? 'Previous'
			: 'Previous'
	);
	const positionLabel = $derived(
		revisionState ? `${revisionState.index + 1}/${revisionState.entries.length}` : '1/1'
	);
</script>

<div class="rounded-xs border border-border bg-muted/60 p-3">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<p class="text-secondary-text text-xs font-semibold uppercase tracking-wide">AI revisions</p>
			<p class="text-muted-fg text-xs">{currentLabel} · {positionLabel}</p>
		</div>
		<div class="flex gap-2">
			<Button type="button" size="sm" variant="ghost" disabled={busy || !canUndo} onclick={onUndo}>
				Undo
			</Button>
			<Button type="button" size="sm" variant="ghost" disabled={busy || !canRedo} onclick={onRedo}>
				Redo
			</Button>
		</div>
	</div>
	<p class="text-muted-fg mt-2 text-xs">{helperText}</p>
</div>

<ResumeAiRevisionDiff {fields} previousLabel={previousLabel} currentLabel={currentLabel} />
