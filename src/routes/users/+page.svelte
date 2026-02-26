<script lang="ts">
	import UserTable from '$lib/components/admin/UserTable.svelte';
	import UserFormModal from '$lib/components/admin/UserFormModal.svelte';
	import { Alert, Button } from '@pixelcode_/blocks/components';

	let { data, form } = $props();

	let isModalOpen = $state(false);
	let feedback = $state<{ type: 'success' | 'error'; message: string } | null>(null);
	let editUser = $state(data.users[0] ?? null);
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
		<h1 class="text-2xl font-semibold text-gray-900">Users</h1>
		<p class="text-sm text-gray-700">Invite teammates and adjust their permissions.</p>
	</div>
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
				roles: ['employee'],
				avatar_url: null,
				active: true
			};
			isModalOpen = true;
		}}
	>
		Create user
	</Button>
</div>

{#if feedback}
	<Alert class="mt-4" variant={feedback.type === 'success' ? 'success' : 'destructive'} size="sm">
		<p class="text-sm font-medium text-gray-900">{feedback.message}</p>
	</Alert>
{/if}

<div class="mt-6">
	<UserTable
		users={data.users}
		{form}
		onEdit={(u) => {
			editMode = 'edit';
			editUser = u;
			isModalOpen = true;
		}}
	/>
</div>

<UserFormModal
	bind:open={isModalOpen}
	mode={editMode}
	initial={editUser ?? undefined}
	on:success={handleUserCreated}
	on:error={handleCreateError}
	on:close={() => (isModalOpen = false)}
/>
