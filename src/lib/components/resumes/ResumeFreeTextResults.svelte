<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ViewMode } from '$lib/types/userSettings';
	import ResumeFreeTextMetaColumn from './ResumeFreeTextMetaColumn.svelte';
	import ResumeOrganisationMark from './ResumeOrganisationMark.svelte';
	import ResumeSearchInsights from './ResumeSearchInsights.svelte';
	import ResumeSearchReasons from './ResumeSearchReasons.svelte';
	import ResumeTalentCard from './ResumeTalentCard.svelte';
	import type { FreeTextTalentResult } from './pageShared';
	import { getSearchMatchBadgeClass, getSearchMatchPillClass } from './pageShared';

	let { talents, viewMode } = $props<{
		talents: FreeTextTalentResult[];
		viewMode: ViewMode;
	}>();
</script>

{#if viewMode === 'grid'}
	<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
		{#each talents as talent (talent.id)}
			<ResumeTalentCard
				{talent}
				href={resolve('/resumes/[personId]', { personId: talent.id })}
				overflowVisible
				desktopBadge={{
					label: `${talent.search.matchPercent}%`,
					className: getSearchMatchBadgeClass(talent.search.matchPercent)
				}}
				mobileBadge={{
					label: `${talent.search.matchPercent}%`,
					className: getSearchMatchPillClass(talent.search.matchPercent)
				}}
				showOrganisation={false}
			>
				{#snippet children()}
					{#if talent.organisation_logo_url || talent.organisation_name}
						<div class="mt-3">
							<ResumeOrganisationMark
								organisationLogoUrl={talent.organisation_logo_url}
								organisationName={talent.organisation_name}
								class="h-4"
							/>
						</div>
					{/if}

					<div class="mt-3">
						<ResumeSearchInsights search={talent.search} techMatches={talent.techMatches} />
					</div>
				{/snippet}
			</ResumeTalentCard>
		{/each}
	</div>
{:else}
	<div class="space-y-4">
		{#each talents as talent (talent.id)}
			<a
				href={resolve('/resumes/[personId]', { personId: talent.id })}
				class="border-border bg-card block rounded-none border p-4 transition-shadow hover:shadow-md"
			>
				<div class="grid gap-6 sm:grid-cols-[minmax(17rem,20rem)_minmax(0,1fr)] sm:items-start">
					<ResumeFreeTextMetaColumn {talent} />

					<div class="min-w-0 space-y-3">
						{#if talent.search.reasons.length > 0}
							<ResumeSearchReasons reasons={talent.search.reasons} />
						{/if}
					</div>
				</div>
			</a>
		{/each}
	</div>
{/if}
