<script lang="ts">
	import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-svelte';
	import Drawer from '$lib/components/drawer/drawer.svelte';
	import type { ResumeSearchJob } from '$lib/types/resumes';

	let {
		open = $bindable(false),
		jobs,
		selectedJobId = null,
		onSelectJob
	}: {
		open?: boolean;
		jobs: ResumeSearchJob[];
		selectedJobId?: string | null;
		onSelectJob?: (jobId: string) => void;
	} = $props();

	const statusLabel = (job: ResumeSearchJob) => {
		if (job.status === 'queued') return 'Queued';
		if (job.status === 'processing') return 'Searching';
		if (job.status === 'succeeded') return `${job.result?.items.length ?? 0} results`;
		return 'Failed';
	};

	const formatDate = (value: string | null) => {
		if (!value) return '';
		const date = new Date(value);
		if (!Number.isFinite(date.getTime())) return '';
		return new Intl.DateTimeFormat(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		}).format(date);
	};

	const openJob = (job: ResumeSearchJob) => {
		if (job.status !== 'succeeded' || !job.result) return;
		onSelectJob?.(job.id);
		open = false;
	};
	const getSearchJobTitle = (job: ResumeSearchJob) =>
		job.title || job.result?.title || 'Deep search';
</script>

<Drawer
	bind:open
	variant="right"
	class="w-full sm:w-[26rem] lg:w-[30rem]"
	title="Previous results"
	subtitle="Saved deep-search runs."
>
	{#if jobs.length === 0}
		<div class="text-muted-fg flex min-h-48 items-center justify-center text-sm">
			No deep-search results yet.
		</div>
	{:else}
		<div class="space-y-2">
			{#each jobs as job (job.id)}
				<button
					type="button"
					disabled={job.status !== 'succeeded' || !job.result}
					class="border-border block w-full rounded-sm border p-3 text-left transition-colors {selectedJobId ===
					job.id
						? 'border-primary bg-primary/5'
						: 'bg-card'} {job.status === 'succeeded' && job.result
						? 'hover:border-primary/50 cursor-pointer'
						: 'cursor-default'}"
					onclick={() => openJob(job)}
				>
					<div class="flex items-start gap-2">
						{#if job.status === 'queued' || job.status === 'processing'}
							<Loader2 class="text-primary mt-0.5 h-4 w-4 shrink-0 animate-spin" />
						{:else if job.status === 'succeeded'}
							<CheckCircle2 class="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
						{:else}
							<XCircle class="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
						{/if}
						<div class="min-w-0 flex-1">
							<div class="flex items-start justify-between gap-2">
								<p class="text-foreground line-clamp-2 text-sm font-semibold">
									{getSearchJobTitle(job)}
								</p>
								{#if job.status === 'succeeded' && !job.readAt}
									<span class="mt-1 h-2 w-2 shrink-0 rounded-full bg-red-500"></span>
								{/if}
							</div>
							<p class="text-muted-fg mt-1 text-xs">{statusLabel(job)}</p>
							{#if job.status === 'failed' && job.errorMessage}
								<p class="mt-2 line-clamp-2 text-xs text-red-700">{job.errorMessage}</p>
							{/if}
							{#if formatDate(job.completedAt ?? job.createdAt)}
								<p class="text-muted-fg mt-2 flex items-center gap-1 text-[11px]">
									<Clock class="h-3 w-3" />
									{formatDate(job.completedAt ?? job.createdAt)}
								</p>
							{/if}
						</div>
					</div>
				</button>
			{/each}
		</div>
	{/if}
</Drawer>
