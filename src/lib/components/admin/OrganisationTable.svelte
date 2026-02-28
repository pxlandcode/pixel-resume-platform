<script lang="ts">
	import {
		Button,
		Card,
		SuperTable,
		TableHandler,
		Row,
		Cell,
		type SuperTableHead
	} from '@pixelcode_/blocks/components';
	import { Globe, Settings, Palette, Users } from 'lucide-svelte';

	type OrganisationRow = {
		id: string;
		name: string;
		slug: string;
		homepage_url: string | null;
		brand_settings: Record<string, unknown> | null;
		created_at: string | null;
		updated_at: string | null;
	};

	export let organisations: OrganisationRow[] = [];
	export let onEditDetails: (organisation: OrganisationRow) => void;
	export let onEditBranding: (organisation: OrganisationRow) => void;
	export let onEditMembership: (organisation: OrganisationRow) => void;

	type TableRow = OrganisationRow & {
		source: OrganisationRow;
		displayName: string;
	};

	const headings: SuperTableHead<TableRow>[] = [
		{ heading: 'Organisation', sortable: 'displayName', width: 32 },
		{ heading: 'Slug', width: 16 },
		{ heading: 'Homepage', width: 20 },
		{ heading: 'Actions', width: 32 }
	];

	const toRows = (items: OrganisationRow[]): TableRow[] =>
		items.map((org) => ({
			...org,
			source: org,
			displayName: org.name || 'Unnamed Organisation'
		}));

	let tableRows: TableRow[] = toRows(organisations);
	let tableInstance = new TableHandler<TableRow>(
		headings,
		tableRows.map((row) => ({ ...row }))
	);

	$: tableRows = toRows(organisations);
	$: tableInstance = new TableHandler<TableRow>(
		headings,
		tableRows.map((row) => ({ ...row }))
	);
</script>

<Card class="border-border/20 space-y-4 bg-white p-4">
	<SuperTable instance={tableInstance} selectable={false} class="organisation-table w-full">
		{#each tableInstance.data as row (row.id)}
			<Row.Root>
				<Cell.Value class="py-4 align-top">
					<p class="text-sm font-semibold text-gray-900">{row.displayName}</p>
				</Cell.Value>

				<Cell.Value class="py-4 align-top">
					<span class="font-mono text-sm text-gray-600">{row.slug}</span>
				</Cell.Value>

				<Cell.Value class="py-4 align-top">
					{#if row.homepage_url}
						<a
							href={row.homepage_url}
							target="_blank"
							rel="noopener noreferrer"
							class="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 hover:underline"
						>
							<Globe size={14} />
							<span class="max-w-[180px] truncate">{row.homepage_url}</span>
						</a>
					{:else}
						<span class="text-xs text-gray-400">Not set</span>
					{/if}
				</Cell.Value>

				<Cell.Value class="py-4 align-top">
					<div class="flex justify-end gap-2">
						<Button
							variant="outline"
							size="sm"
							type="button"
							onclick={() => onEditDetails?.(row.source)}
							class="gap-1.5"
						>
							<Settings size={14} />
							Details
						</Button>
						<Button
							variant="outline"
							size="sm"
							type="button"
							onclick={() => onEditBranding?.(row.source)}
							class="gap-1.5"
						>
							<Palette size={14} />
							Branding
						</Button>
						<Button
							variant="outline"
							size="sm"
							type="button"
							onclick={() => onEditMembership?.(row.source)}
							class="gap-1.5"
						>
							<Users size={14} />
							Access
						</Button>
					</div>
				</Cell.Value>
			</Row.Root>
		{/each}
	</SuperTable>

	{#if organisations.length === 0}
		<p class="text-sm font-medium text-gray-700">
			No organisations yet. Create your first organisation to get started.
		</p>
	{/if}
</Card>

<style>
	.organisation-table .flex.justify-center.p-2.text-sm.font-semibold {
		display: none;
	}

	.organisation-table :global(tr) {
		border-bottom: 1px solid #e2e8f0;
		transition: background-color 0.15s ease;
	}

	.organisation-table :global(tr:last-child) {
		border-bottom: none;
	}

	.organisation-table :global(tr:hover) {
		background-color: #f8fafc;
	}

	.organisation-table :global(td) {
		padding-top: 1rem;
		padding-bottom: 1rem;
	}
</style>
