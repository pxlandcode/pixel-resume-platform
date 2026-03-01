import { json, type RequestHandler } from '@sveltejs/kit';
import { AUTH_COOKIE_NAMES, createSupabaseServerClient } from '$lib/server/supabase';
import {
	applyUserSettingsPatch,
	isViewMode,
	normalizeOrganisationFilterIds,
	normalizeUserSettings,
	type UserSettingsPatch,
	type UserSettingsOrganisationFiltersPatch,
	type UserSettingsViewsPatch
} from '$lib/types/userSettings';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const parseUpdatedAt = (value: unknown) =>
	typeof value === 'string' && value.trim().length > 0 ? value : null;

const parseViewsPatch = (
	value: unknown
):
	| { ok: true; patch: UserSettingsViewsPatch }
	| {
			ok: false;
			message: string;
	  } => {
	if (!isRecord(value)) {
		return { ok: false, message: 'Invalid payload.' };
	}

	const topLevelKeys = Object.keys(value);
	const allowedTopLevelKeys = new Set(['views']);
	for (const key of topLevelKeys) {
		if (!allowedTopLevelKeys.has(key)) {
			return { ok: false, message: `Unsupported field "${key}".` };
		}
	}

	if (!('views' in value)) {
		return { ok: false, message: 'Missing "views" object.' };
	}

	if (!isRecord(value.views)) {
		return { ok: false, message: '"views" must be an object.' };
	}

	const allowedViewKeys = new Set(['talents', 'resumes', 'users']);
	const viewKeys = Object.keys(value.views);
	if (viewKeys.length === 0) {
		return { ok: false, message: 'At least one view setting is required.' };
	}

	const patch: UserSettingsViewsPatch = {};
	for (const key of viewKeys) {
		if (!allowedViewKeys.has(key)) {
			return { ok: false, message: `Unsupported view key "${key}".` };
		}

		const mode = value.views[key];
		if (!isViewMode(mode)) {
			return { ok: false, message: `Invalid view mode for "${key}".` };
		}

		if (key === 'talents') {
			patch.talents = mode;
		} else if (key === 'resumes') {
			patch.resumes = mode;
		} else if (key === 'users') {
			patch.users = mode;
		}
	}

	return { ok: true, patch };
};

const parseOrganisationFiltersPatch = (
	value: unknown
):
	| { ok: true; patch: UserSettingsOrganisationFiltersPatch }
	| {
			ok: false;
			message: string;
	  } => {
	if (!isRecord(value)) {
		return { ok: false, message: '"organisationFilters" must be an object.' };
	}

	const allowedKeys = new Set(['talents', 'resumes']);
	const keys = Object.keys(value);
	if (keys.length === 0) {
		return { ok: false, message: '"organisationFilters" requires at least one key.' };
	}

	const patch: UserSettingsOrganisationFiltersPatch = {};
	for (const key of keys) {
		if (!allowedKeys.has(key)) {
			return { ok: false, message: `Unsupported organisation filter key "${key}".` };
		}

		if (!Array.isArray(value[key])) {
			return { ok: false, message: `Organisation filter "${key}" must be an array.` };
		}

		const ids = normalizeOrganisationFilterIds(value[key]);
		if (key === 'talents') patch.talents = ids;
		if (key === 'resumes') patch.resumes = ids;
	}

	return { ok: true, patch };
};

const parseSettingsPatch = (
	value: unknown
):
	| { ok: true; patch: UserSettingsPatch }
	| {
			ok: false;
			message: string;
	  } => {
	if (!isRecord(value)) {
		return { ok: false, message: 'Invalid payload.' };
	}

	const topLevelKeys = Object.keys(value);
	const allowedTopLevelKeys = new Set(['views', 'organisationFilters']);
	if (topLevelKeys.length === 0) {
		return { ok: false, message: 'At least one settings field is required.' };
	}

	const patch: UserSettingsPatch = {};
	for (const key of topLevelKeys) {
		if (!allowedTopLevelKeys.has(key)) {
			return { ok: false, message: `Unsupported field "${key}".` };
		}

		if (key === 'views') {
			const parsed = parseViewsPatch({ views: value.views });
			if (!parsed.ok) return parsed;
			patch.views = parsed.patch;
		}

		if (key === 'organisationFilters') {
			const parsed = parseOrganisationFiltersPatch(value.organisationFilters);
			if (!parsed.ok) return parsed;
			patch.organisationFilters = parsed.patch;
		}
	}

	return { ok: true, patch };
};

const getAuthenticatedContext = async (accessToken: string | null) => {
	const supabase = createSupabaseServerClient(accessToken);
	if (!supabase) return { supabase: null, userId: null };

	const { data, error } = await supabase.auth.getUser();
	if (error || !data.user?.id) return { supabase: null, userId: null };

	return { supabase, userId: data.user.id };
};

export const GET: RequestHandler = async ({ cookies }) => {
	const accessToken = cookies.get(AUTH_COOKIE_NAMES.access) ?? null;
	const { supabase, userId } = await getAuthenticatedContext(accessToken);

	if (!supabase || !userId) {
		return json({ message: 'Unauthorized.' }, { status: 401 });
	}

	const { data: row, error } = await supabase
		.from('user_settings')
		.select('settings, updated_at')
		.eq('user_id', userId)
		.maybeSingle();

	if (error) {
		return json({ message: error.message }, { status: 500 });
	}

	return json({
		settings: normalizeUserSettings(row?.settings),
		updatedAt: parseUpdatedAt(row?.updated_at),
		source: row ? 'database' : 'default'
	});
};

export const PATCH: RequestHandler = async ({ cookies, request }) => {
	const accessToken = cookies.get(AUTH_COOKIE_NAMES.access) ?? null;
	const { supabase, userId } = await getAuthenticatedContext(accessToken);

	if (!supabase || !userId) {
		return json({ message: 'Unauthorized.' }, { status: 401 });
	}

	let payload: unknown;
	try {
		payload = await request.json();
	} catch {
		return json({ message: 'Invalid JSON payload.' }, { status: 400 });
	}

	const parsedPatch = parseSettingsPatch(payload);
	if (!parsedPatch.ok) {
		return json({ message: parsedPatch.message }, { status: 400 });
	}

	const { data: existingRow, error: existingError } = await supabase
		.from('user_settings')
		.select('settings')
		.eq('user_id', userId)
		.maybeSingle();

	if (existingError) {
		return json({ message: existingError.message }, { status: 500 });
	}

	const nextSettings = applyUserSettingsPatch(
		normalizeUserSettings(existingRow?.settings),
		parsedPatch.patch
	);

	const { data: upsertedRow, error: upsertError } = await supabase
		.from('user_settings')
		.upsert(
			{
				user_id: userId,
				settings: nextSettings,
				updated_at: new Date().toISOString()
			},
			{ onConflict: 'user_id' }
		)
		.select('settings, updated_at')
		.single();

	if (upsertError) {
		return json({ message: upsertError.message }, { status: 500 });
	}

	return json({
		settings: normalizeUserSettings(upsertedRow.settings),
		updatedAt: parseUpdatedAt(upsertedRow.updated_at),
		source: 'database'
	});
};
