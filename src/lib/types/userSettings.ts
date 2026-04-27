export type ViewMode = 'grid' | 'list';

export type UserSettingsViews = {
	billing: ViewMode;
	talents: ViewMode;
	resumes: ViewMode;
	users: ViewMode;
};

export type UserSettingsOrganisationFilters = {
	billing: string[];
	talents: string[];
	resumes: string[];
	users: string[];
};

export type UserSettingsNavigation = {
	sidebarCollapsed: boolean;
};

export type UserSettingsRoleMode = {
	adminEnabled: boolean;
};

export type UserSettings = {
	views: UserSettingsViews;
	organisationFilters: UserSettingsOrganisationFilters;
	navigation: UserSettingsNavigation;
	roleMode: UserSettingsRoleMode;
};

export type UserSettingsViewsPatch = Partial<UserSettingsViews>;
export type UserSettingsOrganisationFiltersPatch = Partial<UserSettingsOrganisationFilters>;
export type UserSettingsNavigationPatch = Partial<UserSettingsNavigation>;
export type UserSettingsRoleModePatch = Partial<UserSettingsRoleMode>;

export type UserSettingsPatch = {
	views?: UserSettingsViewsPatch;
	organisationFilters?: UserSettingsOrganisationFiltersPatch;
	navigation?: UserSettingsNavigationPatch;
	roleMode?: UserSettingsRoleModePatch;
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
	views: {
		billing: 'list',
		talents: 'grid',
		resumes: 'grid',
		users: 'list'
	},
	organisationFilters: {
		billing: [],
		talents: [],
		resumes: [],
		users: []
	},
	navigation: {
		sidebarCollapsed: false
	},
	roleMode: {
		adminEnabled: true
	}
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export const isViewMode = (value: unknown): value is ViewMode =>
	value === 'grid' || value === 'list';

export const cloneUserSettings = (settings: UserSettings): UserSettings => ({
	views: {
		billing: settings.views.billing,
		talents: settings.views.talents,
		resumes: settings.views.resumes,
		users: settings.views.users
	},
	organisationFilters: {
		billing: [...settings.organisationFilters.billing],
		talents: [...settings.organisationFilters.talents],
		resumes: [...settings.organisationFilters.resumes],
		users: [...settings.organisationFilters.users]
	},
	navigation: {
		sidebarCollapsed: settings.navigation.sidebarCollapsed
	},
	roleMode: {
		adminEnabled: settings.roleMode.adminEnabled
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
	const navigation = isRecord(value.navigation) ? value.navigation : {};
	const roleMode = isRecord(value.roleMode) ? value.roleMode : {};

	return {
		views: {
			billing: isViewMode(views.billing) ? views.billing : defaults.views.billing,
			talents: isViewMode(views.talents) ? views.talents : defaults.views.talents,
			resumes: isViewMode(views.resumes) ? views.resumes : defaults.views.resumes,
			users: isViewMode(views.users) ? views.users : defaults.views.users
		},
		organisationFilters: {
			billing: normalizeOrganisationFilterIds(organisationFilters.billing),
			talents: normalizeOrganisationFilterIds(organisationFilters.talents),
			resumes: normalizeOrganisationFilterIds(organisationFilters.resumes),
			users: normalizeOrganisationFilterIds(organisationFilters.users)
		},
		navigation: {
			sidebarCollapsed:
				typeof navigation.sidebarCollapsed === 'boolean'
					? navigation.sidebarCollapsed
					: defaults.navigation.sidebarCollapsed
		},
		roleMode: {
			adminEnabled:
				typeof roleMode.adminEnabled === 'boolean'
					? roleMode.adminEnabled
					: defaults.roleMode.adminEnabled
		}
	};
};

export const applyUserSettingsViewsPatch = (
	settings: UserSettings,
	patch: UserSettingsViewsPatch
): UserSettings => ({
	views: {
		billing: patch.billing ?? settings.views.billing,
		talents: patch.talents ?? settings.views.talents,
		resumes: patch.resumes ?? settings.views.resumes,
		users: patch.users ?? settings.views.users
	},
	organisationFilters: {
		billing: settings.organisationFilters.billing,
		talents: settings.organisationFilters.talents,
		resumes: settings.organisationFilters.resumes,
		users: settings.organisationFilters.users
	},
	navigation: {
		sidebarCollapsed: settings.navigation.sidebarCollapsed
	},
	roleMode: {
		adminEnabled: settings.roleMode.adminEnabled
	}
});

export const applyUserSettingsPatch = (
	settings: UserSettings,
	patch: UserSettingsPatch
): UserSettings => ({
	views: {
		billing: patch.views?.billing ?? settings.views.billing,
		talents: patch.views?.talents ?? settings.views.talents,
		resumes: patch.views?.resumes ?? settings.views.resumes,
		users: patch.views?.users ?? settings.views.users
	},
	organisationFilters: {
		billing:
			patch.organisationFilters?.billing !== undefined
				? normalizeOrganisationFilterIds(patch.organisationFilters.billing)
				: settings.organisationFilters.billing,
		talents:
			patch.organisationFilters?.talents !== undefined
				? normalizeOrganisationFilterIds(patch.organisationFilters.talents)
				: settings.organisationFilters.talents,
		resumes:
			patch.organisationFilters?.resumes !== undefined
				? normalizeOrganisationFilterIds(patch.organisationFilters.resumes)
				: settings.organisationFilters.resumes,
		users:
			patch.organisationFilters?.users !== undefined
				? normalizeOrganisationFilterIds(patch.organisationFilters.users)
				: settings.organisationFilters.users
	},
	navigation: {
		sidebarCollapsed: patch.navigation?.sidebarCollapsed ?? settings.navigation.sidebarCollapsed
	},
	roleMode: {
		adminEnabled: patch.roleMode?.adminEnabled ?? settings.roleMode.adminEnabled
	}
});
