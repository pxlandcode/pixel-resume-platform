import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActorAccessContext } from '$lib/server/access';
import { resolveHomeOrganisationId } from '$lib/server/homeOrganisation';
import type {
	EffectiveTechCatalogCategory,
	EffectiveTechCatalogItem,
	EffectiveTechCatalogResponse,
	TechCatalogCategory,
	TechCatalogCapabilities,
	TechCatalogItem,
	TechCatalogManagementPayload,
	TechCatalogResolvedScope,
	TechCatalogScopeMode
} from '$lib/types/techCatalog';

type TechCategoryRow = {
	id: string;
	name: string | null;
	sort_order: number | null;
	is_active: boolean | null;
};

type TechItemRow = {
	id: string;
	scope: string | null;
	organisation_id: string | null;
	category_id: string | null;
	slug: string | null;
	label: string | null;
	normalized_label: string | null;
	aliases: string[] | null;
	sort_order: number | null;
	is_active: boolean | null;
};

type OrgItemOverrideRow = {
	organisation_id: string | null;
	tech_catalog_item_id: string | null;
	sort_order: number | null;
	is_hidden: boolean | null;
};

type MatchableTechItem = {
	id: string;
	slug: string;
	normalizedLabel: string;
	matchKeys: Set<string>;
};

export type TechCatalogMatchState = {
	globalItems: MatchableTechItem[];
	orgItemsByOrganisationId: Map<string, MatchableTechItem[]>;
	excludedGlobalItemIdsByOrganisationId: Map<string, Set<string>>;
};

const CATEGORY_SELECT = 'id, name, sort_order, is_active';
const ITEM_SELECT =
	'id, scope, organisation_id, category_id, slug, label, normalized_label, aliases, sort_order, is_active';
const SPACE_RE = /\s+/g;
const SLUG_RE = /[^a-z0-9]+/g;

const uniqueCaseInsensitive = (values: string[]) => {
	const seen = new Set<string>();
	const out: string[] = [];

	for (const value of values) {
		const trimmed = normalizeTechCatalogText(value);
		if (!trimmed) continue;
		const key = trimmed.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(trimmed);
	}

	return out;
};

const toStringArray = (value: unknown) =>
	Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const categorySort = (left: TechCatalogCategory, right: TechCatalogCategory) => {
	if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
	return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
};

const itemSort = (left: TechCatalogItem, right: TechCatalogItem) => {
	if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
	if (left.scope !== right.scope) return left.scope === 'global' ? -1 : 1;
	return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' });
};

type OrgItemOverride = {
	sortOrder: number | null;
	isHidden: boolean;
};

const isOrganisationManagementItemHidden = (item: TechCatalogItem, override?: OrgItemOverride) =>
	Boolean(override?.isHidden || (item.scope === 'organisation' && !item.isActive));

const mapCategoryRow = (row: TechCategoryRow): TechCatalogCategory => ({
	id: row.id,
	name: (row.name ?? '').trim(),
	sortOrder: row.sort_order ?? 0,
	isActive: Boolean(row.is_active ?? false)
});

const mapItemRow = (row: TechItemRow): TechCatalogItem => ({
	id: row.id,
	scope: row.scope === 'organisation' ? 'organisation' : 'global',
	organisationId: row.organisation_id ?? null,
	categoryId: row.category_id ?? '',
	slug: (row.slug ?? '').trim(),
	label: (row.label ?? '').trim(),
	normalizedLabel: normalizeTechCatalogKey(row.normalized_label ?? row.label ?? ''),
	aliases: uniqueCaseInsensitive(toStringArray(row.aliases)),
	sortOrder: row.sort_order ?? 0,
	isActive: Boolean(row.is_active ?? false)
});

export const normalizeTechCatalogText = (value: string) => value.trim().replace(SPACE_RE, ' ');

export const normalizeTechCatalogKey = (value: string) =>
	normalizeTechCatalogText(value).toLowerCase();

export const slugifyTechCatalogText = (value: string) =>
	normalizeTechCatalogKey(value)
		.replace(SLUG_RE, '-')
		.replace(/^-+|-+$/g, '') || 'item';

export const parseTechCatalogAliasesInput = (value: string) =>
	uniqueCaseInsensitive(
		value
			.split(',')
			.map((entry) => entry.trim())
			.filter(Boolean)
	);

export const serializeTechCatalogAliasesInput = (aliases: string[]) =>
	uniqueCaseInsensitive(aliases).join(', ');

const loadCategories = async (
	adminClient: SupabaseClient,
	includeInactive = false
): Promise<TechCatalogCategory[]> => {
	const query = adminClient.from('tech_categories').select(CATEGORY_SELECT);
	const result = includeInactive
		? await query.order('sort_order', { ascending: true }).order('name', { ascending: true })
		: await query
				.eq('is_active', true)
				.order('sort_order', { ascending: true })
				.order('name', { ascending: true });

	if (result.error) {
		throw new Error(result.error.message);
	}

	return ((result.data ?? []) as TechCategoryRow[]).map(mapCategoryRow).sort(categorySort);
};

const loadItems = async (payload: {
	adminClient: SupabaseClient;
	includeInactive?: boolean;
	scope?: 'global' | 'organisation';
	organisationId?: string | null;
}) => {
	const { adminClient, includeInactive = false, scope, organisationId = null } = payload;
	let query = adminClient.from('tech_catalog_items').select(ITEM_SELECT);

	if (!includeInactive) query = query.eq('is_active', true);
	if (scope) query = query.eq('scope', scope);
	if (scope === 'organisation' && organisationId)
		query = query.eq('organisation_id', organisationId);

	const result = await query.order('sort_order', { ascending: true }).order('label', {
		ascending: true
	});
	if (result.error) {
		throw new Error(result.error.message);
	}

	return ((result.data ?? []) as TechItemRow[]).map(mapItemRow).sort(itemSort);
};

const loadOrgItemOverrides = async (adminClient: SupabaseClient, organisationId: string) => {
	const result = await adminClient
		.from('organisation_tech_catalog_item_overrides')
		.select('tech_catalog_item_id, sort_order, is_hidden')
		.eq('organisation_id', organisationId);

	if (result.error) {
		throw new Error(result.error.message);
	}

	return new Map(
		((result.data ?? []) as OrgItemOverrideRow[])
			.map((row) => {
				if (!row.tech_catalog_item_id) return null;
				return [
					row.tech_catalog_item_id,
					{
						sortOrder: row.sort_order ?? null,
						isHidden: Boolean(row.is_hidden ?? false)
					} satisfies OrgItemOverride
				] as const;
			})
			.filter((entry): entry is readonly [string, OrgItemOverride] => entry !== null)
	);
};

const loadOrgItemOverrideRows = async (adminClient: SupabaseClient) => {
	const result = await adminClient
		.from('organisation_tech_catalog_item_overrides')
		.select('organisation_id, tech_catalog_item_id, sort_order, is_hidden');

	if (result.error) {
		throw new Error(result.error.message);
	}

	return (result.data ?? []) as OrgItemOverrideRow[];
};

const resolveEffectiveSortOrder = (
	item: Pick<TechCatalogItem, 'sortOrder'>,
	override?: OrgItemOverride
) => override?.sortOrder ?? item.sortOrder;

const buildEffectiveOrganisationItems = (payload: {
	globalItems: TechCatalogItem[];
	organisationItems: TechCatalogItem[];
	overridesByItemId: Map<string, OrgItemOverride>;
}): EffectiveTechCatalogItem[] => {
	const items: EffectiveTechCatalogItem[] = [];

	for (const item of payload.globalItems) {
		const override = payload.overridesByItemId.get(item.id);
		if (override?.isHidden) continue;
		items.push({
			...item,
			sortOrder: resolveEffectiveSortOrder(item, override),
			source: 'global'
		});
	}

	for (const item of payload.organisationItems) {
		const override = payload.overridesByItemId.get(item.id);
		if (override?.isHidden) continue;
		items.push({
			...item,
			sortOrder: resolveEffectiveSortOrder(item, override),
			source: 'organisation'
		});
	}

	return items.sort(itemSort);
};

const buildOrganisationManagementItems = (payload: {
	globalItems: TechCatalogItem[];
	organisationItems: TechCatalogItem[];
	overridesByItemId: Map<string, OrgItemOverride>;
}): TechCatalogManagementPayload['organisationItems'] => {
	const items = payload.globalItems.map((item) => {
		const override = payload.overridesByItemId.get(item.id);
		return {
			...item,
			sortOrder: resolveEffectiveSortOrder(item, override),
			excludedByOrganisation: isOrganisationManagementItemHidden(item, override)
		};
	});

	for (const item of payload.organisationItems) {
		const override = payload.overridesByItemId.get(item.id);
		items.push({
			...item,
			sortOrder: resolveEffectiveSortOrder(item, override),
			excludedByOrganisation: isOrganisationManagementItemHidden(item, override)
		});
	}

	return items.sort(itemSort);
};

export const canManageGlobalTechCatalog = (actor: ActorAccessContext) => actor.isAdmin;

export const canManageOrganisationTechCatalog = (
	actor: ActorAccessContext,
	resolvedHomeOrganisationId: string | null,
	organisationId: string | null
) => {
	if (!organisationId) return false;
	if (actor.isAdmin) return true;
	return Boolean(
		resolvedHomeOrganisationId &&
			organisationId === resolvedHomeOrganisationId &&
			(actor.isBroker || actor.isEmployer)
	);
};

export const canReadOrganisationTechCatalog = (
	actor: ActorAccessContext,
	resolvedHomeOrganisationId: string | null,
	organisationId: string | null
) => {
	if (!organisationId) return false;
	if (actor.isAdmin) return true;
	if (resolvedHomeOrganisationId && organisationId === resolvedHomeOrganisationId) return true;
	return actor.accessibleOrganisationIds.includes(organisationId);
};

export const resolveTechCatalogScope = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
	requestedMode: TechCatalogScopeMode;
	requestedOrganisationId?: string | null;
}): Promise<TechCatalogResolvedScope> => {
	const resolvedHomeOrganisationId = await resolveHomeOrganisationId({
		adminClient: payload.adminClient,
		homeOrganisationId: payload.actor.homeOrganisationId,
		talentId: payload.actor.talentId
	});

	const requestedOrganisationId = payload.requestedOrganisationId?.trim() || null;

	if (payload.requestedMode === 'organisation' && requestedOrganisationId) {
		if (
			!canReadOrganisationTechCatalog(
				payload.actor,
				resolvedHomeOrganisationId,
				requestedOrganisationId
			)
		) {
			throw new Error('Requested organisation catalog scope is not allowed.');
		}

		return {
			requestedMode: payload.requestedMode,
			mode: 'organisation',
			organisationId: requestedOrganisationId,
			signature: `org:${requestedOrganisationId}`,
			source: 'explicit-organisation'
		};
	}

	if (payload.requestedMode === 'global') {
		return {
			requestedMode: payload.requestedMode,
			mode: 'global',
			organisationId: null,
			signature: 'global',
			source: payload.actor.isAdmin ? 'admin-global' : 'global-fallback'
		};
	}

	if (!payload.actor.isAdmin && resolvedHomeOrganisationId) {
		return {
			requestedMode: payload.requestedMode,
			mode: 'organisation',
			organisationId: resolvedHomeOrganisationId,
			signature: `org:${resolvedHomeOrganisationId}`,
			source: 'home-organisation'
		};
	}

	return {
		requestedMode: payload.requestedMode,
		mode: 'global',
		organisationId: null,
		signature: 'global',
		source: payload.actor.isAdmin ? 'admin-global' : 'global-fallback'
	};
};

const buildCapabilities = (
	actor: ActorAccessContext,
	resolvedHomeOrganisationId: string | null,
	scope: TechCatalogResolvedScope
): TechCatalogCapabilities => ({
	canManageGlobal: canManageGlobalTechCatalog(actor),
	canManageOrganisation:
		scope.mode === 'organisation'
			? canManageOrganisationTechCatalog(actor, resolvedHomeOrganisationId, scope.organisationId)
			: actor.isAdmin || Boolean(resolvedHomeOrganisationId && (actor.isBroker || actor.isEmployer))
});

export const loadEffectiveTechCatalog = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
	requestedMode?: TechCatalogScopeMode;
	requestedOrganisationId?: string | null;
}): Promise<EffectiveTechCatalogResponse> => {
	const requestedMode = payload.requestedMode ?? 'auto';
	const resolvedHomeOrganisationId = await resolveHomeOrganisationId({
		adminClient: payload.adminClient,
		homeOrganisationId: payload.actor.homeOrganisationId,
		talentId: payload.actor.talentId
	});
	const scope = await resolveTechCatalogScope({
		adminClient: payload.adminClient,
		actor: payload.actor,
		requestedMode,
		requestedOrganisationId: payload.requestedOrganisationId
	});
	const [categories, globalItems, orgItems, overridesByItemId] = await Promise.all([
		loadCategories(payload.adminClient, false),
		loadItems({ adminClient: payload.adminClient, scope: 'global', includeInactive: false }),
		scope.mode === 'organisation' && scope.organisationId
			? loadItems({
					adminClient: payload.adminClient,
					scope: 'organisation',
					organisationId: scope.organisationId,
					includeInactive: false
				})
			: Promise.resolve([] as TechCatalogItem[]),
		scope.mode === 'organisation' && scope.organisationId
			? loadOrgItemOverrides(payload.adminClient, scope.organisationId)
			: Promise.resolve(new Map<string, OrgItemOverride>())
	]);

	const effectiveItems =
		scope.mode === 'organisation'
			? buildEffectiveOrganisationItems({
					globalItems,
					organisationItems: orgItems,
					overridesByItemId
				})
			: globalItems.map((item) => ({ ...item, source: 'global' as const })).sort(itemSort);

	const itemsByCategoryId = new Map<string, EffectiveTechCatalogItem[]>();
	for (const item of effectiveItems) {
		const categoryItems = itemsByCategoryId.get(item.categoryId) ?? [];
		categoryItems.push(item);
		itemsByCategoryId.set(item.categoryId, categoryItems);
	}

	const effectiveCategories: EffectiveTechCatalogCategory[] = categories
		.sort(categorySort)
		.map((category) => ({
			...category,
			items: itemsByCategoryId.get(category.id) ?? []
		}));

	return {
		scope,
		capabilities: buildCapabilities(payload.actor, resolvedHomeOrganisationId, scope),
		categories: effectiveCategories,
		generatedAt: new Date().toISOString()
	};
};

export const loadTechCatalogManagementPayload = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
	organisationId?: string | null;
}): Promise<TechCatalogManagementPayload> => {
	const resolvedHomeOrganisationId = await resolveHomeOrganisationId({
		adminClient: payload.adminClient,
		homeOrganisationId: payload.actor.homeOrganisationId,
		talentId: payload.actor.talentId
	});
	const organisationId = payload.organisationId?.trim() || null;

	if (!payload.actor.isAdmin && organisationId === null) {
		throw new Error('Only admins can read the global tech catalog management view.');
	}
	if (
		organisationId &&
		!canManageOrganisationTechCatalog(payload.actor, resolvedHomeOrganisationId, organisationId)
	) {
		throw new Error('You are not allowed to manage that organisation catalog.');
	}

	const [categories, globalItems, organisationItems, overridesByItemId] = await Promise.all([
		loadCategories(payload.adminClient, true),
		loadItems({ adminClient: payload.adminClient, scope: 'global', includeInactive: true }),
		organisationId
			? loadItems({
					adminClient: payload.adminClient,
					scope: 'organisation',
					organisationId,
					includeInactive: true
				})
			: Promise.resolve([] as TechCatalogItem[]),
		organisationId
			? loadOrgItemOverrides(payload.adminClient, organisationId)
			: Promise.resolve(new Map<string, OrgItemOverride>())
	]);

	return {
		categories,
		globalItems,
		organisationItems: organisationId
			? buildOrganisationManagementItems({
					globalItems,
					organisationItems,
					overridesByItemId
				})
			: []
	};
};

export const resolveUniqueTechCategoryId = async (payload: {
	adminClient: SupabaseClient;
	name: string;
	existingId?: string | null;
}) => {
	const baseId = slugifyTechCatalogText(payload.name);
	let candidate = baseId;
	let suffix = 2;

	while (candidate !== payload.existingId) {
		const result = await payload.adminClient
			.from('tech_categories')
			.select('id')
			.eq('id', candidate)
			.maybeSingle();

		if (result.error) throw new Error(result.error.message);
		if (!result.data?.id) return candidate;
		candidate = `${baseId}-${suffix}`;
		suffix += 1;
	}

	return candidate;
};

export const resolveUniqueTechCatalogSlug = async (payload: {
	adminClient: SupabaseClient;
	label: string;
	scope: TechCatalogItem['scope'];
	organisationId?: string | null;
	existingId?: string | null;
}) => {
	const baseSlug = slugifyTechCatalogText(payload.label);
	let candidate = baseSlug;
	let suffix = 2;

	while (true) {
		let query = payload.adminClient
			.from('tech_catalog_items')
			.select('id')
			.eq('scope', payload.scope)
			.eq('slug', candidate);

		if (payload.scope === 'organisation') {
			query = query.eq('organisation_id', payload.organisationId ?? '');
		}

		const result = await query.maybeSingle();
		if (result.error) throw new Error(result.error.message);
		if (!result.data?.id || result.data.id === payload.existingId) return candidate;
		candidate = `${baseSlug}-${suffix}`;
		suffix += 1;
	}
};

const toMatchableItem = (item: TechCatalogItem): MatchableTechItem => ({
	id: item.id,
	slug: item.slug,
	normalizedLabel: item.normalizedLabel,
	matchKeys: new Set(
		[item.normalizedLabel, ...item.aliases.map(normalizeTechCatalogKey)].filter(Boolean)
	)
});

export const loadTechCatalogMatchState = async (
	adminClient: SupabaseClient
): Promise<TechCatalogMatchState> => {
	const [items, overrides] = await Promise.all([
		loadItems({ adminClient, includeInactive: false }),
		loadOrgItemOverrideRows(adminClient)
	]);

	const hiddenItemIdsByOrganisationId = new Map<string, Set<string>>();
	for (const row of overrides) {
		const organisationId = row.organisation_id ?? null;
		const itemId = row.tech_catalog_item_id ?? null;
		if (!organisationId || !itemId || !row.is_hidden) continue;
		const set = hiddenItemIdsByOrganisationId.get(organisationId) ?? new Set<string>();
		set.add(itemId);
		hiddenItemIdsByOrganisationId.set(organisationId, set);
	}

	const globalItems: MatchableTechItem[] = [];
	const orgItemsByOrganisationId = new Map<string, MatchableTechItem[]>();

	for (const item of items) {
		const matchable = toMatchableItem(item);
		if (item.scope === 'global') {
			globalItems.push(matchable);
			continue;
		}
		if (!item.organisationId) continue;
		if (hiddenItemIdsByOrganisationId.get(item.organisationId)?.has(item.id)) continue;
		const orgItems = orgItemsByOrganisationId.get(item.organisationId) ?? [];
		orgItems.push(matchable);
		orgItemsByOrganisationId.set(item.organisationId, orgItems);
	}

	const globalItemIds = new Set(globalItems.map((item) => item.id));
	const excludedGlobalItemIdsByOrganisationId = new Map<string, Set<string>>();
	for (const [organisationId, hiddenItemIds] of hiddenItemIdsByOrganisationId.entries()) {
		const hiddenGlobalItemIds = Array.from(hiddenItemIds).filter((itemId) =>
			globalItemIds.has(itemId)
		);
		if (hiddenGlobalItemIds.length === 0) continue;
		excludedGlobalItemIdsByOrganisationId.set(organisationId, new Set(hiddenGlobalItemIds));
	}

	return {
		globalItems,
		orgItemsByOrganisationId,
		excludedGlobalItemIdsByOrganisationId
	};
};

export const resolveTechCatalogMatchKeys = (
	matchState: TechCatalogMatchState,
	rawLabel: string,
	organisationId: string | null
) => {
	const rawKey = normalizeTechCatalogKey(rawLabel);
	if (!rawKey) return [] as string[];

	const result = new Set<string>([rawKey]);
	const excludedIds =
		(organisationId
			? matchState.excludedGlobalItemIdsByOrganisationId.get(organisationId)
			: undefined) ?? new Set<string>();

	const orgItems =
		(organisationId ? matchState.orgItemsByOrganisationId.get(organisationId) : undefined) ?? [];
	for (const item of orgItems) {
		if (!item.matchKeys.has(rawKey)) continue;
		result.add(item.normalizedLabel);
		result.add(item.slug);
		return Array.from(result);
	}

	for (const item of matchState.globalItems) {
		if (excludedIds.has(item.id) || !item.matchKeys.has(rawKey)) continue;
		result.add(item.normalizedLabel);
		result.add(item.slug);
		return Array.from(result);
	}

	return Array.from(result);
};
