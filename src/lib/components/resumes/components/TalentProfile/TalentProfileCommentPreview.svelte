<script lang="ts">
	import type { TalentComment } from '$lib/types/talentComments';
	import { getRoleLabel, getRoleIcon } from '$lib/types/roles';
	import { BriefcaseBusiness, CalendarClock, MessageSquare, Workflow } from 'lucide-svelte';

	let {
		comment,
		isExpanded = false,
		isFlashing = false,
		onToggle
	}: {
		comment: TalentComment;
		isExpanded?: boolean;
		isFlashing?: boolean;
		onToggle?: (commentId: string) => void;
	} = $props();

	const commentTypeIcons = {
		'briefcase-business': BriefcaseBusiness,
		'calendar-clock': CalendarClock,
		workflow: Workflow,
		'message-square': MessageSquare
	} as const;

	const TypeIcon =
		commentTypeIcons[comment.comment_type.icon_name as keyof typeof commentTypeIcons] ??
		MessageSquare;
	const RoleIcon = getRoleIcon(comment.author_role);
	const roleLabel = getRoleLabel(comment.author_role);
	const formattedDate = new Date(comment.created_at).toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	});
</script>

<button
	type="button"
	class="border-border hover:bg-muted/50 hover:border-primary/50 w-full cursor-pointer border px-4 py-3 text-left transition-colors {isFlashing
		? 'animate-flash-highlight'
		: ''}"
	onclick={() => onToggle?.(comment.id)}
>
	<div class="mb-1 flex items-center gap-2">
		<span
			class="text-primary bg-primary/5 border-primary/30 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-semibold"
		>
			<TypeIcon size={12} />
			{comment.comment_type.label}
		</span>
		{#if comment.author_name}
			<span class="text-muted-fg inline-flex items-center gap-1 text-[11px]">
				<span title={roleLabel}>
					<RoleIcon size={12} />
				</span>
				{comment.author_name}
			</span>
		{/if}
		<span class="text-muted-fg ml-auto text-[11px]">{formattedDate}</span>
	</div>
	<div
		class="relative overflow-hidden transition-[max-height] duration-300 ease-in-out"
		style="max-height: {isExpanded ? '40rem' : '3rem'};"
	>
		<p class="text-foreground whitespace-pre-wrap text-sm leading-6">{comment.body_text}</p>
		{#if !isExpanded && comment.body_text.length > 120}
			<div
				class="from-background pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t"
			></div>
		{/if}
	</div>
</button>
