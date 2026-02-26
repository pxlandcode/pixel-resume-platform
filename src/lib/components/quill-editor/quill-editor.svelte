<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { loadQuill, type QuillInstance } from '$lib/utils/quillLoader';

	let {
		content = $bindable(''),
		placeholder = 'Write something...',
		toolbarOptions = [
			['bold', 'italic', 'underline', 'blockquote'],
			[{ list: 'ordered' }, { list: 'bullet' }],
			['clean']
		],
		onchange
	} = $props<{
		content?: string;
		placeholder?: string;
		toolbarOptions?: unknown[];
		onchange?: (html: string) => void;
	}>();

	let quillContainer: HTMLDivElement | null = null;
	let quillEditor: QuillInstance | null = null;
	let applyingExternalContent = false;
	let isMounted = false;
	let mountSession = 0;

	const normalizeEditorHtml = (value: string | null | undefined): string => {
		const raw = (value ?? '').trim();
		if (!raw || raw === '<p><br></p>') return '';
		return raw.replace(/\s+/g, ' ');
	};

	const destroyQuill = () => {
		if (quillEditor) {
			quillEditor = null;
		}
	};

	const mountQuill = async () => {
		if (!quillContainer) return;
		if (quillEditor) return;
		const container = quillContainer;
		const session = ++mountSession;

		const QuillConstructor = await loadQuill();
		if (!QuillConstructor) return;
		if (!isMounted || session !== mountSession) return;
		if (!quillContainer || quillContainer !== container) return;

		let nextEditor: QuillInstance | null = null;
		try {
			nextEditor = new QuillConstructor(container, {
				theme: 'snow',
				placeholder,
				modules: {
					toolbar: toolbarOptions
				}
			});
		} catch (error) {
			console.error('[quill-editor] failed to initialize', error);
			return;
		}
		if (!nextEditor) return;
		if (!isMounted || session !== mountSession) return;
		quillEditor = nextEditor;

		// Initial content
		if (content && quillEditor.clipboard?.dangerouslyPasteHTML) {
			quillEditor.clipboard.dangerouslyPasteHTML(content);
		}

		// Listen for changes
		quillEditor.on?.('text-change', () => {
			const newContent = quillEditor?.root.innerHTML ?? '';
			content = newContent;
			if (!applyingExternalContent) {
				onchange?.(newContent);
			}
		});
	};

	$effect(() => {
		if (quillEditor) {
			const next = normalizeEditorHtml(content);
			const current = normalizeEditorHtml(quillEditor.root.innerHTML);
			if (next !== current) {
				applyingExternalContent = true;
				if (!next) {
					quillEditor.setText?.('');
				} else if (quillEditor.clipboard?.dangerouslyPasteHTML) {
					quillEditor.clipboard.dangerouslyPasteHTML(content);
				}
				queueMicrotask(() => {
					applyingExternalContent = false;
				});
			}
		}
	});

	onMount(() => {
		isMounted = true;
		mountQuill();
	});

	onDestroy(() => {
		isMounted = false;
		mountSession += 1;
		destroyQuill();
	});
</script>

<div class="quill-wrapper">
	<div bind:this={quillContainer} class="bg-white text-slate-900"></div>
</div>

<style>
	/* Quill editor text color override if needed */
	:global(.ql-editor) {
		color: rgb(15 23 42) !important; /* text-slate-900 */
		min-height: 100px;
	}
	:global(.ql-toolbar) {
		border-top-left-radius: 0.375rem;
		border-top-right-radius: 0.375rem;
		border-color: #e2e8f0 !important;
	}
	:global(.ql-container) {
		border-bottom-left-radius: 0.375rem;
		border-bottom-right-radius: 0.375rem;
		border-color: #e2e8f0 !important;
	}
	:global(.ql-editor blockquote) {
		border-left-width: 2px;
		border-color: rgb(251 146 60) !important; /* orange-400 */
		padding-left: 0.75rem; /* pl-3 */
		font-size: 0.875rem; /* text-sm */
		color: rgb(51 65 85) !important; /* text-slate-700 */
		font-style: italic;
		margin-top: 0.5rem;
		margin-bottom: 0.5rem;
		position: relative;
	}
	:global(.ql-editor blockquote::before) {
		content: '"';
	}
	:global(.ql-editor blockquote::after) {
		content: '"';
	}
</style>
