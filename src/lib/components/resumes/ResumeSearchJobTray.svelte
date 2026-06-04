<script lang="ts">
	import { Button } from '@pixelcode_/blocks/components';
	import { CheckCircle2, ChevronDown, Loader2, XCircle } from 'lucide-svelte';
	import type { ResumeSearchJob } from '$lib/types/resumes';

	let {
		jobs,
		onOpenResults
	}: {
		jobs: ResumeSearchJob[];
		onOpenResults?: (jobId?: string) => void;
	} = $props();

	let expanded = $state(false);

	const activeJobs = $derived(
		jobs.filter((job) => job.status === 'queued' || job.status === 'processing')
	);
	const visibleJobs = $derived(jobs.slice(0, 5));
	const newestActiveJob = $derived(activeJobs[0] ?? null);
	const shouldShow = $derived(activeJobs.length > 0);

	const statusLabel = (job: ResumeSearchJob) => {
		if (job.status === 'queued') return 'Queued';
		if (job.status === 'processing') return 'Searching';
		if (job.status === 'succeeded') return 'Ready';
		return 'Failed';
	};
	const getSearchJobTitle = (job: ResumeSearchJob) =>
		job.title || job.result?.title || 'Search job';
</script>

{#if shouldShow}
	<div class="border-border bg-card rounded-none border p-3 shadow-sm">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<button
				type="button"
				class="flex min-w-0 flex-1 items-center gap-3 text-left"
				onclick={() => (expanded = !expanded)}
				onmouseenter={() => (expanded = true)}
			>
				<span class="bg-primary/10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
					<Loader2 class="text-primary h-5 w-5 animate-spin" />
				</span>
				<span class="min-w-0">
					<span class="text-foreground block truncate text-sm font-semibold">
						Deep search running
					</span>
					<span class="text-muted-fg block truncate text-xs">
						{newestActiveJob
							? getSearchJobTitle(newestActiveJob)
							: 'Search job'}{activeJobs.length > 1 ? ` + ${activeJobs.length - 1} more` : ''}
					</span>
				</span>
				<ChevronDown class={`h-4 w-4 shrink-0 transition ${expanded ? 'rotate-180' : ''}`} />
			</button>

			<Button type="button" size="sm" variant="outline" onclick={() => onOpenResults?.()}>
				Results
			</Button>
		</div>

		{#if expanded}
			<div class="border-border mt-3 grid gap-2 border-t pt-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each visibleJobs as job (job.id)}
					<button
						type="button"
						class="border-border hover:border-primary/50 flex min-w-0 items-start gap-2 rounded-sm border p-2 text-left transition-colors"
						onclick={() => onOpenResults?.(job.id)}
					>
						{#if job.status === 'queued' || job.status === 'processing'}
							<Loader2 class="text-primary mt-0.5 h-4 w-4 shrink-0 animate-spin" />
						{:else if job.status === 'succeeded'}
							<CheckCircle2 class="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
						{:else}
							<XCircle class="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
						{/if}
						<span class="min-w-0">
							<span class="text-foreground block truncate text-xs font-semibold">
								{getSearchJobTitle(job)}
							</span>
							<span class="text-muted-fg block text-[11px]">{statusLabel(job)}</span>
						</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}
