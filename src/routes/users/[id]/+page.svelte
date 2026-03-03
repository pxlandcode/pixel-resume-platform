<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { Alert, Badge, Button, FormControl, Input, Select } from '@pixelcode_/blocks/components';
	import { ArrowLeft, Lock, Unlock, User } from 'lucide-svelte';
	import Uppy from '@uppy/core';
	import Dashboard from '@uppy/dashboard';
	import XHRUpload from '@uppy/xhr-upload';
	import type { UppyFile } from '@uppy/utils/lib/UppyFile';
	import type { Body, Meta } from '@uppy/utils/lib/UppyFile';
	import {
		applyImageFallbackOnce,
		getOriginalImageUrl,
		supabaseImagePresets,
		transformSupabasePublicUrl,
		transformSupabasePublicUrlSrcSet
	} from '$lib/images/supabaseImage';
	import { onDestroy, tick } from 'svelte';

	type AnyUppyFile = UppyFile<Meta, Body>;
	type Role = 'admin' | 'broker' | 'talent' | 'employer';

	type TalentOption = {
		id: string;
		first_name: string;
		last_name: string;
		user_id: string | null;
	};

	let { data, form } = $props();
	const user = $derived(data.user);
	const talents = $derived(data.talents as TalentOption[]);
	const canEditUsers = $derived(Boolean(data.canEditUsers));
	const allowedEditRoles = $derived((data.allowedEditRoles as Role[] | undefined) ?? ['talent']);

	const roleOptions: Array<{ value: Role; label: string; description: string }> = [
		{ value: 'admin', label: 'Admin', description: 'Full access to internal tools.' },
		{ value: 'broker', label: 'Broker', description: 'Manage content, resumes, and talent flows.' },
		{
			value: 'talent',
			label: 'Talent',
			description: 'Can access talent-facing flows when a talent record is linked.'
		},
		{ value: 'employer', label: 'Employer', description: 'Client-side access to assigned resumes.' }
	];

	let feedback = $state<{ type: 'success' | 'error'; message: string } | null>(null);
	let selectedRoles = $state<Role[]>([]);
	let avatarUrl = $state('');
	let previewUrl = $state('');
	let avatarError = $state<string | null>(null);
	let isUploading = $state(false);
	let isActive = $state(true);
	let password = $state('');
	let confirmPassword = $state('');
	let passwordUnlocked = $state(false);
	let passwordError = $state<string | null>(null);
	let linkedTalentId = $state('');
	let tempObjectUrl: string | null = null;

	// Initialize state from user data
	$effect(() => {
		selectedRoles = user.roles ?? ['talent'];
		avatarUrl = user.avatar_url ?? '';
		previewUrl = user.avatar_url ?? '';
		isActive = user.active ?? true;
		linkedTalentId = user.linked_talent_id ?? '';
	});

	const uploadEndpoint = '/internal/api/users/upload-avatar';

	type UppyInstance = InstanceType<typeof Uppy>;
	let uppy: UppyInstance | null = null;
	let uppyContainer = $state<HTMLDivElement | null>(null);

	const allowedRoleSet = $derived(new Set(allowedEditRoles));
	const visibleRoleOptions = $derived(
		roleOptions.filter((option) => allowedRoleSet.has(option.value))
	);

	const availableTalentOptions = $derived.by(() => {
		if (!canEditUsers) return [] as TalentOption[];
		const filtered = talents.filter((talent) => !talent.user_id || talent.user_id === user.id);
		if (!linkedTalentId) return filtered;
		const selected = talents.find((talent) => talent.id === linkedTalentId);
		if (selected && !filtered.some((talent) => talent.id === selected.id)) {
			return [selected, ...filtered];
		}
		return filtered;
	});

	const formatTalentLabel = (talent: TalentOption) => {
		const name = [talent.first_name, talent.last_name].filter(Boolean).join(' ').trim();
		return name || talent.id;
	};

	const showUploader = $derived(!previewUrl);
	const avatarDetailSrc = (url: string | null | undefined) =>
		transformSupabasePublicUrl(url, supabaseImagePresets.avatarProfile);
	const avatarDetailSrcSet = (url: string | null | undefined) =>
		transformSupabasePublicUrlSrcSet(url, [96, 160, 240], {
			height: supabaseImagePresets.avatarProfile.height,
			quality: supabaseImagePresets.avatarProfile.quality,
			resize: supabaseImagePresets.avatarProfile.resize
		});
	const avatarPreviewSrc = (url: string | null | undefined) =>
		transformSupabasePublicUrl(url, supabaseImagePresets.avatarList);
	const avatarPreviewSrcSet = (url: string | null | undefined) =>
		transformSupabasePublicUrlSrcSet(url, [128, 256], {
			height: supabaseImagePresets.avatarList.height,
			quality: supabaseImagePresets.avatarList.quality,
			resize: supabaseImagePresets.avatarList.resize
		});
	const avatarFallbackSrc = (url: string | null | undefined) => getOriginalImageUrl(url);

	$effect(() => {
		if (form?.type !== 'updateUser') return;
		feedback = {
			type: form.ok ? 'success' : 'error',
			message: form.message ?? ''
		};
	});

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
		if (!uppy) return;
		uppy.cancelAll();
		uppy.resetProgress();
		revokeTempObjectUrl();
	};

	const destroyUppy = () => {
		if (!uppy) return;
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
		if (uppy || !uppyContainer) return;

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
		void (async () => {
			await tick();
			if (showUploader && uppyContainer && !uppy) {
				initializeUppy();
			}
		})();
	});

	onDestroy(() => {
		destroyUppy();
	});

	const toggleRole = (role: Role) => {
		if (!allowedRoleSet.has(role)) return;
		selectedRoles = selectedRoles.includes(role)
			? selectedRoles.filter((r) => r !== role)
			: [...selectedRoles, role];
	};

	const formatDate = (dateString: string | null) => {
		if (!dateString) return 'Never';
		return new Date(dateString).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	};

	const handleSubmit = async (event: SubmitEvent) => {
		passwordError = null;

		if (selectedRoles.length === 0) {
			event.preventDefault();
			feedback = { type: 'error', message: 'Select at least one role.' };
			return;
		}

		if (passwordUnlocked && password) {
			if (password !== confirmPassword) {
				event.preventDefault();
				passwordError = 'Passwords do not match.';
				return;
			}
			if (password.length < 6) {
				event.preventDefault();
				passwordError = 'Password must be at least 6 characters.';
				return;
			}
		}
	};
</script>

<div class="mx-auto max-w-4xl space-y-6">
	<div class="flex items-center gap-4">
		<Button variant="ghost" size="sm" onclick={() => goto('/users')} class="gap-2">
			<ArrowLeft size={16} />
			Back to users
		</Button>
	</div>

	{#if feedback}
		<Alert variant={feedback.type === 'success' ? 'success' : 'destructive'} size="sm">
			<p class="text-foreground text-sm font-medium">{feedback.message}</p>
		</Alert>
	{/if}

	<div class="bg-card border-border rounded-lg border p-6">
		<div class="mb-6 flex items-start gap-6">
			{#if user.avatar_url}
				<img
					src={avatarDetailSrc(user.avatar_url)}
					srcset={avatarDetailSrcSet(user.avatar_url)}
					sizes="96px"
					alt="{user.first_name} {user.last_name}"
					class="border-border h-24 w-24 rounded-full border object-cover"
					loading="lazy"
					decoding="async"
					onerror={(event) => applyImageFallbackOnce(event, avatarFallbackSrc(user.avatar_url))}
				/>
			{:else}
				<div
					class="bg-muted border-border flex h-24 w-24 items-center justify-center rounded-full border"
				>
					<User size={40} class="text-muted-fg" />
				</div>
			{/if}
			<div class="flex-1">
				<h1 class="text-foreground text-2xl font-semibold">
					{user.first_name || user.last_name
						? `${user.first_name} ${user.last_name}`.trim()
						: 'Unknown User'}
				</h1>
				<p class="text-muted-fg text-sm">{user.email ?? 'No email'}</p>
				<div class="mt-2 flex flex-wrap items-center gap-2">
					{#each user.roles as role (role)}
						<Badge variant="default" size="xs" class="uppercase tracking-wide">
							{role.replace('_', ' ')}
						</Badge>
					{/each}
					{#if user.active}
						<Badge variant="success" size="xs">Active</Badge>
					{:else}
						<Badge variant="destructive" size="xs">Inactive</Badge>
					{/if}
				</div>
			</div>
		</div>

		<div class="border-border mb-6 grid gap-4 border-t pt-6 sm:grid-cols-2">
			<div>
				<p class="text-muted-fg text-xs font-medium uppercase tracking-wide">Organisation</p>
				<p class="text-foreground text-sm font-medium">
					{user.organisation_name ?? 'Unassigned'}
				</p>
			</div>
			<div>
				<p class="text-muted-fg text-xs font-medium uppercase tracking-wide">Linked Talent</p>
				<p class="text-foreground text-sm font-medium">
					{user.linked_talent_name ?? 'None'}
				</p>
			</div>
			<div>
				<p class="text-muted-fg text-xs font-medium uppercase tracking-wide">Created</p>
				<p class="text-foreground text-sm font-medium">
					{formatDate(user.created_at)}
				</p>
			</div>
			<div>
				<p class="text-muted-fg text-xs font-medium uppercase tracking-wide">Last Sign In</p>
				<p class="text-foreground text-sm font-medium">
					{formatDate(user.last_sign_in_at)}
				</p>
			</div>
		</div>
	</div>

	{#if canEditUsers}
		<div class="bg-card border-border rounded-lg border p-6">
			<h2 class="text-foreground mb-4 text-lg font-semibold">Edit User</h2>

			<form
				method="POST"
				action="?/updateUser"
				class="flex flex-col gap-5"
				onsubmit={handleSubmit}
				use:enhance
			>
				<div class="grid gap-4 sm:grid-cols-2">
					<FormControl label="First name" required class="gap-2 text-sm">
						<Input
							id="first_name"
							name="first_name"
							required
							class="bg-input text-foreground"
							value={user.first_name}
						/>
					</FormControl>

					<FormControl label="Last name" required class="gap-2 text-sm">
						<Input
							id="last_name"
							name="last_name"
							required
							class="bg-input text-foreground"
							value={user.last_name}
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
						value={user.email ?? ''}
						readonly
					/>
				</FormControl>

				<FormControl label="Linked talent" class="gap-2 text-sm">
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

				<FormControl label="Roles" required class="gap-2 text-sm" tag="div">
					<div class="grid gap-2 sm:grid-cols-2">
						{#each visibleRoleOptions as option (option.value)}
							<button
								type="button"
								onclick={() => toggleRole(option.value)}
								class="border-border hover:bg-muted/50 flex items-start gap-3 rounded-lg border p-3 text-left transition-colors {selectedRoles.includes(
									option.value
								)
									? 'bg-primary/5 border-primary/50'
									: 'bg-card'}"
							>
								<input
									type="checkbox"
									name="roles"
									value={option.value}
									checked={selectedRoles.includes(option.value)}
									class="pointer-events-none mt-0.5"
									tabindex={-1}
								/>
								<div>
									<span class="text-foreground text-sm font-medium">{option.label}</span>
									<p class="text-muted-fg text-xs">{option.description}</p>
								</div>
							</button>
						{/each}
					</div>
				</FormControl>

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

				<FormControl label="Active" class="gap-2 text-sm" tag="div">
					<input type="hidden" name="active" value={isActive ? 'true' : 'false'} />
					<button
						type="button"
						role="switch"
						aria-checked={isActive}
						aria-label="Toggle active status"
						onclick={() => {
							isActive = !isActive;
						}}
						class="focus-visible:ring-primary/60 group relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-in-out focus-visible:ring-2 focus-visible:ring-offset-2 {isActive
							? 'bg-emerald-500'
							: 'bg-muted'}"
					>
						<span
							class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out {isActive
								? 'translate-x-6'
								: 'translate-x-1'}"
						></span>
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

				<FormControl label="Avatar" class="gap-2 text-sm" tag="div">
					<input type="hidden" name="avatar_url" value={avatarUrl} />
					<div class="flex flex-col gap-3">
						{#if previewUrl}
							<div class="flex flex-col gap-3">
								<div class="border-border bg-muted w-32 overflow-hidden rounded-lg border">
									<img
										src={avatarPreviewSrc(previewUrl)}
										srcset={avatarPreviewSrcSet(previewUrl)}
										sizes="128px"
										alt="Avatar preview"
										class="aspect-square w-full object-cover"
										loading="lazy"
										decoding="async"
										onerror={(event) =>
											applyImageFallbackOnce(event, avatarFallbackSrc(previewUrl))}
									/>
								</div>
								<div class="flex flex-wrap items-center gap-2">
									<Button
										type="button"
										variant="outline"
										size="sm"
										class="border-border text-muted-fg hover:bg-muted/70"
										onclick={handleReplaceImage}
									>
										Replace image
									</Button>
								</div>
							</div>
						{:else}
							<div bind:this={uppyContainer} class="uppy-container max-w-sm"></div>
						{/if}
						{#if avatarError}
							<p class="text-sm text-red-600">{avatarError}</p>
						{/if}
						{#if isUploading}
							<p class="text-muted-fg text-sm">Uploading...</p>
						{/if}
					</div>
				</FormControl>

				<div class="border-border flex justify-end gap-3 border-t pt-4">
					<Button variant="outline" size="md" type="button" onclick={() => goto('/users')}>
						Cancel
					</Button>
					<Button variant="primary" size="md" type="submit">Save changes</Button>
				</div>
			</form>
		</div>
	{/if}
</div>

<style>
	:global(.uppy-container .uppy-Dashboard-inner) {
		width: 100% !important;
		min-height: 200px;
	}
</style>
