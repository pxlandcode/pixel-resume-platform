<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { loadQuill, type QuillInstance } from '$lib/utils/quillLoader';

	let {
		content = '',
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
	let removeRootListeners: (() => void) | null = null;
	let applyingExternalContent = false;
	let isMounted = false;
	let mountSession = 0;
	let pendingEmitTimer: number | null = null;
	let pendingSerializedContent: string | null = null;
	let selectionRepairTimer: number | null = null;
	let lastEmittedContent = '';
	let lastAppliedContent = '';
	let lastKnownSelection: { index: number; length: number } | null = null;
	let lastTextChangeAt = 0;

	const normalizeEditorHtml = (value: string | null | undefined): string => {
		const raw = (value ?? '').trim();
		if (!raw || raw === '<p><br></p>') return '';
		return raw.replace(/\s+/g, ' ');
	};

	const getEditorHtml = (): string => quillEditor?.root.innerHTML ?? '';

	const serializeEditorHtml = (value: string | null | undefined): string => {
		const normalized = normalizeEditorHtml(value);
		return normalized ? (value ?? '') : '';
	};

	const editorHasFocus = (): boolean =>
		document.activeElement instanceof HTMLElement &&
		Boolean(quillContainer?.contains(document.activeElement));
	const getSelectionSnapshot = () => quillEditor?.getSelection?.() ?? null;
	const getEditorSelectionEnd = (): { index: number; length: number } | null => {
		if (!quillEditor?.getLength) return null;
		return {
			index: Math.max(0, quillEditor.getLength() - 1),
			length: 0
		};
	};
	const getRepairSelection = (): { index: number; length: number } | null => {
		const endSelection = getEditorSelectionEnd();
		if (!lastKnownSelection) return endSelection;
		if (!endSelection) return lastKnownSelection;

		const clampedSelection = {
			index: Math.min(lastKnownSelection.index, endSelection.index),
			length: lastKnownSelection.length
		};
		const shouldPreferEndSelection =
			clampedSelection.length === 0 &&
			Date.now() - lastTextChangeAt < 1000 &&
			endSelection.index >= clampedSelection.index &&
			endSelection.index - clampedSelection.index <= 2;

		return shouldPreferEndSelection ? endSelection : clampedSelection;
	};

	const clearSelectionRepair = () => {
		if (selectionRepairTimer !== null) {
			window.clearTimeout(selectionRepairTimer);
			selectionRepairTimer = null;
		}
	};

	const scheduleSelectionRepair = (delay = 30) => {
		clearSelectionRepair();
		selectionRepairTimer = window.setTimeout(() => {
			selectionRepairTimer = null;
			if (!quillEditor) return;
			const selection = getSelectionSnapshot();
			const repairSelection = getRepairSelection();
			if (editorHasFocus() && !selection && repairSelection) {
				quillEditor.setSelection?.(repairSelection.index, repairSelection.length, 'silent');
			}
		}, delay);
	};

	const clearPendingEmit = () => {
		if (pendingEmitTimer !== null) {
			window.clearTimeout(pendingEmitTimer);
			pendingEmitTimer = null;
		}
	};

	const flushPendingEmit = () => {
		if (pendingSerializedContent === null) return;
		const serialized = pendingSerializedContent;
		pendingSerializedContent = null;
		clearPendingEmit();
		onchange?.(serialized);
		scheduleSelectionRepair(0);
	};

	const scheduleEmit = (serialized: string) => {
		pendingSerializedContent = serialized;
		clearPendingEmit();
		pendingEmitTimer = window.setTimeout(() => {
			flushPendingEmit();
		}, 150);
	};

	const applyEditorHtml = (nextContent: string | null | undefined, reason = 'external') => {
		if (!quillEditor) return;
		const normalized = normalizeEditorHtml(nextContent);
		const current = normalizeEditorHtml(getEditorHtml());
		if (normalized === current) {
			lastAppliedContent = normalized;
			return;
		}

		const hadFocus = editorHasFocus();
		const selection = quillEditor.getSelection?.();

		applyingExternalContent = true;
		if (!normalized) {
			quillEditor.setText?.('');
		} else if (quillEditor.clipboard?.dangerouslyPasteHTML) {
			quillEditor.clipboard.dangerouslyPasteHTML(nextContent ?? '');
		}
		lastAppliedContent = normalized;

		queueMicrotask(() => {
			if (hadFocus) {
				quillEditor?.focus?.();
				if (selection) {
					quillEditor?.setSelection?.(selection.index, selection.length, 'silent');
				}
			}
			applyingExternalContent = false;
		});
	};

	const destroyQuill = () => {
		removeRootListeners?.();
		removeRootListeners = null;
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
		const root = quillEditor.root;
		quillEditor.on?.('selection-change', (range) => {
			const nextSelection =
				range && typeof range === 'object' && 'index' in range && 'length' in range
					? { index: range.index as number, length: range.length as number }
					: null;
			if (nextSelection) {
				lastKnownSelection = nextSelection;
			}
			if (!range && editorHasFocus()) {
				scheduleSelectionRepair(0);
			} else {
				clearSelectionRepair();
			}
		});
		const handleFocusOut = (event: FocusEvent) => {
			void event;
			queueMicrotask(() => {
				flushPendingEmit();
			});
		};
		root.addEventListener('focusout', handleFocusOut);
		removeRootListeners = () => {
			root.removeEventListener('focusout', handleFocusOut);
		};

		// Initial content
		applyEditorHtml(content, 'initial');

		// Listen for changes
		quillEditor.on?.('text-change', () => {
			const newContent = getEditorHtml();
			const normalized = normalizeEditorHtml(newContent);
			lastEmittedContent = normalized;
			lastAppliedContent = normalized;
			lastTextChangeAt = Date.now();
			lastKnownSelection = getSelectionSnapshot() ?? lastKnownSelection;
			if (!applyingExternalContent) {
				const serialized = serializeEditorHtml(newContent);
				if (editorHasFocus()) {
					scheduleEmit(serialized);
				} else {
					onchange?.(serialized);
				}
			}
		});
	};

	$effect(() => {
		if (!quillEditor) return;
		const next = normalizeEditorHtml(content);
		const current = normalizeEditorHtml(getEditorHtml());
		if (editorHasFocus()) {
			lastAppliedContent = current;
			return;
		}
		if (next === current) return;
		if (next === lastEmittedContent) return;
		applyEditorHtml(content, 'effect');
	});

	onMount(() => {
		isMounted = true;
		mountQuill();
	});

	onDestroy(() => {
		isMounted = false;
		mountSession += 1;
		flushPendingEmit();
		clearPendingEmit();
		clearSelectionRepair();
		destroyQuill();
	});
</script>

<div class="quill-wrapper">
	<div bind:this={quillContainer} class="bg-input text-foreground"></div>
</div>

<style>
	:global(.ql-editor) {
		color: var(--color-foreground, #0f172a) !important;
		background: var(--color-input, #ffffff) !important;
		min-height: 100px;
	}
	:global(.ql-toolbar) {
		border-top-left-radius: 0.375rem;
		border-top-right-radius: 0.375rem;
		border-color: var(--color-border, #e2e8f0) !important;
		background: var(--color-card, #ffffff) !important;
	}
	:global(.ql-container) {
		border-bottom-left-radius: 0.375rem;
		border-bottom-right-radius: 0.375rem;
		border-color: var(--color-border, #e2e8f0) !important;
		background: var(--color-input, #ffffff) !important;
	}
	:global(.ql-editor blockquote) {
		border-left-width: 2px;
		border-color: var(--color-primary, #f35b3f) !important;
		padding-left: 0.75rem; /* pl-3 */
		font-size: 0.875rem; /* text-sm */
		color: var(--color-muted-fg, #2e333a) !important;
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
