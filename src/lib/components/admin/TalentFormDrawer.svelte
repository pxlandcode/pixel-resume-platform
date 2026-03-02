<script lang="ts">
	import { Button, FormControl, Input } from '@pixelcode_/blocks/components';
	import Drawer from '$lib/components/drawer/drawer.svelte';

	let { open = $bindable(false) } = $props();
	let avatarUrl = $state('');
	let avatarUploadError = $state<string | null>(null);
	let avatarUploading = $state(false);

	$effect(() => {
		if (!open) {
			avatarUrl = '';
			avatarUploadError = null;
			avatarUploading = false;
		}
	});

	const handleAvatarUpload = async (
		event: Event & { currentTarget: EventTarget & HTMLInputElement }
	) => {
		const inputEl = event.currentTarget;
		const file = inputEl.files?.[0];
		if (!file) return;
		if (!file.type.startsWith('image/')) {
			avatarUploadError = 'Please choose an image file.';
			inputEl.value = '';
			return;
		}
		if (file.size > 5 * 1024 * 1024) {
			avatarUploadError = 'Image must be 5MB or smaller.';
			inputEl.value = '';
			return;
		}

		avatarUploadError = null;
		avatarUploading = true;

		try {
			const payload = new FormData();
			payload.set('file', file);

			const response = await fetch('/internal/api/users/upload-avatar', {
				method: 'POST',
				body: payload
			});
			const result = await response.json().catch(() => null);

			if (!response.ok || typeof result?.url !== 'string') {
				const message =
					typeof result?.message === 'string'
						? result.message
						: `Avatar upload failed (${response.status}).`;
				throw new Error(message);
			}

			avatarUrl = result.url;
		} catch (error) {
			avatarUploadError = error instanceof Error ? error.message : 'Avatar upload failed.';
		} finally {
			avatarUploading = false;
			inputEl.value = '';
		}
	};
</script>

<Drawer
	variant="right"
	bind:open
	title="Create talent"
	subtitle="Create a standalone talent profile. Link it to a user in Users > Edit."
	class="mr-0 w-full max-w-2xl"
	dismissable
>
	<form method="POST" action="?/createTalent" class="flex flex-col gap-5 overflow-y-auto pb-16">
		<input type="hidden" name="avatar_url" value={avatarUrl} />

		<div class="grid gap-4 sm:grid-cols-2">
			<FormControl label="First name" class="gap-2 text-sm">
				<Input
					id="first_name"
					name="first_name"
					placeholder="First name"
					class="bg-input text-foreground"
				/>
			</FormControl>
			<FormControl label="Last name" class="gap-2 text-sm">
				<Input
					id="last_name"
					name="last_name"
					placeholder="Last name"
					class="bg-input text-foreground"
				/>
			</FormControl>
		</div>

		<FormControl label="Title" class="gap-2 text-sm">
			<Input
				id="title"
				name="title"
				placeholder="Title (optional)"
				class="bg-input text-foreground"
			/>
		</FormControl>

		<div class="border-border bg-card rounded-lg border p-4">
			<p class="text-foreground text-sm font-semibold">Employer lawful basis</p>
			<p class="text-muted-fg mt-1 text-xs">
				Required when creating a talent profile without a linked user account.
			</p>

			<div class="mt-3 grid gap-4">
				<FormControl label="Lawful basis type" class="gap-2 text-sm">
					<select
						id="lawful_basis_type"
						name="lawful_basis_type"
						required
						class="border-border bg-input text-foreground h-10 rounded border px-3 text-sm"
					>
						<option value="consent_obtained">Consent obtained</option>
						<option value="contract">Contract</option>
						<option value="legitimate_interest">Legitimate interest</option>
						<option value="other">Other</option>
					</select>
				</FormControl>

				<FormControl label="Details (optional)" class="gap-2 text-sm" tag="div">
					<textarea
						id="lawful_basis_details"
						name="lawful_basis_details"
						rows="3"
						class="border-border bg-input text-foreground w-full rounded border p-3 text-sm"
						placeholder="Add context or reference details"
					></textarea>
				</FormControl>

				<label class="text-foreground flex items-start gap-2 text-sm font-medium">
					<input
						type="checkbox"
						name="lawful_basis_confirmed"
						required
						class="mt-1 h-4 w-4 rounded border"
					/>
					I confirm lawful basis has been validated for creating this talent profile.
				</label>
			</div>
		</div>

		<FormControl label="Avatar" class="gap-2 text-sm" tag="div">
			{#if avatarUrl}
				<div class="border-border bg-muted w-24 overflow-hidden rounded-lg border">
					<img
						src={avatarUrl}
						alt="Talent avatar preview"
						class="aspect-square w-full object-cover"
					/>
				</div>
			{/if}

			<div class="flex flex-wrap items-center gap-2">
				<label
					class="border-border bg-input text-foreground hover:bg-muted/70 inline-flex cursor-pointer items-center rounded border px-3 py-2 text-sm"
				>
					<input
						type="file"
						accept="image/*"
						class="hidden"
						onchange={handleAvatarUpload}
						disabled={avatarUploading}
					/>
					{avatarUploading ? 'Uploading...' : avatarUrl ? 'Replace image' : 'Upload image'}
				</label>
				{#if avatarUrl}
					<Button
						type="button"
						variant="outline"
						size="sm"
						onclick={() => {
							avatarUrl = '';
							avatarUploadError = null;
						}}
					>
						Remove image
					</Button>
				{/if}
			</div>

			{#if avatarUploadError}
				<p class="text-xs text-red-600">{avatarUploadError}</p>
			{/if}

			<p class="text-muted-fg text-xs">PNG, JPG up to 5MB.</p>
		</FormControl>

		<p class="text-muted-fg text-xs">
			Provide first name, last name, or both. User linking is managed under user edit.
		</p>

		<div class="sticky bottom-0 flex flex-wrap justify-end gap-3 pt-4">
			<Button
				variant="outline"
				type="button"
				onclick={() => (open = false)}
				class="bg-input hover:bg-muted/70"
			>
				Cancel
			</Button>
			<Button variant="primary" type="submit">Create talent</Button>
		</div>
	</form>
</Drawer>
