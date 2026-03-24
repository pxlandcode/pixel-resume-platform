<script lang="ts">
	import { Button } from '@pixelcode_/blocks/components';
	import { ArrowLeft } from 'lucide-svelte';

	let {
		hasProfile = false,
		canEdit = false,
		isEditing = false,
		avatarUploading = false,
		onStartEdit,
		onCancelEdit
	}: {
		hasProfile?: boolean;
		canEdit?: boolean;
		isEditing?: boolean;
		avatarUploading?: boolean;
		onStartEdit?: () => void;
		onCancelEdit?: () => void;
	} = $props();
</script>

<div class="mb-6 flex items-center justify-between">
	<Button variant="ghost" href="/resumes" class="hover:text-primary pl-0 hover:bg-transparent">
		<ArrowLeft size={16} class="mr-2" />
		Back to all talents
	</Button>

	{#if hasProfile && canEdit}
		<div class="flex gap-2">
			{#if isEditing}
				<Button type="button" variant="ghost" onclick={onCancelEdit}>Cancel</Button>
				<Button form="profile-form" type="submit" variant="primary" disabled={avatarUploading}>
					Save profile
				</Button>
			{:else}
				<Button type="button" onclick={onStartEdit}>Edit profile</Button>
			{/if}
		</div>
	{/if}
</div>
