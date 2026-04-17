<script lang="ts">
	import { Alert, Button, Checkbox, FormControl, Input } from '@pixelcode_/blocks/components';
	import { Dropdown, type DropdownOption } from '$lib/components/dropdown';
	import Drawer from '$lib/components/drawer/drawer.svelte';
	import { confirm } from '$lib/utils/confirm';
	import { createEventDispatcher } from 'svelte';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import {
		applyImageFallbackOnce,
		getOriginalImageUrl,
		supabaseImagePresets,
		transformSupabasePublicUrl,
		transformSupabasePublicUrlSrcSet
	} from '$lib/images/supabaseImage';

	type TalentFormMode = 'create' | 'edit';
	type LawfulBasisType = 'consent_obtained' | 'contract' | 'legitimate_interest' | 'other';
	type EditableTalent = {
		id: string;
		user_id: string | null;
		first_name: string;
		last_name: string;
		avatar_url: string | null;
		title: string;
		resume_count: number;
		can_edit: boolean;
		organisation_name?: string | null;
	};

	const dispatch = createEventDispatcher<{
		success: { action: 'create' | 'update' | 'delete'; message: string; talentId: string | null };
		error: { action: 'create' | 'update' | 'delete'; message: string; talentId: string | null };
	}>();

	let {
		open = $bindable(false),
		mode = 'create',
		talent = null
	}: {
		open: boolean;
		mode?: TalentFormMode;
		talent?: EditableTalent | null;
	} = $props();

	const lawfulBasisOptions = [
		{ label: 'Consent obtained', value: 'consent_obtained' },
		{ label: 'Contract', value: 'contract' },
		{ label: 'Legitimate interest', value: 'legitimate_interest' },
		{ label: 'Other', value: 'other' }
	] satisfies DropdownOption<LawfulBasisType>[];

	const lawfulBasisDescriptions: Record<LawfulBasisType, string> = {
		consent_obtained:
			'The person has clearly agreed to this specific use of their profile data and can withdraw that consent later.',
		contract:
			'The profile is genuinely necessary to prepare, enter into, or perform an agreement with the person.',
		legitimate_interest:
			"The organisation has a documented business need for the profile, and that need does not override the person's rights and expectations.",
		other:
			'Use this only when relying on another lawful basis and record the basis and reference details below.'
	};

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

	const avatarPreviewSrc = (url: string | null | undefined) =>
		transformSupabasePublicUrl(url, supabaseImagePresets.avatarList);
	const avatarPreviewSrcSet = (url: string | null | undefined) =>
		transformSupabasePublicUrlSrcSet(url, [96, 192], {
			height: supabaseImagePresets.avatarList.height,
			quality: supabaseImagePresets.avatarList.quality,
			resize: supabaseImagePresets.avatarList.resize
		});
	const avatarPreviewFallbackSrc = (url: string | null | undefined) => getOriginalImageUrl(url);

	let firstName = $state('');
	let lastName = $state('');
	let title = $state('');
	let avatarUrl = $state('');
	let avatarUploadError = $state<string | null>(null);
	let avatarUploading = $state(false);
	let lawfulBasisType = $state<LawfulBasisType | ''>('');
	let lawfulBasisConfirmed = $state(false);
	let lawfulBasisError = $state('');
	let formMessage = $state<string | null>(null);
	let formMessageAction = $state<'save' | 'delete' | null>(null);
	let formFailed = $state(false);
	let submittingAction = $state<'save' | 'delete' | null>(null);
	let confirmDeleteResumes = $state(false);
	let confirmUnlinkUser = $state(false);
	let initializedKey = $state<string | null>(null);

	const isCreateMode = $derived(mode === 'create');
	const hasSelectedTalent = $derived(Boolean(talent?.id));
	const drawerTitle = $derived(isCreateMode ? 'Create talent' : 'Edit talent');
	const drawerSubtitle = $derived(
		isCreateMode
			? 'Create a standalone talent profile. Link it to a user in Users > Edit.'
			: 'Update basic talent details. Bio and availability stay in the resume workspace.'
	);
	const submitLabel = $derived(isCreateMode ? 'Create talent' : 'Save changes');
	const selectedLawfulBasisDescription = $derived(
		lawfulBasisType ? lawfulBasisDescriptions[lawfulBasisType] : ''
	);
	const talentName = $derived(
		[talent?.first_name ?? '', talent?.last_name ?? ''].filter(Boolean).join(' ').trim() ||
			'this talent'
	);
	const requiresResumeDeleteConfirmation = $derived((talent?.resume_count ?? 0) > 0);
	const requiresUnlinkUserConfirmation = $derived(Boolean(talent?.user_id));
	const canSubmitDelete = $derived(
		(!requiresResumeDeleteConfirmation || confirmDeleteResumes) &&
			(!requiresUnlinkUserConfirmation || confirmUnlinkUser)
	);
	const deleteConfirmDescription = $derived.by(() => {
		const consequences: string[] = [];
		if ((talent?.resume_count ?? 0) > 0) {
			const label = talent?.resume_count === 1 ? 'resume' : 'resumes';
			consequences.push(`This will delete ${talent?.resume_count} ${label} for ${talentName}.`);
		}
		if (talent?.user_id) {
			consequences.push(
				'The linked user account will remain, but it will no longer be linked to this talent.'
			);
		}
		if (consequences.length === 0) {
			return `Delete ${talentName}? This cannot be undone.`;
		}
		return consequences.join(' ');
	});

	const clearTransientState = () => {
		avatarUploadError = null;
		avatarUploading = false;
		lawfulBasisError = '';
		formMessage = null;
		formMessageAction = null;
		formFailed = false;
		submittingAction = null;
		confirmDeleteResumes = false;
		confirmUnlinkUser = false;
	};

	const loadCreateState = () => {
		firstName = '';
		lastName = '';
		title = '';
		avatarUrl = '';
		lawfulBasisType = '';
		lawfulBasisConfirmed = false;
		clearTransientState();
	};

	const loadEditState = (currentTalent: EditableTalent) => {
		firstName = currentTalent.first_name ?? '';
		lastName = currentTalent.last_name ?? '';
		title = currentTalent.title ?? '';
		avatarUrl = currentTalent.avatar_url ?? '';
		lawfulBasisType = '';
		lawfulBasisConfirmed = false;
		clearTransientState();
	};

	$effect(() => {
		if (!open) {
			initializedKey = null;
			clearTransientState();
			return;
		}

		const nextKey = mode === 'edit' && talent?.id ? `edit:${talent.id}` : 'create';
		if (initializedKey === nextKey) return;
		initializedKey = nextKey;

		if (mode === 'edit' && talent?.id) {
			loadEditState(talent);
			return;
		}

		loadCreateState();
	});

	const handleLawfulBasisChange = (value: string) => {
		lawfulBasisType = value in lawfulBasisDescriptions ? (value as LawfulBasisType) : '';
		lawfulBasisError = '';
	};

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

	const closeDrawer = () => {
		open = false;
	};

	const handleUpsertSubmit = async (event: SubmitEvent) => {
		event.preventDefault();

		const form = event.currentTarget as HTMLFormElement;
		if (!form.reportValidity()) return;

		formMessage = null;
		formMessageAction = 'save';
		formFailed = false;

		if (isCreateMode && !lawfulBasisType) {
			lawfulBasisError = 'Select the lawful basis used for this profile.';
			return;
		}
		if (isCreateMode && !lawfulBasisConfirmed) {
			formMessage = 'You must confirm lawful basis before creating this talent profile.';
			formFailed = true;
			return;
		}

		const action: 'create' | 'update' = isCreateMode ? 'create' : 'update';
		const endpoint = isCreateMode ? '?/createTalent' : '?/updateTalent';
		const formData = new FormData(form);
		formData.set('avatar_url', avatarUrl);
		if (!isCreateMode && talent?.id) {
			formData.set('talent_id', talent.id);
		}

		submittingAction = 'save';

		try {
			const response = await fetch(endpoint, {
				method: 'POST',
				body: formData
			});
			const result = await parseActionMessage(response);
			if (!response.ok || !result.ok) {
				formMessage = result.message ?? 'Could not save talent.';
				formFailed = true;
				dispatch('error', {
					action,
					message: formMessage,
					talentId: talent?.id ?? null
				});
				return;
			}

			open = false;
			dispatch('success', {
				action,
				message: result.message ?? (isCreateMode ? 'Talent created.' : 'Talent updated.'),
				talentId: talent?.id ?? null
			});
		} catch (error) {
			formMessage = error instanceof Error ? error.message : 'Could not save talent.';
			formFailed = true;
			dispatch('error', {
				action,
				message: formMessage,
				talentId: talent?.id ?? null
			});
		} finally {
			submittingAction = null;
		}
	};

	const submitDelete = async () => {
		if (!talent?.id) {
			return;
		}
		if (!canSubmitDelete) {
			return;
		}

		formMessage = null;
		formMessageAction = 'delete';
		formFailed = false;
		submittingAction = 'delete';

		try {
			const payload = new FormData();
			payload.set('talent_id', talent.id);
			payload.set('confirm_delete_resumes', confirmDeleteResumes ? 'true' : 'false');
			payload.set('confirm_unlink_user', confirmUnlinkUser ? 'true' : 'false');
			const response = await fetch('?/deleteTalent', {
				method: 'POST',
				body: payload
			});
			const result = await parseActionMessage(response);
			if (!response.ok || !result.ok) {
				formMessage = result.message ?? 'Could not delete talent.';
				formFailed = true;
				dispatch('error', {
					action: 'delete',
					message: formMessage,
					talentId: talent?.id ?? null
				});
				return;
			}

			open = false;
			dispatch('success', {
				action: 'delete',
				message: result.message ?? 'Talent deleted.',
				talentId: talent?.id ?? null
			});
		} catch (error) {
			formMessage = error instanceof Error ? error.message : 'Could not delete talent.';
			formFailed = true;
			dispatch('error', {
				action: 'delete',
				message: formMessage,
				talentId: talent?.id ?? null
			});
		} finally {
			submittingAction = null;
		}
	};

	const handleDeleteSubmit = async (event: SubmitEvent) => {
		event.preventDefault();
		await submitDelete();
	};
</script>

<Drawer
	variant="right"
	bind:open
	title={drawerTitle}
	subtitle={drawerSubtitle}
	class="mr-0 w-full max-w-2xl"
	dismissable
>
	{#if !isCreateMode && !hasSelectedTalent}
		<div class="space-y-4 pb-6">
			<Alert variant="destructive" size="sm">
				<p class="text-foreground text-sm font-medium">This talent is no longer available.</p>
			</Alert>
			<div class="flex justify-end">
				<Button variant="outline" type="button" onclick={closeDrawer}>Close</Button>
			</div>
		</div>
	{:else}
		<form
			method="POST"
			class="flex flex-col gap-5 pb-8"
			onsubmit={handleUpsertSubmit}
		>
			{#if !isCreateMode && talent?.id}
				<input type="hidden" name="talent_id" value={talent.id} />
			{/if}
			<input type="hidden" name="avatar_url" value={avatarUrl} />

			<div class="grid gap-4 sm:grid-cols-2">
				<FormControl label="First name" class="gap-2 text-sm">
					<Input
						id="first_name"
						name="first_name"
						placeholder="First name"
						class="bg-input text-foreground"
						bind:value={firstName}
					/>
				</FormControl>
				<FormControl label="Last name" class="gap-2 text-sm">
					<Input
						id="last_name"
						name="last_name"
						placeholder="Last name"
						class="bg-input text-foreground"
						bind:value={lastName}
					/>
				</FormControl>
			</div>

			<FormControl label="Title" class="gap-2 text-sm">
				<Input
					id="title"
					name="title"
					placeholder="Title (optional)"
					class="bg-input text-foreground"
					bind:value={title}
				/>
			</FormControl>

			{#if isCreateMode}
				<div class="border-border bg-card rounded-lg border p-4">
					<p class="text-foreground text-sm font-semibold">Employer lawful basis</p>
					<p class="text-muted-fg mt-1 text-xs">
						Required when creating a talent profile without a linked user account. Choose the lawful
						basis your organisation has already validated for storing this person's profile data.
					</p>

					<div class="mt-3 grid gap-4">
						<FormControl label="Lawful basis type" class="gap-2 text-sm">
							<Dropdown
								id="lawful_basis_type"
								name="lawful_basis_type"
								bind:value={lawfulBasisType}
								options={lawfulBasisOptions}
								placeholder="Choose lawful basis"
								error={lawfulBasisError}
								onchange={handleLawfulBasisChange}
							/>
							{#if selectedLawfulBasisDescription}
								<p class="text-muted-fg text-xs">{selectedLawfulBasisDescription}</p>
							{/if}
						</FormControl>

						<FormControl label="Details (optional)" class="gap-2 text-sm" tag="div">
							<textarea
								id="lawful_basis_details"
								name="lawful_basis_details"
								rows="3"
								class="border-border bg-input text-foreground w-full rounded border p-3 text-sm"
								placeholder="Add why this basis applies, plus any ticket, policy, or reference details"
							></textarea>
						</FormControl>

						<input
							type="hidden"
							name="lawful_basis_confirmed"
							value={lawfulBasisConfirmed ? 'true' : 'false'}
						/>
						<label class="text-foreground flex items-start gap-3 text-sm font-medium">
							<Checkbox
								bind:checked={lawfulBasisConfirmed}
								disabled={submittingAction !== null}
								class="mt-0.5 shrink-0"
							/>
							<span class="min-w-0 leading-5">
								I confirm lawful basis has been validated for creating this talent profile.
							</span>
						</label>
					</div>
				</div>
			{/if}

			<FormControl label="Avatar" class="gap-2 text-sm" tag="div">
				{#if avatarUrl}
					<div class="border-border bg-muted w-24 overflow-hidden rounded-lg border">
						<img
							src={avatarPreviewSrc(avatarUrl)}
							srcset={avatarPreviewSrcSet(avatarUrl)}
							sizes="96px"
							alt="Talent avatar preview"
							class="aspect-square w-full object-cover"
							loading="lazy"
							decoding="async"
							onerror={(event) =>
								applyImageFallbackOnce(event, avatarPreviewFallbackSrc(avatarUrl))}
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
							disabled={avatarUploading || submittingAction !== null}
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
							disabled={avatarUploading || submittingAction !== null}
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
				{#if isCreateMode}
					Provide first name, last name, or both. User linking is managed under user edit.
				{:else}
					Use the resume workspace to edit bio, availability, and deeper profile content.
				{/if}
			</p>

			{#if formMessage && formMessageAction === 'save'}
				<Alert variant={formFailed ? 'destructive' : 'success'} size="sm">
					<p class="text-foreground text-sm font-medium">{formMessage}</p>
				</Alert>
			{/if}

			<div
				class={`flex flex-wrap justify-end gap-3 border-t pt-4 ${isCreateMode ? 'sticky bottom-0 z-20 bg-background pb-1' : ''}`}
			>
				<Button
					variant="outline"
					type="button"
					onclick={closeDrawer}
					class="bg-input hover:bg-muted/70"
					disabled={submittingAction !== null}
				>
					Cancel
				</Button>
				<Button
					variant="primary"
					type="submit"
					disabled={avatarUploading || submittingAction !== null}
				>
					{#if submittingAction === 'save'}
						Saving...
					{:else}
						{submitLabel}
					{/if}
				</Button>
			</div>
		</form>

		{#if !isCreateMode && talent?.id}
			<form
				method="POST"
				class="border-border relative z-30 mt-6 border-t pt-6"
				onsubmit={handleDeleteSubmit}
			>
				<input type="hidden" name="talent_id" value={talent.id} />

				<div class="rounded-lg border border-red-200 bg-red-50/60 p-4">
					<div class="space-y-3">
						<div>
							<p class="text-sm font-semibold text-red-700">Delete talent</p>
							<p class="mt-1 text-xs text-red-700/80">
								This permanently deletes the talent profile and any talent-owned records that
								cascade from it.
							</p>
						</div>

						<div class="space-y-2 text-xs text-red-700/90">
							{#if requiresResumeDeleteConfirmation}
								<p>
									This talent currently has {talent.resume_count}
									{talent.resume_count === 1 ? 'resume' : 'resumes'} that will be deleted.
								</p>
							{/if}
							{#if requiresUnlinkUserConfirmation}
								<p>
									A linked user account will remain, but it will no longer be linked to this talent
									after deletion.
								</p>
							{/if}
							{#if !requiresResumeDeleteConfirmation && !requiresUnlinkUserConfirmation}
								<p>No linked resumes or user accounts were found for this talent.</p>
							{/if}
						</div>

						{#if formMessage && formMessageAction === 'delete'}
							<Alert variant={formFailed ? 'destructive' : 'success'} size="sm">
								<p class="text-foreground text-sm font-medium">{formMessage}</p>
							</Alert>
						{/if}

						{#if requiresResumeDeleteConfirmation}
							<input
								type="hidden"
								name="confirm_delete_resumes"
								value={confirmDeleteResumes ? 'true' : 'false'}
							/>
							<label class="flex items-start gap-3 text-sm text-red-800">
								<Checkbox
									bind:checked={confirmDeleteResumes}
									disabled={submittingAction !== null}
									class="mt-0.5 shrink-0"
								/>
								<span class="min-w-0 leading-5">
									I want to delete this talent and all linked resumes.
								</span>
							</label>
						{/if}

						{#if requiresUnlinkUserConfirmation}
							<input
								type="hidden"
								name="confirm_unlink_user"
								value={confirmUnlinkUser ? 'true' : 'false'}
							/>
							<label class="flex items-start gap-3 text-sm text-red-800">
								<Checkbox
									bind:checked={confirmUnlinkUser}
									disabled={submittingAction !== null}
									class="mt-0.5 shrink-0"
								/>
								<span class="min-w-0 leading-5">
									I understand the linked user account will be unlinked from this talent, but
									the user account itself will not be deleted.
								</span>
							</label>
						{/if}

						<div class="flex justify-end">
							<button
								type="button"
								class="inline-flex items-center gap-2 rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
								disabled={!canSubmitDelete || submittingAction !== null}
								use:confirm={{
									title: `Delete ${talentName}?`,
									description: deleteConfirmDescription,
									actionLabel: 'Delete',
									action: () => {
										void submitDelete();
									}
								}}
							>
								<Trash2 class="h-4 w-4" />
								{#if submittingAction === 'delete'}
									Deleting...
								{:else}
									Delete talent
								{/if}
							</button>
						</div>
					</div>
				</div>
			</form>
		{/if}
	{/if}
</Drawer>
