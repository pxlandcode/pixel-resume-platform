export type TechCatalogScopeMode = 'auto' | 'global' | 'organisation';
export type TechCatalogResolvedScopeMode = 'global' | 'organisation';
export type TechCatalogItemScope = 'global' | 'organisation';

export type TechCatalogCategory = {
	id: string;
	name: string;
	sortOrder: number;
	isActive: boolean;
};

export type TechCatalogItem = {
	id: string;
	scope: TechCatalogItemScope;
	organisationId: string | null;
	categoryId: string;
	slug: string;
	label: string;
	normalizedLabel: string;
	aliases: string[];
	sortOrder: number;
	isActive: boolean;
};

export type EffectiveTechCatalogItem = TechCatalogItem & {
	source: TechCatalogItemScope;
};

export type EffectiveTechCatalogCategory = TechCatalogCategory & {
	items: EffectiveTechCatalogItem[];
};

export type TechCatalogCapabilities = {
	canManageGlobal: boolean;
	canManageOrganisation: boolean;
};

export type TechCatalogResolvedScope = {
	requestedMode: TechCatalogScopeMode;
	mode: TechCatalogResolvedScopeMode;
	organisationId: string | null;
	signature: string;
	source: 'admin-global' | 'home-organisation' | 'explicit-organisation' | 'global-fallback';
};

export type EffectiveTechCatalogResponse = {
	scope: TechCatalogResolvedScope;
	capabilities: TechCatalogCapabilities;
	categories: EffectiveTechCatalogCategory[];
	generatedAt: string;
};

export type TechCatalogManagementCategory = TechCatalogCategory;

export type TechCatalogManagementItem = TechCatalogItem & {
	excludedByOrganisation?: boolean;
};

export type TechCatalogManagementPayload = {
	categories: TechCatalogManagementCategory[];
	globalItems: TechCatalogManagementItem[];
	organisationItems: TechCatalogManagementItem[];
};

export type TechCatalogApiResponse = EffectiveTechCatalogResponse & {
	management?: TechCatalogManagementPayload;
};
