<script lang="ts" module>
	export type UserRole = 'admin' | 'broker' | 'talent' | 'employer';
</script>

<script lang="ts">
	import { Alert, Button, FormControl, Input, Select } from '@pixelcode_/blocks/components';
	import Drawer from '$lib/components/drawer/drawer.svelte';
	import { createEventDispatcher, onDestroy, tick } from 'svelte';
	import Uppy from '@uppy/core';
	import Dashboard from '@uppy/dashboard';
	import XHRUpload from '@uppy/xhr-upload';
	import type { UppyFile } from '@uppy/utils/lib/UppyFile';
	import type { Body, Meta } from '@uppy/utils/lib/UppyFile';
	import { Lock, Unlock } from 'lucide-svelte';

	type AnyUppyFile = UppyFile<Meta, Body>;

	const dispatch = createEventDispatcher<{
		success: { message?: string };
		close: void;
		error: { message?: string };
	}>();

	const roleOptions: Array<{ value: UserRole; label: string; description: string }> = [
		{ value: 'admin', label: 'Admin', description: 'Full access to internal tools.' },
		{ value: 'broker', label: 'Broker', description: 'Manage content, resumes, and talent flows.' },
		{
			value: 'talent',
			label: 'Talent',
			description: 'Can access talent-facing flows when a talent record is linked.'
		},
		{ value: 'employer', label: 'Employer', description: 'Client-side access to assigned resumes.' }
	];

	type InitialUser = {
		id: string;
		first_name: string;
		last_name: string;
		email: string;
		roles: UserRole[];
		avatar_url?: string | null;
		active: boolean;
		linked_talent_id?: string | null;
	};

	type TalentOption = {
		id: string;
		first_name: string;
		last_name: string;
		user_id: string | null;
	};

	let {
		open = $bindable(false),
		loading = $bindable(false),
		error = $bindable<string | null>(null),
		mode = $bindable<'create' | 'edit'>('create'),
		talentOptions = $bindable<TalentOption[]>([]),
		allowedRoles = $bindable<UserRole[]>(['admin', 'broker', 'talent', 'employer']),
		canEditUsers = $bindable(true),
		initial = $bindable<InitialUser>({
			id: '',
			first_name: '',
			last_name: '',
			email: '',
			roles: ['talent'],
			avatar_url: null,
			active: true,
			linked_talent_id: null
		})
	} = $props();

	const uploadEndpoint = '/internal/api/users/upload-avatar';

	type UppyInstance = InstanceType<typeof Uppy>;

	let uppy: UppyInstance | null = null;
	let uppyContainer: HTMLDivElement | null = null;

	let selectedRoles = $state<UserRole[]>(initial.roles ?? ['talent']);
	let avatarUrl = $state(initial.avatar_url ?? '');
	let previewUrl = $state(avatarUrl);
	let avatarError = $state<string | null>(null);
	let isUploading = $state(false);
	let isActive = $state(initial.active ?? true);
	let tempObjectUrl: string | null = null;
	let password = $state('');
	let confirmPassword = $state('');
	let passwordUnlocked = $state(false);
	let passwordError = $state<string | null>(null);
	let linkedTalentId = $state(initial.linked_talent_id ?? '');

	const showUploader = $derived(!previewUrl);
	const availableTalentOptions = $derived.by(() => {
		if (mode !== 'edit' || !canEditUsers) return [] as TalentOption[];

		const filtered = talentOptions.filter(
			(talent) => !talent.user_id || talent.user_id === initial.id
		);
		if (!linkedTalentId) return filtered;

		const selected = talentOptions.find((talent) => talent.id === linkedTalentId);
		if (selected && !filtered.some((talent) => talent.id === selected.id)) {
			return [selected, ...filtered];
		}

		return filtered;
	});

	const formatTalentLabel = (talent: TalentOption) => {
		const name = [talent.first_name, talent.last_name].filter(Boolean).join(' ').trim();
		return name || talent.id;
	};

	const allowedRoleSet = $derived(new Set(allowedRoles));
	const visibleRoleOptions = $derived(roleOptions.filter((option) => allowedRoleSet.has(option.value)));

	const revokeTempObjectUrl = () => {
		if (tempObjectUrl) {
			URL.revokeObjectURL(tempObjectUrl);
			tempObjectUrl = null;
		}
	};

	const setPreviewFromLocalFile = (file: AnyUppyFile) => {
		const blob = file.data as Blob | undefined;
		if (!blob) return;

		revokeTempObjectUrl();
		tempObjectUrl = URL.createObjectURL(blob);
		previewUrl = tempObjectUrl;
	};

	const resetUploaderState = () => {
		if (!uppy) {
			return;
		}

		uppy.cancelAll();
		uppy.resetProgress();
		revokeTempObjectUrl();
	};

	const destroyUppy = () => {
		if (!uppy) {
			return;
		}

		uppy.cancelAll();
		uppy.destroy();
		if (uppyContainer) {
			uppyContainer.innerHTML = '';
		}
		uppy = null;
		revokeTempObjectUrl();
	};

	const handleReplaceImage = () => {
		avatarUrl = '';
		previewUrl = '';
		avatarError = null;
		isUploading = false;
		resetUploaderState();
	};

	const initializeUppy = () => {
		if (uppy || !uppyContainer) {
			return;
		}

		uppy = new Uppy({
			autoProceed: true,
			allowMultipleUploads: false,
			restrictions: {
				maxNumberOfFiles: 1,
				allowedFileTypes: ['image/*']
			}
		});

		uppy.use(Dashboard, {
			target: uppyContainer,
			inline: true,
			proudlyDisplayPoweredByUppy: false,
			showRemoveButtonAfterComplete: true,
			note: 'PNG, JPG up to 5MB'
		});

		uppy.use(XHRUpload, {
			endpoint: uploadEndpoint,
			fieldName: 'file',
			formData: true,
			withCredentials: true,
			limit: 1,
			allowedMetaFields: []
		});

		uppy.on('file-added', (file) => {
			setPreviewFromLocalFile(file as AnyUppyFile);
		});

		uppy.on('file-removed', () => {
			revokeTempObjectUrl();
			if (!avatarUrl) {
				previewUrl = '';
			}
		});

		uppy.on('upload', () => {
			isUploading = true;
			avatarError = null;
		});

		uppy.on('upload-error', (_file, error) => {
			isUploading = false;
			avatarError = error?.message ?? 'Upload failed. Please try again.';
		});

		uppy.on('upload-success', (_file, response) => {
			isUploading = false;
			avatarError = null;

			const url = response?.body?.url as string | undefined;

			if (!url) {
				avatarError = 'Upload succeeded but no URL was returned.';
				return;
			}

			revokeTempObjectUrl();
			avatarUrl = url;
			previewUrl = url;
		});

		uppy.on('complete', () => {
			isUploading = false;
		});
	};

	$effect(() => {
		if (open) {
			void (async () => {
				await tick();
				if (!open) {
					return;
				}
				if (uppyContainer && !uppy) {
					initializeUppy();
				}
			})();
		} else {
			destroyUppy();
		}
	});

	onDestroy(() => {
		destroyUppy();
	});

	let lastInitialId = $state(initial?.id ?? null);

	$effect(() => {
		const currentInitialId = initial?.id ?? null;

		if (currentInitialId !== lastInitialId) {
			selectedRoles = initial.roles ?? ['talent'];
			avatarUrl = initial.avatar_url ?? '';
			previewUrl = avatarUrl;
			isActive = initial.active ?? true;
			avatarError = null;
			isUploading = false;
			password = '';
			confirmPassword = '';
			passwordUnlocked = false;
			passwordError = null;
			linkedTalentId = initial.linked_talent_id ?? '';
			resetUploaderState();

			lastInitialId = currentInitialId;
		}
	});

	$effect(() => {
		if (!open) {
			resetUploaderState();
			avatarError = null;
			isUploading = false;
			selectedRoles = initial.roles ?? ['talent'];
			avatarUrl = initial.avatar_url ?? '';
			previewUrl = avatarUrl;
			isActive = initial.active ?? true;
			password = '';
			confirmPassword = '';
			passwordUnlocked = false;
			passwordError = null;
			linkedTalentId = initial.linked_talent_id ?? '';
		}
	});

	const title = $derived(mode === 'create' ? 'Create user' : 'Edit user');
	const submitLabel = $derived(mode === 'create' ? 'Create user' : 'Save changes');

	const close = () => {
		open = false;
		dispatch('close');
	};

	const toggleRole = (role: UserRole) => {
		if (!allowedRoleSet.has(role)) return;
		selectedRoles = selectedRoles.includes(role)
			? selectedRoles.filter((r) => r !== role)
			: [...selectedRoles, role];
	};

	const handleSubmit = async (event: SubmitEvent) => {
		event.preventDefault();
		const form = event.currentTarget as HTMLFormElement;
		const formData = new FormData(form);
		error = null;
		passwordError = null;

		if (selectedRoles.length === 0) {
			dispatch('error', { message: 'Select at least one role.' });
			return;
		}
		if (selectedRoles.some((role) => !allowedRoleSet.has(role))) {
			dispatch('error', { message: 'Selected roles are not allowed for your account.' });
			return;
		}

		// Password validation
		const shouldValidatePassword = mode === 'create' || passwordUnlocked;
		if (shouldValidatePassword && password) {
			if (password !== confirmPassword) {
				passwordError = 'Passwords do not match.';
				return;
			}
			if (password.length < 6) {
				passwordError = 'Password must be at least 6 characters.';
				return;
			}
		}

		// In create mode, password is required
		if (mode === 'create' && !password) {
			passwordError = 'Password is required.';
			return;
		}

		// Ensure roles and avatar are included explicitly
		formData.delete('roles');
		selectedRoles.forEach((role) => formData.append('roles', role));
		formData.set('avatar_url', avatarUrl);
		if (mode === 'edit') {
			formData.set('linked_talent_id', linkedTalentId);
		}

		try {
			if (mode === 'create') {
				const payload = Object.fromEntries(formData.entries());
				const response = await fetch('/api/create-user', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						...payload,
						roles: selectedRoles,
						avatar_url: avatarUrl
					})
				});

				if (!response.ok) {
					const detail = await response.json().catch(() => null);
					dispatch('error', { message: detail?.message ?? 'Request failed.' });
					return;
				}
			} else {
				const response = await fetch('?/updateUser', { method: 'POST', body: formData });

				if (!response.ok) {
					const detail = await response.json().catch(() => null);
					dispatch('error', { message: detail?.message ?? 'Request failed.' });
					return;
				}
			}

			dispatch('success', { message: mode === 'create' ? 'User created.' : 'User updated.' });

			// Reset only when creating; keep selections on edit so the state mirrors what was saved.
			if (mode === 'create') {
				form.reset();
				selectedRoles = ['talent'];
				avatarUrl = '';
			}

			open = false;
		} catch (err) {
			dispatch('error', { message: err instanceof Error ? err.message : 'Request failed.' });
		}
	};
</script>

<Drawer
	variant="right"
	bind:open
	{title}
	subtitle={mode === 'create'
		? 'Provision a new user with access and role.'
		: 'Update role, activation status, and talent link.'}
	class="mr-0 w-full max-w-2xl"
	dismissable
>
	<form class="flex flex-col gap-5 overflow-y-auto pb-16" onsubmit={handleSubmit}>
		{#if mode === 'edit'}
			<input type="hidden" name="user_id" value={initial.id} />
		{/if}

		<div class="grid gap-4 sm:grid-cols-2">
			<FormControl label="First name" required class="gap-2 text-sm">
				<Input
					id="first_name"
					name="first_name"
					required
					class="bg-input text-foreground"
					value={initial.first_name}
				/>
			</FormControl>

			<FormControl label="Last name" required class="gap-2 text-sm">
				<Input
					id="last_name"
					name="last_name"
					required
					class="bg-input text-foreground"
					value={initial.last_name}
				/>
			</FormControl>
		</div>

		<FormControl label="Email" required class="gap-2 text-sm">
			<Input
				id="email"
				name="email"
				type="email"
				required
				class="bg-input text-foreground"
				value={initial.email}
				readonly={mode === 'edit'}
			/>
		</FormControl>

		{#if mode === 'edit' && canEditUsers}
			<FormControl
				label="Linked talent"
				class="gap-2 text-sm"
				bl="Link this user to one talent profile. Existing linking is managed here in edit mode."
			>
				<Select
					id="linked_talent_id"
					name="linked_talent_id"
					bind:value={linkedTalentId}
					class="bg-input text-foreground"
				>
					<option value="">No linked talent</option>
					{#each availableTalentOptions as talent (talent.id)}
						<option value={talent.id}>{formatTalentLabel(talent)}</option>
					{/each}
				</Select>
				{#if availableTalentOptions.length === 0 && !linkedTalentId}
					<p class="text-muted-fg text-xs">
						No unlinked talents are available right now. Create a talent first.
					</p>
				{/if}
			</FormControl>
		{/if}

		{#if mode === 'create'}
			<div class="grid gap-4 sm:grid-cols-2">
				<FormControl label="Password" required class="gap-2 text-sm">
					<Input
						id="password"
						name="password"
						type="password"
						minlength={6}
						required
						bind:value={password}
						class="bg-input text-foreground"
					/>
				</FormControl>
				<FormControl label="Confirm password" required class="gap-2 text-sm">
					<Input
						id="confirm_password"
						type="password"
						minlength={6}
						required
						bind:value={confirmPassword}
						class="bg-input text-foreground"
					/>
				</FormControl>
			</div>
			{#if passwordError}
				<p class="-mt-2 text-sm text-red-600">{passwordError}</p>
			{/if}
		{:else}
			<div class="border-border bg-card rounded-lg border p-4">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-foreground text-sm font-semibold">Password</p>
						<p class="text-muted-fg text-xs">
							{passwordUnlocked
								? 'Enter a new password to change it.'
								: 'Unlock to change the password.'}
						</p>
					</div>
					<Button
						type="button"
						variant="outline"
						size="sm"
						class="gap-2"
						onclick={() => {
							passwordUnlocked = !passwordUnlocked;
							if (!passwordUnlocked) {
								password = '';
								confirmPassword = '';
								passwordError = null;
							}
						}}
					>
						{#if passwordUnlocked}
							<Unlock class="h-4 w-4" />
							Lock
						{:else}
							<Lock class="h-4 w-4" />
							Unlock
						{/if}
					</Button>
				</div>
				{#if passwordUnlocked}
					<div class="mt-4 grid gap-4 sm:grid-cols-2">
						<FormControl label="New password" class="gap-2 text-sm">
							<Input
								id="password"
								name="password"
								type="password"
								minlength={6}
								bind:value={password}
								class="bg-input text-foreground"
							/>
						</FormControl>
						<FormControl label="Confirm password" class="gap-2 text-sm">
							<Input
								id="confirm_password"
								type="password"
								minlength={6}
								bind:value={confirmPassword}
								class="bg-input text-foreground"
							/>
						</FormControl>
					</div>
					{#if passwordError}
						<p class="mt-2 text-sm text-red-600">{passwordError}</p>
					{/if}
				{/if}
			</div>
		{/if}

		<FormControl label="Active" class="gap-2 text-sm" tag="div">
			<input type="hidden" name="active" value={isActive ? 'true' : 'false'} />
			<button
				type="button"
				role="switch"
				aria-checked={isActive}
				onclick={() => {
					if (!canEditUsers) return;
					isActive = !isActive;
				}}
				class="group relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-in-out focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 {isActive
					? 'bg-emerald-500'
					: 'bg-muted'}"
			>
				<span
					class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out {isActive
						? 'translate-x-6'
						: 'translate-x-1'}"
				/>
			</button>
			<div class="mt-1 flex items-center gap-2">
				<span
					class="inline-flex items-center gap-1.5 text-sm {isActive
						? 'text-emerald-700'
						: 'text-muted-fg'}"
				>
				{#if isActive}
						<svg
							class="h-4 w-4"
							fill="none"
							viewBox="0 0 24 24"
							stroke-width="2"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						Active — can sign in
					{:else}
						<svg
							class="h-4 w-4"
							fill="none"
							viewBox="0 0 24 24"
							stroke-width="2"
							stroke="currentColor"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
							/>
						</svg>
						Inactive — cannot sign in
					{/if}
				</span>
			</div>
		</FormControl>

		<FormControl
			label="Avatar"
			class="gap-2 text-sm"
			bl="Profile avatar for this user account. Talent avatars are managed on talent records."
			tag="div"
		>
			<input type="hidden" name="avatar_url" value={avatarUrl} />
			<div class="flex flex-col gap-3">
				{#if previewUrl}
					<div class="flex flex-col gap-3">
						<div class="border-border bg-muted w-32 overflow-hidden rounded-lg border">
							<img
								src={previewUrl}
								alt="Avatar preview"
								class="aspect-square w-full object-cover"
							/>
						</div>

						<div class="flex flex-wrap items-center gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								class="border-border text-muted-fg hover:bg-muted/70"
								onclick={handleReplaceImage}
								disabled={isUploading}
							>
								Replace image
							</Button>
						</div>
					</div>
				{/if}

				<div
					class:hidden={!showUploader}
					class="border-border bg-muted rounded-lg border border-dashed p-1.5"
				>
					<div bind:this={uppyContainer} class="uppy-container h-44 w-full" />
				</div>

				{#if avatarError}
					<Alert variant="destructive" size="sm">
						<p class="text-foreground text-sm font-medium">{avatarError}</p>
					</Alert>
				{/if}

				{#if isUploading}
					<p class="text-muted-fg text-xs font-medium">Uploading…</p>
				{/if}

				{#if !previewUrl}
					<p class="text-muted-fg text-xs">
						Drag and drop an image or click to upload. PNG, JPG up to 5MB.
					</p>
				{/if}
			</div>
			{#if !canEditUsers}
				<p class="text-muted-fg text-xs">Account activation is managed by admins.</p>
			{/if}
		</FormControl>

		<div class="border-border bg-card rounded-lg border p-4">
			<p class="text-foreground text-sm font-semibold">Roles</p>
			<p class="text-muted-fg mb-3 text-xs">
				Users can hold multiple roles. Talent records are separate and must be linked explicitly.
			</p>
			<div class="grid gap-2 sm:grid-cols-2">
				{#each visibleRoleOptions as option (option.value)}
					<label
						class="border-border hover:border-border/80 flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2"
					>
						<input
							type="checkbox"
							name="roles"
							value={option.value}
							checked={selectedRoles.includes(option.value)}
							onchange={() => toggleRole(option.value)}
							class="border-border text-foreground mt-1 h-4 w-4 rounded focus:ring-2 focus:ring-primary/60"
						/>
						<div class="space-y-1">
							<p class="text-foreground text-sm font-medium">{option.label}</p>
							<p class="text-muted-fg text-xs">{option.description}</p>
						</div>
					</label>
				{/each}
			</div>
		</div>

		{#if error}
			<Alert variant="destructive" size="sm">
				<p class="text-foreground text-sm font-medium">{error}</p>
			</Alert>
		{/if}

		<div
			class="sticky bottom-0 flex flex-wrap justify-end gap-3 pt-4 {mode === 'edit'
				? 'bg-transparent'
				: 'border-border bg-card border-t'}"
		>
			<Button
				variant="outline"
				type="button"
				onclick={close}
				class={mode === 'edit' ? 'bg-input hover:bg-muted/70' : ''}
			>
				Cancel
			</Button>
			<Button variant="primary" type="submit" {loading} loading-text="Saving…">
				{submitLabel}
			</Button>
		</div>
	</form>
</Drawer>

<style>
	:global(.uppy-container .uppy-Dashboard) {
		height: 100%;
		background: transparent;
		border: none;
		box-shadow: none;
	}

	:global(.uppy-container .uppy-Dashboard-inner) {
		min-height: 180px;
		max-height: 180px;
	}

	:global(.uppy-container .uppy-Dashboard-AddFiles) {
		min-height: 160px;
	}
</style>
