import { writable } from 'svelte/store';

type LoadingState = {
	isLoading: boolean;
	loadingText: string | null;
};

const defaultState: LoadingState = {
	isLoading: false,
	loadingText: null
};

const loadingStore = writable<LoadingState>(defaultState);

const loading = (isLoading: boolean, loadingText?: string) => {
	if (isLoading) {
		loadingStore.set({
			isLoading: true,
			loadingText: loadingText ?? null
		});
		return;
	}

	loadingStore.set(defaultState);
};

export { loading, loadingStore };
export type { LoadingState };
