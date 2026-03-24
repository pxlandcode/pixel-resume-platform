<script lang="ts">
	import { resolve } from '$app/paths';
	import { ripple } from '$lib/utils/ripple';
	import type { QuickSearchSection } from '$lib/types/quickSearch';
	import type { QuickSearchStatus } from './types';
	import {
		getQuickSearchEmptyMessage,
		getQuickSearchErrorMessage,
		getQuickSearchResultIcon,
		getQuickSearchResultLabel,
		isSearchResultActive
	} from './utils';

	type Props = {
		activePath: string;
		sections?: QuickSearchSection[];
		status: QuickSearchStatus;
		error?: string | null;
		searchTerm: string;
		total?: number;
		visibleCount?: number;
		onselect?: () => void;
	};

	let {
		activePath,
		sections = [],
		status,
		error = null,
		searchTerm,
		total = 0,
		visibleCount = 0,
		onselect
	}: Props = $props();
</script>

{#if status === 'loading' && sections.length === 0}
	<div class="border-border text-muted-fg rounded-sm border border-dashed px-4 py-6 text-sm">
		Searching talents, profiles, resumes, and tech stack...
	</div>
{:else if status === 'error'}
	<div class="border-border rounded-sm border border-dashed px-4 py-6 text-sm text-red-600">
		{getQuickSearchErrorMessage(error)}
	</div>
{:else if sections.length > 0}
	<div class="space-y-4">
		{#if status === 'loading'}
			<p class="text-muted-fg px-1 text-[11px] font-medium uppercase tracking-[0.16em]">
				Updating results
			</p>
		{/if}

		{#each sections as section, sectionIndex (section.id)}
			<section class={sectionIndex > 0 ? 'mt-4' : ''}>
				<div class="mb-3 flex min-h-4 items-center">
					<p class="text-muted-fg text-[11px] font-semibold uppercase tracking-[0.22em]">
						{section.label}
					</p>
				</div>

				<div class="space-y-1.5">
					{#each section.results as result (`${result.kind}:${result.id}`)}
						{@const ResultIcon = getQuickSearchResultIcon(result.kind)}
						<a
							href={resolve(result.href)}
							onclick={() => onselect?.()}
							use:ripple={{ opacity: 0.14 }}
							class={`relative isolate flex items-start gap-3 rounded-sm px-3 py-2.5 transition-colors ${
								isSearchResultActive(result.href, activePath)
									? 'bg-primary/10 text-primary'
									: 'text-secondary-text hover:bg-muted/60 hover:text-foreground'
							}`}
						>
							<div
								class={`relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm ${
									isSearchResultActive(result.href, activePath)
										? 'bg-primary/12 text-primary'
										: 'bg-muted text-muted-fg'
								}`}
							>
								<ResultIcon size={16} />
							</div>

							<div class="relative z-10 min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<p class="truncate text-sm font-semibold">{result.title}</p>
									<span
										class="bg-muted text-muted-fg rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]"
									>
										{getQuickSearchResultLabel(result.kind)}
									</span>
								</div>

								{#if result.description}
									<p class="text-muted-fg mt-1 text-xs leading-5">{result.description}</p>
								{/if}

								{#if result.matchedTechs.length > 0}
									<div class="mt-2 flex flex-wrap gap-1.5">
										{#each result.matchedTechs as tech (tech)}
											<span
												class="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[11px] font-medium"
											>
												{tech}
											</span>
										{/each}
									</div>
								{/if}
							</div>
						</a>
					{/each}
				</div>
			</section>
		{/each}

		{#if total > visibleCount}
			<p class="text-muted-fg px-1 text-xs">Showing {visibleCount} of {total} matches.</p>
		{/if}
	</div>
{:else}
	<div class="border-border text-muted-fg rounded-sm border border-dashed px-4 py-6 text-sm">
		{getQuickSearchEmptyMessage(searchTerm)}
	</div>
{/if}
