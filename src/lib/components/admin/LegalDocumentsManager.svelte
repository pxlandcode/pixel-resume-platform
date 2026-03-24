<script lang="ts">
	import { Alert, Button, FormControl, Input } from '@pixelcode_/blocks/components';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import ChevronLeft from 'lucide-svelte/icons/chevron-left';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import Plus from 'lucide-svelte/icons/plus';
	import FileText from 'lucide-svelte/icons/file-text';
	import RefreshCw from 'lucide-svelte/icons/refresh-cw';

	type LegalDocumentType =
		| 'tos'
		| 'privacy'
		| 'ai_notice'
		| 'data_sharing'
		| 'data_processing_agreement'
		| 'subprocessor_list';

	type LegalAcceptanceScope = 'platform_access' | 'none';

	type LegalDocument = {
		id: string;
		doc_type: LegalDocumentType;
		version: string;
		content_html: string;
		effective_date: string;
		acceptance_scope: LegalAcceptanceScope;
		is_active: boolean;
		created_at: string;
	};

	let { documents = [] as LegalDocument[] }: { documents: LegalDocument[] } = $props();

	let localDocumentsOverride = $state<LegalDocument[] | null>(null);
	const localDocuments = $derived(localDocumentsOverride ?? documents);

	const allDocTypes: LegalDocumentType[] = [
		'tos',
		'privacy',
		'ai_notice',
		'data_sharing',
		'data_processing_agreement',
		'subprocessor_list'
	];

	const documentsByType = $derived.by(() => {
		const grouped: Record<LegalDocumentType, LegalDocument[]> = {
			tos: [],
			privacy: [],
			ai_notice: [],
			data_sharing: [],
			data_processing_agreement: [],
			subprocessor_list: []
		};

		for (const doc of localDocuments) {
			grouped[doc.doc_type].push(doc);
		}

		for (const type of allDocTypes) {
			grouped[type] = grouped[type].slice().sort((a, b) => {
				const byDate = b.effective_date.localeCompare(a.effective_date);
				if (byDate !== 0) return byDate;
				return b.created_at.localeCompare(a.created_at);
			});
		}

		return grouped;
	});

	let selectedDocType = $state<LegalDocumentType | null>(null);
	let selectedVersionIndex = $state(0);
	let showCreateForm = $state(false);

	const versionsForSelectedType = $derived.by(() => {
		if (!selectedDocType) return [];
		return documentsByType[selectedDocType] ?? [];
	});

	const currentDocument = $derived.by(() => {
		const versions = versionsForSelectedType;
		if (versions.length === 0) return null;
		return versions[Math.min(selectedVersionIndex, versions.length - 1)] ?? null;
	});

	let docType = $state<LegalDocumentType>('tos');
	let acceptanceScope = $state<LegalAcceptanceScope>('platform_access');
	let version = $state('');
	let effectiveDate = $state('');
	let contentHtml = $state('');
	let activateNow = $state(true);
	let isSaving = $state(false);
	let isRefreshing = $state(false);
	let feedback = $state<{ type: 'success' | 'error'; message: string } | null>(null);

	$effect(() => {
		if (selectedDocType) {
			selectedVersionIndex = 0;
		}
	});

	const docTypeLabel = (docTypeValue: LegalDocumentType) => {
		switch (docTypeValue) {
			case 'tos':
				return 'Terms of Service';
			case 'privacy':
				return 'Privacy Notice';
			case 'ai_notice':
				return 'AI Notice';
			case 'data_sharing':
				return 'Data Sharing Notice';
			case 'data_processing_agreement':
				return 'Data Processing Agreement';
			case 'subprocessor_list':
				return 'Subprocessor List';
			default:
				return docTypeValue;
		}
	};

	const docTypeShortLabel = (docTypeValue: LegalDocumentType) => {
		switch (docTypeValue) {
			case 'tos':
				return 'ToS';
			case 'privacy':
				return 'Privacy';
			case 'ai_notice':
				return 'AI Notice';
			case 'data_sharing':
				return 'Data Sharing';
			case 'data_processing_agreement':
				return 'DPA';
			case 'subprocessor_list':
				return 'Subprocessors';
			default:
				return docTypeValue;
		}
	};

	const refreshDocuments = async () => {
		isRefreshing = true;
		try {
			const response = await fetch('/legal/admin/documents', {
				method: 'GET',
				credentials: 'include'
			});
			const payload = (await response.json().catch(() => null)) as {
				documents?: LegalDocument[];
				message?: string;
			} | null;
			if (!response.ok) {
				throw new Error(payload?.message ?? 'Could not refresh legal documents.');
			}
			localDocumentsOverride = payload?.documents ?? [];
		} catch (err) {
			feedback = {
				type: 'error',
				message: err instanceof Error ? err.message : 'Could not refresh legal documents.'
			};
		} finally {
			isRefreshing = false;
		}
	};

	const createDocument = async (event: SubmitEvent) => {
		event.preventDefault();
		feedback = null;
		isSaving = true;

		try {
			const response = await fetch('/legal/admin/documents', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				credentials: 'include',
				body: JSON.stringify({
					doc_type: docType,
					version,
					effective_date: effectiveDate,
					acceptance_scope: acceptanceScope,
					content_html: contentHtml,
					is_active: activateNow
				})
			});

			const payload = (await response.json().catch(() => null)) as {
				ok?: boolean;
				message?: string;
			} | null;
			if (!response.ok || !payload?.ok) {
				throw new Error(payload?.message ?? 'Could not create legal document.');
			}

			feedback = {
				type: 'success',
				message: 'Legal document created successfully.'
			};
			version = '';
			effectiveDate = '';
			contentHtml = '';
			acceptanceScope = 'platform_access';
			activateNow = true;
			showCreateForm = false;
			await refreshDocuments();
		} catch (err) {
			feedback = {
				type: 'error',
				message: err instanceof Error ? err.message : 'Could not create legal document.'
			};
		} finally {
			isSaving = false;
		}
	};

	const activateDocument = async (documentId: string) => {
		feedback = null;
		isSaving = true;
		try {
			const response = await fetch(`/legal/admin/documents/${documentId}/activate`, {
				method: 'POST',
				credentials: 'include'
			});
			const payload = (await response.json().catch(() => null)) as {
				ok?: boolean;
				message?: string;
			} | null;
			if (!response.ok || !payload?.ok) {
				throw new Error(payload?.message ?? 'Could not activate legal document.');
			}
			feedback = {
				type: 'success',
				message: 'Legal document activated.'
			};
			await refreshDocuments();
		} catch (err) {
			feedback = {
				type: 'error',
				message: err instanceof Error ? err.message : 'Could not activate legal document.'
			};
		} finally {
			isSaving = false;
		}
	};

	const selectDocType = (type: LegalDocumentType) => {
		selectedDocType = type;
		selectedVersionIndex = 0;
		showCreateForm = false;
	};

	const goBackToList = () => {
		selectedDocType = null;
		showCreateForm = false;
	};

	const navigateVersion = (direction: 'prev' | 'next') => {
		const versions = versionsForSelectedType;
		if (direction === 'prev' && selectedVersionIndex > 0) {
			selectedVersionIndex--;
		} else if (direction === 'next' && selectedVersionIndex < versions.length - 1) {
			selectedVersionIndex++;
		}
	};
</script>

<div class="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
	{#if feedback}
		<Alert variant={feedback.type === 'success' ? 'success' : 'destructive'} size="sm">
			<p class="text-foreground text-sm font-medium">{feedback.message}</p>
		</Alert>
	{/if}

	<div class="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row sm:gap-4">
		<div
			class="border-border bg-muted/30 flex shrink-0 flex-col gap-1 overflow-y-auto rounded-sm border p-2 {selectedDocType ||
			showCreateForm
				? 'hidden sm:flex sm:w-40'
				: 'flex-1 sm:w-40 sm:flex-none'}"
		>
			<div class="flex items-center justify-between px-2 py-1.5">
				<p class="text-muted-fg text-xs font-medium uppercase tracking-wide">Documents</p>
				<button
					type="button"
					class="text-muted-fg hover:text-foreground p-1 transition-colors disabled:opacity-50"
					disabled={isRefreshing}
					onclick={refreshDocuments}
					title="Refresh"
				>
					<RefreshCw class="h-3.5 w-3.5 {isRefreshing ? 'animate-spin' : ''}" />
				</button>
			</div>

			{#each allDocTypes as type (type)}
				{@const versions = documentsByType[type] ?? []}
				{@const hasActive = versions.some((v) => v.is_active)}
				<button
					type="button"
					class="flex items-center gap-2 rounded-sm px-2 py-2 text-left text-sm transition-colors sm:py-1.5 {selectedDocType ===
					type
						? 'bg-primary text-primary-fg'
						: 'text-foreground hover:bg-muted'}"
					onclick={() => selectDocType(type)}
				>
					<FileText class="h-4 w-4 shrink-0 opacity-60" />
					<span class="min-w-0 flex-1 truncate">{docTypeShortLabel(type)}</span>
					{#if hasActive}
						<span class="h-2 w-2 shrink-0 rounded-full bg-emerald-500" title="Active"></span>
					{:else if versions.length > 0}
						<span class="h-2 w-2 shrink-0 rounded-full bg-amber-500" title="Inactive"></span>
					{/if}
					<ChevronRight class="h-4 w-4 shrink-0 opacity-40 sm:hidden" />
				</button>
			{/each}

			<div class="border-border mt-2 border-t pt-2">
				<button
					type="button"
					class="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm transition-colors sm:py-1.5 {showCreateForm
						? 'bg-primary text-primary-fg'
						: 'text-foreground hover:bg-muted'}"
					onclick={() => {
						showCreateForm = true;
						selectedDocType = null;
					}}
				>
					<Plus class="h-4 w-4 shrink-0" />
					<span class="flex-1">New document</span>
					<ChevronRight class="h-4 w-4 shrink-0 opacity-40 sm:hidden" />
				</button>
			</div>
		</div>

		<div
			class="flex min-h-0 flex-1 flex-col overflow-hidden {!selectedDocType && !showCreateForm
				? 'hidden sm:flex'
				: ''}"
		>
			{#if showCreateForm}
				<div class="flex flex-1 flex-col overflow-hidden">
					<button
						type="button"
						class="text-muted-fg hover:text-foreground mb-3 flex items-center gap-1.5 text-sm sm:hidden"
						onclick={goBackToList}
					>
						<ArrowLeft class="h-4 w-4" />
						Back to documents
					</button>

					<div class="border-border bg-card flex-1 overflow-y-auto rounded-sm border p-4">
						<h3 class="text-foreground mb-4 text-sm font-semibold">Create new document</h3>
						<form class="space-y-4" onsubmit={createDocument}>
							<FormControl label="Document type" class="gap-2 text-sm">
								<select
									class="border-border bg-input text-foreground h-10 w-full rounded-sm border px-3 text-sm"
									bind:value={docType}
								>
									<option value="tos">Terms of Service</option>
									<option value="privacy">Privacy Notice</option>
									<option value="ai_notice">AI Notice</option>
									<option value="data_sharing">Data Sharing Notice</option>
									<option value="data_processing_agreement">Data Processing Agreement</option>
									<option value="subprocessor_list">Subprocessor List</option>
								</select>
							</FormControl>

							<FormControl label="Version" class="gap-2 text-sm">
								<Input bind:value={version} placeholder="2026-03-15" required />
							</FormControl>

							<FormControl label="Acceptance requirement" class="gap-2 text-sm">
								<select
									class="border-border bg-input text-foreground h-10 w-full rounded-sm border px-3 text-sm"
									bind:value={acceptanceScope}
								>
									<option value="platform_access">Platform Access (Mandatory)</option>
									<option value="none">Reference Only (Not Required)</option>
								</select>
							</FormControl>

							<FormControl label="Effective date" class="gap-2 text-sm">
								<input
									type="date"
									bind:value={effectiveDate}
									required
									class="border-border bg-input text-foreground h-10 w-full rounded-sm border px-3 text-sm"
								/>
							</FormControl>

							<FormControl label="Sanitized HTML content" class="gap-2 text-sm" tag="div">
								<textarea
									bind:value={contentHtml}
									required
									rows="10"
									class="border-border bg-input text-foreground w-full rounded-sm border p-3 font-mono text-xs"
									placeholder="Paste legal HTML content"
								></textarea>
							</FormControl>

							<label class="text-foreground flex items-center gap-2 text-sm font-medium">
								<input type="checkbox" bind:checked={activateNow} class="h-4 w-4" />
								Activate immediately
							</label>

							<div class="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									class="w-full sm:w-auto"
									onclick={() => {
										showCreateForm = false;
									}}
								>
									Cancel
								</Button>
								<Button
									type="submit"
									variant="primary"
									size="sm"
									class="w-full sm:w-auto"
									disabled={isSaving}
								>
									{isSaving ? 'Creating...' : 'Create document'}
								</Button>
							</div>
						</form>
					</div>
				</div>
			{:else if selectedDocType && currentDocument}
				{@const doc = currentDocument}
				{@const versions = versionsForSelectedType}
				<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
					<button
						type="button"
						class="text-muted-fg hover:text-foreground mb-3 flex items-center gap-1.5 text-sm sm:hidden"
						onclick={goBackToList}
					>
						<ArrowLeft class="h-4 w-4" />
						Back to documents
					</button>

					<div
						class="border-border bg-muted/30 flex flex-col gap-2 rounded-t-sm border border-b-0 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-4 sm:py-3"
					>
						<div class="min-w-0">
							<h3 class="text-foreground text-sm font-semibold">{docTypeLabel(selectedDocType)}</h3>
							{#if doc}
								<p class="text-muted-fg mt-0.5 text-xs">
									{#if doc.version}v{doc.version}{/if}
									{#if doc.effective_date}
										{doc.version ? ' · ' : ''}Effective {doc.effective_date}
									{/if}
								</p>
							{/if}
						</div>

						<div class="flex flex-wrap items-center gap-2">
							{#if doc && doc.is_active}
								<span
									class="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"
								>
									Active
								</span>
							{:else if doc}
								<Button
									type="button"
									variant="outline"
									size="sm"
									onclick={() => void activateDocument(doc.id)}
									disabled={isSaving}
								>
									Activate
								</Button>
							{/if}
							{#if doc}
								<span
									class="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700"
								>
									{doc.acceptance_scope === 'platform_access' ? 'Mandatory' : 'Reference'}
								</span>
							{/if}
						</div>
					</div>

					{#if versions.length > 1}
						<div
							class="border-border bg-card flex items-center justify-between border border-b-0 px-3 py-2 sm:px-4"
						>
							<button
								type="button"
								class="text-muted-fg hover:text-foreground flex items-center gap-1 text-xs disabled:opacity-40"
								disabled={selectedVersionIndex <= 0}
								onclick={() => navigateVersion('prev')}
							>
								<ChevronLeft class="h-4 w-4" />
								<span class="xs:inline hidden">Newer</span>
							</button>
							<span class="text-muted-fg text-xs">
								{selectedVersionIndex + 1} / {versions.length}
							</span>
							<button
								type="button"
								class="text-muted-fg hover:text-foreground flex items-center gap-1 text-xs disabled:opacity-40"
								disabled={selectedVersionIndex >= versions.length - 1}
								onclick={() => navigateVersion('next')}
							>
								<span class="xs:inline hidden">Older</span>
								<ChevronRight class="h-4 w-4" />
							</button>
						</div>
					{/if}

					<div
						class="border-border bg-card min-h-0 flex-1 overflow-y-auto rounded-b-sm border p-3 sm:p-4"
					>
						{#if doc}
							<div class="prose prose-sm legal-html text-foreground max-w-none">
								<!-- eslint-disable-next-line svelte/no-at-html-tags -->
								{@html doc.content_html}
							</div>
						{/if}
					</div>
				</div>
			{:else}
				<div class="hidden flex-1 items-center justify-center sm:flex">
					<div class="text-center">
						<FileText class="text-muted-fg mx-auto h-12 w-12 opacity-50" />
						<p class="text-muted-fg mt-3 text-sm">Select a document type to view its content.</p>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	:global(.legal-html h1, .legal-html h2, .legal-html h3) {
		margin-top: 1rem;
		margin-bottom: 0.5rem;
	}
	:global(.legal-html p, .legal-html li) {
		line-height: 1.5;
	}
	:global(.legal-html ul, .legal-html ol) {
		padding-left: 1.2rem;
	}
</style>
