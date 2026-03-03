<script lang="ts">
	import { goto } from '$app/navigation';
	import { Button, Checkbox } from '@pixelcode_/blocks/components';
	import Drawer from '$lib/components/drawer/drawer.svelte';

	const { data } = $props();

	type ActiveLegalDocument = {
		id: string;
		doc_type:
			| 'tos'
			| 'privacy'
			| 'ai_notice'
			| 'data_sharing'
			| 'data_processing_agreement'
			| 'subprocessor_list';
		version: string;
		content_html: string;
		effective_date: string;
		acceptance_scope: 'platform_access' | 'none';
		created_at: string;
	};

	type ReviewDocument = {
		id: string;
		title: string;
		version: string;
		effective_date: string;
		acceptance_scope: 'platform_access' | 'none';
		content_html: string;
	};

	const activeDocuments = $derived((data.activeDocuments ?? []) as ActiveLegalDocument[]);
	const missingHomeOrganisation = $derived(!data.homeOrganisationId);
	const redirectTo = $derived((data.redirectTo as string | undefined) ?? '/');
	const hasAcceptedCurrent = $derived(Boolean(data.acceptanceStatus?.hasAcceptedCurrent));

	const docTypeLabel = (type: ActiveLegalDocument['doc_type']) => {
		switch (type) {
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
				return type;
		}
	};

	const reviewDocuments = $derived<ReviewDocument[]>(
		activeDocuments.map((document) => ({
			id: document.id,
			title: docTypeLabel(document.doc_type),
			version: document.version,
			effective_date: document.effective_date,
			acceptance_scope: document.acceptance_scope,
			content_html: document.content_html
		}))
	);

	let selectedDocument = $state<ReviewDocument | null>(null);
	let drawerOpen = $state(false);
	let accepted = $state(false);
	let isSubmitting = $state(false);
	let message = $state<string | null>(null);
	let messageType = $state<'error' | 'success'>('error');

	const openDocument = (document: ReviewDocument) => {
		selectedDocument = document;
		drawerOpen = true;
	};

	const submitAcceptance = async () => {
		if (missingHomeOrganisation) {
			message = 'Your account must be linked to a home organisation before continuing.';
			messageType = 'error';
			return;
		}
		if (!accepted) {
			message = 'You must confirm acceptance before continuing.';
			messageType = 'error';
			return;
		}

		isSubmitting = true;
		message = null;

		try {
			const response = await fetch(`/legal/accept?redirect=${encodeURIComponent(redirectTo)}`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({ redirectTo })
			});

			const payload = (await response.json().catch(() => null)) as {
				ok?: boolean;
				message?: string;
				redirectTo?: string;
			} | null;

			if (!response.ok || !payload?.ok) {
				message = payload?.message ?? 'Could not save legal acceptance.';
				messageType = 'error';
				return;
			}

			messageType = 'success';
			message = 'Legal acceptance saved. Redirecting...';
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			await goto(payload.redirectTo || '/');
		} catch (err) {
			message = err instanceof Error ? err.message : 'Could not save legal acceptance.';
			messageType = 'error';
		} finally {
			isSubmitting = false;
		}
	};
</script>

<div class="bg-background text-foreground min-h-screen px-4 py-10 sm:px-6">
	<div class="mx-auto w-full max-w-4xl space-y-6">
		<header class="space-y-2">
			<h1 class="text-3xl font-semibold tracking-tight">Legal Acceptance Required</h1>
			<p class="text-muted-fg text-sm">
				Review and accept the active legal documents to continue using the platform.
			</p>
		</header>

		{#if hasAcceptedCurrent}
			<div class="border-border bg-card rounded-sm border p-4 text-sm">
				You have already accepted the current legal documents. Redirecting should happen
				automatically.
			</div>
		{/if}

		{#if missingHomeOrganisation}
			<div class="rounded-sm border border-red-200 bg-red-50 p-4 text-sm text-red-700">
				Your account is missing a home organisation. Ask an administrator to connect your user
				before you continue.
			</div>
		{/if}

		<div class="grid gap-4 sm:grid-cols-2">
			{#each reviewDocuments as document (document.id)}
				<div class="border-border bg-card rounded-sm border p-4">
					<p class="text-xs font-semibold uppercase tracking-wide">{document.title}</p>
					{#if document.version}
						<p class="mt-2 text-sm">Version {document.version}</p>
					{/if}
					{#if document.effective_date}
						<p class="text-muted-fg mt-1 text-xs">Effective {document.effective_date}</p>
					{/if}
					<p class="text-muted-fg mt-1 text-xs">
						{document.acceptance_scope === 'platform_access'
							? 'Mandatory for platform access'
							: 'Reference only'}
					</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						class="mt-3"
						onclick={() => openDocument(document)}
					>
						View document
					</Button>
				</div>
			{/each}
		</div>

		<div class="border-border bg-card space-y-4 rounded-sm border p-5">
			<Checkbox bind:checked={accepted} disabled={missingHomeOrganisation || isSubmitting}>
				I confirm that I have read and accept all current legal documents.
			</Checkbox>

			{#if message}
				<div
					class={`rounded-sm border px-3 py-2 text-sm ${
						messageType === 'error'
							? 'border-red-200 bg-red-50 text-red-700'
							: 'border-emerald-200 bg-emerald-50 text-emerald-700'
					}`}
				>
					{message}
				</div>
			{/if}

			<div class="flex justify-end">
				<Button
					type="button"
					variant="primary"
					disabled={missingHomeOrganisation || isSubmitting || hasAcceptedCurrent}
					onclick={submitAcceptance}
				>
					{isSubmitting ? 'Saving...' : 'Accept and Continue'}
				</Button>
			</div>
		</div>
	</div>
</div>

<Drawer
	variant="right"
	bind:open={drawerOpen}
	title={selectedDocument ? selectedDocument.title : ''}
	subtitle={selectedDocument ? `Version ${selectedDocument.version}` : undefined}
	class="mr-0 w-full max-w-2xl"
	dismissable
>
	{#if selectedDocument}
		<div class="prose prose-sm legal-html text-foreground max-w-none" data-legal-html>
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html selectedDocument.content_html}
		</div>
	{/if}
</Drawer>

<style>
	:global(.legal-html h1, .legal-html h2, .legal-html h3) {
		margin-top: 1rem;
		margin-bottom: 0.5rem;
	}
	:global(.legal-html p, .legal-html li) {
		line-height: 1.5;
	}
	:global(.legal-html ul) {
		padding-left: 1.2rem;
	}
</style>
