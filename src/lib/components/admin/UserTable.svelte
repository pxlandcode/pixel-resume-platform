<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		Card,
		SuperTable,
		TableHandler,
		Row,
		Cell,
		type SuperTableHead
	} from '@pixelcode_/blocks/components';
	type Role = 'admin' | 'broker' | 'talent' | 'employer' | string;

	type UserRow = {
		id: string;
		first_name: string | null;
		last_name: string | null;
		email: string | null;
		avatar_url: string | null;
		active: boolean;
		roles: Role[];
		linked_talent_id?: string | null;
		organisation_name?: string | null;
	};

	type UserTableFormData = {
		type?: string;
		ok?: boolean;
		message?: string;
	};

	export let users: UserRow[] = [];
	export let form: UserTableFormData | null = null;
	export let onEdit: (user: UserRow) => void;
	export let showEdit = true;

	type TableRow = UserRow & {
		source: UserRow;
		fullName: string;
		roleLabel: string;
		emailText: string;
		organisationLabel: string;
	};

	const headings: SuperTableHead<TableRow>[] = [
		{ heading: 'Name', sortable: 'fullName', width: 32 },
		{ heading: 'Organisation', sortable: 'organisationLabel', width: 22 },
		{ heading: 'Roles', sortable: 'roleLabel', width: 22 },
		{ heading: 'Status', width: 10 },
		{ heading: 'Actions', width: 8 }
	];

	const toRows = (items: UserRow[]): TableRow[] =>
		items.map((user) => {
			const fullName =
				[user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || 'Unknown';

			const emailText = user.email ?? 'Email not provided';
			const roleLabel = user.roles?.length ? user.roles.join(', ') : 'talent';
			const organisationLabel = user.organisation_name?.trim() || 'Unassigned';

			return {
				...user,
				source: user,
				fullName,
				roleLabel,
				emailText,
				organisationLabel
			};
		});

	let tableRows: TableRow[] = toRows(users);
	let tableInstance = new TableHandler<TableRow>(
		headings,
		tableRows.map((row) => ({ ...row }))
	);

	$: tableRows = toRows(users);
	$: tableInstance = new TableHandler<TableRow>(
		headings,
		tableRows.map((row) => ({ ...row }))
	);
</script>

<Card class="border-border/20 bg-card space-y-4 p-4">
	<SuperTable instance={tableInstance} selectable={false} class="user-table w-full">
		{#each tableInstance.data as row (row.id)}
			<Row.Root>
				<Cell.Value class="py-4 align-top">
					<div class="flex gap-3">
						{#if row.avatar_url}
							<img
								src={row.avatar_url}
								alt={row.fullName}
								class="h-10 w-10 rounded-full object-cover"
							/>
						{:else}
							<div class="bg-muted h-10 w-10 rounded-full" />
						{/if}
						<div class="space-y-1">
							<div>
								<p class="text-foreground text-sm font-semibold">{row.fullName}</p>
								<p class="text-muted-fg text-xs font-medium">{row.emailText}</p>
							</div>
						</div>
					</div>
				</Cell.Value>

				<Cell.Value class="py-4 align-top">
					<p class="text-foreground text-sm font-medium">{row.organisationLabel}</p>
				</Cell.Value>

				<Cell.Value class="py-4 align-top">
					<div class="flex flex-wrap gap-2">
						{#each row.roles as role (role)}
							<Badge variant="default" size="xs" class="uppercase tracking-wide">
								{role.replace('_', ' ')}
							</Badge>
						{:else}
							<Badge variant="default" size="xs" class="uppercase tracking-wide">talent</Badge>
						{/each}
					</div>
				</Cell.Value>

				<Cell.Value class="py-4 align-top">
					{#if row.active}
						<Badge variant="success" size="xs">Active</Badge>
					{:else}
						<Badge variant="destructive" size="xs">Inactive</Badge>
					{/if}
				</Cell.Value>

				<Cell.Value class="py-4 align-top">
					{#if showEdit}
						<div class="flex justify-end">
							<Button variant="primary" size="sm" type="button" onclick={() => onEdit?.(row.source)}>
								Edit
							</Button>
						</div>
					{/if}
				</Cell.Value>
			</Row.Root>
		{/each}
	</SuperTable>

	{#if users.length === 0}
		<p class="text-muted-fg text-sm font-medium">
			No users yet. Invite your first teammate with Create user.
		</p>
	{/if}
</Card>

{#if form?.message && form?.type === 'updateRole'}
	<Alert class="mt-4" variant={form.ok ? 'success' : 'destructive'} size="sm">
		<p class="text-foreground text-sm font-medium">{form.message}</p>
	</Alert>
{/if}

<style>
	.user-table .flex.justify-center.p-2.text-sm.font-semibold {
		display: none;
	}

	.user-table :global(tr) {
		border-bottom: 1px solid var(--color-border);
		transition: background-color 0.15s ease;
	}

	.user-table :global(tr:last-child) {
		border-bottom: none;
	}

	.user-table :global(tr:hover) {
		background-color: color-mix(in oklab, var(--color-muted) 70%, transparent);
	}

	.user-table :global(td) {
		padding-top: 1rem;
		padding-bottom: 1rem;
	}
</style>
