<script lang="ts">
	import { resolve } from '$app/paths';
	import { Cell, Row } from '$lib/components/super-list';
	import ConsultantAvailabilityPills from '$lib/components/resumes/ConsultantAvailabilityPills.svelte';
	import type { ViewMode } from '$lib/types/userSettings';
	import ResumeOrganisationMark from './ResumeOrganisationMark.svelte';
	import ResumeTalentCard from './ResumeTalentCard.svelte';
	import ResumeTechMatchBadges from './ResumeTechMatchBadges.svelte';
	import type { TalentGroup } from './pageShared';
	import {
		getMatchBadgeClass,
		getMatchPillClass,
		getTalentName,
		isPerfectMatch
	} from './pageShared';

	let { groups, viewMode } = $props<{
		groups: TalentGroup[];
		viewMode: ViewMode;
	}>();
</script>

<div class="space-y-10">
	{#each groups as group (`${group.metCount}-${group.insufficientCount}`)}
		<section>
			<div class="mb-4 flex items-center gap-3">
				<h2 class="text-foreground text-lg font-semibold">
					{#if isPerfectMatch(group.metCount, group.total, group.insufficientCount)}
						<span class="text-emerald-600">Perfect match</span>
					{:else}
						Partial match
					{/if}
				</h2>
				<span
					class={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${getMatchPillClass(
						group.metCount,
						group.total,
						group.insufficientCount
					)}`}
				>
					{group.metCount}/{group.total} met
					{#if group.insufficientCount > 0}
						<span class="ml-1">+ {group.insufficientCount} close</span>
					{/if}
				</span>
				<span class="text-muted-fg text-sm">
					({group.talents.length} consultant{group.talents.length === 1 ? '' : 's'})
				</span>
			</div>

			{#if viewMode === 'grid'}
				<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each group.talents as talent (talent.id)}
						<ResumeTalentCard
							{talent}
							href={resolve('/resumes/[personId]', { personId: talent.id })}
							highlight={isPerfectMatch(talent.metCount, group.total, talent.insufficientCount)}
							overflowVisible
							desktopBadge={{
								label: `${talent.metCount}/${group.total}`,
								className: getMatchBadgeClass(
									talent.metCount,
									group.total,
									talent.insufficientCount
								)
							}}
							mobileBadge={{
								label: `${talent.metCount}/${group.total}`,
								className: getMatchPillClass(talent.metCount, group.total, talent.insufficientCount)
							}}
						>
							{#snippet children()}
								<div class="mt-3">
									<ResumeTechMatchBadges techMatches={talent.techMatches} />
								</div>
							{/snippet}
						</ResumeTalentCard>
					{/each}
				</div>
			{:else}
				<div class="border-border divide-border divide-y border-x border-b">
					{#each group.talents as talent (talent.id)}
						<Row.Root
							href={resolve('/resumes/[personId]', { personId: talent.id })}
							highlight={isPerfectMatch(talent.metCount, group.total, talent.insufficientCount)}
						>
							<Cell.Value width={6} class="hidden sm:block">
								<Cell.Avatar src={talent.avatar_url} alt={getTalentName(talent)} size={36} />
							</Cell.Value>
							<Cell.Value width={24} class="mobile-fill-cell">
								<div class="flex flex-wrap items-center gap-2">
									<span class="text-foreground truncate text-sm font-semibold">
										{getTalentName(talent)}
									</span>
									<span
										class={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getMatchPillClass(
											talent.metCount,
											group.total,
											talent.insufficientCount
										)}`}
									>
										{talent.metCount}/{group.total}
									</span>
								</div>
							</Cell.Value>
							<Cell.Value width={20} class="mobile-fill-cell">
								<ConsultantAvailabilityPills compact availability={talent.availability ?? null} />
							</Cell.Value>
							<Cell.Value width={30} class="mobile-fill-cell">
								<ResumeTechMatchBadges techMatches={talent.techMatches} />
							</Cell.Value>
							<Cell.Value width={20} class="mobile-logo-cell">
								<ResumeOrganisationMark
									organisationLogoUrl={talent.organisation_logo_url}
									organisationName={talent.organisation_name}
								/>
							</Cell.Value>
						</Row.Root>
					{/each}
				</div>
			{/if}
		</section>
	{/each}
</div>
