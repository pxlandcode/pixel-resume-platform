import { writable, derived } from 'svelte/store';

export type ResumeDownloadKind = 'pdf' | 'word';

export type ResumeDownloadState = {
	isActive: boolean;
	kind: ResumeDownloadKind | null;
	label: string | null;
};

const initialState: ResumeDownloadState = {
	isActive: false,
	kind: null,
	label: null
};

function createResumeDownloadStore() {
	const { subscribe, set } = writable<ResumeDownloadState>(initialState);

	return {
		subscribe,
		start: (kind: ResumeDownloadKind, label?: string) => {
			set({
				isActive: true,
				kind,
				label: label?.trim() || null
			});
		},
		stop: () => {
			set(initialState);
		}
	};
}

export const resumeDownloadStore = createResumeDownloadStore();
export const isResumeDownloadActive = derived(resumeDownloadStore, ($store) => $store.isActive);
