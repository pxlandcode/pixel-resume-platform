<script lang="ts">
	import UserTable from '$lib/components/admin/UserTable.svelte';
	import UserFormModal from '$lib/components/admin/UserFormModal.svelte';
	import { Alert, Button } from '@pixelcode_/blocks/components';

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
	const allowedCreateRoles = $derived((data.allowedCreateRoles as Role[] | undefined) ?? ['talent']);
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
</script>

<div class="flex items-center justify-between">
	<div>
		<h1 class="text-foreground text-2xl font-semibold">Users</h1>
		<p class="text-muted-fg text-sm">Invite teammates and adjust their permissions.</p>
	</div>
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

{#if feedback}
	<Alert class="mt-4" variant={feedback.type === 'success' ? 'success' : 'destructive'} size="sm">
		<p class="text-foreground text-sm font-medium">{feedback.message}</p>
	</Alert>
{/if}

<div class="mt-6">
	<UserTable
		users={data.users}
		{form}
		showEdit={canEditUsers}
		onEdit={(u) => {
			editMode = 'edit';
			editUser = toEditableUser(u as LoadUser);
			isModalOpen = true;
		}}
	/>
</div>

<UserFormModal
	bind:open={isModalOpen}
	mode={editMode}
	talentOptions={data.talents ?? []}
	allowedRoles={allowedCreateRoles}
	canEditUsers={canEditUsers}
	initial={editUser ?? undefined}
	on:success={handleUserCreated}
	on:error={handleCreateError}
	on:close={() => (isModalOpen = false)}
/>
