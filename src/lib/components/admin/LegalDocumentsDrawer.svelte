<script lang="ts">
	import Drawer from '$lib/components/drawer/drawer.svelte';
	import LegalDocumentsManager from './LegalDocumentsManager.svelte';

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

	let {
		open = $bindable(false),
		documents = [] as LegalDocument[]
	}: {
		open: boolean;
		documents: LegalDocument[];
	} = $props();
</script>

<Drawer
	variant="right"
	bind:open
	title="Legal Documents"
	subtitle="Manage and review legal document versions."
	class="mr-0 w-full max-w-3xl"
	dismissable
>
	<LegalDocumentsManager {documents} />
</Drawer>
