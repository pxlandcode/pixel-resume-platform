<script lang="ts">
	import UserFormModal from '$lib/components/admin/UserFormModal.svelte';
	import Drawer from '$lib/components/drawer/drawer.svelte';
	import { SuperList, ListHandler, Cell, Row } from '$lib/components/super-list';
	import type { SuperListHead } from '$lib/components/super-list';
	import {
		applyImageFallbackOnce,
		getOriginalImageUrl,
		supabaseImagePresets,
		transformSupabasePublicUrl,
		transformSupabasePublicUrlSrcSet
	} from '$lib/images/supabaseImage';
	import { Alert, Badge, Button } from '@pixelcode_/blocks/components';
	import { Pencil, User } from 'lucide-svelte';

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
	type TalentOption = {
		id: string;
		user_id: string | null;
		first_name: string;
		last_name: string;
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
	let isMobileDetailOpen = $state(false);
	let selectedUserForDetail = $state<UsersListRow | null>(null);
	let feedback = $state<{ type: 'success' | 'error'; message: string } | null>(null);
	let talentOptions = $state<TalentOption[]>([]);
	let talentOptionsStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let talentOptionsError = $state<string | null>(null);
	let talentOptionsEtag = $state<string | null>(null);
	let editUser = $state<EditableUser | null>(
		data.users[0] ? toEditableUser(data.users[0] as LoadUser) : null
	);
	let editMode: 'create' | 'edit' = $state('create');

	const loadTalentOptions = async () => {
		if (!canEditUsers) return;
		if (talentOptionsStatus === 'loading') return;
		if (talentOptionsStatus === 'ready' && talentOptions.length > 0) return;

		talentOptionsStatus = 'loading';
		talentOptionsError = null;

		try {
			const response = await fetch('/internal/api/users/talent-options', {
				method: 'GET',
				credentials: 'include',
				headers: talentOptionsEtag ? { 'If-None-Match': talentOptionsEtag } : undefined
			});

			if (response.status === 304) {
				talentOptionsStatus = 'ready';
				return;
			}

			if (!response.ok) {
				const message = await response.text().catch(() => '');
				throw new Error(message || 'Could not load talent options.');
			}

			const payload = (await response.json()) as {
				items?: Array<{
					id?: unknown;
					user_id?: unknown;
					first_name?: unknown;
					last_name?: unknown;
				}>;
			};

			talentOptions = (payload.items ?? [])
				.filter(
					(
						item
					): item is {
						id: string;
						user_id: string | null;
						first_name: string;
						last_name: string;
					} => typeof item.id === 'string' && item.id.trim().length > 0
				)
				.map((item) => ({
					id: item.id.trim(),
					user_id: typeof item.user_id === 'string' ? item.user_id : null,
					first_name: typeof item.first_name === 'string' ? item.first_name : '',
					last_name: typeof item.last_name === 'string' ? item.last_name : ''
				}));

			talentOptionsEtag = response.headers.get('etag');
			talentOptionsStatus = 'ready';
			talentOptionsError = null;
		} catch (error) {
			talentOptionsStatus = 'error';
			talentOptionsError =
				error instanceof Error ? error.message : 'Could not load talent options.';
		}
	};

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

	$effect(() => {
		if (!isModalOpen || editMode !== 'edit') return;
		void loadTalentOptions();
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
	const detailAvatarSrc = (url: string | null | undefined) =>
		transformSupabasePublicUrl(url, supabaseImagePresets.avatarList);
	const detailAvatarSrcSet = (url: string | null | undefined) =>
		transformSupabasePublicUrlSrcSet(url, [64, 128], {
			height: supabaseImagePresets.avatarList.height,
			quality: supabaseImagePresets.avatarList.quality,
			resize: supabaseImagePresets.avatarList.resize
		});
	const detailAvatarFallbackSrc = (url: string | null | undefined) => getOriginalImageUrl(url);

	const handleRowClick = (row: UsersListRow) => {
		// Only open drawer on mobile (sm breakpoint is 640px)
		if (window.innerWidth < 640) {
			selectedUserForDetail = row;
			isMobileDetailOpen = true;
		}
	};
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
						void loadTalentOptions();
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
	{#if talentOptionsError && isModalOpen && editMode === 'edit'}
		<Alert variant="destructive" size="sm">
			<p class="text-foreground text-sm font-medium">{talentOptionsError}</p>
		</Alert>
	{/if}

	{#if data.users.length === 0}
		<p class="text-muted-fg text-sm font-medium">
			No users yet. Invite your first teammate with Create user.
		</p>
	{:else}
		<SuperList instance={userListHandler} emptyMessage="No users found">
			{#each userListHandler.data as row (row.id)}
				<Row.Root onclick={() => handleRowClick(row)} class="cursor-pointer sm:cursor-default">
					<Cell.Value width={5} class="hidden sm:block">
						<Cell.Avatar src={row.avatar_url} alt={row.fullName} size={36} />
					</Cell.Value>
					<Cell.Value width={20} class="mobile-fill-cell">
						<span class="text-foreground truncate text-sm font-semibold">{row.fullName}</span>
					</Cell.Value>
					<Cell.Value width={25} class="hidden sm:block">
						<span class="text-muted-fg truncate text-xs">{row.email}</span>
					</Cell.Value>
					<Cell.Value width={18} class="mobile-fill-cell">
						<span class="text-foreground text-sm font-medium">
							{row.organisation_name ?? 'Unassigned'}
						</span>
					</Cell.Value>
					<Cell.Value width={17} class="hidden sm:block">
						<div class="flex flex-wrap gap-1">
							{#each row.roles as role (role)}
								<Badge variant="default" size="xs" class="uppercase tracking-wide">
									{role.replace('_', ' ')}
								</Badge>
							{/each}
						</div>
					</Cell.Value>
					<Cell.Value width={5} class="hidden sm:block">
						{#if row.active}
							<Badge variant="success" size="xs">Active</Badge>
						{:else}
							<Badge variant="destructive" size="xs">Inactive</Badge>
						{/if}
					</Cell.Value>
					<Cell.Value width={10} class="mobile-action-cell">
						{#if canEditUsers}
							<div class="flex justify-end">
								<Button
									variant="outline"
									size="sm"
									type="button"
									aria-label={`Edit ${row.fullName}`}
									onclick={() => {
										editMode = 'edit';
										editUser = toEditableUser(row.source);
										isModalOpen = true;
										void loadTalentOptions();
									}}
									class="gap-0 sm:gap-1.5"
								>
									<Pencil size={14} />
									<span class="sr-only sm:not-sr-only">Edit</span>
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
	{talentOptions}
	allowedRoles={allowedCreateRoles}
	{canEditUsers}
	initial={editUser ?? undefined}
	on:success={handleUserCreated}
	on:error={handleCreateError}
	on:close={() => (isModalOpen = false)}
/>

<!-- Mobile user detail drawer -->
<Drawer variant="bottom" bind:open={isMobileDetailOpen} title="User Details" dismissable>
	{#if selectedUserForDetail}
		<div class="space-y-4 pb-6">
			<div class="flex items-center gap-4">
				{#if selectedUserForDetail.avatar_url}
					<img
						src={detailAvatarSrc(selectedUserForDetail.avatar_url)}
						srcset={detailAvatarSrcSet(selectedUserForDetail.avatar_url)}
						sizes="64px"
						alt={selectedUserForDetail.fullName}
						class="border-border h-16 w-16 rounded-full border object-cover"
						loading="lazy"
						decoding="async"
						onerror={(event) =>
							applyImageFallbackOnce(
								event,
								detailAvatarFallbackSrc(selectedUserForDetail?.avatar_url)
							)}
					/>
				{:else}
					<div
						class="bg-muted border-border flex h-16 w-16 items-center justify-center rounded-full border"
					>
						<User size={28} class="text-muted-fg" />
					</div>
				{/if}
				<div class="flex-1">
					<h3 class="text-foreground text-lg font-semibold">{selectedUserForDetail.fullName}</h3>
					<p class="text-muted-fg text-sm">{selectedUserForDetail.email || 'No email'}</p>
				</div>
			</div>

			<div class="border-border grid gap-4 border-t pt-4">
				<div>
					<p class="text-muted-fg text-xs font-medium uppercase tracking-wide">Organisation</p>
					<p class="text-foreground text-sm font-medium">
						{selectedUserForDetail.organisation_name ?? 'Unassigned'}
					</p>
				</div>

				<div>
					<p class="text-muted-fg text-xs font-medium uppercase tracking-wide">Roles</p>
					<div class="mt-1 flex flex-wrap gap-1">
						{#each selectedUserForDetail.roles as role (role)}
							<Badge variant="default" size="xs" class="uppercase tracking-wide">
								{role.replace('_', ' ')}
							</Badge>
						{/each}
					</div>
				</div>

				<div>
					<p class="text-muted-fg text-xs font-medium uppercase tracking-wide">Status</p>
					<div class="mt-1">
						{#if selectedUserForDetail.active}
							<Badge variant="success" size="xs">Active</Badge>
						{:else}
							<Badge variant="destructive" size="xs">Inactive</Badge>
						{/if}
					</div>
				</div>
			</div>

			{#if canEditUsers}
				<div class="border-border border-t pt-4">
					<Button
						variant="outline"
						size="md"
						type="button"
						class="w-full gap-2"
						onclick={() => {
							if (!selectedUserForDetail) return;
							isMobileDetailOpen = false;
							editMode = 'edit';
							editUser = toEditableUser(selectedUserForDetail.source);
							isModalOpen = true;
							void loadTalentOptions();
						}}
					>
						<Pencil size={16} />
						Edit user
					</Button>
				</div>
			{/if}
		</div>
	{/if}
</Drawer>

<style>
	@media (max-width: 639px) {
		:global(.mobile-fill-cell) {
			width: auto !important;
			flex: 1 1 0% !important;
		}

		:global(.mobile-action-cell) {
			width: auto !important;
			flex: 0 0 auto !important;
		}
	}
</style>
