import { browser } from '$app/environment';
import { get, writable } from 'svelte/store';
import {
	DEFAULT_USER_SETTINGS,
	applyUserSettingsPatch,
	cloneUserSettings,
	normalizeOrganisationFilterIds,
	normalizeUserSettings,
	type UserSettings,
	type UserSettingsPatch,
	type UserSettingsOrganisationFilters,
	type ViewMode
} from '$lib/types/userSettings';

type UserSettingsSource = 'default' | 'local' | 'server';

export type UserSettingsState = {
	userId: string | null;
	settings: UserSettings;
	updatedAt: string | null;
	source: UserSettingsSource;
	syncing: boolean;
};

const STORAGE_KEY_PREFIX = 'user-settings:v1:';
const SESSION_SYNC_MARKER_PREFIX = 'user-settings-synced:v1:';

type PersistedUserSettings = {
	settings?: unknown;
	updatedAt?: unknown;
};

const initialState = (): UserSettingsState => ({
	userId: null,
	settings: cloneUserSettings(DEFAULT_USER_SETTINGS),
	updatedAt: null,
	source: 'default',
	syncing: false
});

const getStorageKey = (userId: string) => `${STORAGE_KEY_PREFIX}${userId}`;
const getSessionMarkerKey = (userId: string) => `${SESSION_SYNC_MARKER_PREFIX}${userId}`;

const readLocalSettings = (
	userId: string
): { settings: UserSettings; updatedAt: string | null } | null => {
	if (!browser) return null;

	try {
		const raw = localStorage.getItem(getStorageKey(userId));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as PersistedUserSettings;
		return {
			settings: normalizeUserSettings(parsed.settings),
			updatedAt:
				typeof parsed.updatedAt === 'string' && parsed.updatedAt.trim().length > 0
					? parsed.updatedAt
					: null
		};
	} catch {
		return null;
	}
};

const writeLocalSettings = (userId: string, settings: UserSettings, updatedAt: string | null) => {
	if (!browser) return;

	try {
		localStorage.setItem(
			getStorageKey(userId),
			JSON.stringify({
				settings,
				updatedAt,
				savedAt: new Date().toISOString()
			})
		);
	} catch {
		// Ignore local storage write errors.
	}
};

const hasSessionSyncMarker = (userId: string) => {
	if (!browser) return false;
	try {
		return sessionStorage.getItem(getSessionMarkerKey(userId)) === '1';
	} catch {
		return false;
	}
};

const markSessionSynced = (userId: string) => {
	if (!browser) return;
	try {
		sessionStorage.setItem(getSessionMarkerKey(userId), '1');
	} catch {
		// Ignore session storage write errors.
	}
};

function createUserSettingsStore() {
	const { subscribe, set, update } = writable<UserSettingsState>(initialState());

	let activeUserId: string | null = null;
	let patchSequence = 0;

	const getState = () => get({ subscribe });

	const setCurrentUser = (userId: string | null) => {
		if (activeUserId === userId) return;

		activeUserId = userId;
		patchSequence += 1;

		if (!userId) {
			set(initialState());
			return;
		}

		const local = readLocalSettings(userId);
		set({
			userId,
			settings: local ? local.settings : cloneUserSettings(DEFAULT_USER_SETTINGS),
			updatedAt: local?.updatedAt ?? null,
			source: local ? 'local' : 'default',
			syncing: false
		});
	};

	const syncFromServer = async (userId: string) => {
		if (!browser || !userId) return;

		if (activeUserId !== userId) {
			setCurrentUser(userId);
		}

		if (hasSessionSyncMarker(userId)) return;

		update((state) =>
			state.userId === userId
				? {
						...state,
						syncing: true
					}
				: state
		);

		try {
			const response = await fetch('/internal/api/settings', {
				method: 'GET',
				credentials: 'include'
			});

			if (!response.ok) {
				console.warn('[settings] could not sync from server', response.status);
				return;
			}

			const payload = (await response.json()) as {
				settings?: unknown;
				updatedAt?: unknown;
			};
			const settings = normalizeUserSettings(payload.settings);
			const updatedAt =
				typeof payload.updatedAt === 'string' && payload.updatedAt.trim().length > 0
					? payload.updatedAt
					: null;

			markSessionSynced(userId);
			writeLocalSettings(userId, settings, updatedAt);

			update((state) =>
				state.userId === userId
					? {
							...state,
							settings,
							updatedAt,
							source: 'server',
							syncing: false
						}
					: state
			);
		} catch (error) {
			console.warn('[settings] sync request failed', error);
		} finally {
			update((state) =>
				state.userId === userId
					? {
							...state,
							syncing: false
						}
					: state
			);
		}
	};

	const persistPatch = async (
		requestUserId: string,
		requestSequence: number,
		patch: UserSettingsPatch
	) => {
		try {
			const response = await fetch('/internal/api/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify(patch)
			});

			if (!response.ok) {
				console.warn('[settings] could not persist settings patch', response.status);
				return;
			}

			const payload = (await response.json()) as {
				settings?: unknown;
				updatedAt?: unknown;
			};
			if (requestSequence !== patchSequence || activeUserId !== requestUserId) return;

			const settings = normalizeUserSettings(payload.settings);
			const updatedAt =
				typeof payload.updatedAt === 'string' && payload.updatedAt.trim().length > 0
					? payload.updatedAt
					: null;

			writeLocalSettings(requestUserId, settings, updatedAt);
			markSessionSynced(requestUserId);

			update((state) =>
				state.userId === requestUserId
					? {
							...state,
							settings,
							updatedAt,
							source: 'server'
						}
					: state
			);
		} catch (error) {
			console.warn('[settings] settings patch request failed', error);
		}
	};

	const setViewMode = async (view: keyof UserSettings['views'], mode: ViewMode) => {
		const current = getState();
		if (current.settings.views[view] === mode) return;

		const patch: UserSettingsPatch = {
			views: {
				[view]: mode
			}
		};
		const nextSettings = applyUserSettingsPatch(current.settings, patch);

		update((state) =>
			state.userId === current.userId
				? {
						...state,
						settings: nextSettings,
						source: state.userId ? 'local' : state.source
					}
				: state
		);

		if (!current.userId) return;

		writeLocalSettings(current.userId, nextSettings, current.updatedAt);

		const requestUserId = current.userId;
		const requestSequence = ++patchSequence;
		await persistPatch(requestUserId, requestSequence, patch);
	};

	const setOrganisationFilters = async (
		view: keyof UserSettingsOrganisationFilters,
		organisationIds: string[]
	) => {
		const current = getState();
		const normalizedIds = normalizeOrganisationFilterIds(organisationIds);

		const currentIds = current.settings.organisationFilters[view];
		const isSame =
			currentIds.length === normalizedIds.length &&
			currentIds.every((id, index) => id === normalizedIds[index]);
		if (isSame) return;

		const patch: UserSettingsPatch = {
			organisationFilters: {
				[view]: normalizedIds
			}
		};
		const nextSettings = applyUserSettingsPatch(current.settings, patch);

		update((state) =>
			state.userId === current.userId
				? {
						...state,
						settings: nextSettings,
						source: state.userId ? 'local' : state.source
					}
				: state
		);

		if (!current.userId) return;

		writeLocalSettings(current.userId, nextSettings, current.updatedAt);

		const requestUserId = current.userId;
		const requestSequence = ++patchSequence;
		await persistPatch(requestUserId, requestSequence, patch);
	};

	const reset = () => {
		activeUserId = null;
		patchSequence += 1;
		set(initialState());
	};

	return {
		subscribe,
		setCurrentUser,
		syncFromServer,
		setViewMode,
		setOrganisationFilters,
		reset
	};
}

export const userSettingsStore = createUserSettingsStore();
