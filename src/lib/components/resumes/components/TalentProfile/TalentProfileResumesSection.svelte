<script lang="ts">
	import { Button } from '@pixelcode_/blocks/components';
	import { FileText, Plus, Upload } from 'lucide-svelte';
	import TalentProfileResumeCard from './TalentProfileResumeCard.svelte';
	import type { TalentProfileResume } from './types';

	type DownloadLanguage = 'sv' | 'en';

	let {
		visibleResumes = [],
		totalResumeCount = 0,
		hasMoreResumes = false,
		canEdit = false,
		dragOverIndex = null,
		draggedResumeId = null,
		downloadMenuResumeId = null,
		downloadingResumeId = null,
		downloadLang = 'sv',
		downloadAnonymized = false,
		onOpenImportDrawer,
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
		visibleResumes?: TalentProfileResume[];
		totalResumeCount?: number;
		hasMoreResumes?: boolean;
		canEdit?: boolean;
		dragOverIndex?: number | null;
		draggedResumeId?: string | null;
		downloadMenuResumeId?: string | null;
		downloadingResumeId?: string | null;
		downloadLang?: DownloadLanguage;
		downloadAnonymized?: boolean;
		onOpenImportDrawer?: () => void;
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

	const scrollToAllResumes = () => {
		const element = document.getElementById('all-resumes-section');
		if (element) element.scrollIntoView({ behavior: 'smooth' });
	};
</script>

<div class="pt-2">
	<div class="mb-2 flex items-center justify-between">
		<h3 class="text-foreground text-lg font-semibold">Resumes</h3>
		{#if canEdit}
			<div class="flex items-center gap-1">
				<Button size="sm" variant="outline" onclick={onOpenImportDrawer}>
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
		{#each visibleResumes as resume, index (resume.id)}
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
			<button
				type="button"
				class="text-primary hover:text-primary/80 cursor-pointer pt-1 text-sm font-medium"
				onclick={scrollToAllResumes}
			>
				See all {totalResumeCount} resumes
			</button>
		{/if}

		{#if totalResumeCount === 0}
			<div class="border-border rounded-none border border-dashed px-4 py-6 text-center">
				<FileText size={24} class="text-muted-fg mx-auto mb-2" />
				<p class="text-muted-fg text-sm">No resumes yet.</p>
			</div>
		{/if}
	</div>
</div>
