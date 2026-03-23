<script lang="ts">
	import { Card } from '@pixelcode_/blocks/components';
	import { confirm } from '$lib/utils/confirm';
	import type { TalentComment } from '$lib/types/talentComments';
	import {
		BriefcaseBusiness,
		Building2,
		CalendarClock,
		MessageSquare,
		Shield,
		Trash2,
		User,
		Workflow
	} from 'lucide-svelte';

	let {
		comment,
		isArchiving = false,
		onArchive = null
	}: {
		comment: TalentComment;
		isArchiving?: boolean;
		onArchive?: ((commentId: string) => Promise<void> | void) | null;
	} = $props();

	const roleLabelByKey = {
		admin: 'Admin',
		broker: 'Broker',
		employer: 'Employer',
		talent: 'Talent'
	} as const;

	const roleIconByKey = {
		admin: Shield,
		broker: BriefcaseBusiness,
		employer: Building2,
		talent: User
	} as const;

	const typeIconByName = {
		'briefcase-business': BriefcaseBusiness,
		'calendar-clock': CalendarClock,
		workflow: Workflow,
		'message-square': MessageSquare
	} as const;

	const resolveTypeIcon = (iconName: string) =>
		typeIconByName[iconName as keyof typeof typeIconByName] ?? MessageSquare;
	const resolveRoleIcon = (role: TalentComment['author_role']) =>
		roleIconByKey[role as keyof typeof roleIconByKey] ?? User;
	const roleLabel = (role: TalentComment['author_role']) =>
		roleLabelByKey[role as keyof typeof roleLabelByKey] ?? 'User';

	const authorDisplayLabel = (comment: TalentComment) => {
		const role = roleLabel(comment.author_role);
		return comment.author_name ? `${comment.author_name} (${role})` : role;
	};

	const formatTimestamp = (value: string) => {
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return value;
		return new Intl.DateTimeFormat(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(parsed);
	};

	const TypeIcon = $derived(resolveTypeIcon(comment.comment_type.icon_name));
	const AuthorIcon = $derived(resolveRoleIcon(comment.author_role));
</script>

<Card class="border-border/20 bg-card space-y-3 rounded-none p-4">
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0 flex-1 space-y-2">
			<div class="flex flex-wrap items-center gap-2">
				<span
					class="text-primary border-primary/30 bg-primary/5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide"
				>
					<TypeIcon size={13} />
					{comment.comment_type.label}
				</span>
				<span
					class="text-muted-fg border-border inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide"
				>
					<AuthorIcon size={13} />
					{authorDisplayLabel(comment)}
				</span>
			</div>
			<p class="text-muted-fg text-xs">{formatTimestamp(comment.created_at)}</p>
		</div>

		{#if comment.canArchive && onArchive}
			<button
				type="button"
				class="text-muted-fg cursor-pointer rounded-md p-2 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
				disabled={isArchiving}
				aria-label="Archive comment"
				title="Archive comment"
				use:confirm={{
					title: 'Archive comment?',
					description: 'This will hide the comment from the profile.',
					actionLabel: 'Archive',
					action: () => onArchive?.(comment.id)
				}}
			>
				<Trash2 size={16} />
			</button>
		{/if}
	</div>

	<p class="text-foreground whitespace-pre-wrap text-sm leading-6">{comment.body_text}</p>
</Card>
