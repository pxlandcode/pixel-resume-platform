<script lang="ts">
	import type {
		ResumeAiDiffField,
		ResumeAiTextDiffOperation
	} from './aiRevisions';
	import {
		buildResumeAiTextDiffOperations,
		hasResumeAiDiffFieldChanges,
		normalizeResumeAiDiffListValue,
		normalizeResumeAiDiffTextValue
	} from './aiRevisions';

	type ListFieldPresentation = {
		key: string;
		label: string;
		kind: 'list';
		beforeItems: string[];
		afterItems: string[];
		addedItems: string[];
		removedItems: string[];
	};

	type TextFieldPresentation = {
		key: string;
		label: string;
		kind: 'text';
		beforeText: string;
		afterText: string;
		beforeSegments: ResumeAiTextDiffOperation[];
		afterSegments: ResumeAiTextDiffOperation[];
	};

	type FieldPresentation = ListFieldPresentation | TextFieldPresentation;

	let {
		fields = [],
		previousLabel = 'Previous',
		currentLabel = 'Current'
	}: {
		fields?: ResumeAiDiffField[];
		previousLabel?: string;
		currentLabel?: string;
	} = $props();

	const buildFieldPresentation = (field: ResumeAiDiffField): FieldPresentation => {
		if (field.mode === 'list') {
			const beforeItems = normalizeResumeAiDiffListValue(field.before);
			const afterItems = normalizeResumeAiDiffListValue(field.after);
			const beforeKeys = new Set(beforeItems.map((item) => item.toLowerCase()));
			const afterKeys = new Set(afterItems.map((item) => item.toLowerCase()));
			return {
				key: field.key,
				label: field.label,
				kind: 'list',
				beforeItems,
				afterItems,
				addedItems: afterItems.filter((item) => !beforeKeys.has(item.toLowerCase())),
				removedItems: beforeItems.filter((item) => !afterKeys.has(item.toLowerCase()))
			};
		}

		const beforeText = normalizeResumeAiDiffTextValue(field.before, field.mode ?? 'text');
		const afterText = normalizeResumeAiDiffTextValue(field.after, field.mode ?? 'text');
		const operations = buildResumeAiTextDiffOperations(beforeText, afterText);
		return {
			key: field.key,
			label: field.label,
			kind: 'text',
			beforeText,
			afterText,
			beforeSegments: operations.filter((operation) => operation.type !== 'added'),
			afterSegments: operations.filter((operation) => operation.type !== 'removed')
		};
	};

	const changedFields = $derived.by<FieldPresentation[]>(() =>
		fields.filter(hasResumeAiDiffFieldChanges).map(buildFieldPresentation)
	);

	const getTextSegmentClass = (type: ResumeAiTextDiffOperation['type']) => {
		if (type === 'removed') return 'rounded bg-rose-100 text-rose-800';
		if (type === 'added') return 'rounded bg-emerald-100 text-emerald-800';
		return '';
	};

	const getListChipClass = (kind: 'neutral' | 'removed' | 'added') => {
		if (kind === 'removed') return 'border-rose-200 bg-rose-50 text-rose-700';
		if (kind === 'added') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
		return 'border-border bg-card text-secondary-text';
	};
</script>

{#if changedFields.length > 0}
	<div class="rounded-xs border border-border bg-card p-4">
		<div class="mb-4 flex items-center justify-between gap-3">
			<div>
				<p class="text-secondary-text text-xs font-semibold uppercase tracking-wide">Diff</p>
				<p class="text-muted-fg text-xs">Comparing {currentLabel} against {previousLabel}</p>
			</div>
			<span
				class="border-border bg-muted text-secondary-text rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em]"
			>
				{changedFields.length} changed
			</span>
		</div>

		<div class="space-y-3">
			{#each changedFields as field (field.key)}
				<div class="rounded-xs border border-border bg-muted/40 p-3">
					<p class="mb-2 text-sm font-medium text-foreground">{field.label}</p>

					{#if field.kind === 'list'}
						<div class="grid gap-3 md:grid-cols-2">
							<div class="space-y-2">
								<p class="text-muted-fg text-[11px] font-semibold uppercase tracking-wide">
									{previousLabel}
								</p>
								{#if field.beforeItems.length > 0}
									<div class="flex flex-wrap gap-1.5">
										{#each field.beforeItems as item}
											<span
												class={`rounded-full border px-2 py-1 text-xs ${getListChipClass(field.removedItems.some((entry) => entry.toLowerCase() === item.toLowerCase()) ? 'removed' : 'neutral')}`}
											>
												{item}
											</span>
										{/each}
									</div>
								{:else}
									<p class="text-muted-fg text-sm italic">No previous items.</p>
								{/if}
							</div>

							<div class="space-y-2">
								<p class="text-muted-fg text-[11px] font-semibold uppercase tracking-wide">
									{currentLabel}
								</p>
								{#if field.afterItems.length > 0}
									<div class="flex flex-wrap gap-1.5">
										{#each field.afterItems as item}
											<span
												class={`rounded-full border px-2 py-1 text-xs ${getListChipClass(field.addedItems.some((entry) => entry.toLowerCase() === item.toLowerCase()) ? 'added' : 'neutral')}`}
											>
												{item}
											</span>
										{/each}
									</div>
								{:else}
									<p class="text-muted-fg text-sm italic">No current items.</p>
								{/if}
							</div>
						</div>
					{:else}
						<div class="grid gap-3 md:grid-cols-2">
							<div class="space-y-2">
								<p class="text-muted-fg text-[11px] font-semibold uppercase tracking-wide">
									{previousLabel}
								</p>
								<div
									class="rounded-xs border border-border bg-card px-3 py-2 text-sm whitespace-pre-wrap text-secondary-text"
								>
									{#if field.beforeText}
										{#each field.beforeSegments as segment}
											<span class={getTextSegmentClass(segment.type)}>{segment.value}</span>
										{/each}
									{:else}
										<span class="italic text-muted-fg">No previous content.</span>
									{/if}
								</div>
							</div>

							<div class="space-y-2">
								<p class="text-muted-fg text-[11px] font-semibold uppercase tracking-wide">
									{currentLabel}
								</p>
								<div
									class="rounded-xs border border-border bg-card px-3 py-2 text-sm whitespace-pre-wrap text-secondary-text"
								>
									{#if field.afterText}
										{#each field.afterSegments as segment}
											<span class={getTextSegmentClass(segment.type)}>{segment.value}</span>
										{/each}
									{:else}
										<span class="italic text-muted-fg">No current content.</span>
									{/if}
								</div>
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>
{/if}
