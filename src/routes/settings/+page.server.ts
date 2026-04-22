import { error, fail, type Actions } from '@sveltejs/kit';
import type { AppRole, ShareAccessLevel } from '$lib/server/access';
import type { PageServerLoad } from './$types';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import { getActorAccessContext } from '$lib/server/access';
import { writeAuditLog } from '$lib/server/legalService';
import { assertAcceptedForSensitiveAction } from '$lib/server/legalGate';
import { invalidateOrganisationContextCache } from '$lib/server/organisationContextCache';
import {
	extendResumeShareLink,
	listVisibleResumeShareLinks,
	parseResumeShareUpdateForm,
	regenerateResumeShareLink,
	revokeResumeShareLink,
	ResumeShareAccessError,
	updateResumeShareLink
} from '$lib/server/resumeShares';
import {
	canManageGlobalTechCatalog,
	canManageOrganisationTechCatalog,
	normalizeTechCatalogKey,
	parseTechCatalogAliasesInput,
	resolveUniqueTechCatalogSlug,
	resolveUniqueTechCategoryId
} from '$lib/server/techCatalog';
import {
	loadOrganisationEmailDomains,
	OrganisationEmailDomainError
} from '$lib/server/organisationEmailDomains';
import {
	ensureOrgManagerContext,
	handleUpdateOrganisation,
	handleUpdateOrganisationBranding,
	handleUpdateOrganisationTemplate,
	handleConnectUserHome,
	handleDisconnectUserHome,
	handleConnectTalentHome,
	handleDisconnectTalentHome
} from '$lib/server/organisationActions';
import {
	createTalentLabelDefinition,
	deleteTalentLabelDefinition,
	TalentLabelServiceError,
	updateTalentLabelDefinition
} from '$lib/server/talentLabels';
import {
	createBillingAddonVersion,
	createBillingPlanVersion,
	loadBillingAddonVersions,
	loadBillingPlanVersions,
	setBillingAddonVersionActiveState,
	setBillingPlanVersionActiveState
} from '$lib/server/billing';
import type { BillingMetricKey, BillingPlanFamily } from '$lib/types/billing';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORGANISATION_ACCESS_LEVELS = new Set<ShareAccessLevel>(['read', 'write']);
const TALENT_ACCESS_LEVELS = new Set<ShareAccessLevel>(['none', 'read', 'write']);

type OrganisationOption = {
	id: string;
	name: string;
};

type SourceTalentOption = {
	id: string;
	organisation_id: string;
	first_name: string;
	last_name: string;
};

type OrganisationShareRule = {
	id: string;
	source_organisation_id: string;
	target_organisation_id: string;
	access_level: ShareAccessLevel;
	allow_target_logo_export: boolean;
};

type TalentShareRule = OrganisationShareRule & {
	talent_id: string;
};

const resolveEffectiveRoles = (roles: AppRole[]): AppRole[] =>
	roles.length > 0 ? roles : ['talent'];

const canManageSharing = (roles: AppRole[]) =>
	roles.includes('admin') || roles.includes('broker') || roles.includes('employer');

const parseString = (value: FormDataEntryValue | null) =>
	typeof value === 'string' ? value.trim() : '';

const parseBoolean = (value: FormDataEntryValue | null) => {
	if (typeof value !== 'string') return false;
	const normalized = value.trim().toLowerCase();
	return normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes';
};

const unique = (values: string[]) =>
	Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));

const normalizeOptionalUuid = (value: FormDataEntryValue | null) => {
	if (typeof value !== 'string') return null;
	const normalized = value.trim();
	if (!normalized) return null;
	return UUID_REGEX.test(normalized) ? normalized : '__invalid__';
};

const normalizeShareAccessLevel = (value: FormDataEntryValue | null) => {
	if (typeof value !== 'string') return 'none';
	const normalized = value.trim().toLowerCase();
	return normalized === 'read' || normalized === 'write' || normalized === 'none'
		? (normalized as ShareAccessLevel)
		: 'none';
};

const loadSharingData = async (payload: {
	adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>;
	effectiveRoles: AppRole[];
	homeOrganisationId: string | null;
}) => {
	if (!canManageSharing(payload.effectiveRoles)) {
		return {
			sourceOrganisationOptions: [] as OrganisationOption[],
			allOrganisations: [] as OrganisationOption[],
			defaultSourceOrganisationId: null as string | null,
			sourceTalentOptions: [] as SourceTalentOption[],
			organisationShareRules: [] as OrganisationShareRule[],
			talentShareRules: [] as TalentShareRule[]
		};
	}

	const organisationsResult = await payload.adminClient
		.from('organisations')
		.select('id, name')
		.order('name', { ascending: true });

	if (organisationsResult.error) {
		throw error(500, organisationsResult.error.message);
	}

	const allOrganisations = (
		(organisationsResult.data ?? []) as Array<{
			id?: string | null;
			name?: string | null;
		}>
	)
		.filter(
			(organisation): organisation is { id: string; name: string } =>
				typeof organisation.id === 'string' &&
				organisation.id.length > 0 &&
				typeof organisation.name === 'string' &&
				organisation.name.length > 0
		)
		.map((organisation) => ({
			id: organisation.id,
			name: organisation.name
		}));

	const manageableSourceOrganisationIds = payload.effectiveRoles.includes('admin')
		? allOrganisations.map((organisation) => organisation.id)
		: payload.homeOrganisationId
			? [payload.homeOrganisationId]
			: [];

	const sourceOrganisationOptions = allOrganisations.filter((organisation) =>
		manageableSourceOrganisationIds.includes(organisation.id)
	);

	const defaultSourceOrganisationId =
		(payload.homeOrganisationId &&
		sourceOrganisationOptions.some((organisation) => organisation.id === payload.homeOrganisationId)
			? payload.homeOrganisationId
			: sourceOrganisationOptions[0]?.id) ?? null;

	if (manageableSourceOrganisationIds.length === 0) {
		return {
			sourceOrganisationOptions,
			allOrganisations,
			defaultSourceOrganisationId,
			sourceTalentOptions: [] as SourceTalentOption[],
			organisationShareRules: [] as OrganisationShareRule[],
			talentShareRules: [] as TalentShareRule[]
		};
	}

	const [organisationShareRulesResult, talentShareRulesResult, organisationTalentRowsResult] =
		await Promise.all([
			payload.adminClient
				.from('organisation_share_rules')
				.select(
					'id, source_organisation_id, target_organisation_id, access_level, allow_target_logo_export'
				)
				.in('source_organisation_id', manageableSourceOrganisationIds),
			payload.adminClient
				.from('talent_share_rules')
				.select(
					'id, source_organisation_id, target_organisation_id, talent_id, access_level, allow_target_logo_export'
				)
				.in('source_organisation_id', manageableSourceOrganisationIds),
			payload.adminClient
				.from('organisation_talents')
				.select('organisation_id, talent_id')
				.in('organisation_id', manageableSourceOrganisationIds)
		]);

	if (organisationShareRulesResult.error) {
		throw error(500, organisationShareRulesResult.error.message);
	}
	if (talentShareRulesResult.error) {
		throw error(500, talentShareRulesResult.error.message);
	}
	if (organisationTalentRowsResult.error) {
		throw error(500, organisationTalentRowsResult.error.message);
	}

	const organisationShareRules = (
		(organisationShareRulesResult.data ?? []) as Array<{
			id?: string | null;
			source_organisation_id?: string | null;
			target_organisation_id?: string | null;
			access_level?: string | null;
			allow_target_logo_export?: boolean | null;
		}>
	)
		.filter(
			(
				rule
			): rule is {
				id: string;
				source_organisation_id: string;
				target_organisation_id: string;
				access_level: ShareAccessLevel;
				allow_target_logo_export?: boolean | null;
			} =>
				typeof rule.id === 'string' &&
				typeof rule.source_organisation_id === 'string' &&
				typeof rule.target_organisation_id === 'string' &&
				(rule.access_level === 'read' || rule.access_level === 'write')
		)
		.map((rule) => ({
			id: rule.id,
			source_organisation_id: rule.source_organisation_id,
			target_organisation_id: rule.target_organisation_id,
			access_level: rule.access_level,
			allow_target_logo_export: Boolean(rule.allow_target_logo_export ?? false)
		}));

	const rawTalentShareRules = (
		(talentShareRulesResult.data ?? []) as Array<{
			id?: string | null;
			source_organisation_id?: string | null;
			target_organisation_id?: string | null;
			talent_id?: string | null;
			access_level?: string | null;
			allow_target_logo_export?: boolean | null;
		}>
	).filter(
		(
			rule
		): rule is {
			id: string;
			source_organisation_id: string;
			target_organisation_id: string;
			talent_id: string;
			access_level: ShareAccessLevel;
			allow_target_logo_export?: boolean | null;
		} =>
			typeof rule.id === 'string' &&
			typeof rule.source_organisation_id === 'string' &&
			typeof rule.target_organisation_id === 'string' &&
			typeof rule.talent_id === 'string' &&
			(rule.access_level === 'none' ||
				rule.access_level === 'read' ||
				rule.access_level === 'write')
	);

	const organisationTalentRows = (
		(organisationTalentRowsResult.data ?? []) as Array<{
			organisation_id?: string | null;
			talent_id?: string | null;
		}>
	)
		.map((row) => ({
			organisationId: typeof row.organisation_id === 'string' ? row.organisation_id : null,
			talentId: typeof row.talent_id === 'string' ? row.talent_id : null
		}))
		.filter(
			(row): row is { organisationId: string; talentId: string } =>
				row.organisationId !== null && row.talentId !== null
		);

	const talentIds = unique(organisationTalentRows.map((row) => row.talentId));
	const talentsResult =
		talentIds.length === 0
			? {
					data: [] as Array<{
						id: string;
						first_name: string | null;
						last_name: string | null;
					}>,
					error: null
				}
			: await payload.adminClient
					.from('talents')
					.select('id, first_name, last_name')
					.in('id', talentIds)
					.order('last_name', { ascending: true })
					.order('first_name', { ascending: true });

	if (talentsResult.error) {
		throw error(500, talentsResult.error.message);
	}

	const talentNameById = new Map(
		(
			(talentsResult.data ?? []) as Array<{
				id?: string | null;
				first_name?: string | null;
				last_name?: string | null;
			}>
		)
			.filter(
				(talent): talent is { id: string; first_name?: string | null; last_name?: string | null } =>
					typeof talent.id === 'string'
			)
			.map(
				(talent) =>
					[
						talent.id,
						{
							first_name: talent.first_name ?? '',
							last_name: talent.last_name ?? ''
						}
					] as const
			)
	);

	const sourceTalentOptions = organisationTalentRows
		.map((row) => {
			const talent = talentNameById.get(row.talentId);
			if (!talent) return null;
			return {
				id: row.talentId,
				organisation_id: row.organisationId,
				first_name: talent.first_name,
				last_name: talent.last_name
			} satisfies SourceTalentOption;
		})
		.filter((talent): talent is SourceTalentOption => talent !== null)
		.sort((left, right) => {
			const leftName = `${left.last_name} ${left.first_name}`.trim().toLowerCase();
			const rightName = `${right.last_name} ${right.first_name}`.trim().toLowerCase();
			return leftName.localeCompare(rightName);
		});

	const validTalentIds = new Set(sourceTalentOptions.map((talent) => talent.id));
	const talentShareRules = rawTalentShareRules
		.filter((rule) => validTalentIds.has(rule.talent_id))
		.map((rule) => ({
			id: rule.id,
			source_organisation_id: rule.source_organisation_id,
			target_organisation_id: rule.target_organisation_id,
			talent_id: rule.talent_id,
			access_level: rule.access_level,
			allow_target_logo_export: Boolean(rule.allow_target_logo_export ?? false)
		}));

	return {
		sourceOrganisationOptions,
		allOrganisations,
		defaultSourceOrganisationId,
		sourceTalentOptions,
		organisationShareRules,
		talentShareRules
	};
};

const loadManagedOrganisation = async (payload: {
	adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>;
	canManageOrganisation: boolean;
	homeOrganisationId: string | null;
}) => {
	if (!payload.canManageOrganisation || !payload.homeOrganisationId) {
		return null;
	}

	const { data: organisation, error: organisationError } = await payload.adminClient
		.from('organisations')
		.select('id, name, slug, homepage_url, brand_settings, created_at, updated_at')
		.eq('id', payload.homeOrganisationId)
		.maybeSingle();

	if (organisationError) {
		throw error(500, organisationError.message);
	}
	if (!organisation) {
		throw error(404, 'Organisation not found.');
	}

	try {
		const emailDomainsByOrganisationId = await loadOrganisationEmailDomains(payload.adminClient, [
			payload.homeOrganisationId
		]);

		return {
			...organisation,
			email_domains: emailDomainsByOrganisationId.get(payload.homeOrganisationId) ?? []
		};
	} catch (domainError) {
		throw error(
			domainError instanceof OrganisationEmailDomainError ? domainError.status : 500,
			domainError instanceof OrganisationEmailDomainError
				? domainError.message
				: 'Could not load email domains.'
		);
	}
};

const getActionContext = async (cookies: { get(name: string): string | undefined }) => {
	const supabase = createSupabaseServerClient(cookies.get(AUTH_COOKIE_NAMES.access) ?? null);
	const adminClient = getSupabaseAdminClient();
	if (!supabase || !adminClient) {
		return {
			ok: false as const,
			status: 401,
			message: 'You are not authenticated.'
		};
	}

	const { data: authData, error: authError } = await supabase.auth.getUser();
	if (authError || !authData.user) {
		return {
			ok: false as const,
			status: 401,
			message: 'You are not authenticated.'
		};
	}

	const actor = await getActorAccessContext(supabase, adminClient, { authUser: authData.user });
	const effectiveRoles = resolveEffectiveRoles(actor.roles);

	return {
		ok: true as const,
		supabase,
		adminClient,
		actor: { ...actor, userId: authData.user.id },
		effectiveRoles
	};
};

const ensureSharingActionContext = async (cookies: { get(name: string): string | undefined }) => {
	const context = await getActionContext(cookies);
	if (!context.ok) return context;
	if (!canManageSharing(context.effectiveRoles)) {
		return {
			ok: false as const,
			status: 403,
			message: 'You are not authorized to manage sharing settings.'
		};
	}
	return context;
};

const ensureOrgManager = async (
	cookies: { get(name: string): string | undefined },
	formData: FormData
) => {
	const orgId = formData.get('organisation_id');
	const targetOrgId = typeof orgId === 'string' ? orgId : undefined;
	return ensureOrgManagerContext(cookies, targetOrgId);
};

const isRecordWithStatus = (value: unknown): value is { status?: unknown } =>
	typeof value === 'object' && value !== null;

const ensureLegalAcceptance = async (
	context: Extract<Awaited<ReturnType<typeof ensureOrgManager>>, { ok: true }>
) => {
	try {
		await assertAcceptedForSensitiveAction({
			adminClient: context.adminClient,
			userId: context.actor.userId,
			homeOrganisationId: context.actor.homeOrganisationId
		});
		return null;
	} catch (legalError) {
		const status =
			isRecordWithStatus(legalError) && typeof legalError.status === 'number'
				? legalError.status
				: 403;
		const message =
			legalError instanceof Error
				? legalError.message
				: 'You must accept the latest legal documents before continuing.';
		return { status, message };
	}
};

const failTalentLabelAction = (payload: {
	status: number;
	type: 'createTalentLabelDefinition' | 'updateTalentLabelDefinition' | 'deleteTalentLabelDefinition';
	message: string;
}) =>
	fail(payload.status, {
		type: payload.type,
		ok: false,
		message: payload.message
	});

const ensureAllowedSourceOrganisation = (
	context: Awaited<ReturnType<typeof ensureSharingActionContext>>,
	sourceOrganisationId: string
) => {
	if (!context.ok) return false;
	if (context.effectiveRoles.includes('admin')) return true;
	return Boolean(
		context.actor.homeOrganisationId &&
			context.actor.homeOrganisationId === sourceOrganisationId &&
			(context.effectiveRoles.includes('broker') || context.effectiveRoles.includes('employer'))
	);
};

const ensureOrganisationExists = async (
	adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
	organisationId: string
) => {
	const { data, error: lookupError } = await adminClient
		.from('organisations')
		.select('id')
		.eq('id', organisationId)
		.maybeSingle();
	if (lookupError) throw new Error(lookupError.message);
	return Boolean(data?.id);
};

const ensureTalentBelongsToSourceOrganisation = async (
	adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
	talentId: string,
	sourceOrganisationId: string
) => {
	const { data, error: lookupError } = await adminClient
		.from('organisation_talents')
		.select('organisation_id')
		.eq('talent_id', talentId)
		.order('updated_at', { ascending: false })
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();
	if (lookupError) throw new Error(lookupError.message);
	return data?.organisation_id === sourceOrganisationId;
};

const canManageOrganisationTechCatalogForContext = (
	context: Awaited<ReturnType<typeof getActionContext>>,
	organisationId: string
) => {
	if (!context.ok) return false;
	return canManageOrganisationTechCatalog(
		context.actor,
		context.actor.homeOrganisationId,
		organisationId
	);
};

const parseInteger = (value: FormDataEntryValue | null, fallback = 0) => {
	if (typeof value !== 'string') return fallback;
	const parsed = Number.parseInt(value.trim(), 10);
	return Number.isFinite(parsed) ? parsed : fallback;
};

const parseOptionalInteger = (value: FormDataEntryValue | null) => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	const parsed = Number.parseInt(trimmed, 10);
	return Number.isFinite(parsed) ? parsed : null;
};

const parseRequiredString = (formData: FormData, key: string) => {
	const value = formData.get(key);
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`Missing ${key.replace(/_/g, ' ')}.`);
	}
	return value.trim();
};

const parseOptionalString = (formData: FormData, key: string) => {
	const value = formData.get(key);
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
};

const parseMoneyOre = (value: string | null) => {
	if (!value) return 0;
	const normalized = value.replace(',', '.').trim();
	const parsed = Number(normalized);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error('Price must be a positive number.');
	}
	return Math.round(parsed * 100);
};

const parseBillingOptionalInteger = (value: string | null) => {
	if (!value) return null;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error('Value must be a whole number or empty.');
	}
	return parsed;
};

const parseBillingSortOrder = (value: string | null) => {
	if (!value) return 100;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed)) return 100;
	return parsed;
};

const parseFeatureList = (value: string | null) =>
	(value ?? '')
		.split('\n')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);

const toSortOrderValue = (index: number) => (index + 1) * 10;

const ensureAdminBillingActionContext = async (cookies: {
	get(name: string): string | undefined;
}) => {
	const context = await getActionContext(cookies);
	if (!context.ok) return context;
	if (!context.effectiveRoles.includes('admin')) {
		return {
			ok: false as const,
			status: 403,
			message: 'You are not authorized to manage billing catalog.'
		};
	}
	return context;
};

const resolveNextTechCategorySortOrder = async (
	adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>
) => {
	const { data, error: lookupError } = await adminClient
		.from('tech_categories')
		.select('sort_order')
		.order('sort_order', { ascending: false })
		.limit(1)
		.maybeSingle();
	if (lookupError) throw new Error(lookupError.message);
	return Math.max(data?.sort_order ?? 0, 0) + 10;
};

const resolveNextTechCatalogItemSortOrder = async ({
	adminClient,
	scope,
	categoryId,
	organisationId
}: {
	adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>;
	scope: 'global' | 'organisation';
	categoryId: string;
	organisationId?: string | null;
}) => {
	let query = adminClient
		.from('tech_catalog_items')
		.select('sort_order')
		.eq('scope', scope)
		.eq('category_id', categoryId)
		.order('sort_order', { ascending: false })
		.limit(1);

	if (scope === 'global') {
		query = query.is('organisation_id', null);
	} else {
		query = query.eq('organisation_id', organisationId ?? '');
	}

	const { data, error: lookupError } = await query.maybeSingle();
	if (lookupError) throw new Error(lookupError.message);
	return Math.max(data?.sort_order ?? 0, 0) + 10;
};

const resolveNextOrganisationTechCatalogSortOrder = async ({
	adminClient,
	organisationId,
	categoryId
}: {
	adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>;
	organisationId: string;
	categoryId: string;
}) => {
	const [globalItemsResult, organisationItemsResult] = await Promise.all([
		adminClient
			.from('tech_catalog_items')
			.select('id, sort_order')
			.eq('scope', 'global')
			.is('organisation_id', null)
			.eq('category_id', categoryId),
		adminClient
			.from('tech_catalog_items')
			.select('id, sort_order')
			.eq('scope', 'organisation')
			.eq('organisation_id', organisationId)
			.eq('category_id', categoryId)
	]);

	if (globalItemsResult.error) throw new Error(globalItemsResult.error.message);
	if (organisationItemsResult.error) throw new Error(organisationItemsResult.error.message);

	const itemIds = [
		...(globalItemsResult.data ?? []).map((item) => item.id),
		...(organisationItemsResult.data ?? []).map((item) => item.id)
	];

	const overridesResult =
		itemIds.length > 0
			? await adminClient
					.from('organisation_tech_catalog_item_overrides')
					.select('tech_catalog_item_id, sort_order')
					.eq('organisation_id', organisationId)
					.in('tech_catalog_item_id', itemIds)
			: { data: [], error: null };

	if (overridesResult.error) throw new Error(overridesResult.error.message);

	const overrideSortOrderByItemId = new Map(
		(overridesResult.data ?? [])
			.map((row) =>
				row.tech_catalog_item_id ? [row.tech_catalog_item_id, row.sort_order ?? null] : null
			)
			.filter((entry): entry is [string, number | null] => entry !== null)
	);

	const items = [...(globalItemsResult.data ?? []), ...(organisationItemsResult.data ?? [])];
	const maxSortOrder = items.reduce((currentMax, item) => {
		const effectiveSortOrder = overrideSortOrderByItemId.get(item.id) ?? item.sort_order ?? 0;
		return Math.max(currentMax, effectiveSortOrder);
	}, 0);

	return maxSortOrder + 10;
};

const parseStringArrayField = (value: FormDataEntryValue | null) => {
	if (typeof value !== 'string') return [] as string[];
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean);
	} catch {
		return [];
	}
};

const applyTechCategorySortOrder = async ({
	adminClient,
	categoryIds
}: {
	adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>;
	categoryIds: string[];
}) => {
	for (const [index, categoryId] of categoryIds.entries()) {
		const { error: updateError } = await adminClient
			.from('tech_categories')
			.update({
				sort_order: toSortOrderValue(index),
				updated_at: new Date().toISOString()
			})
			.eq('id', categoryId);
		if (updateError) throw new Error(updateError.message);
	}
};

const applyTechCatalogItemSortOrder = async ({
	adminClient,
	itemIds,
	scope,
	categoryId,
	organisationId
}: {
	adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>;
	itemIds: string[];
	scope: 'global' | 'organisation';
	categoryId: string;
	organisationId?: string | null;
}) => {
	for (const [index, itemId] of itemIds.entries()) {
		let query = adminClient
			.from('tech_catalog_items')
			.update({
				sort_order: toSortOrderValue(index),
				updated_at: new Date().toISOString()
			})
			.eq('id', itemId)
			.eq('scope', scope)
			.eq('category_id', categoryId);

		if (scope === 'global') {
			query = query.is('organisation_id', null);
		} else {
			query = query.eq('organisation_id', organisationId ?? '');
		}

		const { error: updateError } = await query;
		if (updateError) throw new Error(updateError.message);
	}
};

const applyOrganisationTechCatalogItemOverrideSortOrder = async ({
	adminClient,
	organisationId,
	itemIds
}: {
	adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>;
	organisationId: string;
	itemIds: string[];
}) => {
	for (const [index, itemId] of itemIds.entries()) {
		const { error: upsertError } = await adminClient
			.from('organisation_tech_catalog_item_overrides')
			.upsert(
				{
					organisation_id: organisationId,
					tech_catalog_item_id: itemId,
					sort_order: toSortOrderValue(index),
					updated_at: new Date().toISOString()
				},
				{ onConflict: 'organisation_id,tech_catalog_item_id' }
			);
		if (upsertError) throw new Error(upsertError.message);
	}
};

const setOrganisationTechCatalogItemHiddenState = async ({
	adminClient,
	organisationId,
	itemId,
	hidden
}: {
	adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>;
	organisationId: string;
	itemId: string;
	hidden: boolean;
}) => {
	if (hidden) {
		const { error: upsertError } = await adminClient
			.from('organisation_tech_catalog_item_overrides')
			.upsert(
				{
					organisation_id: organisationId,
					tech_catalog_item_id: itemId,
					is_hidden: true,
					updated_at: new Date().toISOString()
				},
				{ onConflict: 'organisation_id,tech_catalog_item_id' }
			);
		if (upsertError) throw new Error(upsertError.message);
		return;
	}

	const { data: existingOverride, error: overrideLookupError } = await adminClient
		.from('organisation_tech_catalog_item_overrides')
		.select('sort_order')
		.eq('organisation_id', organisationId)
		.eq('tech_catalog_item_id', itemId)
		.maybeSingle();
	if (overrideLookupError) throw new Error(overrideLookupError.message);

	if (existingOverride?.sort_order != null) {
		const { error: updateError } = await adminClient
			.from('organisation_tech_catalog_item_overrides')
			.update({
				is_hidden: false,
				updated_at: new Date().toISOString()
			})
			.eq('organisation_id', organisationId)
			.eq('tech_catalog_item_id', itemId);
		if (updateError) throw new Error(updateError.message);
		return;
	}

	const { error: deleteError } = await adminClient
		.from('organisation_tech_catalog_item_overrides')
		.delete()
		.eq('organisation_id', organisationId)
		.eq('tech_catalog_item_id', itemId);
	if (deleteError) throw new Error(deleteError.message);
};

const reactivateOrganisationTechCatalogItem = async ({
	adminClient,
	organisationId,
	itemId
}: {
	adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>;
	organisationId: string;
	itemId: string;
}) => {
	const { error: updateError } = await adminClient
		.from('tech_catalog_items')
		.update({
			is_active: true,
			updated_at: new Date().toISOString()
		})
		.eq('id', itemId)
		.eq('scope', 'organisation')
		.eq('organisation_id', organisationId);
	if (updateError) throw new Error(updateError.message);
};

const ensureTechCategoryExists = async (
	adminClient: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
	categoryId: string
) => {
	const { data, error: lookupError } = await adminClient
		.from('tech_categories')
		.select('id')
		.eq('id', categoryId)
		.maybeSingle();
	if (lookupError) throw new Error(lookupError.message);
	return Boolean(data?.id);
};

export const load: PageServerLoad = async ({ locals, url }) => {
	const requestContext = locals.requestContext;
	const supabase = requestContext.getSupabaseClient();
	const adminClient = requestContext.getAdminClient();

	if (!supabase || !adminClient) {
		throw error(401, 'Unauthorized');
	}

	const actor = await requestContext.getActorContext();
	if (!actor.userId) {
		throw error(401, 'Unauthorized');
	}

	const effectiveRoles = resolveEffectiveRoles(actor.roles);
	const isAdmin = effectiveRoles.includes('admin');
	const sharingEnabled = canManageSharing(effectiveRoles);
	const techCatalogManagementEnabled =
		isAdmin || effectiveRoles.includes('broker') || effectiveRoles.includes('employer');
	const canManageOrganisation =
		(isAdmin || effectiveRoles.includes('organisation_admin')) && Boolean(actor.homeOrganisationId);

	const [
		legalDocumentsResult,
		sharingData,
		resumeShareLinks,
		organisation,
		planVersions,
		addonVersions
	] = await Promise.all([
		isAdmin
			? adminClient
					.from('legal_documents')
					.select(
						'id, doc_type, version, content_html, effective_date, acceptance_scope, is_active, created_at'
					)
					.order('doc_type', { ascending: true })
					.order('effective_date', { ascending: false })
			: Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
		loadSharingData({
			adminClient,
			effectiveRoles,
			homeOrganisationId: actor.homeOrganisationId
		}),
		listVisibleResumeShareLinks({
			adminClient,
			actor,
			origin: url.origin
		}),
		loadManagedOrganisation({
			adminClient,
			canManageOrganisation,
			homeOrganisationId: actor.homeOrganisationId
		}),
		isAdmin ? loadBillingPlanVersions(adminClient) : Promise.resolve([]),
		isAdmin ? loadBillingAddonVersions(adminClient) : Promise.resolve([])
	]);

	if (legalDocumentsResult.error) {
		throw error(500, legalDocumentsResult.error.message);
	}

	return {
		canManageLegalDocuments: isAdmin,
		canManageBillingCatalog: isAdmin,
		canManageSharing: sharingEnabled,
		canManageGlobalTechCatalog: canManageGlobalTechCatalog(actor),
		canManageOrganisationTechCatalog: techCatalogManagementEnabled,
		canManageOrganisation,
		homeOrganisationId: actor.homeOrganisationId ?? null,
		organisation,
		planVersions,
		addonVersions,
		legalDocuments: legalDocumentsResult.data ?? [],
		resumeShareLinks,
		...sharingData
	};
};

export const actions: Actions = {
	changePassword: async ({ request, cookies }) => {
		const context = await getActionContext(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'changePassword',
				ok: false,
				message: context.message
			});
		}

		const formData = await request.formData();
		const password = parseString(formData.get('password'));
		const confirmPassword = parseString(formData.get('confirm_password'));

		if (!password || password.length < 8) {
			return fail(400, {
				type: 'changePassword',
				ok: false,
				message: 'Password must be at least 8 characters long.'
			});
		}

		if (password !== confirmPassword) {
			return fail(400, {
				type: 'changePassword',
				ok: false,
				message: 'Passwords do not match.'
			});
		}

		const accessToken = cookies.get(AUTH_COOKIE_NAMES.access) ?? null;
		const refreshToken = cookies.get(AUTH_COOKIE_NAMES.refresh) ?? null;
		if (!accessToken || !refreshToken) {
			return fail(401, {
				type: 'changePassword',
				ok: false,
				message: 'Your session has expired. Please sign in again.'
			});
		}

		const { data: sessionData, error: sessionError } = await context.supabase.auth.setSession({
			access_token: accessToken,
			refresh_token: refreshToken
		});
		if (sessionError || !sessionData.session) {
			return fail(401, {
				type: 'changePassword',
				ok: false,
				message: sessionError?.message ?? 'Your session has expired. Please sign in again.'
			});
		}

		const { error: updateError } = await context.supabase.auth.updateUser({ password });
		if (updateError) {
			return fail(400, {
				type: 'changePassword',
				ok: false,
				message: updateError.message
			});
		}

		return {
			type: 'changePassword' as const,
			ok: true as const,
			message: 'Password updated successfully.'
		};
	},

	createPlanVersion: async ({ request, cookies }) => {
		const context = await ensureAdminBillingActionContext(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'createPlanVersion',
				ok: false,
				message: context.message
			});
		}

		try {
			const formData = await request.formData();
			const planFamily = parseRequiredString(formData, 'plan_family');
			if (planFamily !== 'standard' && planFamily !== 'broker') {
				return fail(400, {
					type: 'createPlanVersion',
					ok: false,
					message: 'Plan family must be standard or broker.'
				});
			}

			await createBillingPlanVersion({
				adminClient: context.adminClient,
				planFamily: planFamily as BillingPlanFamily,
				planCode: parseRequiredString(formData, 'plan_code'),
				planName: parseRequiredString(formData, 'plan_name'),
				currencyCode: parseOptionalString(formData, 'currency_code') ?? 'SEK',
				monthlyPriceOre: parseMoneyOre(parseOptionalString(formData, 'monthly_price')),
				includedTalentProfiles: parseBillingOptionalInteger(
					parseOptionalString(formData, 'included_talent_profiles')
				),
				includedTalentUserSeats: parseBillingOptionalInteger(
					parseOptionalString(formData, 'included_talent_user_seats')
				),
				includedAdminSeats: parseBillingOptionalInteger(
					parseOptionalString(formData, 'included_admin_seats')
				),
				sortOrder: parseBillingSortOrder(parseOptionalString(formData, 'sort_order')),
				features: parseFeatureList(parseOptionalString(formData, 'features')),
				metadata: {}
			});

			return {
				type: 'createPlanVersion' as const,
				ok: true as const,
				message: 'Plan version created.'
			};
		} catch (actionError) {
			return fail(400, {
				type: 'createPlanVersion',
				ok: false,
				message:
					actionError instanceof Error ? actionError.message : 'Could not create plan version.'
			});
		}
	},

	setPlanVersionState: async ({ request, cookies }) => {
		const context = await ensureAdminBillingActionContext(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'setPlanVersionState',
				ok: false,
				message: context.message
			});
		}

		try {
			const formData = await request.formData();
			const planVersionId = parseRequiredString(formData, 'plan_version_id');
			const nextActive = parseRequiredString(formData, 'is_active') === 'true';

			await setBillingPlanVersionActiveState({
				adminClient: context.adminClient,
				planVersionId,
				isActive: nextActive
			});

			return {
				type: 'setPlanVersionState' as const,
				ok: true as const,
				message: 'Plan version updated.'
			};
		} catch (actionError) {
			return fail(400, {
				type: 'setPlanVersionState',
				ok: false,
				message:
					actionError instanceof Error ? actionError.message : 'Could not update plan version.'
			});
		}
	},

	createAddonVersion: async ({ request, cookies }) => {
		const context = await ensureAdminBillingActionContext(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'createAddonVersion',
				ok: false,
				message: context.message
			});
		}

		try {
			const formData = await request.formData();
			const billingType = parseRequiredString(formData, 'billing_type');
			if (billingType !== 'monthly' && billingType !== 'one_time') {
				return fail(400, {
					type: 'createAddonVersion',
					ok: false,
					message: 'Billing type must be monthly or one_time.'
				});
			}

			const appliesToMetric = parseOptionalString(formData, 'applies_to_metric');
			if (
				appliesToMetric &&
				appliesToMetric !== 'talent_profiles' &&
				appliesToMetric !== 'talent_user_seats' &&
				appliesToMetric !== 'admin_seats'
			) {
				return fail(400, {
					type: 'createAddonVersion',
					ok: false,
					message: 'Invalid metric for addon.'
				});
			}

			await createBillingAddonVersion({
				adminClient: context.adminClient,
				addonCode: parseRequiredString(formData, 'addon_code'),
				addonName: parseRequiredString(formData, 'addon_name'),
				billingType,
				currencyCode: parseOptionalString(formData, 'currency_code') ?? 'SEK',
				unitPriceOre: parseMoneyOre(parseOptionalString(formData, 'unit_price')),
				packageQuantity: parseBillingOptionalInteger(
					parseOptionalString(formData, 'package_quantity')
				),
				appliesToMetric: (appliesToMetric as BillingMetricKey | null) ?? null,
				sortOrder: parseBillingSortOrder(parseOptionalString(formData, 'sort_order')),
				metadata: {}
			});

			return {
				type: 'createAddonVersion' as const,
				ok: true as const,
				message: 'Add-on version created.'
			};
		} catch (actionError) {
			return fail(400, {
				type: 'createAddonVersion',
				ok: false,
				message:
					actionError instanceof Error ? actionError.message : 'Could not create add-on version.'
			});
		}
	},

	setAddonVersionState: async ({ request, cookies }) => {
		const context = await ensureAdminBillingActionContext(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'setAddonVersionState',
				ok: false,
				message: context.message
			});
		}

		try {
			const formData = await request.formData();
			const addonVersionId = parseRequiredString(formData, 'addon_version_id');
			const nextActive = parseRequiredString(formData, 'is_active') === 'true';

			await setBillingAddonVersionActiveState({
				adminClient: context.adminClient,
				addonVersionId,
				isActive: nextActive
			});

			return {
				type: 'setAddonVersionState' as const,
				ok: true as const,
				message: 'Add-on version updated.'
			};
		} catch (actionError) {
			return fail(400, {
				type: 'setAddonVersionState',
				ok: false,
				message:
					actionError instanceof Error ? actionError.message : 'Could not update add-on version.'
			});
		}
	},

	updateOrganisation: async ({ request, cookies }) => {
		const formData = await request.formData();
		const context = await ensureOrgManager(cookies, formData);
		if (!context.ok) {
			return fail(context.status, {
				type: 'updateOrganisation',
				ok: false,
				message: context.message
			});
		}
		return handleUpdateOrganisation(formData, context);
	},

	updateOrganisationBranding: async ({ request, cookies }) => {
		const formData = await request.formData();
		const context = await ensureOrgManager(cookies, formData);
		if (!context.ok) {
			return fail(context.status, {
				type: 'updateOrganisationBranding',
				ok: false,
				message: context.message
			});
		}
		return handleUpdateOrganisationBranding(formData, context);
	},

	updateOrganisationTemplate: async ({ request, cookies }) => {
		const formData = await request.formData();
		const context = await ensureOrgManager(cookies, formData);
		if (!context.ok) {
			return fail(context.status, {
				type: 'updateOrganisationTemplate',
				ok: false,
				message: context.message
			});
		}
		return handleUpdateOrganisationTemplate(formData, context);
	},

	connectUserHome: async ({ request, cookies }) => {
		const formData = await request.formData();
		const context = await ensureOrgManager(cookies, formData);
		if (!context.ok) {
			return fail(context.status, {
				type: 'connectUserHome',
				ok: false,
				message: context.message
			});
		}
		return handleConnectUserHome(formData, context);
	},

	disconnectUserHome: async ({ request, cookies }) => {
		const formData = await request.formData();
		const context = await ensureOrgManager(cookies, formData);
		if (!context.ok) {
			return fail(context.status, {
				type: 'disconnectUserHome',
				ok: false,
				message: context.message
			});
		}
		return handleDisconnectUserHome(formData, context);
	},

	connectTalentHome: async ({ request, cookies }) => {
		const formData = await request.formData();
		const context = await ensureOrgManager(cookies, formData);
		if (!context.ok) {
			return fail(context.status, {
				type: 'connectTalentHome',
				ok: false,
				message: context.message
			});
		}
		return handleConnectTalentHome(formData, context);
	},

	disconnectTalentHome: async ({ request, cookies }) => {
		const formData = await request.formData();
		const context = await ensureOrgManager(cookies, formData);
		if (!context.ok) {
			return fail(context.status, {
				type: 'disconnectTalentHome',
				ok: false,
				message: context.message
			});
		}
		return handleDisconnectTalentHome(formData, context);
	},

	createTalentLabelDefinition: async ({ request, cookies }) => {
		const formData = await request.formData();
		const context = await ensureOrgManager(cookies, formData);
		if (!context.ok) {
			return failTalentLabelAction({
				status: context.status,
				type: 'createTalentLabelDefinition',
				message: context.message
			});
		}

		const legalError = await ensureLegalAcceptance(context);
		if (legalError) {
			return failTalentLabelAction({
				status: legalError.status,
				type: 'createTalentLabelDefinition',
				message: legalError.message
			});
		}

		try {
			await createTalentLabelDefinition({
				adminClient: context.adminClient,
				actor: context.actor,
				name: typeof formData.get('name') === 'string' ? String(formData.get('name')) : '',
				colorHex:
					typeof formData.get('color_hex') === 'string' ? String(formData.get('color_hex')) : ''
			});
			invalidateOrganisationContextCache(context.actor.homeOrganisationId);
			return {
				type: 'createTalentLabelDefinition' as const,
				ok: true,
				message: 'Label created.'
			};
		} catch (actionError) {
			const status = actionError instanceof TalentLabelServiceError ? actionError.status : 500;
			return failTalentLabelAction({
				status,
				type: 'createTalentLabelDefinition',
				message: actionError instanceof Error ? actionError.message : 'Could not create label.'
			});
		}
	},

	updateTalentLabelDefinition: async ({ request, cookies }) => {
		const formData = await request.formData();
		const context = await ensureOrgManager(cookies, formData);
		if (!context.ok) {
			return failTalentLabelAction({
				status: context.status,
				type: 'updateTalentLabelDefinition',
				message: context.message
			});
		}

		const legalError = await ensureLegalAcceptance(context);
		if (legalError) {
			return failTalentLabelAction({
				status: legalError.status,
				type: 'updateTalentLabelDefinition',
				message: legalError.message
			});
		}

		const labelDefinitionId = formData.get('label_definition_id');
		if (typeof labelDefinitionId !== 'string' || !labelDefinitionId.trim()) {
			return failTalentLabelAction({
				status: 400,
				type: 'updateTalentLabelDefinition',
				message: 'Invalid label id.'
			});
		}

		try {
			await updateTalentLabelDefinition({
				adminClient: context.adminClient,
				actor: context.actor,
				labelDefinitionId,
				name: typeof formData.get('name') === 'string' ? String(formData.get('name')) : '',
				colorHex:
					typeof formData.get('color_hex') === 'string' ? String(formData.get('color_hex')) : ''
			});
			invalidateOrganisationContextCache(context.actor.homeOrganisationId);
			return {
				type: 'updateTalentLabelDefinition' as const,
				ok: true,
				message: 'Label updated.'
			};
		} catch (actionError) {
			const status = actionError instanceof TalentLabelServiceError ? actionError.status : 500;
			return failTalentLabelAction({
				status,
				type: 'updateTalentLabelDefinition',
				message: actionError instanceof Error ? actionError.message : 'Could not update label.'
			});
		}
	},

	deleteTalentLabelDefinition: async ({ request, cookies }) => {
		const formData = await request.formData();
		const context = await ensureOrgManager(cookies, formData);
		if (!context.ok) {
			return failTalentLabelAction({
				status: context.status,
				type: 'deleteTalentLabelDefinition',
				message: context.message
			});
		}

		const legalError = await ensureLegalAcceptance(context);
		if (legalError) {
			return failTalentLabelAction({
				status: legalError.status,
				type: 'deleteTalentLabelDefinition',
				message: legalError.message
			});
		}

		const labelDefinitionId = formData.get('label_definition_id');
		if (typeof labelDefinitionId !== 'string' || !labelDefinitionId.trim()) {
			return failTalentLabelAction({
				status: 400,
				type: 'deleteTalentLabelDefinition',
				message: 'Invalid label id.'
			});
		}

		try {
			await deleteTalentLabelDefinition({
				adminClient: context.adminClient,
				actor: context.actor,
				labelDefinitionId
			});
			invalidateOrganisationContextCache(context.actor.homeOrganisationId);
			return {
				type: 'deleteTalentLabelDefinition' as const,
				ok: true,
				message: 'Label deleted.'
			};
		} catch (actionError) {
			const status = actionError instanceof TalentLabelServiceError ? actionError.status : 500;
			return failTalentLabelAction({
				status,
				type: 'deleteTalentLabelDefinition',
				message: actionError instanceof Error ? actionError.message : 'Could not delete label.'
			});
		}
	},

	updateResumeShareLink: async ({ request, cookies }) => {
		const context = await getActionContext(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'updateResumeShareLink',
				ok: false,
				message: context.message
			});
		}

		const formData = await request.formData();
		const parsed = parseResumeShareUpdateForm(formData);
		if (!parsed.shareLinkId) {
			return fail(400, {
				type: 'updateResumeShareLink',
				ok: false,
				message: 'Invalid share link.'
			});
		}

		try {
			await updateResumeShareLink({
				adminClient: context.adminClient,
				actor: context.actor,
				shareLinkId: parsed.shareLinkId,
				label: parsed.label,
				isAnonymized: parsed.isAnonymized,
				accessMode: parsed.accessMode,
				languageMode: parsed.languageMode,
				password: parsed.password,
				neverExpires: parsed.neverExpires,
				expiresInDays: parsed.expiresInDays,
				allowDownload: parsed.allowDownload,
				contactName: parsed.contactName,
				contactEmail: parsed.contactEmail,
				contactPhone: parsed.contactPhone,
				contactNote: parsed.contactNote
			});

			return {
				type: 'updateResumeShareLink' as const,
				ok: true as const,
				message: 'Share link updated.'
			};
		} catch (actionError) {
			if (actionError instanceof ResumeShareAccessError) {
				return fail(actionError.status, {
					type: 'updateResumeShareLink',
					ok: false,
					message: actionError.message
				});
			}

			return fail(500, {
				type: 'updateResumeShareLink',
				ok: false,
				message: actionError instanceof Error ? actionError.message : 'Could not update share link.'
			});
		}
	},

	revokeResumeShareLink: async ({ request, cookies }) => {
		const context = await getActionContext(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'revokeResumeShareLink',
				ok: false,
				message: context.message
			});
		}

		const formData = await request.formData();
		const shareLinkId = parseString(formData.get('share_link_id'));
		if (!shareLinkId) {
			return fail(400, {
				type: 'revokeResumeShareLink',
				ok: false,
				message: 'Invalid share link.'
			});
		}

		try {
			await revokeResumeShareLink({
				adminClient: context.adminClient,
				actor: context.actor,
				shareLinkId,
				reason: parseString(formData.get('reason')) || null
			});

			return {
				type: 'revokeResumeShareLink' as const,
				ok: true as const,
				message: 'Share link revoked.'
			};
		} catch (actionError) {
			if (actionError instanceof ResumeShareAccessError) {
				return fail(actionError.status, {
					type: 'revokeResumeShareLink',
					ok: false,
					message: actionError.message
				});
			}

			return fail(500, {
				type: 'revokeResumeShareLink',
				ok: false,
				message: actionError instanceof Error ? actionError.message : 'Could not revoke share link.'
			});
		}
	},

	extendResumeShareLink: async ({ request, cookies }) => {
		const context = await getActionContext(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'extendResumeShareLink',
				ok: false,
				message: context.message
			});
		}

		const formData = await request.formData();
		const shareLinkId = parseString(formData.get('share_link_id'));
		if (!shareLinkId) {
			return fail(400, {
				type: 'extendResumeShareLink',
				ok: false,
				message: 'Invalid share link.'
			});
		}

		const neverExpires = parseBoolean(formData.get('never_expires'));
		const expiresInDays = parseOptionalInteger(formData.get('expires_in_days'));

		try {
			await extendResumeShareLink({
				adminClient: context.adminClient,
				actor: context.actor,
				shareLinkId,
				neverExpires,
				expiresInDays
			});

			return {
				type: 'extendResumeShareLink' as const,
				ok: true as const,
				message: 'Share link expiration updated.'
			};
		} catch (actionError) {
			if (actionError instanceof ResumeShareAccessError) {
				return fail(actionError.status, {
					type: 'extendResumeShareLink',
					ok: false,
					message: actionError.message
				});
			}

			return fail(500, {
				type: 'extendResumeShareLink',
				ok: false,
				message:
					actionError instanceof Error
						? actionError.message
						: 'Could not update share link expiration.'
			});
		}
	},

	regenerateResumeShareLink: async ({ request, cookies, url }) => {
		const context = await getActionContext(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'regenerateResumeShareLink',
				ok: false,
				message: context.message
			});
		}

		const formData = await request.formData();
		const shareLinkId = parseString(formData.get('share_link_id'));
		if (!shareLinkId) {
			return fail(400, {
				type: 'regenerateResumeShareLink',
				ok: false,
				message: 'Invalid share link.'
			});
		}

		try {
			const result = await regenerateResumeShareLink({
				adminClient: context.adminClient,
				actor: context.actor,
				shareLinkId,
				origin: url.origin
			});

			return {
				type: 'regenerateResumeShareLink' as const,
				ok: true as const,
				message: 'Share link regenerated.',
				shareUrl: result.shareUrl
			};
		} catch (actionError) {
			if (actionError instanceof ResumeShareAccessError) {
				return fail(actionError.status, {
					type: 'regenerateResumeShareLink',
					ok: false,
					message: actionError.message
				});
			}

			return fail(500, {
				type: 'regenerateResumeShareLink',
				ok: false,
				message:
					actionError instanceof Error ? actionError.message : 'Could not regenerate share link.'
			});
		}
	},

	upsertOrganisationShareRule: async ({ request, cookies }) => {
		const context = await ensureSharingActionContext(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'upsertOrganisationShareRule',
				ok: false,
				message: context.message
			});
		}

		const formData = await request.formData();
		const sourceContextId = parseString(formData.get('source_context_id'));
		const sourceOrganisationId = normalizeOptionalUuid(formData.get('source_organisation_id'));
		const existingRuleId = normalizeOptionalUuid(formData.get('existing_rule_id'));
		const targetOrganisationId = normalizeOptionalUuid(formData.get('target_organisation_id'));
		const accessLevel = normalizeShareAccessLevel(formData.get('access_level'));
		const allowTargetLogoExport = parseBoolean(formData.get('allow_target_logo_export'));

		if (
			sourceOrganisationId === '__invalid__' ||
			targetOrganisationId === '__invalid__' ||
			existingRuleId === '__invalid__'
		) {
			return fail(400, {
				type: 'upsertOrganisationShareRule',
				ok: false,
				message: 'Choose valid organisations.',
				source_context_id: sourceContextId
			});
		}
		if (!sourceOrganisationId || !targetOrganisationId) {
			return fail(400, {
				type: 'upsertOrganisationShareRule',
				ok: false,
				message: 'Choose both source and target organisations.',
				source_context_id: sourceContextId
			});
		}
		if (sourceOrganisationId === targetOrganisationId) {
			return fail(400, {
				type: 'upsertOrganisationShareRule',
				ok: false,
				message: 'Source and target organisations must be different.',
				source_context_id: sourceContextId
			});
		}
		if (!ORGANISATION_ACCESS_LEVELS.has(accessLevel)) {
			return fail(400, {
				type: 'upsertOrganisationShareRule',
				ok: false,
				message: 'Choose read or write access.',
				source_context_id: sourceContextId
			});
		}
		if (!ensureAllowedSourceOrganisation(context, sourceOrganisationId)) {
			return fail(403, {
				type: 'upsertOrganisationShareRule',
				ok: false,
				message: 'You cannot manage sharing for that source organisation.',
				source_context_id: sourceContextId || sourceOrganisationId
			});
		}

		try {
			const [sourceExists, targetExists] = await Promise.all([
				ensureOrganisationExists(context.adminClient, sourceOrganisationId),
				ensureOrganisationExists(context.adminClient, targetOrganisationId)
			]);
			if (!sourceExists || !targetExists) {
				return fail(404, {
					type: 'upsertOrganisationShareRule',
					ok: false,
					message: 'The selected organisation was not found.',
					source_context_id: sourceContextId || sourceOrganisationId
				});
			}

			const timestamp = new Date().toISOString();
			let ruleId = existingRuleId ?? null;

			if (existingRuleId) {
				const { data: existingRule, error: existingRuleError } = await context.adminClient
					.from('organisation_share_rules')
					.select('id, source_organisation_id')
					.eq('id', existingRuleId)
					.maybeSingle();
				if (existingRuleError) throw new Error(existingRuleError.message);
				if (!existingRule?.id) {
					return fail(404, {
						type: 'upsertOrganisationShareRule',
						ok: false,
						message: 'Organisation share not found.',
						source_context_id: sourceContextId || sourceOrganisationId
					});
				}
				if (!ensureAllowedSourceOrganisation(context, existingRule.source_organisation_id)) {
					return fail(403, {
						type: 'upsertOrganisationShareRule',
						ok: false,
						message: 'You cannot manage sharing for that source organisation.',
						source_context_id: sourceContextId || sourceOrganisationId
					});
				}
				const { data: updatedRule, error: updateError } = await context.adminClient
					.from('organisation_share_rules')
					.update({
						source_organisation_id: sourceOrganisationId,
						target_organisation_id: targetOrganisationId,
						access_level: accessLevel,
						allow_target_logo_export: allowTargetLogoExport,
						updated_by_user_id: context.actor.userId,
						updated_at: timestamp
					})
					.eq('id', existingRuleId)
					.select('id')
					.single();
				if (updateError) throw new Error(updateError.message);
				ruleId = updatedRule.id;
			} else {
				const { data: existingRule, error: existingRuleError } = await context.adminClient
					.from('organisation_share_rules')
					.select('id')
					.eq('source_organisation_id', sourceOrganisationId)
					.eq('target_organisation_id', targetOrganisationId)
					.maybeSingle();
				if (existingRuleError) throw new Error(existingRuleError.message);

				if (existingRule?.id) {
					const { data: updatedRule, error: updateError } = await context.adminClient
						.from('organisation_share_rules')
						.update({
							access_level: accessLevel,
							allow_target_logo_export: allowTargetLogoExport,
							updated_by_user_id: context.actor.userId,
							updated_at: timestamp
						})
						.eq('id', existingRule.id)
						.select('id')
						.single();
					if (updateError) throw new Error(updateError.message);
					ruleId = updatedRule.id;
				} else {
					const { data: insertedRule, error: insertError } = await context.adminClient
						.from('organisation_share_rules')
						.insert({
							source_organisation_id: sourceOrganisationId,
							target_organisation_id: targetOrganisationId,
							access_level: accessLevel,
							allow_target_logo_export: allowTargetLogoExport,
							created_by_user_id: context.actor.userId,
							updated_by_user_id: context.actor.userId,
							updated_at: timestamp
						})
						.select('id')
						.single();
					if (insertError) throw new Error(insertError.message);
					ruleId = insertedRule.id;
				}
			}

			const auditResult = await writeAuditLog({
				actorUserId: context.actor.userId,
				organisationId: sourceOrganisationId,
				actionType: 'SHARE_RULE_CONFIGURED',
				resourceType: 'organisation_share_rule',
				resourceId: ruleId,
				metadata: {
					source_org_id: sourceOrganisationId,
					target_org_id: targetOrganisationId,
					access_level: accessLevel,
					allow_target_logo_export: allowTargetLogoExport
				}
			});
			if (!auditResult.ok) {
				console.warn('[settings] could not write organisation share audit log', auditResult.error);
			}

			return {
				type: 'upsertOrganisationShareRule' as const,
				ok: true as const,
				message: 'Organisation sharing saved.',
				source_context_id: sourceOrganisationId
			};
		} catch (actionError) {
			return fail(500, {
				type: 'upsertOrganisationShareRule',
				ok: false,
				message:
					actionError instanceof Error
						? actionError.message
						: 'Could not save organisation sharing.',
				source_context_id: sourceContextId || sourceOrganisationId
			});
		}
	},

	deleteOrganisationShareRule: async ({ request, cookies }) => {
		const context = await ensureSharingActionContext(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'deleteOrganisationShareRule',
				ok: false,
				message: context.message
			});
		}

		const formData = await request.formData();
		const sourceContextId = parseString(formData.get('source_context_id'));
		const ruleId = normalizeOptionalUuid(formData.get('rule_id'));

		if (ruleId === '__invalid__' || !ruleId) {
			return fail(400, {
				type: 'deleteOrganisationShareRule',
				ok: false,
				message: 'Invalid rule id.',
				source_context_id: sourceContextId
			});
		}

		try {
			const { data: rule, error: ruleError } = await context.adminClient
				.from('organisation_share_rules')
				.select(
					'id, source_organisation_id, target_organisation_id, access_level, allow_target_logo_export'
				)
				.eq('id', ruleId)
				.maybeSingle();
			if (ruleError) throw new Error(ruleError.message);
			if (!rule?.id) {
				return fail(404, {
					type: 'deleteOrganisationShareRule',
					ok: false,
					message: 'Organisation share not found.',
					source_context_id: sourceContextId
				});
			}
			if (!ensureAllowedSourceOrganisation(context, rule.source_organisation_id)) {
				return fail(403, {
					type: 'deleteOrganisationShareRule',
					ok: false,
					message: 'You cannot manage sharing for that source organisation.',
					source_context_id: sourceContextId || rule.source_organisation_id
				});
			}

			const { error: deleteError } = await context.adminClient
				.from('organisation_share_rules')
				.delete()
				.eq('id', ruleId);
			if (deleteError) throw new Error(deleteError.message);

			const auditResult = await writeAuditLog({
				actorUserId: context.actor.userId,
				organisationId: rule.source_organisation_id,
				actionType: 'SHARE_RULE_REVOKED',
				resourceType: 'organisation_share_rule',
				resourceId: rule.id,
				metadata: {
					source_org_id: rule.source_organisation_id,
					target_org_id: rule.target_organisation_id,
					access_level: rule.access_level,
					allow_target_logo_export: Boolean(rule.allow_target_logo_export ?? false)
				}
			});
			if (!auditResult.ok) {
				console.warn(
					'[settings] could not write organisation share revoke audit log',
					auditResult.error
				);
			}

			return {
				type: 'deleteOrganisationShareRule' as const,
				ok: true as const,
				message: 'Organisation sharing removed.',
				source_context_id: rule.source_organisation_id
			};
		} catch (actionError) {
			return fail(500, {
				type: 'deleteOrganisationShareRule',
				ok: false,
				message:
					actionError instanceof Error
						? actionError.message
						: 'Could not remove organisation sharing.',
				source_context_id: sourceContextId
			});
		}
	},

	upsertTalentShareRule: async ({ request, cookies }) => {
		const context = await ensureSharingActionContext(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'upsertTalentShareRule',
				ok: false,
				message: context.message
			});
		}

		const formData = await request.formData();
		const sourceContextId = parseString(formData.get('source_context_id'));
		const sourceOrganisationId = normalizeOptionalUuid(formData.get('source_organisation_id'));
		const existingRuleId = normalizeOptionalUuid(formData.get('existing_rule_id'));
		const targetOrganisationId = normalizeOptionalUuid(formData.get('target_organisation_id'));
		const talentId = normalizeOptionalUuid(formData.get('talent_id'));
		const accessLevel = normalizeShareAccessLevel(formData.get('access_level'));
		const allowTargetLogoExport = parseBoolean(formData.get('allow_target_logo_export'));

		if (
			sourceOrganisationId === '__invalid__' ||
			targetOrganisationId === '__invalid__' ||
			talentId === '__invalid__' ||
			existingRuleId === '__invalid__'
		) {
			return fail(400, {
				type: 'upsertTalentShareRule',
				ok: false,
				message: 'Choose a valid organisation and talent.',
				source_context_id: sourceContextId
			});
		}
		if (!sourceOrganisationId || !targetOrganisationId || !talentId) {
			return fail(400, {
				type: 'upsertTalentShareRule',
				ok: false,
				message: 'Choose source organisation, target organisation, and talent.',
				source_context_id: sourceContextId
			});
		}
		if (sourceOrganisationId === targetOrganisationId) {
			return fail(400, {
				type: 'upsertTalentShareRule',
				ok: false,
				message: 'Source and target organisations must be different.',
				source_context_id: sourceContextId || sourceOrganisationId
			});
		}
		if (!TALENT_ACCESS_LEVELS.has(accessLevel)) {
			return fail(400, {
				type: 'upsertTalentShareRule',
				ok: false,
				message: 'Choose exclude, read, or write access.',
				source_context_id: sourceContextId || sourceOrganisationId
			});
		}
		if (!ensureAllowedSourceOrganisation(context, sourceOrganisationId)) {
			return fail(403, {
				type: 'upsertTalentShareRule',
				ok: false,
				message: 'You cannot manage sharing for that source organisation.',
				source_context_id: sourceContextId || sourceOrganisationId
			});
		}

		try {
			const [sourceExists, targetExists, talentBelongsToSource] = await Promise.all([
				ensureOrganisationExists(context.adminClient, sourceOrganisationId),
				ensureOrganisationExists(context.adminClient, targetOrganisationId),
				ensureTalentBelongsToSourceOrganisation(context.adminClient, talentId, sourceOrganisationId)
			]);

			if (!sourceExists || !targetExists) {
				return fail(404, {
					type: 'upsertTalentShareRule',
					ok: false,
					message: 'The selected organisation was not found.',
					source_context_id: sourceContextId || sourceOrganisationId
				});
			}
			if (!talentBelongsToSource) {
				return fail(400, {
					type: 'upsertTalentShareRule',
					ok: false,
					message: 'The selected talent does not belong to that source organisation.',
					source_context_id: sourceContextId || sourceOrganisationId
				});
			}

			const timestamp = new Date().toISOString();
			let ruleId = existingRuleId ?? null;

			if (existingRuleId) {
				const { data: existingRule, error: existingRuleError } = await context.adminClient
					.from('talent_share_rules')
					.select('id, source_organisation_id')
					.eq('id', existingRuleId)
					.maybeSingle();
				if (existingRuleError) throw new Error(existingRuleError.message);
				if (!existingRule?.id) {
					return fail(404, {
						type: 'upsertTalentShareRule',
						ok: false,
						message: 'Talent share not found.',
						source_context_id: sourceContextId || sourceOrganisationId
					});
				}
				if (!ensureAllowedSourceOrganisation(context, existingRule.source_organisation_id)) {
					return fail(403, {
						type: 'upsertTalentShareRule',
						ok: false,
						message: 'You cannot manage sharing for that source organisation.',
						source_context_id: sourceContextId || sourceOrganisationId
					});
				}
				const { data: updatedRule, error: updateError } = await context.adminClient
					.from('talent_share_rules')
					.update({
						source_organisation_id: sourceOrganisationId,
						target_organisation_id: targetOrganisationId,
						talent_id: talentId,
						access_level: accessLevel,
						allow_target_logo_export: allowTargetLogoExport,
						updated_by_user_id: context.actor.userId,
						updated_at: timestamp
					})
					.eq('id', existingRuleId)
					.select('id')
					.single();
				if (updateError) throw new Error(updateError.message);
				ruleId = updatedRule.id;
			} else {
				const { data: existingRule, error: existingRuleError } = await context.adminClient
					.from('talent_share_rules')
					.select('id')
					.eq('source_organisation_id', sourceOrganisationId)
					.eq('target_organisation_id', targetOrganisationId)
					.eq('talent_id', talentId)
					.maybeSingle();
				if (existingRuleError) throw new Error(existingRuleError.message);

				if (existingRule?.id) {
					const { data: updatedRule, error: updateError } = await context.adminClient
						.from('talent_share_rules')
						.update({
							access_level: accessLevel,
							allow_target_logo_export: allowTargetLogoExport,
							updated_by_user_id: context.actor.userId,
							updated_at: timestamp
						})
						.eq('id', existingRule.id)
						.select('id')
						.single();
					if (updateError) throw new Error(updateError.message);
					ruleId = updatedRule.id;
				} else {
					const { data: insertedRule, error: insertError } = await context.adminClient
						.from('talent_share_rules')
						.insert({
							source_organisation_id: sourceOrganisationId,
							target_organisation_id: targetOrganisationId,
							talent_id: talentId,
							access_level: accessLevel,
							allow_target_logo_export: allowTargetLogoExport,
							created_by_user_id: context.actor.userId,
							updated_by_user_id: context.actor.userId,
							updated_at: timestamp
						})
						.select('id')
						.single();
					if (insertError) throw new Error(insertError.message);
					ruleId = insertedRule.id;
				}
			}

			const auditResult = await writeAuditLog({
				actorUserId: context.actor.userId,
				organisationId: sourceOrganisationId,
				actionType: 'SHARE_RULE_CONFIGURED',
				resourceType: 'talent_share_rule',
				resourceId: ruleId,
				metadata: {
					source_org_id: sourceOrganisationId,
					target_org_id: targetOrganisationId,
					talent_id: talentId,
					access_level: accessLevel,
					allow_target_logo_export: allowTargetLogoExport
				}
			});
			if (!auditResult.ok) {
				console.warn('[settings] could not write talent share audit log', auditResult.error);
			}

			return {
				type: 'upsertTalentShareRule' as const,
				ok: true as const,
				message: 'Talent sharing saved.',
				source_context_id: sourceOrganisationId
			};
		} catch (actionError) {
			return fail(500, {
				type: 'upsertTalentShareRule',
				ok: false,
				message:
					actionError instanceof Error ? actionError.message : 'Could not save talent sharing.',
				source_context_id: sourceContextId || sourceOrganisationId
			});
		}
	},

	deleteTalentShareRule: async ({ request, cookies }) => {
		const context = await ensureSharingActionContext(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'deleteTalentShareRule',
				ok: false,
				message: context.message
			});
		}

		const formData = await request.formData();
		const sourceContextId = parseString(formData.get('source_context_id'));
		const ruleId = normalizeOptionalUuid(formData.get('rule_id'));

		if (ruleId === '__invalid__' || !ruleId) {
			return fail(400, {
				type: 'deleteTalentShareRule',
				ok: false,
				message: 'Invalid rule id.',
				source_context_id: sourceContextId
			});
		}

		try {
			const { data: rule, error: ruleError } = await context.adminClient
				.from('talent_share_rules')
				.select(
					'id, source_organisation_id, target_organisation_id, talent_id, access_level, allow_target_logo_export'
				)
				.eq('id', ruleId)
				.maybeSingle();
			if (ruleError) throw new Error(ruleError.message);
			if (!rule?.id) {
				return fail(404, {
					type: 'deleteTalentShareRule',
					ok: false,
					message: 'Talent share not found.',
					source_context_id: sourceContextId
				});
			}
			if (!ensureAllowedSourceOrganisation(context, rule.source_organisation_id)) {
				return fail(403, {
					type: 'deleteTalentShareRule',
					ok: false,
					message: 'You cannot manage sharing for that source organisation.',
					source_context_id: sourceContextId || rule.source_organisation_id
				});
			}

			const { error: deleteError } = await context.adminClient
				.from('talent_share_rules')
				.delete()
				.eq('id', ruleId);
			if (deleteError) throw new Error(deleteError.message);

			const auditResult = await writeAuditLog({
				actorUserId: context.actor.userId,
				organisationId: rule.source_organisation_id,
				actionType: 'SHARE_RULE_REVOKED',
				resourceType: 'talent_share_rule',
				resourceId: rule.id,
				metadata: {
					source_org_id: rule.source_organisation_id,
					target_org_id: rule.target_organisation_id,
					talent_id: rule.talent_id,
					access_level: rule.access_level,
					allow_target_logo_export: Boolean(rule.allow_target_logo_export ?? false)
				}
			});
			if (!auditResult.ok) {
				console.warn('[settings] could not write talent share revoke audit log', auditResult.error);
			}

			return {
				type: 'deleteTalentShareRule' as const,
				ok: true as const,
				message: 'Talent sharing removed.',
				source_context_id: rule.source_organisation_id
			};
		} catch (actionError) {
			return fail(500, {
				type: 'deleteTalentShareRule',
				ok: false,
				message:
					actionError instanceof Error ? actionError.message : 'Could not remove talent sharing.',
				source_context_id: sourceContextId
			});
		}
	},

	upsertTechCategory: async ({ request, cookies }) => {
		const context = await getActionContext(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'upsertTechCategory',
				ok: false,
				message: context.message
			});
		}
		if (!canManageGlobalTechCatalog(context.actor)) {
			return fail(403, {
				type: 'upsertTechCategory',
				ok: false,
				message: 'Only admins can manage the global technology catalog.'
			});
		}

		const formData = await request.formData();
		const techContextId = parseString(formData.get('tech_context_id'));
		const categoryId = parseString(formData.get('category_id'));
		const name = parseString(formData.get('name'));
		const sortOrder = parseOptionalInteger(formData.get('sort_order'));

		if (!name) {
			return fail(400, {
				type: 'upsertTechCategory',
				ok: false,
				message: 'Category name is required.',
				tech_context_id: techContextId
			});
		}

		try {
			if (categoryId) {
				const { data: existing, error: existingError } = await context.adminClient
					.from('tech_categories')
					.select('id, sort_order')
					.eq('id', categoryId)
					.maybeSingle();
				if (existingError) throw new Error(existingError.message);
				if (!existing?.id) {
					return fail(404, {
						type: 'upsertTechCategory',
						ok: false,
						message: 'Technology category not found.',
						tech_context_id: techContextId
					});
				}

				const { error: updateError } = await context.adminClient
					.from('tech_categories')
					.update({
						name,
						sort_order: sortOrder ?? existing.sort_order ?? 0,
						updated_at: new Date().toISOString()
					})
					.eq('id', categoryId);
				if (updateError) throw new Error(updateError.message);
			} else {
				const nextSortOrder =
					sortOrder ?? (await resolveNextTechCategorySortOrder(context.adminClient));
				const nextCategoryId = await resolveUniqueTechCategoryId({
					adminClient: context.adminClient,
					name
				});
				const { error: insertError } = await context.adminClient.from('tech_categories').insert({
					id: nextCategoryId,
					name,
					sort_order: nextSortOrder,
					is_active: true
				});
				if (insertError) throw new Error(insertError.message);
			}

			return {
				type: 'upsertTechCategory' as const,
				ok: true as const,
				message: 'Technology category saved.',
				tech_context_id: techContextId
			};
		} catch (actionError) {
			return fail(500, {
				type: 'upsertTechCategory',
				ok: false,
				message:
					actionError instanceof Error
						? actionError.message
						: 'Could not save technology category.',
				tech_context_id: techContextId
			});
		}
	},

	setTechCategoryStatus: async ({ request, cookies }) => {
		const context = await getActionContext(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'setTechCategoryStatus',
				ok: false,
				message: context.message
			});
		}
		if (!canManageGlobalTechCatalog(context.actor)) {
			return fail(403, {
				type: 'setTechCategoryStatus',
				ok: false,
				message: 'Only admins can manage the global technology catalog.'
			});
		}

		const formData = await request.formData();
		const techContextId = parseString(formData.get('tech_context_id'));
		const categoryId = parseString(formData.get('category_id'));
		const nextIsActive = parseBoolean(formData.get('next_is_active'));

		if (!categoryId) {
			return fail(400, {
				type: 'setTechCategoryStatus',
				ok: false,
				message: 'Category id is required.',
				tech_context_id: techContextId
			});
		}

		try {
			const { error: updateError } = await context.adminClient
				.from('tech_categories')
				.update({
					is_active: nextIsActive,
					updated_at: new Date().toISOString()
				})
				.eq('id', categoryId);
			if (updateError) throw new Error(updateError.message);

			return {
				type: 'setTechCategoryStatus' as const,
				ok: true as const,
				message: nextIsActive ? 'Technology category shown.' : 'Technology category hidden.',
				tech_context_id: techContextId
			};
		} catch (actionError) {
			return fail(500, {
				type: 'setTechCategoryStatus',
				ok: false,
				message:
					actionError instanceof Error
						? actionError.message
						: 'Could not update technology category status.',
				tech_context_id: techContextId
			});
		}
	},

	upsertGlobalTechCatalogItem: async ({ request, cookies }) => {
		const context = await getActionContext(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'upsertGlobalTechCatalogItem',
				ok: false,
				message: context.message
			});
		}
		if (!canManageGlobalTechCatalog(context.actor)) {
			return fail(403, {
				type: 'upsertGlobalTechCatalogItem',
				ok: false,
				message: 'Only admins can manage the global technology catalog.'
			});
		}

		const formData = await request.formData();
		const techContextId = parseString(formData.get('tech_context_id'));
		const itemId = normalizeOptionalUuid(formData.get('item_id'));
		const categoryId = parseString(formData.get('category_id'));
		const label = parseString(formData.get('label'));
		const aliasesInput = parseString(formData.get('aliases'));
		const sortOrder = parseOptionalInteger(formData.get('sort_order'));

		if (itemId === '__invalid__') {
			return fail(400, {
				type: 'upsertGlobalTechCatalogItem',
				ok: false,
				message: 'Invalid technology id.',
				tech_context_id: techContextId
			});
		}
		if (!label || !categoryId) {
			return fail(400, {
				type: 'upsertGlobalTechCatalogItem',
				ok: false,
				message: 'Choose a category and enter a technology name.',
				tech_context_id: techContextId
			});
		}

		try {
			const categoryExists = await ensureTechCategoryExists(context.adminClient, categoryId);
			if (!categoryExists) {
				return fail(404, {
					type: 'upsertGlobalTechCatalogItem',
					ok: false,
					message: 'Technology category not found.',
					tech_context_id: techContextId
				});
			}

			const nextAliases = parseTechCatalogAliasesInput(aliasesInput);
			const normalizedLabel = normalizeTechCatalogKey(label);

			if (itemId) {
				const { data: existing, error: existingError } = await context.adminClient
					.from('tech_catalog_items')
					.select('id, scope, label, aliases, slug, sort_order')
					.eq('id', itemId)
					.maybeSingle();
				if (existingError) throw new Error(existingError.message);
				if (!existing?.id || existing.scope !== 'global') {
					return fail(404, {
						type: 'upsertGlobalTechCatalogItem',
						ok: false,
						message: 'Global technology not found.',
						tech_context_id: techContextId
					});
				}

				const mergedAliases = parseTechCatalogAliasesInput(
					[
						...nextAliases,
						...(Array.isArray(existing.aliases) ? existing.aliases : []),
						existing.label !== label ? existing.label : ''
					]
						.filter(Boolean)
						.join(', ')
				).filter((alias) => normalizeTechCatalogKey(alias) !== normalizedLabel);

				const { error: updateError } = await context.adminClient
					.from('tech_catalog_items')
					.update({
						category_id: categoryId,
						label,
						normalized_label: normalizedLabel,
						aliases: mergedAliases,
						sort_order: sortOrder ?? existing.sort_order ?? 0,
						updated_at: new Date().toISOString()
					})
					.eq('id', itemId);
				if (updateError) throw new Error(updateError.message);
			} else {
				const nextSortOrder =
					sortOrder ??
					(await resolveNextTechCatalogItemSortOrder({
						adminClient: context.adminClient,
						scope: 'global',
						categoryId
					}));
				const slug = await resolveUniqueTechCatalogSlug({
					adminClient: context.adminClient,
					label,
					scope: 'global'
				});
				const { error: insertError } = await context.adminClient.from('tech_catalog_items').insert({
					scope: 'global',
					organisation_id: null,
					category_id: categoryId,
					slug,
					label,
					normalized_label: normalizedLabel,
					aliases: nextAliases.filter(
						(alias) => normalizeTechCatalogKey(alias) !== normalizedLabel
					),
					sort_order: nextSortOrder,
					is_active: true
				});
				if (insertError) throw new Error(insertError.message);
			}

			return {
				type: 'upsertGlobalTechCatalogItem' as const,
				ok: true as const,
				message: 'Global technology saved.',
				tech_context_id: techContextId
			};
		} catch (actionError) {
			return fail(500, {
				type: 'upsertGlobalTechCatalogItem',
				ok: false,
				message:
					actionError instanceof Error ? actionError.message : 'Could not save global technology.',
				tech_context_id: techContextId
			});
		}
	},

	setGlobalTechCatalogItemStatus: async ({ request, cookies }) => {
		const context = await getActionContext(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'setGlobalTechCatalogItemStatus',
				ok: false,
				message: context.message
			});
		}
		if (!canManageGlobalTechCatalog(context.actor)) {
			return fail(403, {
				type: 'setGlobalTechCatalogItemStatus',
				ok: false,
				message: 'Only admins can manage the global technology catalog.'
			});
		}

		const formData = await request.formData();
		const techContextId = parseString(formData.get('tech_context_id'));
		const itemId = normalizeOptionalUuid(formData.get('item_id'));
		const nextIsActive = parseBoolean(formData.get('next_is_active'));

		if (itemId === '__invalid__' || !itemId) {
			return fail(400, {
				type: 'setGlobalTechCatalogItemStatus',
				ok: false,
				message: 'Invalid technology id.',
				tech_context_id: techContextId
			});
		}

		try {
			const { error: updateError } = await context.adminClient
				.from('tech_catalog_items')
				.update({
					is_active: nextIsActive,
					updated_at: new Date().toISOString()
				})
				.eq('id', itemId)
				.eq('scope', 'global');
			if (updateError) throw new Error(updateError.message);

			return {
				type: 'setGlobalTechCatalogItemStatus' as const,
				ok: true as const,
				message: nextIsActive ? 'Global technology restored.' : 'Global technology archived.',
				tech_context_id: techContextId
			};
		} catch (actionError) {
			return fail(500, {
				type: 'setGlobalTechCatalogItemStatus',
				ok: false,
				message:
					actionError instanceof Error
						? actionError.message
						: 'Could not update global technology status.',
				tech_context_id: techContextId
			});
		}
	},

	setOrganisationTechCatalogExclusion: async ({ request, cookies }) => {
		const context = await getActionContext(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'setOrganisationTechCatalogExclusion',
				ok: false,
				message: context.message
			});
		}

		const formData = await request.formData();
		const techContextId = parseString(formData.get('tech_context_id'));
		const organisationId = normalizeOptionalUuid(formData.get('organisation_id'));
		const itemId = normalizeOptionalUuid(formData.get('item_id'));
		const hidden = parseBoolean(formData.get('hidden')) || parseBoolean(formData.get('exclude'));

		if (
			organisationId === '__invalid__' ||
			itemId === '__invalid__' ||
			!organisationId ||
			!itemId
		) {
			return fail(400, {
				type: 'setOrganisationTechCatalogExclusion',
				ok: false,
				message: 'Choose a valid organisation and technology.',
				tech_context_id: techContextId
			});
		}
		if (!canManageOrganisationTechCatalogForContext(context, organisationId)) {
			return fail(403, {
				type: 'setOrganisationTechCatalogExclusion',
				ok: false,
				message: 'You cannot manage that organisation catalog.',
				tech_context_id: techContextId || organisationId
			});
		}

		try {
			const [organisationExists, itemResult] = await Promise.all([
				ensureOrganisationExists(context.adminClient, organisationId),
				context.adminClient
					.from('tech_catalog_items')
					.select('id, scope, organisation_id')
					.eq('id', itemId)
					.maybeSingle()
			]);
			if (!organisationExists) {
				return fail(404, {
					type: 'setOrganisationTechCatalogExclusion',
					ok: false,
					message: 'Organisation not found.',
					tech_context_id: techContextId || organisationId
				});
			}
			if (itemResult.error) throw new Error(itemResult.error.message);
			if (!itemResult.data?.id) {
				return fail(404, {
					type: 'setOrganisationTechCatalogExclusion',
					ok: false,
					message: 'Technology not found.',
					tech_context_id: techContextId || organisationId
				});
			}

			const item = itemResult.data;
			if (
				item.scope !== 'global' &&
				(item.scope !== 'organisation' || item.organisation_id !== organisationId)
			) {
				return fail(404, {
					type: 'setOrganisationTechCatalogExclusion',
					ok: false,
					message: 'Technology not found.',
					tech_context_id: techContextId || organisationId
				});
			}

			if (item.scope === 'organisation') {
				await reactivateOrganisationTechCatalogItem({
					adminClient: context.adminClient,
					organisationId,
					itemId
				});
			}

			await setOrganisationTechCatalogItemHiddenState({
				adminClient: context.adminClient,
				organisationId,
				itemId,
				hidden
			});

			return {
				type: 'setOrganisationTechCatalogExclusion' as const,
				ok: true as const,
				message: hidden
					? 'Technology hidden for this organisation.'
					: 'Technology restored for this organisation.',
				tech_context_id: organisationId
			};
		} catch (actionError) {
			return fail(500, {
				type: 'setOrganisationTechCatalogExclusion',
				ok: false,
				message:
					actionError instanceof Error
						? actionError.message
						: 'Could not update organisation technology visibility.',
				tech_context_id: techContextId || organisationId
			});
		}
	},

	upsertOrganisationTechCatalogItem: async ({ request, cookies }) => {
		const context = await getActionContext(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'upsertOrganisationTechCatalogItem',
				ok: false,
				message: context.message
			});
		}

		const formData = await request.formData();
		const techContextId = parseString(formData.get('tech_context_id'));
		const organisationId = normalizeOptionalUuid(formData.get('organisation_id'));
		const itemId = normalizeOptionalUuid(formData.get('item_id'));
		const categoryId = parseString(formData.get('category_id'));
		const label = parseString(formData.get('label'));
		const aliasesInput = parseString(formData.get('aliases'));
		const sortOrder = parseOptionalInteger(formData.get('sort_order'));

		if (organisationId === '__invalid__' || itemId === '__invalid__' || !organisationId) {
			return fail(400, {
				type: 'upsertOrganisationTechCatalogItem',
				ok: false,
				message: 'Choose a valid organisation.',
				tech_context_id: techContextId
			});
		}
		if (!canManageOrganisationTechCatalogForContext(context, organisationId)) {
			return fail(403, {
				type: 'upsertOrganisationTechCatalogItem',
				ok: false,
				message: 'You cannot manage that organisation catalog.',
				tech_context_id: techContextId || organisationId
			});
		}
		if (!label || !categoryId) {
			return fail(400, {
				type: 'upsertOrganisationTechCatalogItem',
				ok: false,
				message: 'Choose a category and enter a technology name.',
				tech_context_id: techContextId || organisationId
			});
		}

		try {
			const [organisationExists, categoryExists] = await Promise.all([
				ensureOrganisationExists(context.adminClient, organisationId),
				ensureTechCategoryExists(context.adminClient, categoryId)
			]);
			if (!organisationExists) {
				return fail(404, {
					type: 'upsertOrganisationTechCatalogItem',
					ok: false,
					message: 'Organisation not found.',
					tech_context_id: techContextId || organisationId
				});
			}
			if (!categoryExists) {
				return fail(404, {
					type: 'upsertOrganisationTechCatalogItem',
					ok: false,
					message: 'Technology category not found.',
					tech_context_id: techContextId || organisationId
				});
			}

			const nextAliases = parseTechCatalogAliasesInput(aliasesInput);
			const normalizedLabel = normalizeTechCatalogKey(label);

			if (itemId) {
				const { data: existing, error: existingError } = await context.adminClient
					.from('tech_catalog_items')
					.select('id, scope, organisation_id, label, aliases, sort_order')
					.eq('id', itemId)
					.maybeSingle();
				if (existingError) throw new Error(existingError.message);
				if (
					!existing?.id ||
					existing.scope !== 'organisation' ||
					existing.organisation_id !== organisationId
				) {
					return fail(404, {
						type: 'upsertOrganisationTechCatalogItem',
						ok: false,
						message: 'Organisation-specific technology not found.',
						tech_context_id: techContextId || organisationId
					});
				}

				const mergedAliases = parseTechCatalogAliasesInput(
					[
						...nextAliases,
						...(Array.isArray(existing.aliases) ? existing.aliases : []),
						existing.label !== label ? existing.label : ''
					]
						.filter(Boolean)
						.join(', ')
				).filter((alias) => normalizeTechCatalogKey(alias) !== normalizedLabel);

				const { error: updateError } = await context.adminClient
					.from('tech_catalog_items')
					.update({
						category_id: categoryId,
						label,
						normalized_label: normalizedLabel,
						aliases: mergedAliases,
						sort_order: sortOrder ?? existing.sort_order ?? 0,
						updated_at: new Date().toISOString()
					})
					.eq('id', itemId);
				if (updateError) throw new Error(updateError.message);
			} else {
				const nextSortOrder =
					sortOrder ??
					(await resolveNextOrganisationTechCatalogSortOrder({
						adminClient: context.adminClient,
						categoryId,
						organisationId
					}));
				const slug = await resolveUniqueTechCatalogSlug({
					adminClient: context.adminClient,
					label,
					scope: 'organisation',
					organisationId
				});
				const { error: insertError } = await context.adminClient.from('tech_catalog_items').insert({
					scope: 'organisation',
					organisation_id: organisationId,
					category_id: categoryId,
					slug,
					label,
					normalized_label: normalizedLabel,
					aliases: nextAliases.filter(
						(alias) => normalizeTechCatalogKey(alias) !== normalizedLabel
					),
					sort_order: nextSortOrder,
					is_active: true
				});
				if (insertError) throw new Error(insertError.message);
			}

			return {
				type: 'upsertOrganisationTechCatalogItem' as const,
				ok: true as const,
				message: 'Organisation-specific technology saved.',
				tech_context_id: organisationId
			};
		} catch (actionError) {
			return fail(500, {
				type: 'upsertOrganisationTechCatalogItem',
				ok: false,
				message:
					actionError instanceof Error
						? actionError.message
						: 'Could not save organisation-specific technology.',
				tech_context_id: techContextId || organisationId
			});
		}
	},

	deleteOrganisationTechCatalogItem: async ({ request, cookies }) => {
		const context = await getActionContext(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'deleteOrganisationTechCatalogItem',
				ok: false,
				message: context.message
			});
		}

		const formData = await request.formData();
		const techContextId = parseString(formData.get('tech_context_id'));
		const organisationId = normalizeOptionalUuid(formData.get('organisation_id'));
		const itemId = normalizeOptionalUuid(formData.get('item_id'));

		if (
			organisationId === '__invalid__' ||
			itemId === '__invalid__' ||
			!organisationId ||
			!itemId
		) {
			return fail(400, {
				type: 'deleteOrganisationTechCatalogItem',
				ok: false,
				message: 'Choose a valid organisation and technology.',
				tech_context_id: techContextId
			});
		}
		if (!canManageOrganisationTechCatalogForContext(context, organisationId)) {
			return fail(403, {
				type: 'deleteOrganisationTechCatalogItem',
				ok: false,
				message: 'You cannot manage that organisation catalog.',
				tech_context_id: techContextId || organisationId
			});
		}

		try {
			const { data: existingItem, error: lookupError } = await context.adminClient
				.from('tech_catalog_items')
				.select('id, scope, organisation_id')
				.eq('id', itemId)
				.maybeSingle();
			if (lookupError) throw new Error(lookupError.message);
			if (
				!existingItem?.id ||
				existingItem.scope !== 'organisation' ||
				existingItem.organisation_id !== organisationId
			) {
				return fail(404, {
					type: 'deleteOrganisationTechCatalogItem',
					ok: false,
					message: 'Organisation-specific technology not found.',
					tech_context_id: techContextId || organisationId
				});
			}

			const { error: deleteError } = await context.adminClient
				.from('tech_catalog_items')
				.delete()
				.eq('id', itemId)
				.eq('scope', 'organisation')
				.eq('organisation_id', organisationId);
			if (deleteError) throw new Error(deleteError.message);

			return {
				type: 'deleteOrganisationTechCatalogItem' as const,
				ok: true as const,
				message: 'Organisation-specific technology deleted.',
				tech_context_id: organisationId
			};
		} catch (actionError) {
			return fail(500, {
				type: 'deleteOrganisationTechCatalogItem',
				ok: false,
				message:
					actionError instanceof Error
						? actionError.message
						: 'Could not delete organisation-specific technology.',
				tech_context_id: techContextId || organisationId
			});
		}
	},

	reorderTechCategories: async ({ request, cookies }) => {
		const context = await getActionContext(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'reorderTechCategories',
				ok: false,
				message: context.message
			});
		}
		if (!canManageGlobalTechCatalog(context.actor)) {
			return fail(403, {
				type: 'reorderTechCategories',
				ok: false,
				message: 'Only admins can manage the global technology catalog.'
			});
		}

		const formData = await request.formData();
		const techContextId = parseString(formData.get('tech_context_id'));
		const categoryIds = Array.from(new Set(parseStringArrayField(formData.get('category_ids'))));

		if (categoryIds.length === 0) {
			return fail(400, {
				type: 'reorderTechCategories',
				ok: false,
				message: 'Choose at least one category to reorder.',
				tech_context_id: techContextId
			});
		}

		try {
			const { data: categories, error: lookupError } = await context.adminClient
				.from('tech_categories')
				.select('id')
				.in('id', categoryIds);
			if (lookupError) throw new Error(lookupError.message);
			const foundIds = new Set((categories ?? []).map((category) => category.id));
			if (foundIds.size !== categoryIds.length) {
				return fail(400, {
					type: 'reorderTechCategories',
					ok: false,
					message: 'One or more categories could not be reordered.',
					tech_context_id: techContextId
				});
			}

			await applyTechCategorySortOrder({
				adminClient: context.adminClient,
				categoryIds
			});

			return {
				type: 'reorderTechCategories' as const,
				ok: true as const,
				message: 'Category order updated.',
				tech_context_id: techContextId
			};
		} catch (actionError) {
			return fail(500, {
				type: 'reorderTechCategories',
				ok: false,
				message:
					actionError instanceof Error ? actionError.message : 'Could not reorder categories.',
				tech_context_id: techContextId
			});
		}
	},

	reorderGlobalTechCatalogItems: async ({ request, cookies }) => {
		const context = await getActionContext(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'reorderGlobalTechCatalogItems',
				ok: false,
				message: context.message
			});
		}
		if (!canManageGlobalTechCatalog(context.actor)) {
			return fail(403, {
				type: 'reorderGlobalTechCatalogItems',
				ok: false,
				message: 'Only admins can manage the global technology catalog.'
			});
		}

		const formData = await request.formData();
		const techContextId = parseString(formData.get('tech_context_id'));
		const categoryId = parseString(formData.get('category_id'));
		const itemIds = Array.from(new Set(parseStringArrayField(formData.get('item_ids'))));

		if (!categoryId || itemIds.length === 0) {
			return fail(400, {
				type: 'reorderGlobalTechCatalogItems',
				ok: false,
				message: 'Choose a category and technologies to reorder.',
				tech_context_id: techContextId
			});
		}

		try {
			const { data: items, error: lookupError } = await context.adminClient
				.from('tech_catalog_items')
				.select('id')
				.eq('scope', 'global')
				.is('organisation_id', null)
				.eq('category_id', categoryId)
				.in('id', itemIds);
			if (lookupError) throw new Error(lookupError.message);
			const foundIds = new Set((items ?? []).map((item) => item.id));
			if (foundIds.size !== itemIds.length) {
				return fail(400, {
					type: 'reorderGlobalTechCatalogItems',
					ok: false,
					message: 'One or more global technologies could not be reordered.',
					tech_context_id: techContextId
				});
			}

			await applyTechCatalogItemSortOrder({
				adminClient: context.adminClient,
				itemIds,
				scope: 'global',
				categoryId
			});

			return {
				type: 'reorderGlobalTechCatalogItems' as const,
				ok: true as const,
				message: 'Technology order updated.',
				tech_context_id: techContextId
			};
		} catch (actionError) {
			return fail(500, {
				type: 'reorderGlobalTechCatalogItems',
				ok: false,
				message:
					actionError instanceof Error
						? actionError.message
						: 'Could not reorder global technologies.',
				tech_context_id: techContextId
			});
		}
	},

	reorderOrganisationTechCatalogItems: async ({ request, cookies }) => {
		const context = await getActionContext(cookies);
		if (!context.ok) {
			return fail(context.status, {
				type: 'reorderOrganisationTechCatalogItems',
				ok: false,
				message: context.message
			});
		}

		const formData = await request.formData();
		const techContextId = parseString(formData.get('tech_context_id'));
		const organisationId = normalizeOptionalUuid(formData.get('organisation_id'));
		const categoryId = parseString(formData.get('category_id'));
		const itemIds = Array.from(new Set(parseStringArrayField(formData.get('item_ids'))));

		if (
			organisationId === '__invalid__' ||
			!organisationId ||
			!categoryId ||
			itemIds.length === 0
		) {
			return fail(400, {
				type: 'reorderOrganisationTechCatalogItems',
				ok: false,
				message: 'Choose a valid organisation, category, and technologies to reorder.',
				tech_context_id: techContextId
			});
		}
		if (!canManageOrganisationTechCatalogForContext(context, organisationId)) {
			return fail(403, {
				type: 'reorderOrganisationTechCatalogItems',
				ok: false,
				message: 'You cannot manage that organisation catalog.',
				tech_context_id: techContextId || organisationId
			});
		}

		try {
			const [globalItemsResult, organisationItemsResult] = await Promise.all([
				context.adminClient
					.from('tech_catalog_items')
					.select('id')
					.eq('scope', 'global')
					.is('organisation_id', null)
					.eq('category_id', categoryId)
					.in('id', itemIds),
				context.adminClient
					.from('tech_catalog_items')
					.select('id')
					.eq('scope', 'organisation')
					.eq('organisation_id', organisationId)
					.eq('category_id', categoryId)
					.in('id', itemIds)
			]);
			if (globalItemsResult.error) throw new Error(globalItemsResult.error.message);
			if (organisationItemsResult.error) throw new Error(organisationItemsResult.error.message);
			const foundIds = new Set([
				...(globalItemsResult.data ?? []).map((item) => item.id),
				...(organisationItemsResult.data ?? []).map((item) => item.id)
			]);
			if (foundIds.size !== itemIds.length) {
				return fail(400, {
					type: 'reorderOrganisationTechCatalogItems',
					ok: false,
					message: 'One or more organisation catalog items could not be reordered.',
					tech_context_id: techContextId || organisationId
				});
			}

			await applyOrganisationTechCatalogItemOverrideSortOrder({
				adminClient: context.adminClient,
				itemIds,
				organisationId
			});

			return {
				type: 'reorderOrganisationTechCatalogItems' as const,
				ok: true as const,
				message: 'Organisation catalog order updated.',
				tech_context_id: techContextId || organisationId
			};
		} catch (actionError) {
			return fail(500, {
				type: 'reorderOrganisationTechCatalogItems',
				ok: false,
				message:
					actionError instanceof Error
						? actionError.message
						: 'Could not reorder organisation-specific technologies.',
				tech_context_id: techContextId || organisationId
			});
		}
	}
};
