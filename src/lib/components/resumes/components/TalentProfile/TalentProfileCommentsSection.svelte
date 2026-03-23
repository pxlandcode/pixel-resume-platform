<script lang="ts">
	import { Button } from '@pixelcode_/blocks/components';
	import { Dropdown } from '$lib/components/dropdown';
	import {
		TALENT_COMMENT_BODY_MAX_LENGTH,
		type TalentComment,
		type TalentCommentType
	} from '$lib/types/talentComments';
	import { MessageSquarePlus } from 'lucide-svelte';
	import TalentProfileCommentPreview from './TalentProfileCommentPreview.svelte';
	import type { TalentProfileMessage } from './types';

	let {
		canCreateComment = false,
		commentTypes = [],
		latestComments = [],
		commentCount = 0,
		commentTypeId = $bindable(''),
		commentBody = $bindable(''),
		commentFormOpen = $bindable(false),
		commentSubmitting = false,
		commentFeedback = null,
		expandedCommentIds = {},
		flashingCommentId = null,
		onSubmitComment,
		onToggleCommentExpanded,
		onOpenCommentHistory
	}: {
		canCreateComment?: boolean;
		commentTypes?: TalentCommentType[];
		latestComments?: TalentComment[];
		commentCount?: number;
		commentTypeId?: string;
		commentBody?: string;
		commentFormOpen?: boolean;
		commentSubmitting?: boolean;
		commentFeedback?: TalentProfileMessage | null;
		expandedCommentIds?: Record<string, boolean>;
		flashingCommentId?: string | null;
		onSubmitComment?: (
			event: SubmitEvent & { currentTarget: EventTarget & HTMLFormElement }
		) => void;
		onToggleCommentExpanded?: (commentId: string) => void;
		onOpenCommentHistory?: () => void;
	} = $props();

	const commentCharactersUsed = $derived(commentBody.length);
</script>

<div class="pt-2">
	<div class="mb-2 flex items-center justify-between">
		<h3 class="text-foreground text-lg font-semibold">Comments</h3>
		{#if canCreateComment}
			<Button
				type="button"
				variant="outline"
				size="sm"
				onclick={() => (commentFormOpen = !commentFormOpen)}
			>
				<MessageSquarePlus size={14} />
				Leave comment
			</Button>
		{/if}
	</div>

	{#if commentFeedback?.type === 'error'}
		<div class="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
			{commentFeedback.message}
		</div>
	{/if}

	{#if commentFormOpen}
		<div class="border-border bg-card rounded border p-4">
			<form class="space-y-3" onsubmit={onSubmitComment}>
				<input type="hidden" name="comment_type_id" value={commentTypeId} />
				<Dropdown
					id="comment-type"
					bind:value={commentTypeId}
					options={commentTypes.map((commentType) => ({
						label: commentType.label,
						value: commentType.id
					}))}
					placeholder="Comment type"
					size="sm"
					disabled={commentTypes.length === 0 || commentSubmitting}
				/>

				<textarea
					id="comment-body"
					name="comment_body"
					bind:value={commentBody}
					maxlength={TALENT_COMMENT_BODY_MAX_LENGTH}
					class="border-border bg-card text-foreground focus:border-primary min-h-20 w-full resize-y rounded-none border p-2.5 text-sm outline-none"
					placeholder="Internal note..."
					disabled={commentSubmitting}
					required
				></textarea>

				<div class="flex items-center justify-between gap-3">
					<p class="text-muted-fg text-xs">
						{commentCharactersUsed}/{TALENT_COMMENT_BODY_MAX_LENGTH}
					</p>
					<div class="flex gap-1.5">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onclick={() => {
								commentFormOpen = false;
								commentBody = '';
							}}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							size="sm"
							loading={commentSubmitting}
							disabled={commentTypes.length === 0 || commentSubmitting}
						>
							Add
						</Button>
					</div>
				</div>
			</form>
		</div>
	{/if}

	{#if latestComments.length > 0}
		<div class="space-y-2">
			{#each latestComments as comment (comment.id)}
				<TalentProfileCommentPreview
					{comment}
					isExpanded={expandedCommentIds[comment.id] ?? false}
					isFlashing={flashingCommentId === comment.id}
					onToggle={onToggleCommentExpanded}
				/>
			{/each}
		</div>

		{#if commentCount > latestComments.length}
			<div class="flex w-full justify-end">
				<button
					type="button"
					class="text-primary hover:text-primary/80 mt-1 cursor-pointer text-sm font-medium"
					onclick={onOpenCommentHistory}
				>
					See all {commentCount} comments
				</button>
			</div>
		{/if}
	{/if}
</div>
