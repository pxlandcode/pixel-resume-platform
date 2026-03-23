<script lang="ts">
	import ConsultantAvailabilityPills from '$lib/components/resumes/ConsultantAvailabilityPills.svelte';
	import { applyImageFallbackOnce, supabaseImageSizes } from '$lib/images/supabaseImage';
	import { Camera, Loader2, User } from 'lucide-svelte';
	import type { TalentProfileAvailability, TalentProfileProfile } from './types';

	let {
		profile,
		availability = null,
		canEdit = false,
		isEditing = false,
		avatarUploading = false,
		editingAvatarUrl = '',
		avatarUploadError = null,
		displayedAvatarUrl = '',
		displayedAvatarSrc = '',
		displayedAvatarSrcSet = '',
		displayedAvatarFallbackSrc = '',
		onAvatarUpload,
		onRemoveImage
	}: {
		profile: TalentProfileProfile;
		availability?: TalentProfileAvailability;
		canEdit?: boolean;
		isEditing?: boolean;
		avatarUploading?: boolean;
		editingAvatarUrl?: string;
		avatarUploadError?: string | null;
		displayedAvatarUrl?: string;
		displayedAvatarSrc?: string;
		displayedAvatarSrcSet?: string;
		displayedAvatarFallbackSrc?: string;
		onAvatarUpload?: (event: Event & { currentTarget: EventTarget & HTMLInputElement }) => void;
		onRemoveImage?: () => void;
	} = $props();

	let avatarFileInput = $state<HTMLInputElement | null>(null);

	const profileName = $derived([profile.first_name, profile.last_name].filter(Boolean).join(' '));
</script>

<div class="w-32 flex-shrink-0 space-y-4 md:w-48">
	<div class="space-y-2">
		<div class="relative h-32 w-32 md:h-48 md:w-48">
			<input
				bind:this={avatarFileInput}
				type="file"
				accept="image/*"
				class="hidden"
				onchange={onAvatarUpload}
				disabled={avatarUploading}
			/>

			<button
				type="button"
				class="border-border group relative h-full w-full overflow-hidden border-4 shadow-lg {isEditing &&
				canEdit
					? 'cursor-pointer'
					: 'cursor-default'}"
				onclick={() => isEditing && canEdit && !avatarUploading && avatarFileInput?.click()}
				disabled={!isEditing || !canEdit || avatarUploading}
			>
				{#if displayedAvatarUrl}
					<img
						src={displayedAvatarSrc}
						srcset={displayedAvatarSrcSet}
						sizes={supabaseImageSizes.avatarProfile}
						alt={profileName}
						class="h-full w-full object-cover"
						loading="lazy"
						decoding="async"
						onerror={(event) =>
							applyImageFallbackOnce(event, displayedAvatarFallbackSrc || displayedAvatarUrl)}
					/>
				{:else}
					<div class="bg-muted text-muted-fg flex h-full w-full items-center justify-center">
						<User size={48} />
					</div>
				{/if}

				{#if isEditing && canEdit}
					<div
						class="absolute inset-0 flex flex-col items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 {avatarUploading
							? '!opacity-100'
							: ''}"
					>
						{#if avatarUploading}
							<Loader2 size={32} class="animate-spin text-white" />
							<span class="mt-2 text-xs font-medium text-white">Uploading...</span>
						{:else}
							<Camera size={32} class="text-white" />
							<span class="mt-2 text-xs font-medium text-white">
								{editingAvatarUrl ? 'Change photo' : 'Add photo'}
							</span>
						{/if}
					</div>
				{/if}
			</button>
		</div>

		{#if isEditing && canEdit && editingAvatarUrl && !avatarUploading}
			<button
				type="button"
				class="w-full text-left text-xs text-red-400 transition-colors hover:text-red-500"
				onclick={onRemoveImage}
			>
				Remove image
			</button>
		{/if}

		{#if avatarUploadError}
			<p class="text-xs text-red-600">{avatarUploadError}</p>
		{/if}

		{#if !isEditing}
			<p class="text-sm">Current status</p>
			<ConsultantAvailabilityPills {availability} compact />
		{/if}
	</div>
</div>
