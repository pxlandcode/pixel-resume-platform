import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';

export type PdfImportPhase =
	| 'idle'
	| 'creating-job'
	| 'staging-file'
	| 'starting-background'
	| 'queued'
	| 'processing'
	| 'succeeded';

export interface PdfImportState {
	status: PdfImportPhase;
	jobId: string | null;
	personId: string | null;
	sourceFilename: string | null;
	error: string | null;
	resumeId: string | null;
}

const STORAGE_KEY_PREFIX = 'resume-pdf-import-job:';

function getStorageKey(personId: string): string {
	return `${STORAGE_KEY_PREFIX}${personId}`;
}

function createPdfImportStore() {
	const initialState: PdfImportState = {
		status: 'idle',
		jobId: null,
		personId: null,
		sourceFilename: null,
		error: null,
		resumeId: null
	};

	const { subscribe, set, update } = writable<PdfImportState>(initialState);

	// Try to restore from sessionStorage on init
	if (browser) {
		try {
			// Look for any persisted import job
			for (let i = 0; i < sessionStorage.length; i++) {
				const key = sessionStorage.key(i);
				if (key?.startsWith(STORAGE_KEY_PREFIX)) {
					const raw = sessionStorage.getItem(key);
					if (raw) {
						const parsed = JSON.parse(raw);
						if (parsed.jobId && parsed.status && parsed.status !== 'idle') {
							const personId = key.replace(STORAGE_KEY_PREFIX, '');
							set({
								status:
									parsed.status === 'processing'
										? 'processing'
										: parsed.status === 'queued'
											? 'queued'
											: 'queued',
								jobId: parsed.jobId,
								personId,
								sourceFilename: parsed.sourceFilename || null,
								error: null,
								resumeId: null
							});
							break;
						}
					}
				}
			}
		} catch {
			// Ignore storage errors
		}
	}

	function persist(state: PdfImportState) {
		if (!browser || !state.personId || !state.jobId) return;
		if (state.status === 'idle') {
			try {
				sessionStorage.removeItem(getStorageKey(state.personId));
			} catch {
				// Ignore
			}
			return;
		}

		try {
			sessionStorage.setItem(
				getStorageKey(state.personId),
				JSON.stringify({
					jobId: state.jobId,
					sourceFilename: state.sourceFilename,
					status: state.status,
					savedAt: new Date().toISOString()
				})
			);
		} catch {
			// Ignore storage write failures
		}
	}

	return {
		subscribe,
		setImporting: (
			personId: string,
			jobId: string,
			filename: string | null,
			status: PdfImportPhase
		) => {
			const newState: PdfImportState = {
				status,
				jobId,
				personId,
				sourceFilename: filename,
				error: null,
				resumeId: null
			};
			set(newState);
			persist(newState);
		},
		setSuccess: (resumeId: string) => {
			update((s) => {
				const newState: PdfImportState = { ...s, status: 'succeeded', resumeId, error: null };
				// Clear the storage since we're done
				if (browser && s.personId) {
					try {
						sessionStorage.removeItem(getStorageKey(s.personId));
					} catch {
						// Ignore
					}
				}
				return newState;
			});
		},
		setStatus: (status: PdfImportPhase) => {
			update((s) => {
				const newState = { ...s, status };
				persist(newState);
				return newState;
			});
		},
		setError: (error: string) => {
			update((s) => {
				const newState: PdfImportState = { ...s, status: 'idle', error };
				persist(newState);
				return newState;
			});
		},
		clear: () => {
			const current = get({ subscribe });
			if (browser && current.personId) {
				try {
					sessionStorage.removeItem(getStorageKey(current.personId));
				} catch {
					// Ignore
				}
			}
			set(initialState);
		},
		reset: () => set(initialState)
	};
}

export const pdfImportStore = createPdfImportStore();

export const isImportActive = derived(
	pdfImportStore,
	($store) => $store.status !== 'idle' || !!$store.error
);

export const isBackgroundImporting = derived(
	pdfImportStore,
	($store) => $store.status === 'queued' || $store.status === 'processing'
);

export const isKickoffImporting = derived(
	pdfImportStore,
	($store) =>
		$store.status === 'creating-job' ||
		$store.status === 'staging-file' ||
		$store.status === 'starting-background'
);

export const isImportSucceeded = derived(pdfImportStore, ($store) => $store.status === 'succeeded');

export const importStatusLabel = derived(pdfImportStore, ($store) => {
	switch ($store.status) {
		case 'creating-job':
			return 'Preparing import...';
		case 'staging-file':
			return 'Uploading PDF to secure temp storage...';
		case 'starting-background':
			return 'Starting background import...';
		case 'queued':
			return 'Queued import...';
		case 'processing':
			return 'Importing and building resume...';
		case 'succeeded':
			return 'Import complete!';
		default:
			return '';
	}
});
