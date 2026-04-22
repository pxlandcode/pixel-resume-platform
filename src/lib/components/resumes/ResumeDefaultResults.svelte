<script lang="ts">
	import { resolve } from '$app/paths';
	import { SuperList, ListHandler, Cell, Row } from '$lib/components/super-list';
	import type { SuperListHead } from '$lib/components/super-list';
	import ConsultantAvailabilityPills from '$lib/components/resumes/ConsultantAvailabilityPills.svelte';
	import type { ResumesTalentListItem } from '$lib/types/resumes';
	import type { TalentLabelDefinition } from '$lib/types/talentLabels';
	import type { ViewMode } from '$lib/types/userSettings';
	import { getAvailabilitySortKey } from '$lib/utils/availability';
	import ResumeOrganisationMark from './ResumeOrganisationMark.svelte';
	import ResumeTalentCard from './ResumeTalentCard.svelte';
	import TalentLabelCluster from './TalentLabelCluster.svelte';
	import { getTalentName } from './pageShared';

	type ResumesListRow = {
		id: string;
		name: string;
		avatar_url: string | null;
		availability: ResumesTalentListItem['availability'] | null;
		availability_sort: string;
		organisation_name: string | null;
		organisation_logo_url: string | null;
		labels: ResumesTalentListItem['labels'];
	};

	let {
		talents,
		viewMode,
		searchQuery,
		labelDefinitions = [],
		canManageTalentLabels = false,
		labelMutationByTalentId = {},
		onAssignTalentLabel,
		onRemoveTalentLabel
	} = $props<{
		talents: ResumesTalentListItem[];
		viewMode: ViewMode;
		searchQuery: string;
		labelDefinitions?: TalentLabelDefinition[];
		canManageTalentLabels?: boolean;
		labelMutationByTalentId?: Record<string, boolean>;
		onAssignTalentLabel?: (talentId: string, labelDefinitionId: string) => void;
		onRemoveTalentLabel?: (talentId: string, labelDefinitionId: string) => void;
	}>();

	const resumesListHeadings: SuperListHead<ResumesListRow>[] = [
		{ heading: null, width: 6 },
		{ heading: 'Name', sortable: 'name', filterable: 'name', width: 30 },
		{ heading: 'Availability', sortable: 'availability_sort', width: 26 },
		{ heading: 'Organisation', sortable: 'organisation_name', width: 22 },
		{ heading: 'Labels', width: 16 }
	];

	const matchesNameFilter = (talent: ResumesTalentListItem, rawQuery: string) => {
		const query = rawQuery.trim().toLowerCase();
		if (!query) return true;
		return getTalentName(talent).toLowerCase().includes(query);
	};

	const searchFilteredTalents = $derived.by<ResumesTalentListItem[]>(() =>
		talents.filter((talent: ResumesTalentListItem) => matchesNameFilter(talent, searchQuery))
	);

	const toListRows = (items: ResumesTalentListItem[]): ResumesListRow[] =>
		items.map((talent) => ({
			id: talent.id,
			name: getTalentName(talent),
			avatar_url: talent.avatar_url ?? null,
			availability: talent.availability ?? null,
			availability_sort: getAvailabilitySortKey(talent.availability ?? null),
			organisation_name: talent.organisation_name ?? null,
			organisation_logo_url: talent.organisation_logo_url ?? null,
			labels: talent.labels ?? []
		}));

	const listHandler = $derived.by(() => {
		const handler = new ListHandler<ResumesListRow>(resumesListHeadings, toListRows(talents));
		handler.query = searchQuery;
		return handler;
	});
</script>

{#if viewMode === 'grid'}
	<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
		{#each searchFilteredTalents as talent (talent.id)}
			<ResumeTalentCard
				{talent}
				href={resolve('/resumes/[personId]', { personId: talent.id })}
				overflowVisible
				{labelDefinitions}
				{canManageTalentLabels}
				labelMutationBusy={Boolean(labelMutationByTalentId[talent.id])}
				{onAssignTalentLabel}
				{onRemoveTalentLabel}
			/>
		{/each}
	</div>

	{#if searchQuery && searchFilteredTalents.length === 0}
		<div class="text-muted-fg flex justify-center p-6 text-sm font-medium">
			No results for: {searchQuery}
		</div>
	{/if}
{:else}
	<SuperList instance={listHandler} emptyMessage="No consultants found">
		{#each listHandler.data as row (row.id)}
			<Row.Root href={resolve('/resumes/[personId]', { personId: row.id })}>
				<Cell.Value width={6} class="hidden sm:block">
					<Cell.Avatar src={row.avatar_url} alt={row.name} size={36} />
				</Cell.Value>
				<Cell.Value width={30} class="mobile-fill-cell">
					<span class="text-foreground truncate text-sm font-semibold">{row.name}</span>
				</Cell.Value>
				<Cell.Value width={26} class="mobile-fill-cell">
					<ConsultantAvailabilityPills compact availability={row.availability} />
				</Cell.Value>
				<Cell.Value width={22} class="mobile-logo-cell">
					<ResumeOrganisationMark
						organisationLogoUrl={row.organisation_logo_url}
						organisationName={row.organisation_name}
					/>
				</Cell.Value>
				<Cell.Value width={16} class="mobile-label-cell">
					<TalentLabelCluster
						talentId={row.id}
						labels={row.labels}
						{labelDefinitions}
						canManage={canManageTalentLabels}
						busy={Boolean(labelMutationByTalentId[row.id])}
						menuAlign="right"
						onAssign={onAssignTalentLabel}
						onRemove={onRemoveTalentLabel}
					/>
				</Cell.Value>
			</Row.Root>
		{/each}
	</SuperList>
{/if}
