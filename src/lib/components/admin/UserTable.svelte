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
	import { CircleCheck, CircleX } from 'lucide-svelte';
	import { getRoleLabel, getRoleIcon } from '$lib/types/roles';
	import { tooltip } from '$lib/utils/tooltip';
	import {
		applyImageFallbackOnce,
		getOriginalImageUrl,
		supabaseImagePresets,
		transformSupabasePublicUrl,
		transformSupabasePublicUrlSrcSet
	} from '$lib/images/supabaseImage';
	type Role = 'admin' | 'organisation_admin' | 'broker' | 'talent' | 'employer' | string;

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
	const fallbackRoleIcon = getRoleIcon('talent');

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

	const rowAvatarSrc = (url: string | null | undefined) =>
		transformSupabasePublicUrl(url, supabaseImagePresets.avatarList);
	const rowAvatarSrcSet = (url: string | null | undefined) =>
		transformSupabasePublicUrlSrcSet(url, [40, 80], {
			height: supabaseImagePresets.avatarList.height,
			quality: supabaseImagePresets.avatarList.quality,
			resize: supabaseImagePresets.avatarList.resize
		});
	const rowAvatarFallbackSrc = (url: string | null | undefined) => getOriginalImageUrl(url);

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
								src={rowAvatarSrc(row.avatar_url)}
								srcset={rowAvatarSrcSet(row.avatar_url)}
								sizes="40px"
								alt={row.fullName}
								class="bg-card h-10 w-10 rounded-full object-cover object-center"
								loading="lazy"
								decoding="async"
								onerror={(event) =>
									applyImageFallbackOnce(event, rowAvatarFallbackSrc(row.avatar_url))}
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
							{@const RoleIcon = getRoleIcon(role)}
							<span
								class="text-muted-fg hover:text-foreground inline-flex cursor-default transition-colors"
								use:tooltip={getRoleLabel(role)}
							>
								<RoleIcon size={16} />
							</span>
						{:else}
							<span
								class="text-muted-fg hover:text-foreground inline-flex cursor-default transition-colors"
								use:tooltip={getRoleLabel('talent')}
							>
								<fallbackRoleIcon size={16} />
							</span>
						{/each}
					</div>
				</Cell.Value>

				<Cell.Value class="py-4 align-top">
					{#if row.active}
						<span class="inline-flex cursor-default text-emerald-500" use:tooltip={'Active'}>
							<CircleCheck size={16} />
						</span>
					{:else}
						<span class="inline-flex cursor-default text-red-500" use:tooltip={'Inactive'}>
							<CircleX size={16} />
						</span>
					{/if}
				</Cell.Value>

				<Cell.Value class="py-4 align-top">
					{#if showEdit}
						<div class="flex justify-end">
							<Button
								variant="primary"
								size="sm"
								type="button"
								onclick={() => onEdit?.(row.source)}
							>
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
	:global(.user-table + .flex.justify-center.p-2.text-sm.font-semibold) {
		display: none;
	}

	:global(.user-table tr) {
		border-bottom: 1px solid var(--color-border);
		transition: background-color 0.15s ease;
	}

	:global(.user-table tr:last-child) {
		border-bottom: none;
	}

	:global(.user-table tr:hover) {
		background-color: color-mix(in oklab, var(--color-muted) 70%, transparent);
	}

	:global(.user-table td) {
		padding-top: 1rem;
		padding-bottom: 1rem;
	}
</style>
