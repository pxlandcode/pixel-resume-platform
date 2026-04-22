<script lang="ts">
	import { Cell } from '$lib/components/super-list';
	import ConsultantAvailabilityPills from '$lib/components/resumes/ConsultantAvailabilityPills.svelte';
	import ResumeOrganisationMark from './ResumeOrganisationMark.svelte';
	import ResumeSearchInsights from './ResumeSearchInsights.svelte';
	import TalentLabelCluster from './TalentLabelCluster.svelte';
	import type { TalentLabelDefinition } from '$lib/types/talentLabels';
	import { tooltip } from '$lib/utils/tooltip';
	import type { FreeTextTalentResult } from './pageShared';
	import {
		getMatchPillClass,
		getSearchMatchPillClass,
		getSearchMatchTooltip,
		getTalentName,
		getTechMatchTooltip
	} from './pageShared';

	let {
		talent,
		labelDefinitions = [],
		canManageTalentLabels = false,
		labelMutationBusy = false,
		onAssignTalentLabel,
		onRemoveTalentLabel
	} = $props<{
		talent: FreeTextTalentResult;
		labelDefinitions?: TalentLabelDefinition[];
		canManageTalentLabels?: boolean;
		labelMutationBusy?: boolean;
		onAssignTalentLabel?: (talentId: string, labelDefinitionId: string) => void;
		onRemoveTalentLabel?: (talentId: string, labelDefinitionId: string) => void;
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
					)} cursor-help`}
					use:tooltip={getSearchMatchTooltip(talent.search)}
				>
					{talent.search.matchPercent}%
				</span>
				{#if talent.total > 0}
					<span
						class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getMatchPillClass(
							talent.metCount,
							talent.total,
							talent.insufficientCount
						)} cursor-help`}
						use:tooltip={getTechMatchTooltip(
							talent.metCount,
							talent.total,
							talent.insufficientCount
						)}
					>
						{talent.metCount}/{talent.total}
					</span>
				{/if}
			</div>

			<div class="mt-1 flex flex-wrap items-start gap-2">
				<div class="min-w-0">
					<ConsultantAvailabilityPills compact availability={talent.availability ?? null} />
				</div>

				<TalentLabelCluster
					talentId={talent.id}
					labels={talent.labels}
					{labelDefinitions}
					canManage={canManageTalentLabels}
					busy={labelMutationBusy}
					class="shrink-0"
					menuAlign="right"
					onAssign={onAssignTalentLabel}
					onRemove={onRemoveTalentLabel}
				/>
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
		<ResumeSearchInsights search={talent.search} techMatches={talent.techMatches} />
	</div>
</div>
