<script lang="ts">
	import { Cell } from '$lib/components/super-list';
	import ConsultantAvailabilityPills from '$lib/components/resumes/ConsultantAvailabilityPills.svelte';
	import ResumeOrganisationMark from './ResumeOrganisationMark.svelte';
	import ResumeSearchInsights from './ResumeSearchInsights.svelte';
	import ResumeTechMatchBadges from './ResumeTechMatchBadges.svelte';
	import type { FreeTextTalentResult } from './pageShared';
	import { getMatchPillClass, getSearchMatchPillClass, getTalentName } from './pageShared';

	let { talent } = $props<{
		talent: FreeTextTalentResult;
	}>();
</script>

<div class="space-y-4 sm:max-w-72">
	<div class="flex items-start gap-3">
		<Cell.Avatar src={talent.avatar_url} alt={getTalentName(talent)} size={52} />

		<div class="min-w-0 flex-1">
			<div class="flex flex-wrap items-center gap-2">
				<h3 class="text-foreground text-sm font-semibold">{getTalentName(talent)}</h3>
				<span
					class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getSearchMatchPillClass(
						talent.search.matchPercent
					)}`}
				>
					{talent.search.matchPercent}%
				</span>
				{#if talent.total > 0}
					<span
						class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getMatchPillClass(
							talent.metCount,
							talent.total,
							talent.insufficientCount
						)}`}
					>
						{talent.metCount}/{talent.total}
					</span>
				{/if}
			</div>

			<div class="mt-1">
				<ConsultantAvailabilityPills compact availability={talent.availability ?? null} />
			</div>
		</div>
	</div>

	{#if talent.organisation_logo_url || talent.organisation_name}
		<div class="pt-1">
			<ResumeOrganisationMark
				organisationLogoUrl={talent.organisation_logo_url}
				organisationName={talent.organisation_name}
				class="h-4"
			/>
		</div>
	{/if}

	<div>
		<ResumeSearchInsights search={talent.search} />
	</div>

	{#if talent.total > 0}
		<div>
			<p class="text-foreground text-[11px] font-semibold uppercase tracking-wide">Selected tech</p>
			<div class="mt-1">
				<ResumeTechMatchBadges techMatches={talent.techMatches} />
			</div>
		</div>
	{/if}
</div>
