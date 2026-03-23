<script lang="ts">
	import Drawer from '$lib/components/drawer/drawer.svelte';
	import TalentCommentCard from '$lib/components/talent-comments/TalentCommentCard.svelte';
	import type { TalentComment } from '$lib/types/talentComments';

	let {
		open = $bindable(false),
		commentHistory = [],
		archivingCommentIds = {},
		onArchive
	}: {
		open?: boolean;
		commentHistory?: TalentComment[];
		archivingCommentIds?: Record<string, boolean>;
		onArchive?: (commentId: string) => void;
	} = $props();
</script>

<Drawer
	bind:open
	variant="bottom"
	title="Comment history"
	subtitle="Older internal comments for this talent."
>
	{#if commentHistory.length === 0}
		<div class="border-border rounded-none border border-dashed p-4">
			<p class="text-muted-fg text-sm">No comments yet.</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each commentHistory as comment (comment.id)}
				<TalentCommentCard
					{comment}
					isArchiving={Boolean(archivingCommentIds[comment.id])}
					{onArchive}
				/>
			{/each}
		</div>
	{/if}
</Drawer>
