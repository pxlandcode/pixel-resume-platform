const QUILL_MODULE_URL = 'https://cdn.skypack.dev/quill@1.3.7?min';
const QUILL_STYLESHEET_URL = 'https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.snow.css';
const STYLE_ELEMENT_ID = 'quill-snow-stylesheet';

export type QuillInstance = {
	root: HTMLElement;
	clipboard: { dangerouslyPasteHTML: (value: string) => void };
	on: (event: string, handler: (...args: unknown[]) => void) => void;
	focus?: () => void;
	getLength?: () => number;
	getSelection?: () => { index: number; length: number } | null;
	setSelection?: (index: number, length?: number, source?: string) => void;
	setContents?: (delta: unknown) => void;
	setText?: (text: string) => void;
};

export type QuillConstructor = new (
	container: HTMLElement,
	options: Record<string, unknown>
) => QuillInstance;

const ensureQuillStylesheet = () => {
	if (typeof document === 'undefined') return;
	if (document.getElementById(STYLE_ELEMENT_ID)) return;

	const link = document.createElement('link');
	link.rel = 'stylesheet';
	link.href = QUILL_STYLESHEET_URL;
	link.id = STYLE_ELEMENT_ID;
	document.head.appendChild(link);
};

export const loadQuill = async (): Promise<QuillConstructor | null> => {
	if (typeof window === 'undefined') {
		return null;
	}

	ensureQuillStylesheet();

	const module = (await import(/* @vite-ignore */ QUILL_MODULE_URL)) as {
		default: QuillConstructor;
	};

	return module.default;
};
