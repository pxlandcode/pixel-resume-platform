export type ViewMode = 'grid' | 'list';

export type UserSettingsViews = {
	talents: ViewMode;
	resumes: ViewMode;
};

export type UserSettingsOrganisationFilters = {
	talents: string[];
	resumes: string[];
};

export type UserSettings = {
	views: UserSettingsViews;
	organisationFilters: UserSettingsOrganisationFilters;
};

export type UserSettingsViewsPatch = Partial<UserSettingsViews>;
export type UserSettingsOrganisationFiltersPatch = Partial<UserSettingsOrganisationFilters>;

export type UserSettingsPatch = {
	views?: UserSettingsViewsPatch;
	organisationFilters?: UserSettingsOrganisationFiltersPatch;
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
	views: {
		talents: 'grid',
		resumes: 'grid'
	},
	organisationFilters: {
		talents: [],
		resumes: []
	}
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export const isViewMode = (value: unknown): value is ViewMode =>
	value === 'grid' || value === 'list';

export const cloneUserSettings = (settings: UserSettings): UserSettings => ({
	views: {
		talents: settings.views.talents,
		resumes: settings.views.resumes
	},
	organisationFilters: {
		talents: [...settings.organisationFilters.talents],
		resumes: [...settings.organisationFilters.resumes]
	}
});

export const normalizeOrganisationFilterIds = (value: unknown): string[] => {
	if (!Array.isArray(value)) return [];

	const unique = new Set<string>();
	for (const entry of value) {
		if (typeof entry !== 'string') continue;
		const trimmed = entry.trim();
		if (!trimmed) continue;
		unique.add(trimmed);
	}

	return Array.from(unique);
};

export const normalizeUserSettings = (value: unknown): UserSettings => {
	const defaults = DEFAULT_USER_SETTINGS;
	if (!isRecord(value)) return cloneUserSettings(defaults);

	const views = isRecord(value.views) ? value.views : {};
	const organisationFilters = isRecord(value.organisationFilters) ? value.organisationFilters : {};

	return {
		views: {
			talents: isViewMode(views.talents) ? views.talents : defaults.views.talents,
			resumes: isViewMode(views.resumes) ? views.resumes : defaults.views.resumes
		},
		organisationFilters: {
			talents: normalizeOrganisationFilterIds(organisationFilters.talents),
			resumes: normalizeOrganisationFilterIds(organisationFilters.resumes)
		}
	};
};

export const applyUserSettingsViewsPatch = (
	settings: UserSettings,
	patch: UserSettingsViewsPatch
): UserSettings => ({
	views: {
		talents: patch.talents ?? settings.views.talents,
		resumes: patch.resumes ?? settings.views.resumes
	},
	organisationFilters: {
		talents: settings.organisationFilters.talents,
		resumes: settings.organisationFilters.resumes
	}
});

export const applyUserSettingsPatch = (
	settings: UserSettings,
	patch: UserSettingsPatch
): UserSettings => ({
	views: {
		talents: patch.views?.talents ?? settings.views.talents,
		resumes: patch.views?.resumes ?? settings.views.resumes
	},
	organisationFilters: {
		talents:
			patch.organisationFilters?.talents !== undefined
				? normalizeOrganisationFilterIds(patch.organisationFilters.talents)
				: settings.organisationFilters.talents,
		resumes:
			patch.organisationFilters?.resumes !== undefined
				? normalizeOrganisationFilterIds(patch.organisationFilters.resumes)
				: settings.organisationFilters.resumes
	}
});
