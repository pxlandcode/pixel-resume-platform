<script lang="ts">
	import { Alert, Button, FormControl, Input } from '@pixelcode_/blocks/components';
	import Drawer from '$lib/components/drawer/drawer.svelte';

	type LegalDocument = {
		id: string;
		doc_type: 'tos' | 'privacy' | 'ai_notice' | 'data_sharing';
		version: string;
		content_html: string;
		effective_date: string;
		is_active: boolean;
		created_at: string;
	};

	let {
		open = $bindable(false),
		documents = [] as LegalDocument[]
	}: {
		open: boolean;
		documents: LegalDocument[];
	} = $props();

	let localDocumentsOverride = $state<LegalDocument[] | null>(null);
	const localDocuments = $derived(localDocumentsOverride ?? documents);
	let docType = $state<'tos' | 'privacy' | 'ai_notice' | 'data_sharing'>('tos');
	let version = $state('');
	let effectiveDate = $state('');
	let contentHtml = $state('');
	let activateNow = $state(true);
	let isSaving = $state(false);
	let isRefreshing = $state(false);
	let feedback = $state<{ type: 'success' | 'error'; message: string } | null>(null);

	$effect(() => {
		if (!open) {
			localDocumentsOverride = null;
		}
	});

	const docTypeLabel = (docTypeValue: LegalDocument['doc_type']) => {
		switch (docTypeValue) {
			case 'tos':
				return 'Terms of Service';
			case 'privacy':
				return 'Privacy Notice';
			case 'ai_notice':
				return 'AI Notice';
			case 'data_sharing':
				return 'Data Sharing Notice';
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
			const payload = (await response.json().catch(() => null)) as
				| { documents?: LegalDocument[]; message?: string }
				| null;
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
					content_html: contentHtml,
					is_active: activateNow
				})
			});

			const payload = (await response.json().catch(() => null)) as
				| { ok?: boolean; message?: string }
				| null;
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
			activateNow = true;
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
			const payload = (await response.json().catch(() => null)) as
				| { ok?: boolean; message?: string }
				| null;
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
</script>

<Drawer
	variant="right"
	bind:open
	title="Legal Documents"
	subtitle="Create, review, and activate legal versions."
	class="mr-0 w-full max-w-2xl"
	dismissable
>
	<div class="flex flex-col gap-6 overflow-y-auto pb-16">
		<form class="space-y-4" onsubmit={createDocument}>
			<div class="grid gap-4 sm:grid-cols-2">
				<FormControl label="Document type" class="gap-2 text-sm">
					<select
						class="border-border bg-input text-foreground h-10 rounded-sm border px-3 text-sm"
						bind:value={docType}
					>
						<option value="tos">Terms of Service</option>
						<option value="privacy">Privacy Notice</option>
						<option value="ai_notice">AI Notice</option>
						<option value="data_sharing">Data Sharing Notice</option>
					</select>
				</FormControl>
				<FormControl label="Version" class="gap-2 text-sm">
					<Input bind:value={version} placeholder="2026-03-15" required />
				</FormControl>
			</div>

			<FormControl label="Effective date" class="gap-2 text-sm">
				<input
					type="date"
					bind:value={effectiveDate}
					required
					class="border-border bg-input text-foreground h-10 rounded-sm border px-3 text-sm"
				/>
			</FormControl>

			<FormControl label="Sanitized HTML content" class="gap-2 text-sm" tag="div">
				<textarea
					bind:value={contentHtml}
					required
					rows="10"
					class="border-border bg-input text-foreground w-full rounded-sm border p-3 text-sm"
					placeholder="Paste legal HTML content"
				></textarea>
			</FormControl>

			<label class="text-foreground flex items-center gap-2 text-sm font-medium">
				<input type="checkbox" bind:checked={activateNow} class="h-4 w-4" />
				Activate immediately
			</label>

			<div class="flex items-center justify-end gap-2">
				<Button type="button" variant="outline" size="sm" disabled={isRefreshing} onclick={refreshDocuments}
					>{isRefreshing ? 'Refreshing...' : 'Refresh'}</Button
				>
				<Button type="submit" variant="primary" size="sm" disabled={isSaving}
					>{isSaving ? 'Saving...' : 'Create document'}</Button
				>
			</div>
		</form>

		{#if feedback}
			<Alert variant={feedback.type === 'success' ? 'success' : 'destructive'} size="sm">
				<p class="text-foreground text-sm font-medium">{feedback.message}</p>
			</Alert>
		{/if}

		<div class="space-y-3">
			<h3 class="text-foreground text-sm font-semibold">Existing versions</h3>
			<ul class="space-y-2">
				{#each localDocuments as document (document.id)}
					<li class="border-border bg-muted rounded-sm border p-3">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<div>
								<p class="text-foreground text-sm font-semibold">
									{docTypeLabel(document.doc_type)} · {document.version}
								</p>
								<p class="text-muted-fg text-xs">Effective {document.effective_date}</p>
							</div>
							{#if document.is_active}
								<span class="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"
									>Active</span
								>
							{:else}
								<Button
									type="button"
									variant="outline"
									size="sm"
									onclick={() => activateDocument(document.id)}
									disabled={isSaving}
								>
									Activate
								</Button>
							{/if}
						</div>
					</li>
				{:else}
					<li class="text-muted-fg text-xs">No legal documents found.</li>
				{/each}
			</ul>
		</div>
	</div>
</Drawer>
