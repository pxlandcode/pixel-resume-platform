<script lang="ts">
	import UserFormModal from '$lib/components/admin/UserFormModal.svelte';
	import { SuperList, ListHandler, Cell, Row } from '$lib/components/super-list';
	import type { SuperListHead } from '$lib/components/super-list';
	import { Alert, Badge, Button } from '@pixelcode_/blocks/components';
	import { Pencil } from 'lucide-svelte';

	type Role = 'admin' | 'broker' | 'talent' | 'employer';
	type EditableUser = {
		id: string;
		first_name: string;
		last_name: string;
		email: string;
		roles: Role[];
		avatar_url: string | null;
		active: boolean;
		linked_talent_id: string | null;
	};

	type LoadUser = {
		id: string;
		first_name: string | null;
		last_name: string | null;
		email: string | null;
		roles: string[] | null;
		avatar_url: string | null;
		active: boolean;
		linked_talent_id: string | null;
		organisation_name?: string | null;
	};

	let { data, form } = $props();
	const canCreateUsers = $derived(Boolean(data.canCreateUsers));
	const canEditUsers = $derived(Boolean(data.canEditUsers));
	const allowedCreateRoles = $derived(
		(data.allowedCreateRoles as Role[] | undefined) ?? ['talent']
	);
	const normalizeRoles = (roles: string[] | null | undefined): Role[] => {
		const allowed = new Set<Role>(['admin', 'broker', 'talent', 'employer']);
		const normalized =
			roles?.filter((role): role is Role => allowed.has(role as Role))?.filter(Boolean) ?? [];
		return normalized.length > 0 ? normalized : ['talent'];
	};

	const toEditableUser = (user: LoadUser): EditableUser => ({
		id: user.id,
		first_name: user.first_name ?? '',
		last_name: user.last_name ?? '',
		email: user.email ?? '',
		roles: normalizeRoles(user.roles),
		avatar_url: user.avatar_url ?? null,
		active: user.active,
		linked_talent_id: user.linked_talent_id ?? null
	});

	let isModalOpen = $state(false);
	let feedback = $state<{ type: 'success' | 'error'; message: string } | null>(null);
	let editUser = $state<EditableUser | null>(
		data.users[0] ? toEditableUser(data.users[0] as LoadUser) : null
	);
	let editMode: 'create' | 'edit' = $state('create');

	const handleUserCreated = (event: CustomEvent<{ message?: string }>) => {
		feedback = { type: 'success', message: event.detail?.message ?? 'User created successfully.' };
		isModalOpen = false;
	};

	const handleCreateError = (event: CustomEvent<{ message?: string }>) => {
		feedback = { type: 'error', message: event.detail?.message ?? 'Failed to create user.' };
	};

	$effect(() => {
		if (form?.type !== 'updateRole') return;

		feedback = {
			type: form.ok ? 'success' : 'error',
			message: form.message ?? ''
		};
	});

	type UsersListRow = {
		id: string;
		fullName: string;
		email: string;
		avatar_url: string | null;
		roles: Role[];
		roleLabel: string;
		active: boolean;
		organisation_name: string | null;
		source: LoadUser;
	};

	const usersListHeadings: SuperListHead<UsersListRow>[] = [
		{ heading: null, width: 5 },
		{ heading: 'Name', sortable: 'fullName', filterable: 'fullName', width: 20 },
		{ heading: 'Email', sortable: 'email', filterable: 'email', width: 25 },
		{ heading: 'Organisation', sortable: 'organisation_name', width: 18 },
		{ heading: 'Roles', sortable: 'roleLabel', width: 17 },
		{ heading: 'Status', width: 5 },
		{ heading: null, width: 10 }
	];

	const toListRows = (users: LoadUser[]): UsersListRow[] =>
		users.map((user) => {
			const roles = normalizeRoles(user.roles);
			return {
				id: user.id,
				fullName:
					[user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || 'Unknown',
				email: user.email ?? '',
				avatar_url: user.avatar_url ?? null,
				roles,
				roleLabel: roles.join(', '),
				active: user.active,
				organisation_name: user.organisation_name?.trim() || null,
				source: user
			};
		});

	const userListHandler = $derived(
		new ListHandler<UsersListRow>(usersListHeadings, toListRows(data.users as LoadUser[]))
	);
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-foreground text-2xl font-semibold">Users</h1>
			<p class="text-muted-fg text-sm">Invite teammates and adjust their permissions.</p>
		</div>
		<div class="ml-auto flex flex-wrap items-center gap-2">
			{#if canCreateUsers}
				<Button
					variant="primary"
					size="md"
					type="button"
					onclick={() => {
						feedback = null;
						editMode = 'create';
						editUser = {
							id: '',
							first_name: '',
							last_name: '',
							email: '',
							roles: ['talent'],
							avatar_url: null,
							active: true,
							linked_talent_id: null
						};
						isModalOpen = true;
					}}
				>
					Create user
				</Button>
			{/if}
		</div>
	</div>

	{#if feedback}
		<Alert variant={feedback.type === 'success' ? 'success' : 'destructive'} size="sm">
			<p class="text-foreground text-sm font-medium">{feedback.message}</p>
		</Alert>
	{/if}

	{#if data.users.length === 0}
		<p class="text-muted-fg text-sm font-medium">
			No users yet. Invite your first teammate with Create user.
		</p>
	{:else}
		<SuperList instance={userListHandler} emptyMessage="No users found">
			{#each userListHandler.data as row (row.id)}
				<Row.Root>
					<Cell.Value width={5}>
						<Cell.Avatar src={row.avatar_url} alt={row.fullName} size={36} />
					</Cell.Value>
					<Cell.Value width={20}>
						<span class="text-foreground truncate text-sm font-semibold">{row.fullName}</span>
					</Cell.Value>
					<Cell.Value width={25}>
						<span class="text-muted-fg truncate text-xs">{row.email}</span>
					</Cell.Value>
					<Cell.Value width={18}>
						<span class="text-foreground text-sm font-medium">
							{row.organisation_name ?? 'Unassigned'}
						</span>
					</Cell.Value>
					<Cell.Value width={17}>
						<div class="flex flex-wrap gap-1">
							{#each row.roles as role (role)}
								<Badge variant="default" size="xs" class="uppercase tracking-wide">
									{role.replace('_', ' ')}
								</Badge>
							{/each}
						</div>
					</Cell.Value>
					<Cell.Value width={5}>
						{#if row.active}
							<Badge variant="success" size="xs">Active</Badge>
						{:else}
							<Badge variant="destructive" size="xs">Inactive</Badge>
						{/if}
					</Cell.Value>
					<Cell.Value width={10}>
						{#if canEditUsers}
							<div class="flex justify-end">
								<Button
									variant="outline"
									size="sm"
									type="button"
									onclick={() => {
										editMode = 'edit';
										editUser = toEditableUser(row.source);
										isModalOpen = true;
									}}
									class="gap-1.5"
								>
									<Pencil size={14} />
									Edit
								</Button>
							</div>
						{/if}
					</Cell.Value>
				</Row.Root>
			{/each}
		</SuperList>
	{/if}
</div>

<UserFormModal
	bind:open={isModalOpen}
	mode={editMode}
	talentOptions={data.talents ?? []}
	allowedRoles={allowedCreateRoles}
	{canEditUsers}
	initial={editUser ?? undefined}
	on:success={handleUserCreated}
	on:error={handleCreateError}
	on:close={() => (isModalOpen = false)}
/>
