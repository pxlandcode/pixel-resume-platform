<script lang="ts" module>
	export type UserRole = 'admin' | 'cms_admin' | 'employee' | 'employer';
</script>

<script lang="ts">
	import { Alert, Button, FormControl, Input } from '@pixelcode_/blocks/components';
	import PixelDrawer from '$lib/components/PixelDrawer.svelte';
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
		{ value: 'cms_admin', label: 'CMS Admin', description: 'Manage content and news.' },
		{ value: 'employee', label: 'Employee', description: 'Access resumes and profile.' },
		{ value: 'employer', label: 'Employer', description: 'Limited access to preboarding.' }
	];

	type InitialUser = {
		id: string;
		first_name: string;
		last_name: string;
		email: string;
		roles: UserRole[];
		avatar_url?: string | null;
		active: boolean;
	};

	let {
		open = $bindable(false),
		loading = $bindable(false),
		error = $bindable<string | null>(null),
		mode = $bindable<'create' | 'edit'>('create'),
		initial = $bindable<InitialUser>({
			id: '',
			first_name: '',
			last_name: '',
			email: '',
			roles: ['employee'],
			avatar_url: null,
			active: true
		})
	} = $props();

	const uploadEndpoint = '/internal/api/users/upload-avatar';

	type UppyInstance = InstanceType<typeof Uppy>;

	let uppy: UppyInstance | null = null;
	let uppyContainer: HTMLDivElement | null = null;

	let selectedRoles = $state<UserRole[]>(initial.roles ?? ['employee']);
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

	const showUploader = $derived(!previewUrl);

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
			selectedRoles = initial.roles ?? ['employee'];
			avatarUrl = initial.avatar_url ?? '';
			previewUrl = avatarUrl;
			isActive = initial.active ?? true;
			avatarError = null;
			isUploading = false;
			password = '';
			confirmPassword = '';
			passwordUnlocked = false;
			passwordError = null;
			resetUploaderState();

			lastInitialId = currentInitialId;
		}
	});

	$effect(() => {
		if (!open) {
			resetUploaderState();
			avatarError = null;
			isUploading = false;
			selectedRoles = initial.roles ?? ['employee'];
			avatarUrl = initial.avatar_url ?? '';
			previewUrl = avatarUrl;
			isActive = initial.active ?? true;
			password = '';
			confirmPassword = '';
			passwordUnlocked = false;
			passwordError = null;
		}
	});

	const title = $derived(mode === 'create' ? 'Create user' : 'Edit user');
	const submitLabel = $derived(mode === 'create' ? 'Create user' : 'Save changes');

	const close = () => {
		open = false;
		dispatch('close');
	};

	const toggleRole = (role: UserRole) => {
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
				selectedRoles = ['employee'];
				avatarUrl = '';
			}

			open = false;
		} catch (err) {
			dispatch('error', { message: err instanceof Error ? err.message : 'Request failed.' });
		}
	};
</script>

<PixelDrawer
	variant="right"
	bind:open
	{title}
	subtitle={mode === 'create'
		? 'Provision a new user with access and role.'
		: 'Update role or activation status.'}
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
					class="bg-white text-gray-900"
					value={initial.first_name}
				/>
			</FormControl>

			<FormControl label="Last name" required class="gap-2 text-sm">
				<Input
					id="last_name"
					name="last_name"
					required
					class="bg-white text-gray-900"
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
				class="bg-white text-gray-900"
				value={initial.email}
				readonly={mode === 'edit'}
			/>
		</FormControl>

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
						class="bg-white text-gray-900"
					/>
				</FormControl>
				<FormControl label="Confirm password" required class="gap-2 text-sm">
					<Input
						id="confirm_password"
						type="password"
						minlength={6}
						required
						bind:value={confirmPassword}
						class="bg-white text-gray-900"
					/>
				</FormControl>
			</div>
			{#if passwordError}
				<p class="-mt-2 text-sm text-red-600">{passwordError}</p>
			{/if}
		{:else}
			<div class="rounded-lg border border-slate-200 bg-white p-4">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-semibold text-gray-900">Password</p>
						<p class="text-xs text-gray-600">
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
								class="bg-white text-gray-900"
							/>
						</FormControl>
						<FormControl label="Confirm password" class="gap-2 text-sm">
							<Input
								id="confirm_password"
								type="password"
								minlength={6}
								bind:value={confirmPassword}
								class="bg-white text-gray-900"
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
				onclick={() => (isActive = !isActive)}
				class="group relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-in-out focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 {isActive
					? 'bg-emerald-500'
					: 'bg-gray-300'}"
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
						: 'text-gray-500'}"
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
			bl="Same image is used on the employee profile."
			tag="div"
		>
			<input type="hidden" name="avatar_url" value={avatarUrl} />
			<div class="flex flex-col gap-3">
				{#if previewUrl}
					<div class="flex flex-col gap-3">
						<div class="w-32 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
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
								class="border-gray-300 text-gray-700 hover:bg-gray-50"
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
					class="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-1.5"
				>
					<div bind:this={uppyContainer} class="uppy-container h-44 w-full" />
				</div>

				{#if avatarError}
					<Alert variant="destructive" size="sm">
						<p class="text-sm font-medium text-gray-900">{avatarError}</p>
					</Alert>
				{/if}

				{#if isUploading}
					<p class="text-xs font-medium text-gray-600">Uploading…</p>
				{/if}

				{#if !previewUrl}
					<p class="text-xs text-gray-500">
						Drag and drop an image or click to upload. PNG, JPG up to 5MB.
					</p>
				{/if}
			</div>
		</FormControl>

		<div class="rounded-lg border border-slate-200 bg-white p-4">
			<p class="text-sm font-semibold text-gray-900">Roles</p>
			<p class="mb-3 text-xs text-gray-600">
				Users can hold multiple roles. Employees get an editable profile and appear in the employee
				list.
			</p>
			<div class="grid gap-2 sm:grid-cols-2">
				{#each roleOptions as option}
					<label
						class="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 px-3 py-2 hover:border-slate-300"
					>
						<input
							type="checkbox"
							name="roles"
							value={option.value}
							checked={selectedRoles.includes(option.value)}
							onchange={() => toggleRole(option.value)}
							class="mt-1 h-4 w-4 rounded border-slate-300 text-gray-900 focus:ring-2 focus:ring-orange-400"
						/>
						<div class="space-y-1">
							<p class="text-sm font-medium text-gray-900">{option.label}</p>
							<p class="text-xs text-gray-600">{option.description}</p>
						</div>
					</label>
				{/each}
			</div>
		</div>

		{#if error}
			<Alert variant="destructive" size="sm">
				<p class="text-sm font-medium text-gray-900">{error}</p>
			</Alert>
		{/if}

		<div
			class="sticky bottom-0 flex flex-wrap justify-end gap-3 border-t border-slate-200 bg-white pt-4"
		>
			<Button variant="outline" type="button" onclick={close}>Cancel</Button>
			<Button variant="primary" type="submit" {loading} loading-text="Saving…">
				{submitLabel}
			</Button>
		</div>
	</form>
</PixelDrawer>

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
