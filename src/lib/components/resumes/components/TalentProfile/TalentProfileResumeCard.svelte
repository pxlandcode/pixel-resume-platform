<script lang="ts">
	import { Button } from '@pixelcode_/blocks/components';
	import ResumeShareDrawer from '$lib/components/resumes/ResumeShareDrawer.svelte';
	import { confirm } from '$lib/utils/confirm';
	import { CheckCircle2, Copy, Download, FileText, Share2, Trash2 } from 'lucide-svelte';
	import { fly } from 'svelte/transition';
	import type { TalentProfileResume } from './types';

	type DownloadLanguage = 'sv' | 'en';

	let {
		resume,
		index,
		canEdit = false,
		isDragging = false,
		isDragOver = false,
		isDownloadMenuOpen = false,
		isDownloading = false,
		downloadLang = 'sv',
		downloadAnonymized = false,
		onOpenResume,
		onDragStartResume,
		onDragOverResume,
		onDragLeaveResume,
		onDropResume,
		onDragEndResume,
		onToggleDownloadMenu,
		onSelectDownloadLang,
		onSetDownloadAnonymized,
		onDownloadResume,
		onCopyResume,
		onSetMainResume,
		onDeleteResume
	}: {
		resume: TalentProfileResume;
		index: number;
		canEdit?: boolean;
		isDragging?: boolean;
		isDragOver?: boolean;
		isDownloadMenuOpen?: boolean;
		isDownloading?: boolean;
		downloadLang?: DownloadLanguage;
		downloadAnonymized?: boolean;
		onOpenResume?: (resumeId: string) => void;
		onDragStartResume?: (resume: TalentProfileResume) => void;
		onDragOverResume?: (event: DragEvent, index: number) => void;
		onDragLeaveResume?: () => void;
		onDropResume?: (event: DragEvent, index: number) => void;
		onDragEndResume?: () => void;
		onToggleDownloadMenu?: (resumeId: string) => void;
		onSelectDownloadLang?: (lang: DownloadLanguage) => void;
		onSetDownloadAnonymized?: (value: boolean) => void;
		onDownloadResume?: (resumeId: string, type: 'pdf' | 'word', lang: DownloadLanguage) => void;
		onCopyResume?: (resumeId: string) => void;
		onSetMainResume?: (resumeId: string) => void;
		onDeleteResume?: (resumeId: string) => void;
	} = $props();

	const formatResumeCardDate = (value: string | null | undefined): string => {
		if (!value) return '—';
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return value;
		return new Intl.DateTimeFormat(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		}).format(parsed);
	};

	let shareDrawerOpen = $state(false);
</script>

<div
	draggable={canEdit}
	ondragstart={() => onDragStartResume?.(resume)}
	ondragover={(event) => onDragOverResume?.(event, index)}
	ondragleave={onDragLeaveResume}
	ondrop={(event) => onDropResume?.(event, index)}
	ondragend={onDragEndResume}
	role="button"
	tabindex="0"
	onclick={() => onOpenResume?.(resume.id)}
	onkeydown={(event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onOpenResume?.(resume.id);
		}
	}}
	class="border-border hover:border-primary/50 hover:bg-muted/50 group flex w-full cursor-pointer items-center gap-3 border px-4 py-3 transition-colors {isDragOver
		? 'border-primary'
		: ''} {isDragging ? 'opacity-50' : ''}"
>
	<FileText size={16} class="text-muted-fg group-hover:text-primary shrink-0" />
	<div class="min-w-0 flex-1">
		<div class="flex items-center gap-2">
			<span class="text-foreground truncate text-sm font-medium">
				{resume.version_name ?? 'Main'}
			</span>
			{#if resume.is_main}
				<span
					class="inline-flex items-center gap-1 rounded-full bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-700"
				>
					<CheckCircle2 size={11} />
					Main
				</span>
			{/if}
		</div>
		<span class="text-muted-fg text-xs">
			{formatResumeCardDate(resume.updated_at ?? resume.created_at)}
		</span>
	</div>

	<div class="ml-auto flex shrink-0 items-center gap-1">
		<div class="relative">
			<Button
				type="button"
				variant="ghost"
				size="sm"
				class="min-h-[36px] min-w-[36px]"
				onclick={(event) => {
					event.stopPropagation();
					onToggleDownloadMenu?.(resume.id);
				}}
				loading={isDownloading}
				title="Download"
			>
				<Download size={14} />
			</Button>
			{#if isDownloadMenuOpen}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="border-border bg-card absolute right-0 top-full z-50 mt-1 flex flex-col gap-1.5 rounded border p-2 shadow-lg"
					onclick={(event) => event.stopPropagation()}
					onkeydown={(event) => event.stopPropagation()}
					transition:fly={{ y: -8, duration: 150 }}
				>
					<div
						class="border-border bg-card flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium"
					>
						<button
							type="button"
							class="cursor-pointer {downloadLang === 'sv'
								? 'bg-primary rounded-full px-2 py-0.5 text-white'
								: 'text-muted-fg hover:text-foreground px-2 py-0.5'}"
							onclick={() => onSelectDownloadLang?.('sv')}
						>
							SV
						</button>
						<button
							type="button"
							class="cursor-pointer {downloadLang === 'en'
								? 'bg-primary rounded-full px-2 py-0.5 text-white'
								: 'text-muted-fg hover:text-foreground px-2 py-0.5'}"
							onclick={() => onSelectDownloadLang?.('en')}
						>
							EN
						</button>
					</div>
					<label
						class="border-border bg-card text-muted-fg flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium"
					>
						<input
							type="checkbox"
							class="accent-primary"
							checked={downloadAnonymized}
							onchange={(event) => onSetDownloadAnonymized?.(event.currentTarget.checked)}
						/>
						Anonymize
					</label>
					<Button
						type="button"
						variant="outline"
						size="sm"
						class="w-full cursor-pointer"
						loading={isDownloading}
						onclick={() => onDownloadResume?.(resume.id, 'word', downloadLang)}
					>
						Word (Pre-beta)
					</Button>
					<Button
						type="button"
						variant="primary"
						size="sm"
						class="w-full cursor-pointer"
						loading={isDownloading}
						onclick={() => onDownloadResume?.(resume.id, 'pdf', downloadLang)}
					>
						<Download size={14} />
						PDF
					</Button>
				</div>
			{/if}
		</div>
		<Button
			type="button"
			variant="ghost"
			size="sm"
			class="min-h-[36px] min-w-[36px]"
			onclick={(event) => {
				event.stopPropagation();
				onCopyResume?.(resume.id);
			}}
			title="Duplicate resume"
		>
			<Copy size={14} />
		</Button>
		{#if canEdit}
			<Button
				type="button"
				variant="ghost"
				size="sm"
				class="min-h-[36px] min-w-[36px]"
				onclick={(event) => {
					event.stopPropagation();
					shareDrawerOpen = true;
				}}
				title="Share resume"
			>
				<Share2 size={14} />
			</Button>
		{/if}
		{#if canEdit && !resume.is_main}
			<Button
				type="button"
				variant="ghost"
				size="sm"
				class="min-h-[36px] text-xs"
				onclick={(event) => {
					event.stopPropagation();
					onSetMainResume?.(resume.id);
				}}
				title="Set as main"
			>
				Set main
			</Button>
			<button
				type="button"
				class="text-muted-fg inline-flex min-h-[36px] min-w-[36px] cursor-pointer items-center justify-center rounded-sm px-2 text-sm transition-colors hover:text-red-500"
				onclick={(event) => event.stopPropagation()}
				title="Delete resume"
				use:confirm={{
					title: 'Delete resume?',
					description: `Are you sure you want to delete "${resume.version_name}"? This cannot be undone.`,
					actionLabel: 'Delete',
					action: () => onDeleteResume?.(resume.id)
				}}
			>
				<Trash2 size={14} />
			</button>
		{/if}
	</div>
</div>

<ResumeShareDrawer bind:open={shareDrawerOpen} resumeId={resume.id} />
