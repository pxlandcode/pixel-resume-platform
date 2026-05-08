<script lang="ts">
	import { Button } from '@pixelcode_/blocks/components';
	import { ChevronDown, FileText, Plus, Upload } from 'lucide-svelte';
	import { slide } from 'svelte/transition';
	import TalentProfileResumeCard from './TalentProfileResumeCard.svelte';
	import type { TalentProfileResume } from './types';

	type DownloadLanguage = 'sv' | 'en';
	const COLLAPSED_RESUME_COUNT = 3;

	let {
		resumes = [],
		canEdit = false,
		dragOverIndex = null,
		draggedResumeId = null,
		downloadMenuResumeId = null,
		downloadingResumeId = null,
		downloadLang = 'sv',
		downloadAnonymized = false,
		onOpenImportDrawer,
		onDropImportPdf,
		onAddResume,
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
		resumes?: TalentProfileResume[];
		canEdit?: boolean;
		dragOverIndex?: number | null;
		draggedResumeId?: string | null;
		downloadMenuResumeId?: string | null;
		downloadingResumeId?: string | null;
		downloadLang?: DownloadLanguage;
		downloadAnonymized?: boolean;
		onOpenImportDrawer?: () => void;
		onDropImportPdf?: (file: File) => void;
		onAddResume?: () => void;
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

	let isImportDragOver = $state(false);
	let resumesExpanded = $state(false);

	const primaryResumes = $derived(resumes.slice(0, COLLAPSED_RESUME_COUNT));
	const expandedResumes = $derived(resumes.slice(COLLAPSED_RESUME_COUNT));
	const hasMoreResumes = $derived(expandedResumes.length > 0);
	const hiddenResumeCount = $derived(expandedResumes.length);
	const visibleResumeCount = $derived(resumes.length);

	const findDroppedFile = (event: DragEvent): File | null => {
		const files = Array.from(event.dataTransfer?.files ?? []);
		return files[0] ?? null;
	};

	const hasDroppedFiles = (event: DragEvent) => {
		const dataTransfer = event.dataTransfer;
		if (!dataTransfer) return false;
		return (
			Array.from(dataTransfer.items ?? []).some((item) => item.kind === 'file') ||
			dataTransfer.files.length > 0
		);
	};

	const handleImportDragOver = (event: DragEvent) => {
		if (!canEdit) return;
		if (!hasDroppedFiles(event)) return;
		event.preventDefault();
		isImportDragOver = true;
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'copy';
		}
	};

	const handleImportDragLeave = (event: DragEvent) => {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
			return;
		}
		isImportDragOver = false;
	};

	const handleImportDrop = (event: DragEvent) => {
		if (!canEdit) return;
		if (!hasDroppedFiles(event)) return;
		event.preventDefault();
		isImportDragOver = false;
		const file = findDroppedFile(event);
		if (!file) return;
		onDropImportPdf?.(file);
	};
</script>

<div class="pt-2">
	<div class="mb-2 flex items-center justify-between">
		<h3 class="text-foreground text-lg font-semibold">Resumes</h3>
		{#if canEdit}
			<div class="flex items-center gap-1">
				<Button
					size="sm"
					variant="outline"
					class={isImportDragOver ? 'border-primary bg-primary/10 text-primary' : ''}
					onclick={onOpenImportDrawer}
					ondragover={handleImportDragOver}
					ondragleave={handleImportDragLeave}
					ondrop={handleImportDrop}
				>
					<Upload size={14} />
					Create resume from PDF
				</Button>
				<Button size="sm" variant="outline" onclick={onAddResume}>
					<Plus size={14} />
					Add resume
				</Button>
			</div>
		{/if}
	</div>

	<div class="space-y-1.5">
		{#each primaryResumes as resume, index (resume.id)}
			<TalentProfileResumeCard
				{resume}
				{index}
				{canEdit}
				isDragging={draggedResumeId === resume.id}
				isDragOver={dragOverIndex === index}
				isDownloadMenuOpen={downloadMenuResumeId === resume.id}
				isDownloading={downloadingResumeId === resume.id}
				{downloadLang}
				{downloadAnonymized}
				{onOpenResume}
				{onDragStartResume}
				{onDragOverResume}
				{onDragLeaveResume}
				{onDropResume}
				{onDragEndResume}
				{onToggleDownloadMenu}
				{onSelectDownloadLang}
				{onSetDownloadAnonymized}
				{onDownloadResume}
				{onCopyResume}
				{onSetMainResume}
				{onDeleteResume}
			/>
		{/each}

		{#if hasMoreResumes}
			{#if resumesExpanded}
				<div class="space-y-1.5 overflow-hidden" transition:slide={{ duration: 180 }}>
					{#each expandedResumes as resume, expandedIndex (resume.id)}
						<TalentProfileResumeCard
							{resume}
							index={expandedIndex + COLLAPSED_RESUME_COUNT}
							{canEdit}
							isDragging={draggedResumeId === resume.id}
							isDragOver={dragOverIndex === expandedIndex + COLLAPSED_RESUME_COUNT}
							isDownloadMenuOpen={downloadMenuResumeId === resume.id}
							isDownloading={downloadingResumeId === resume.id}
							{downloadLang}
							{downloadAnonymized}
							{onOpenResume}
							{onDragStartResume}
							{onDragOverResume}
							{onDragLeaveResume}
							{onDropResume}
							{onDragEndResume}
							{onToggleDownloadMenu}
							{onSelectDownloadLang}
							{onSetDownloadAnonymized}
							{onDownloadResume}
							{onCopyResume}
							{onSetMainResume}
							{onDeleteResume}
						/>
					{/each}
				</div>
			{/if}

			<button
				type="button"
				class="text-primary hover:text-primary/80 inline-flex cursor-pointer items-center gap-1 pt-1 text-sm font-medium"
				aria-expanded={resumesExpanded}
				onclick={() => (resumesExpanded = !resumesExpanded)}
			>
				<ChevronDown size={14} class="transition-transform {resumesExpanded ? 'rotate-180' : ''}" />
				{resumesExpanded
					? `Show fewer resumes`
					: `View ${hiddenResumeCount} more ${hiddenResumeCount === 1 ? 'resume' : 'resumes'}`}
			</button>
		{/if}

		{#if visibleResumeCount === 0}
			<div class="border-border rounded-none border border-dashed px-4 py-6 text-center">
				<FileText size={24} class="text-muted-fg mx-auto mb-2" />
				<p class="text-muted-fg text-sm">No resumes yet.</p>
			</div>
		{/if}
	</div>
</div>
