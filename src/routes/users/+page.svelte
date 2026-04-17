<script lang="ts">
	import UserFormModal from '$lib/components/admin/UserFormModal.svelte';
	import Drawer from '$lib/components/drawer/drawer.svelte';
	import { DropdownCheckbox } from '$lib/components/dropdown-checkbox';
	import { SuperList, ListHandler, Cell, Row } from '$lib/components/super-list';
	import type { SuperListHead } from '$lib/components/super-list';
	import { userSettingsStore } from '$lib/stores/userSettings';
	import type { ViewMode } from '$lib/types/userSettings';
	import { invalidateAll } from '$app/navigation';
	import {
		applyImageFallbackOnce,
		getOriginalImageUrl,
		supabaseImagePresets,
		supabaseImageSizes,
		supabaseImageSrcsetWidths,
		transformSupabasePublicUrl,
		transformSupabasePublicUrlSrcSet
	} from '$lib/images/supabaseImage';
	import { Alert, Badge, Button, Card, Input } from '@pixelcode_/blocks/components';
	import {
		Pencil,
		User,
		LayoutGrid,
		List,
		SlidersHorizontal,
		Search,
		CircleCheck,
		CircleX
	} from 'lucide-svelte';
	import { slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { ROLE_CONFIG, getRoleLabel, getRoleIcon } from '$lib/types/roles';
	import { tooltip } from '$lib/utils/tooltip';

	type Role = 'admin' | 'broker' | 'talent' | 'employer';
	type UserStatusFilter = 'active' | 'inactive';
	type EditableUser = {
		id: string;
		first_name: string;
		last_name: string;
		email: string;
		roles: Role[];
		avatar_url: string | null;
		active: boolean;
		linked_talent_id: string | null;
		organisation_id: string | null;
	};
	type TalentOption = {
		id: string;
		user_id: string | null;
		first_name: string;
		last_name: string;
	};
	type OrganisationOption = {
		id: string;
		name: string;
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
		organisation_id?: string | null;
		organisation_name?: string | null;
	};
	type UsersListRow = {
		id: string;
		fullName: string;
		email: string;
		avatar_url: string | null;
		roles: Role[];
		roleLabel: string;
		active: boolean;
		statusLabel: string;
		organisation_id: string | null;
		organisation_name: string | null;
		organisation_label: string;
		source: LoadUser;
	};

	const UNASSIGNED_ORGANISATION_FILTER = '__unassigned__';
	const roleLabelByValue: Record<Role, string> = {
		admin: ROLE_CONFIG.admin.label,
		broker: ROLE_CONFIG.broker.label,
		talent: ROLE_CONFIG.talent.label,
		employer: ROLE_CONFIG.employer.label
	};
	const roleFilterOptions = [
		{ label: 'Admin', value: 'admin' },
		{ label: 'Broker', value: 'broker' },
		{ label: 'Talent', value: 'talent' },
		{ label: 'Employer', value: 'employer' }
	];
	const statusFilterOptions = [
		{ label: 'Active', value: 'active' },
		{ label: 'Inactive', value: 'inactive' }
	];

	let { data, form } = $props();

	const canCreateUsers = $derived(Boolean(data.canCreateUsers));
	const canDeleteUsers = $derived(Boolean(data.canDeleteUsers));
	const canEditUsers = $derived(Boolean(data.canEditUsers));
	const canManageLinkedTalent = $derived(Boolean(data.canManageLinkedTalent));
	const canManageOrganisationAssignment = $derived(
		Boolean(data.canManageOrganisationAssignment)
	);
	const editableUserIds = $derived(
		new Set(((data.editableUserIds as string[] | undefined) ?? []).filter(Boolean))
	);
	const currentUserId = $derived(
		typeof data.currentUserId === 'string' && data.currentUserId.length > 0
			? data.currentUserId
			: null
	);
	const allowedCreateRoles = $derived(
		(data.allowedCreateRoles as Role[] | undefined) ?? ['talent']
	);
	const organisationOptions = $derived(
		(data.organisationOptions as OrganisationOption[] | undefined) ?? []
	);
	const filterOrganisationOptions = $derived(
		((
			data as typeof data & {
				filterOrganisationOptions?: OrganisationOption[];
			}
		).filterOrganisationOptions ?? []) as OrganisationOption[]
	);
	const usersViewMode = $derived($userSettingsStore.settings.views.users);
	const homeOrganisationId = $derived.by(() => {
		const value = (
			data as typeof data & {
				homeOrganisationId?: unknown;
			}
		).homeOrganisationId;
		return typeof value === 'string' ? value : null;
	});

	const normalizeRoles = (roles: string[] | null | undefined): Role[] => {
		const allowed = new Set<Role>(['admin', 'broker', 'talent', 'employer']);
		const normalized =
			roles?.filter((role): role is Role => allowed.has(role as Role))?.filter(Boolean) ?? [];
		return normalized.length > 0 ? normalized : ['talent'];
	};

	const formatRoleLabel = (role: Role) => roleLabelByValue[role] ?? role;

	const getUserName = (user: LoadUser) =>
		[user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || 'Unknown User';

	const toEditableUser = (user: LoadUser): EditableUser => ({
		id: user.id,
		first_name: user.first_name ?? '',
		last_name: user.last_name ?? '',
		email: user.email ?? '',
		roles: normalizeRoles(user.roles),
		avatar_url: user.avatar_url ?? null,
		active: user.active,
		linked_talent_id: user.linked_talent_id ?? null,
		organisation_id: user.organisation_id ?? null
	});

	const parseActionMessage = async (response: Response) => {
		const payload = (await response.json().catch(() => null)) as {
			message?: unknown;
			ok?: unknown;
			data?: { message?: unknown; ok?: unknown } | null;
		} | null;
		const message =
			typeof payload?.message === 'string'
				? payload.message
				: typeof payload?.data?.message === 'string'
					? payload.data.message
					: null;
		const ok =
			typeof payload?.ok === 'boolean'
				? payload.ok
				: typeof payload?.data?.ok === 'boolean'
					? payload.data.ok
					: response.ok;
		return { ok, message };
	};

	let isModalOpen = $state(false);
	let isMobileDetailOpen = $state(false);
	let selectedUserForDetail = $state<UsersListRow | null>(null);
	let feedback = $state<{ type: 'success' | 'error'; message: string } | null>(null);
	let users = $state<LoadUser[]>((data.users as LoadUser[] | undefined) ?? []);
	let talentOptions = $state<TalentOption[]>([]);
	let talentOptionsStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let talentOptionsError = $state<string | null>(null);
	let talentOptionsEtag = $state<string | null>(null);
	let editUser = $state<EditableUser | null>(null);
	let editMode: 'create' | 'edit' = $state('create');
	let filtersOpen = $state(false);
	let searchQuery = $state('');
	let selectedRoleFilters = $state<Role[]>([]);
	let selectedStatusFilters = $state<UserStatusFilter[]>([]);

	const sanitizeRoleFilters = (values: string[]): Role[] => {
		const allowed = new Set<Role>(['admin', 'broker', 'talent', 'employer']);
		return Array.from(new Set(values.filter((value): value is Role => allowed.has(value as Role))));
	};

	const sanitizeStatusFilters = (values: string[]): UserStatusFilter[] => {
		const allowed = new Set<UserStatusFilter>(['active', 'inactive']);
		return Array.from(
			new Set(
				values.filter((value): value is UserStatusFilter => allowed.has(value as UserStatusFilter))
			)
		);
	};

	const loadTalentOptions = async () => {
		if (!canManageLinkedTalent) return;
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

	const handleUserSaved = async (event: CustomEvent<{ message?: string }>) => {
		feedback = { type: 'success', message: event.detail?.message ?? 'User saved.' };
		isModalOpen = false;
		selectedUserForDetail = null;
		isMobileDetailOpen = false;
		await invalidateAll();
	};

	const handleCreateError = (event: CustomEvent<{ message?: string }>) => {
		feedback = { type: 'error', message: event.detail?.message ?? 'Failed to save user.' };
	};

	const canDeleteRow = (user: { id: string } | null | undefined) =>
		Boolean(canDeleteUsers && user?.id && user.id !== currentUserId);
	const canEditUser = (user: { id: string } | null | undefined) =>
		Boolean(canEditUsers && user?.id && editableUserIds.has(user.id));

	const handleDeleteUserById = async (userId: string) => {
		const user = users.find((candidate) => candidate.id === userId);
		if (!user) {
			feedback = { type: 'error', message: 'User not found.' };
			return;
		}
		await handleDeleteUser(user);
	};

	const handleDeleteUser = async (user: LoadUser) => {
		const formData = new FormData();
		formData.set('user_id', user.id);

		try {
			const response = await fetch('?/deleteUser', { method: 'POST', body: formData });
			const result = await parseActionMessage(response);
			if (!response.ok || !result.ok) {
				feedback = {
					type: 'error',
					message: result.message ?? 'Failed to delete user.'
				};
				return;
			}

			users = users.filter((candidate) => candidate.id !== user.id);
			if (selectedUserForDetail?.id === user.id) {
				selectedUserForDetail = null;
				isMobileDetailOpen = false;
			}
			if (editUser?.id === user.id) {
				editUser = null;
				isModalOpen = false;
			}

			feedback = {
				type: 'success',
				message: result.message ?? 'User deleted.'
			};
		} catch (error) {
			feedback = {
				type: 'error',
				message: error instanceof Error ? error.message : 'Failed to delete user.'
			};
		}
	};

	const openCreateUserModal = () => {
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
			linked_talent_id: null,
			organisation_id: null
		};
		isModalOpen = true;
		void loadTalentOptions();
	};

	const openEditUserModal = (user: LoadUser) => {
		if (!canEditUser(user)) return;
		feedback = null;
		editMode = 'edit';
		editUser = toEditableUser(user);
		isModalOpen = true;
		void loadTalentOptions();
	};

	$effect(() => {
		if (form?.type !== 'updateRole') return;

		feedback = {
			type: form.ok ? 'success' : 'error',
			message: form.message ?? ''
		};
	});

	$effect(() => {
		if (!isModalOpen || !canManageLinkedTalent) return;
		void loadTalentOptions();
	});

	const hasUnassignedUsers = $derived(
		users.some(
			(user) => typeof user.organisation_id !== 'string' || user.organisation_id.trim().length === 0
		)
	);

	const organisationFilterOptions = $derived([
		...filterOrganisationOptions.map((organisation) => ({
			label: organisation.name,
			value: organisation.id
		})),
		...(hasUnassignedUsers ? [{ label: 'Unassigned', value: UNASSIGNED_ORGANISATION_FILTER }] : [])
	]);
	const availableOrganisationIds = $derived(organisationFilterOptions.map((org) => org.value));

	const sanitizeOrganisationIds = (ids: string[]) => {
		const allowed = new Set(availableOrganisationIds);
		return Array.from(
			new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0 && allowed.has(id)))
		);
	};

	const selectedOrganisationIds = $derived.by(() => {
		if (availableOrganisationIds.length === 0) return [];

		const configured = sanitizeOrganisationIds(
			$userSettingsStore.settings.organisationFilters.users
		);
		if (configured.length > 0) return configured;

		if (homeOrganisationId && availableOrganisationIds.includes(homeOrganisationId)) {
			return [homeOrganisationId];
		}

		const firstNamedOrganisation = availableOrganisationIds.find(
			(id) => id !== UNASSIGNED_ORGANISATION_FILTER
		);
		return firstNamedOrganisation ? [firstNamedOrganisation] : [availableOrganisationIds[0]];
	});

	const filteredUsers = $derived.by(() => {
		let items = [...users];

		if (selectedOrganisationIds.length > 0) {
			const selectedOrgIds = new Set(selectedOrganisationIds);
			items = items.filter((user) => {
				const organisationId =
					typeof user.organisation_id === 'string' && user.organisation_id.trim().length > 0
						? user.organisation_id
						: null;
				if (organisationId && selectedOrgIds.has(organisationId)) return true;
				return !organisationId && selectedOrgIds.has(UNASSIGNED_ORGANISATION_FILTER);
			});
		}

		if (selectedRoleFilters.length > 0) {
			const selectedRoles = new Set(selectedRoleFilters);
			items = items.filter((user) =>
				normalizeRoles(user.roles).some((role) => selectedRoles.has(role))
			);
		}

		if (selectedStatusFilters.length > 0) {
			const selectedStatuses = new Set(selectedStatusFilters);
			items = items.filter((user) => selectedStatuses.has(user.active ? 'active' : 'inactive'));
		}

		return items;
	});

	const usersListHeadings: SuperListHead<UsersListRow>[] = [
		{ heading: null, width: 6 },
		{ heading: 'Name', sortable: 'fullName', filterable: 'fullName', width: 24 },
		{ heading: 'Email', sortable: 'email', filterable: 'email', width: 20 },
		{
			heading: 'Organisation',
			sortable: 'organisation_label',
			filterable: 'organisation_label',
			width: 18
		},
		{ heading: 'Roles', sortable: 'roleLabel', filterable: 'roleLabel', width: 18 },
		{ heading: 'Status', sortable: 'statusLabel', filterable: 'statusLabel', width: 8 },
		{ heading: null, width: 6 }
	];

	const toListRows = (items: LoadUser[]): UsersListRow[] =>
		items.map((user) => {
			const roles = normalizeRoles(user.roles);
			return {
				id: user.id,
				fullName: getUserName(user),
				email: user.email ?? '',
				avatar_url: user.avatar_url ?? null,
				roles,
				roleLabel: roles.map(formatRoleLabel).join(', '),
				active: user.active,
				statusLabel: user.active ? 'Active' : 'Inactive',
				organisation_id: user.organisation_id?.trim() || null,
				organisation_name: user.organisation_name?.trim() || null,
				organisation_label: user.organisation_name?.trim() || 'Unassigned',
				source: user
			};
		});

	const filteredUserRows = $derived.by(() => toListRows(filteredUsers));

	const userListHandler = $derived.by(
		() => new ListHandler<UsersListRow>(usersListHeadings, filteredUserRows)
	);

	const searchFilteredUserRows = $derived.by(() => {
		if (!searchQuery.trim()) return filteredUserRows;
		const query = searchQuery.trim().toLowerCase();
		return filteredUserRows.filter((row) => {
			return (
				row.fullName.toLowerCase().includes(query) ||
				row.email.toLowerCase().includes(query) ||
				row.organisation_label.toLowerCase().includes(query) ||
				row.roleLabel.toLowerCase().includes(query) ||
				row.statusLabel.toLowerCase().includes(query)
			);
		});
	});

	$effect(() => {
		const nextUsers = (data.users as LoadUser[] | undefined) ?? [];
		users = nextUsers;

		const selectedUserId = selectedUserForDetail?.id ?? null;
		if (!selectedUserId) return;
		const nextRow = toListRows(nextUsers).find((candidate) => candidate.id === selectedUserId);
		if (nextRow) {
			selectedUserForDetail = nextRow;
			return;
		}

		selectedUserForDetail = null;
		isMobileDetailOpen = false;
	});

	const getCardAvatarSrc = (url: string | null | undefined) =>
		transformSupabasePublicUrl(url, supabaseImagePresets.avatarCard);
	const getCardAvatarSrcSet = (url: string | null | undefined) =>
		transformSupabasePublicUrlSrcSet(url, supabaseImageSrcsetWidths.avatarCard, {
			height: supabaseImagePresets.avatarCard.height,
			quality: supabaseImagePresets.avatarCard.quality,
			resize: supabaseImagePresets.avatarCard.resize
		});
	const getCardAvatarFallbackSrc = (url: string | null | undefined) => getOriginalImageUrl(url);
	const detailAvatarSrc = (url: string | null | undefined) =>
		transformSupabasePublicUrl(url, supabaseImagePresets.avatarList);
	const detailAvatarSrcSet = (url: string | null | undefined) =>
		transformSupabasePublicUrlSrcSet(url, [64, 128], {
			height: supabaseImagePresets.avatarList.height,
			quality: supabaseImagePresets.avatarList.quality,
			resize: supabaseImagePresets.avatarList.resize
		});
	const detailAvatarFallbackSrc = (url: string | null | undefined) => getOriginalImageUrl(url);

	const setUsersViewMode = (mode: ViewMode) => {
		void userSettingsStore.setViewMode('users', mode);
	};

	const toggleFilters = () => {
		filtersOpen = !filtersOpen;
	};

	const handleOrganisationFilterChange = (selected: string[]) => {
		let next = sanitizeOrganisationIds(selected);
		if (next.length === 0) {
			if (homeOrganisationId && availableOrganisationIds.includes(homeOrganisationId)) {
				next = [homeOrganisationId];
			} else {
				const firstNamedOrganisation = availableOrganisationIds.find(
					(id) => id !== UNASSIGNED_ORGANISATION_FILTER
				);
				if (firstNamedOrganisation) {
					next = [firstNamedOrganisation];
				} else if (availableOrganisationIds[0]) {
					next = [availableOrganisationIds[0]];
				}
			}
		}
		void userSettingsStore.setOrganisationFilters('users', next);
	};

	const handleRoleFilterChange = (selected: string[]) => {
		selectedRoleFilters = sanitizeRoleFilters(selected);
	};

	const handleStatusFilterChange = (selected: string[]) => {
		selectedStatusFilters = sanitizeStatusFilters(selected);
	};

	const handlePreviewUser = (row: UsersListRow) => {
		if (typeof window === 'undefined' || window.innerWidth >= 640) return;
		selectedUserForDetail = row;
		isMobileDetailOpen = true;
	};

	const handlePreviewUserKeydown = (event: KeyboardEvent, row: UsersListRow) => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		handlePreviewUser(row);
	};
</script>

<div class="relative space-y-6">
	<div class="absolute right-0 top-0 z-10 flex items-center gap-2">
		{#if canCreateUsers}
			<div class="bg-primary inline-flex items-center rounded-sm p-1">
				<Button
					type="button"
					variant="primary"
					size="sm"
					class="px-3"
					onclick={openCreateUserModal}
				>
					Create user
				</Button>
			</div>
		{/if}
		<div class="border-border bg-card inline-flex rounded-sm border p-1">
			<button
				type="button"
				onclick={toggleFilters}
				class="rounded-xs relative inline-flex cursor-pointer items-center justify-center p-1.5 transition-colors {filtersOpen
					? 'border-primary bg-primary hover:bg-primary/90 text-white'
					: 'text-primary hover:bg-primary/20 border-transparent bg-transparent'}"
				aria-label="Toggle filters"
			>
				<SlidersHorizontal size={16} />
			</button>
		</div>
		<div class="border-border bg-card inline-flex rounded-sm border p-1">
			<Button
				type="button"
				variant="outline"
				size="sm"
				onclick={() => setUsersViewMode('grid')}
				class={`px-2 ${
					usersViewMode === 'grid'
						? 'border-primary bg-primary hover:bg-primary/90 text-white hover:text-white'
						: 'border-transparent bg-transparent'
				}`}
			>
				<LayoutGrid size={16} />
			</Button>
			<Button
				type="button"
				variant="outline"
				size="sm"
				onclick={() => setUsersViewMode('list')}
				class={`px-2 ${
					usersViewMode === 'list'
						? 'border-primary bg-primary hover:bg-primary/90 text-white hover:text-white'
						: 'border-transparent bg-transparent'
				}`}
			>
				<List size={16} />
			</Button>
		</div>
	</div>

	<header>
		<h1 class="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">Users</h1>
		<p class="text-muted-fg mt-3 text-lg">
			Invite teammates, manage access, and review active accounts across your organisations.
		</p>
	</header>

	{#if filtersOpen}
		<div
			transition:slide={{ duration: 300, easing: cubicOut }}
			class="border-border bg-card rounded-none border p-6"
		>
			<div class="grid gap-6 md:grid-cols-3">
				{#if organisationFilterOptions.length > 0}
					<div>
						<h2 class="text-muted-fg mb-3 text-xs font-semibold uppercase tracking-wide">
							Organisation
						</h2>
						<div class="w-64 max-w-full">
							<DropdownCheckbox
								label="Organisations"
								hideLabel
								placeholder="Organisations"
								options={organisationFilterOptions}
								selectedValues={selectedOrganisationIds}
								onchange={handleOrganisationFilterChange}
								variant="outline"
								size="sm"
								search
								searchPlaceholder="Search organisations"
							/>
						</div>
					</div>
				{/if}

				<div>
					<h2 class="text-muted-fg mb-3 text-xs font-semibold uppercase tracking-wide">Roles</h2>
					<div class="w-64 max-w-full">
						<DropdownCheckbox
							label="Roles"
							hideLabel
							placeholder="Roles"
							options={roleFilterOptions}
							selectedValues={selectedRoleFilters}
							onchange={handleRoleFilterChange}
							variant="outline"
							size="sm"
						/>
					</div>
				</div>

				<div>
					<h2 class="text-muted-fg mb-3 text-xs font-semibold uppercase tracking-wide">Status</h2>
					<div class="w-64 max-w-full">
						<DropdownCheckbox
							label="Statuses"
							hideLabel
							placeholder="Statuses"
							options={statusFilterOptions}
							selectedValues={selectedStatusFilters}
							onchange={handleStatusFilterChange}
							variant="outline"
							size="sm"
						/>
					</div>
				</div>
			</div>
		</div>
	{/if}

	{#if feedback}
		<Alert variant={feedback.type === 'success' ? 'success' : 'destructive'} size="sm">
			<p class="text-foreground text-sm font-medium">{feedback.message}</p>
		</Alert>
	{/if}
	{#if talentOptionsError && isModalOpen}
		<Alert variant="destructive" size="sm">
			<p class="text-foreground text-sm font-medium">{talentOptionsError}</p>
		</Alert>
	{/if}

	{#if users.length === 0}
		<div class="border-border bg-card rounded-sm border p-6">
			<h2 class="text-foreground text-lg font-semibold">No users yet</h2>
			<p class="text-muted-fg mt-2 text-sm">
				Invite your first teammate to start managing access here.
			</p>
		</div>
	{:else if filteredUsers.length === 0}
		<div class="border-border bg-card rounded-sm border p-6">
			<h2 class="text-foreground text-lg font-semibold">No users match the current filters</h2>
			<p class="text-muted-fg mt-2 text-sm">
				Try another organisation, role, or status combination.
			</p>
		</div>
	{:else if usersViewMode === 'grid'}
		<div class="mb-2">
			<Input icon={Search} bind:value={searchQuery} placeholder="Search..." class="pl-9" />
		</div>
		<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{#each searchFilteredUserRows as row (row.id)}
				<div
					class="block h-full cursor-pointer sm:cursor-default"
					role="button"
					tabindex="0"
					onclick={() => handlePreviewUser(row)}
					onkeydown={(event) => handlePreviewUserKeydown(event, row)}
				>
					<Card
						class="flex h-full flex-col overflow-hidden rounded-none transition-all hover:shadow-md"
					>
						<div class="bg-muted hidden aspect-square w-full overflow-hidden sm:block">
							{#if row.avatar_url}
								<img
									src={getCardAvatarSrc(row.avatar_url)}
									srcset={getCardAvatarSrcSet(row.avatar_url)}
									sizes={supabaseImageSizes.avatarCard}
									alt={row.fullName}
									class="h-full w-full object-cover object-center transition-transform duration-500 hover:scale-105"
									loading="lazy"
									decoding="async"
									onerror={(event) =>
										applyImageFallbackOnce(event, getCardAvatarFallbackSrc(row.avatar_url))}
								/>
							{:else}
								<div class="text-muted-fg flex h-full w-full items-center justify-center">
									<User size={48} />
								</div>
							{/if}
						</div>
						<div class="flex flex-1 flex-col p-5">
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<h3 class="text-foreground truncate text-lg font-semibold">{row.fullName}</h3>
									<p class="text-muted-fg mt-1 truncate text-sm">{row.email || 'No email'}</p>
								</div>
								{#if row.active}
									<Badge variant="success" size="xs">Active</Badge>
								{:else}
									<Badge variant="destructive" size="xs">Inactive</Badge>
								{/if}
							</div>

							<div class="mt-3 flex flex-wrap gap-1">
								{#each row.roles as role (role)}
									<Badge variant="default" size="xs" class="uppercase tracking-wide">
										{formatRoleLabel(role)}
									</Badge>
								{/each}
							</div>

							<div class="mt-auto flex items-end justify-between gap-3 pt-4">
								<div class="min-w-0">
									<p class="text-muted-fg text-xs font-medium uppercase tracking-wide">
										Organisation
									</p>
									<p class="text-foreground truncate text-sm font-medium">
										{row.organisation_label}
									</p>
								</div>

								{#if canEditUser(row.source)}
									<Button
										variant="outline"
										size="sm"
										type="button"
										aria-label={`Edit ${row.fullName}`}
										onclick={(event) => {
											event.stopPropagation();
											openEditUserModal(row.source);
										}}
										class="gap-0 sm:gap-1.5"
									>
										<Pencil size={14} />
										<span class="sr-only sm:not-sr-only">Edit</span>
									</Button>
								{/if}
							</div>
						</div>
					</Card>
				</div>
			{/each}
		</div>
		{#if searchQuery && searchFilteredUserRows.length === 0}
			<div class="text-muted-fg flex justify-center p-6 text-sm font-medium">
				No results for: {searchQuery}
			</div>
		{/if}
	{:else}
		<SuperList instance={userListHandler} emptyMessage="No users match the current filters">
			{#each userListHandler.data as row (row.id)}
				<Row.Root onclick={() => handlePreviewUser(row)} class="cursor-pointer sm:cursor-default">
					<Cell.Value width={6} class="hidden sm:block">
						<Cell.Avatar src={row.avatar_url} alt={row.fullName} size={36} />
					</Cell.Value>
					<Cell.Value width={24} class="mobile-fill-cell">
						<span class="text-foreground truncate text-sm font-semibold">{row.fullName}</span>
					</Cell.Value>
					<Cell.Value width={20} class="hidden sm:block">
						<span class="text-muted-fg truncate text-xs">{row.email}</span>
					</Cell.Value>
					<Cell.Value width={18} class="mobile-fill-cell">
						<span class="text-foreground truncate text-sm font-medium">
							{row.organisation_label}
						</span>
					</Cell.Value>
					<Cell.Value width={18} class="hidden sm:block">
						<div class="flex flex-wrap gap-1">
							{#each row.roles as role (role)}
								{@const RoleIcon = getRoleIcon(role)}
								<span
									class="text-muted-fg hover:text-foreground inline-flex cursor-default transition-colors"
									use:tooltip={getRoleLabel(role)}
								>
									<RoleIcon size={16} />
								</span>
							{/each}
						</div>
					</Cell.Value>
					<Cell.Value width={8} class="hidden sm:block">
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
					<Cell.Value width={6} class="mobile-action-cell">
						{#if canEditUser(row.source)}
							<div class="flex justify-end gap-2 pl-2">
								<Button
									variant="outline"
									size="sm"
									type="button"
									aria-label={`Edit ${row.fullName}`}
									onclick={(event) => {
										event.stopPropagation();
										openEditUserModal(row.source);
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
	{organisationOptions}
	allowedRoles={allowedCreateRoles}
	{canEditUsers}
	{canManageLinkedTalent}
	{canManageOrganisationAssignment}
	initial={editUser ?? undefined}
	canDelete={Boolean(editUser && canDeleteRow(editUser))}
	on:success={handleUserSaved}
	on:error={handleCreateError}
	on:requestDelete={(event) => {
		void handleDeleteUserById(event.detail.userId);
	}}
	on:close={() => (isModalOpen = false)}
/>

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
						{selectedUserForDetail.organisation_label}
					</p>
				</div>

				<div>
					<p class="text-muted-fg text-xs font-medium uppercase tracking-wide">Roles</p>
					<div class="mt-1 flex flex-wrap gap-1">
						{#each selectedUserForDetail.roles as role (role)}
							<Badge variant="default" size="xs" class="uppercase tracking-wide">
								{formatRoleLabel(role)}
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

			{#if canEditUser(selectedUserForDetail?.source)}
				<div class="border-border border-t pt-4">
					<div class="flex gap-2">
						<Button
							variant="outline"
							size="md"
							type="button"
							class="w-full gap-2"
							onclick={() => {
								if (!selectedUserForDetail) return;
								isMobileDetailOpen = false;
								openEditUserModal(selectedUserForDetail.source);
							}}
						>
							<Pencil size={16} />
							Edit user
						</Button>
					</div>
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
