import type { SupabaseClient, User } from '@supabase/supabase-js';
import { resolveOrganisationMainFont } from '$lib/branding/font';
import {
	DEFAULT_ORGANISATION_BRANDING_THEME,
	resolveOrganisationBrandingTheme,
	type OrganisationBrandingTheme
} from '$lib/branding/theme';
import { normalizeUserSettings } from '$lib/types/userSettings';

export type AppRole = 'admin' | 'organisation_admin' | 'broker' | 'talent' | 'employer';
export type ShareAccessLevel = 'none' | 'read' | 'write';
export type ShareRuleScope =
	| 'none'
	| 'admin'
	| 'own_profile'
	| 'home_organisation'
	| 'organisation_rule'
	| 'talent_rule';

const KNOWN_ROLES = new Set<AppRole>([
	'admin',
	'organisation_admin',
	'broker',
	'talent',
	'employer'
]);
const RAW_ACTOR_CONTEXT_CACHE_TTL_MS = 30_000;

type RoleJoinRow = {
	roles?: { key?: string | null } | Array<{ key?: string | null }> | null;
};

type TemplateRow = {
	organisation_id: string;
	template_key: string | null;
	template_json: unknown;
	template_version: number | null;
	main_logotype_path: string | null;
	accent_logo_path: string | null;
	end_logo_path: string | null;
	organisations?:
		| { homepage_url?: string | null; brand_settings?: unknown }
		| Array<{ homepage_url?: string | null; brand_settings?: unknown }>
		| null;
};

type OrganisationBrandingRow = {
	homepage_url?: string | null;
	brand_settings?: unknown;
};

type OrganisationShareRuleRow = {
	source_organisation_id: string;
	target_organisation_id: string;
	access_level: ShareAccessLevel;
	allow_target_logo_export: boolean | null;
};

type TalentShareRuleRow = OrganisationShareRuleRow & {
	talent_id: string;
};

export type ActorAccessContext = {
	userId: string | null;
	roles: AppRole[];
	primaryRole: AppRole | null;
	assignedRoles: AppRole[];
	assignedPrimaryRole: AppRole | null;
	isAdmin: boolean;
	isOrganisationAdmin: boolean;
	isBroker: boolean;
	isEmployer: boolean;
	isTalent: boolean;
	canToggleAdminMode: boolean;
	adminModeEnabled: boolean;
	homeOrganisationId: string | null;
	accessibleOrganisationIds: string[];
	talentId: string | null;
};

export type EffectiveTalentShare = {
	sourceOrganisationId: string | null;
	targetOrganisationId: string | null;
	accessLevel: ShareAccessLevel;
	allowTargetLogoExport: boolean;
	ruleScope: ShareRuleScope;
};

export type AccessibleTalentAccess = {
	talentId: string;
	accessLevel: ShareAccessLevel;
};

export type TalentAccessResult = {
	exists: boolean;
	talentId: string;
	talentUserId: string | null;
	talentOrganisationId: string | null;
	canView: boolean;
	canEdit: boolean;
	canEditAll: boolean;
	isOwnProfile: boolean;
	effectiveAccessLevel: ShareAccessLevel;
	allowTargetLogoExport: boolean;
};

export type ResumeAccessResult = {
	exists: boolean;
	resumeId: string;
	talentId: string | null;
	talentOrganisationId: string | null;
	canView: boolean;
	canEdit: boolean;
	canEditAll: boolean;
	isOwnProfile: boolean;
	effectiveAccessLevel: ShareAccessLevel;
	allowTargetLogoExport: boolean;
};

export type ResolvedTemplateContext = {
	source: 'target_org' | 'source_org' | 'default';
	organisationId: string | null;
	templateKey: string;
	templateJson: Record<string, unknown>;
	templateVersion: number;
	mainLogotypeUrl: string | null;
	accentLogoUrl: string | null;
	endLogoUrl: string | null;
	homepageUrl: string | null;
	brandingTheme: OrganisationBrandingTheme;
	isPixelCode: boolean;
	mainFontCssStack: string;
	mainFontFaceCss: string | null;
};

export type PrintTemplateMode = 'auto' | 'source' | 'target';

type RawActorContext = {
	userId: string;
	assignedRoles: AppRole[];
	assignedPrimaryRole: AppRole | null;
	homeOrganisationId: string | null;
	sharedSourceOrganisationIds: string[];
	talentId: string | null;
};

type ActorContextCacheEntry = {
	expiresAt: number;
	value: RawActorContext;
};

const actorContextCache = new Map<string, ActorContextCacheEntry>();
const ROLE_PRIORITY: AppRole[] = [
	'admin',
	'organisation_admin',
	'broker',
	'employer',
	'talent'
];

const emptyActorContext = (): ActorAccessContext => ({
	userId: null,
	roles: [],
	primaryRole: null,
	assignedRoles: [],
	assignedPrimaryRole: null,
	isAdmin: false,
	isOrganisationAdmin: false,
	isBroker: false,
	isEmployer: false,
	isTalent: false,
	canToggleAdminMode: false,
	adminModeEnabled: true,
	homeOrganisationId: null,
	accessibleOrganisationIds: [],
	talentId: null
});

const normalizeRole = (value: string | null | undefined): AppRole | null => {
	if (!value) return null;
	const role = value.toLowerCase().replace(/\s+/g, '_');
	if (!KNOWN_ROLES.has(role as AppRole)) return null;
	return role as AppRole;
};

const normalizeShareAccessLevel = (value: string | null | undefined): ShareAccessLevel => {
	if (value === 'read' || value === 'write') return value;
	return 'none';
};

export const normalizeRolesFromJoinRows = (rows: RoleJoinRow[]): AppRole[] =>
	rows
		.flatMap((row) => {
			if (Array.isArray(row.roles)) {
				return row.roles
					.map((roleRow) => normalizeRole(roleRow?.key))
					.filter((role): role is AppRole => role !== null);
			}
			const role = normalizeRole(row.roles?.key);
			return role ? [role] : [];
		})
		.filter((role, index, all) => all.indexOf(role) === index);

const unique = (values: string[]) => {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		const key = value.trim();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(key);
	}
	return out;
};

const sortRolesByPriority = (roles: AppRole[]) => {
	const priorityIndex = new Map(ROLE_PRIORITY.map((role, index) => [role, index]));
	return [...roles].sort(
		(a, b) => (priorityIndex.get(a) ?? ROLE_PRIORITY.length) - (priorityIndex.get(b) ?? ROLE_PRIORITY.length)
	);
};

const resolveAdminModeEnabled = (
	rawContext: RawActorContext,
	requestedAdminModeEnabled: boolean
) => {
	const hasAdminRole = rawContext.assignedRoles.includes('admin');
	const hasNonAdminRole = rawContext.assignedRoles.some((role) => role !== 'admin');
	const canToggleAdminMode =
		hasAdminRole && hasNonAdminRole && typeof rawContext.homeOrganisationId === 'string';

	return {
		canToggleAdminMode,
		adminModeEnabled: canToggleAdminMode ? requestedAdminModeEnabled : true
	};
};

const buildActorAccessContext = (
	rawContext: RawActorContext,
	requestedAdminModeEnabled: boolean
): ActorAccessContext => {
	const { canToggleAdminMode, adminModeEnabled } = resolveAdminModeEnabled(
		rawContext,
		requestedAdminModeEnabled
	);
	const roles = sortRolesByPriority(
		adminModeEnabled
			? rawContext.assignedRoles
			: rawContext.assignedRoles.filter((role) => role !== 'admin')
	);
	const isAdmin = roles.includes('admin');
	const isOrganisationAdmin = roles.includes('organisation_admin');
	const isBroker = roles.includes('broker');
	const isEmployer = roles.includes('employer');
	const isTalent = roles.includes('talent');
	const accessibleOrganisationIds = isAdmin
		? []
		: unique([rawContext.homeOrganisationId ?? '', ...rawContext.sharedSourceOrganisationIds]);

	return {
		userId: rawContext.userId,
		roles,
		primaryRole: roles[0] ?? null,
		assignedRoles: rawContext.assignedRoles,
		assignedPrimaryRole: rawContext.assignedPrimaryRole,
		isAdmin,
		isOrganisationAdmin,
		isBroker,
		isEmployer,
		isTalent,
		canToggleAdminMode,
		adminModeEnabled,
		homeOrganisationId: rawContext.homeOrganisationId,
		accessibleOrganisationIds,
		talentId: rawContext.talentId
	};
};

const parseTemplateJson = (value: unknown): Record<string, unknown> => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return value as Record<string, unknown>;
};

const resolveIsPixelCode = (brandSettings: unknown): boolean => {
	if (!brandSettings || typeof brandSettings !== 'object' || Array.isArray(brandSettings)) {
		return false;
	}
	const value = (brandSettings as Record<string, unknown>).isPixelCode;
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase();
		return normalized === 'true' || normalized === '1';
	}
	if (typeof value === 'number') return value === 1;
	return false;
};

const resolveOrganisation = (
	organisations: TemplateRow['organisations']
): { homepage_url?: string | null; brand_settings?: unknown } | null => {
	if (Array.isArray(organisations)) return organisations[0] ?? null;
	return organisations ?? null;
};

const resolveOrganisationAssetUrl = (
	adminClient: SupabaseClient,
	value: string | null | undefined
) => {
	if (!value || typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (/^https?:\/\//i.test(trimmed)) return trimmed;

	const withNoLeadingSlash = trimmed.replace(/^\/+/, '');
	const objectPath = withNoLeadingSlash.startsWith('organisation-images/')
		? withNoLeadingSlash.slice('organisation-images/'.length)
		: withNoLeadingSlash;
	const { data } = adminClient.storage.from('organisation-images').getPublicUrl(objectPath);
	return data.publicUrl ?? null;
};

const loadSharedSourceOrganisationIds = async (
	adminClient: SupabaseClient,
	targetOrganisationId: string
) => {
	const [orgRulesResult, talentRulesResult] = await Promise.all([
		adminClient
			.from('organisation_share_rules')
			.select('source_organisation_id')
			.eq('target_organisation_id', targetOrganisationId),
		adminClient
			.from('talent_share_rules')
			.select('source_organisation_id, access_level')
			.eq('target_organisation_id', targetOrganisationId)
			.neq('access_level', 'none')
	]);

	const sourceOrganisationIds = [
		...(
			(orgRulesResult.data as Array<{ source_organisation_id?: string | null }> | null) ?? []
		).map((row) =>
			typeof row.source_organisation_id === 'string' ? row.source_organisation_id : null
		),
		...(
			(talentRulesResult.data as Array<{ source_organisation_id?: string | null }> | null) ?? []
		).map((row) =>
			typeof row.source_organisation_id === 'string' ? row.source_organisation_id : null
		)
	].filter((value): value is string => Boolean(value));

	return unique(sourceOrganisationIds);
};

const loadTalentOrganisation = async (adminClient: SupabaseClient, talentId: string) => {
	const { data } = await adminClient
		.from('organisation_talents')
		.select('organisation_id')
		.eq('talent_id', talentId)
		.order('updated_at', { ascending: false })
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();

	return data?.organisation_id ?? null;
};

const resolveEffectiveTalentShare = async (
	adminClient: SupabaseClient | null,
	sourceOrganisationId: string | null,
	targetOrganisationId: string | null,
	talentId: string
): Promise<EffectiveTalentShare> => {
	if (!adminClient || !sourceOrganisationId || !targetOrganisationId) {
		return {
			sourceOrganisationId,
			targetOrganisationId,
			accessLevel: 'none',
			allowTargetLogoExport: false,
			ruleScope: 'none'
		};
	}

	if (sourceOrganisationId === targetOrganisationId) {
		return {
			sourceOrganisationId,
			targetOrganisationId,
			accessLevel: 'write',
			allowTargetLogoExport: false,
			ruleScope: 'home_organisation'
		};
	}

	const [talentRuleResult, organisationRuleResult] = await Promise.all([
		adminClient
			.from('talent_share_rules')
			.select(
				'source_organisation_id, target_organisation_id, talent_id, access_level, allow_target_logo_export'
			)
			.eq('source_organisation_id', sourceOrganisationId)
			.eq('target_organisation_id', targetOrganisationId)
			.eq('talent_id', talentId)
			.maybeSingle(),
		adminClient
			.from('organisation_share_rules')
			.select(
				'source_organisation_id, target_organisation_id, access_level, allow_target_logo_export'
			)
			.eq('source_organisation_id', sourceOrganisationId)
			.eq('target_organisation_id', targetOrganisationId)
			.maybeSingle()
	]);

	const directRule = talentRuleResult.data as TalentShareRuleRow | null;
	if (directRule?.talent_id) {
		return {
			sourceOrganisationId,
			targetOrganisationId,
			accessLevel: normalizeShareAccessLevel(directRule.access_level),
			allowTargetLogoExport: Boolean(directRule.allow_target_logo_export ?? false),
			ruleScope: 'talent_rule'
		};
	}

	const organisationRule = organisationRuleResult.data as OrganisationShareRuleRow | null;
	if (organisationRule?.source_organisation_id) {
		return {
			sourceOrganisationId,
			targetOrganisationId,
			accessLevel: normalizeShareAccessLevel(organisationRule.access_level),
			allowTargetLogoExport: Boolean(organisationRule.allow_target_logo_export ?? false),
			ruleScope: 'organisation_rule'
		};
	}

	return {
		sourceOrganisationId,
		targetOrganisationId,
		accessLevel: 'none',
		allowTargetLogoExport: false,
		ruleScope: 'none'
	};
};

export const getActorAccessContext = async (
	supabase: SupabaseClient | null,
	adminClient: SupabaseClient | null,
	options?: {
		authUser?: User | null;
	}
): Promise<ActorAccessContext> => {
	if (!supabase || !adminClient) {
		return emptyActorContext();
	}

	const authUser =
		options && 'authUser' in options
			? (options.authUser ?? null)
			: (await supabase.auth.getUser()).data.user;

	if (!authUser?.id) {
		return emptyActorContext();
	}

	const userId = authUser.id;
	const now = Date.now();
	const cached = actorContextCache.get(userId);
	const rawContextPromise =
		cached && cached.expiresAt > now
			? Promise.resolve(cached.value)
			: (async () => {
					const [roleResult, homeOrgResult, ownTalentResult] = await Promise.all([
						adminClient.from('user_roles').select('roles(key)').eq('user_id', userId),
						adminClient
							.from('organisation_users')
							.select('organisation_id')
							.eq('user_id', userId)
							.order('updated_at', { ascending: false })
							.order('created_at', { ascending: false })
							.limit(1)
							.maybeSingle(),
						adminClient.from('talents').select('id').eq('user_id', userId).limit(1).maybeSingle()
					]);

					const rolesFromTable = normalizeRolesFromJoinRows(
						(roleResult.data as RoleJoinRow[] | null) ?? []
					);
					const rolesFromMetadata = (
						Array.isArray(authUser.app_metadata?.roles)
							? (authUser.app_metadata.roles as string[])
							: typeof authUser.app_metadata?.role === 'string'
								? [authUser.app_metadata.role as string]
								: []
					)
						.map((value) => normalizeRole(value))
						.filter((role): role is AppRole => role !== null);
					const assignedRoles = sortRolesByPriority(
						Array.from(new Set([...rolesFromTable, ...rolesFromMetadata]))
					);
					const homeOrganisationId = homeOrgResult.data?.organisation_id ?? null;
					const sharedSourceOrganisationIds =
						homeOrganisationId &&
						(assignedRoles.includes('broker') || assignedRoles.includes('employer'))
							? await loadSharedSourceOrganisationIds(adminClient, homeOrganisationId)
							: [];

					const value: RawActorContext = {
						userId,
						assignedRoles,
						assignedPrimaryRole: assignedRoles[0] ?? null,
						homeOrganisationId,
						sharedSourceOrganisationIds,
						talentId: ownTalentResult.data?.id ?? null
					};
					actorContextCache.set(userId, {
						expiresAt: now + RAW_ACTOR_CONTEXT_CACHE_TTL_MS,
						value
					});
					return value;
				})();

	const requestedAdminModePromise = adminClient
		.from('user_settings')
		.select('settings')
		.eq('user_id', userId)
		.maybeSingle()
		.then((result) => {
			if (result.error) {
				console.warn('[access] could not resolve user settings', result.error);
				return true;
			}
			return normalizeUserSettings(result.data?.settings).roleMode.adminEnabled;
		});

	const [rawContext, requestedAdminModeEnabled] = await Promise.all([
		rawContextPromise,
		requestedAdminModePromise
	]);

	return buildActorAccessContext(rawContext, requestedAdminModeEnabled);
};

export const getAccessibleTalentAccess = async (
	adminClient: SupabaseClient | null,
	context: ActorAccessContext
): Promise<AccessibleTalentAccess[] | null> => {
	if (!adminClient || !context.userId) return [];
	if (context.isAdmin) return null;

	if (!(context.isBroker || context.isEmployer) || !context.homeOrganisationId) {
		return context.talentId ? [{ talentId: context.talentId, accessLevel: 'write' }] : [];
	}

	const [homeTalentRowsResult, organisationRuleRowsResult, talentRuleRowsResult] =
		await Promise.all([
			adminClient
				.from('organisation_talents')
				.select('talent_id')
				.eq('organisation_id', context.homeOrganisationId),
			adminClient
				.from('organisation_share_rules')
				.select(
					'source_organisation_id, target_organisation_id, access_level, allow_target_logo_export'
				)
				.eq('target_organisation_id', context.homeOrganisationId),
			adminClient
				.from('talent_share_rules')
				.select(
					'source_organisation_id, target_organisation_id, talent_id, access_level, allow_target_logo_export'
				)
				.eq('target_organisation_id', context.homeOrganisationId)
		]);

	const homeTalentIds = (
		(homeTalentRowsResult.data as Array<{ talent_id?: string | null }> | null) ?? []
	)
		.map((row) => (typeof row.talent_id === 'string' ? row.talent_id : null))
		.filter((value): value is string => value !== null);

	const organisationRuleRows =
		(organisationRuleRowsResult.data as OrganisationShareRuleRow[] | null) ?? [];
	const talentRuleRows = (talentRuleRowsResult.data as TalentShareRuleRow[] | null) ?? [];

	const sharedSourceOrganisationIds = unique(
		organisationRuleRows
			.map((row) =>
				typeof row.source_organisation_id === 'string' ? row.source_organisation_id : null
			)
			.filter((value): value is string => Boolean(value))
	);

	const organisationTalentsResult =
		sharedSourceOrganisationIds.length === 0
			? {
					data: [] as Array<{ talent_id: string; organisation_id: string }>,
					error: null
				}
			: await adminClient
					.from('organisation_talents')
					.select('talent_id, organisation_id')
					.in('organisation_id', sharedSourceOrganisationIds);

	const organisationTalents = (
		(organisationTalentsResult.data as Array<{
			talent_id?: string | null;
			organisation_id?: string | null;
		}> | null) ?? []
	)
		.map((row) => ({
			talentId: typeof row.talent_id === 'string' ? row.talent_id : null,
			organisationId: typeof row.organisation_id === 'string' ? row.organisation_id : null
		}))
		.filter(
			(row): row is { talentId: string; organisationId: string } =>
				row.talentId !== null && row.organisationId !== null
		);

	const orgRuleBySourceOrganisationId = new Map<string, OrganisationShareRuleRow>();
	for (const row of organisationRuleRows) {
		if (!row.source_organisation_id) continue;
		orgRuleBySourceOrganisationId.set(row.source_organisation_id, row);
	}

	const accessByTalentId = new Map<string, ShareAccessLevel>();

	for (const talentId of homeTalentIds) {
		accessByTalentId.set(talentId, 'write');
	}

	for (const membership of organisationTalents) {
		const rule = orgRuleBySourceOrganisationId.get(membership.organisationId);
		if (!rule) continue;
		accessByTalentId.set(membership.talentId, normalizeShareAccessLevel(rule.access_level));
	}

	for (const row of talentRuleRows) {
		if (!row.talent_id) continue;
		accessByTalentId.set(row.talent_id, normalizeShareAccessLevel(row.access_level));
	}

	if (context.talentId) {
		accessByTalentId.set(context.talentId, 'write');
	}

	return Array.from(
		Array.from(accessByTalentId.entries())
			.filter(([, accessLevel]) => accessLevel !== 'none')
			.map(([talentId, accessLevel]) => ({
				talentId,
				accessLevel
			}))
	);
};

export const getAccessibleTalentIds = async (
	adminClient: SupabaseClient | null,
	context: ActorAccessContext
): Promise<string[] | null> => {
	const accessEntries = await getAccessibleTalentAccess(adminClient, context);
	if (accessEntries === null) return null;

	return unique(accessEntries.map((entry) => entry.talentId));
};

export const getTalentAccess = async (
	adminClient: SupabaseClient | null,
	context: ActorAccessContext,
	talentId: string
): Promise<TalentAccessResult> => {
	if (!adminClient || !context.userId || !talentId) {
		return {
			exists: false,
			talentId,
			talentUserId: null,
			talentOrganisationId: null,
			canView: false,
			canEdit: false,
			canEditAll: false,
			isOwnProfile: false,
			effectiveAccessLevel: 'none',
			allowTargetLogoExport: false
		};
	}

	const [talentResult, talentOrganisationId] = await Promise.all([
		adminClient.from('talents').select('id, user_id').eq('id', talentId).maybeSingle(),
		loadTalentOrganisation(adminClient, talentId)
	]);

	if (!talentResult.data?.id) {
		return {
			exists: false,
			talentId,
			talentUserId: null,
			talentOrganisationId: null,
			canView: false,
			canEdit: false,
			canEditAll: false,
			isOwnProfile: false,
			effectiveAccessLevel: 'none',
			allowTargetLogoExport: false
		};
	}

	const talentUserId = talentResult.data.user_id ?? null;
	const isOwnProfile = Boolean(talentUserId && talentUserId === context.userId);

	if (context.isAdmin) {
		return {
			exists: true,
			talentId,
			talentUserId,
			talentOrganisationId,
			canView: true,
			canEdit: true,
			canEditAll: true,
			isOwnProfile,
			effectiveAccessLevel: 'write',
			allowTargetLogoExport: false
		};
	}

	if (isOwnProfile) {
		return {
			exists: true,
			talentId,
			talentUserId,
			talentOrganisationId,
			canView: true,
			canEdit: true,
			canEditAll: true,
			isOwnProfile: true,
			effectiveAccessLevel: 'write',
			allowTargetLogoExport: false
		};
	}

	let effectiveShare: EffectiveTalentShare = {
		sourceOrganisationId: talentOrganisationId,
		targetOrganisationId: context.homeOrganisationId,
		accessLevel: 'none',
		allowTargetLogoExport: false,
		ruleScope: 'none'
	};

	if (
		(context.isBroker || context.isEmployer) &&
		talentOrganisationId &&
		context.homeOrganisationId
	) {
		effectiveShare = await resolveEffectiveTalentShare(
			adminClient,
			talentOrganisationId,
			context.homeOrganisationId,
			talentId
		);
	}

	const canView = effectiveShare.accessLevel !== 'none';
	const canEdit = effectiveShare.accessLevel === 'write';

	return {
		exists: true,
		talentId,
		talentUserId,
		talentOrganisationId,
		canView,
		canEdit,
		canEditAll: canEdit,
		isOwnProfile: false,
		effectiveAccessLevel: effectiveShare.accessLevel,
		allowTargetLogoExport: effectiveShare.allowTargetLogoExport
	};
};

export const getResumeAccess = async (
	adminClient: SupabaseClient | null,
	context: ActorAccessContext,
	resumeId: string
): Promise<ResumeAccessResult> => {
	if (!adminClient || !resumeId) {
		return {
			exists: false,
			resumeId,
			talentId: null,
			talentOrganisationId: null,
			canView: false,
			canEdit: false,
			canEditAll: false,
			isOwnProfile: false,
			effectiveAccessLevel: 'none',
			allowTargetLogoExport: false
		};
	}

	const { data: resumeRow } = await adminClient
		.from('resumes')
		.select('id, talent_id')
		.eq('id', resumeId)
		.maybeSingle();

	if (!resumeRow?.talent_id) {
		return {
			exists: false,
			resumeId,
			talentId: null,
			talentOrganisationId: null,
			canView: false,
			canEdit: false,
			canEditAll: false,
			isOwnProfile: false,
			effectiveAccessLevel: 'none',
			allowTargetLogoExport: false
		};
	}

	const talentAccess = await getTalentAccess(adminClient, context, resumeRow.talent_id);
	return {
		exists: true,
		resumeId,
		talentId: resumeRow.talent_id,
		talentOrganisationId: talentAccess.talentOrganisationId,
		canView: talentAccess.canView,
		canEdit: talentAccess.canEdit,
		canEditAll: talentAccess.canEditAll,
		isOwnProfile: talentAccess.isOwnProfile,
		effectiveAccessLevel: talentAccess.effectiveAccessLevel,
		allowTargetLogoExport: talentAccess.allowTargetLogoExport
	};
};

const getTemplateForOrganisation = async (
	adminClient: SupabaseClient,
	organisationId: string
): Promise<TemplateRow | null> => {
	const { data } = await adminClient
		.from('organisation_templates')
		.select(
			'organisation_id, template_key, template_json, template_version, main_logotype_path, accent_logo_path, end_logo_path, organisations(homepage_url, brand_settings)'
		)
		.eq('organisation_id', organisationId)
		.maybeSingle();

	if (data) {
		return data as TemplateRow;
	}

	const { data: organisationData } = await adminClient
		.from('organisations')
		.select('homepage_url, brand_settings')
		.eq('id', organisationId)
		.maybeSingle();

	if (!organisationData) {
		return null;
	}

	return {
		organisation_id: organisationId,
		template_key: null,
		template_json: null,
		template_version: null,
		main_logotype_path: null,
		accent_logo_path: null,
		end_logo_path: null,
		organisations: organisationData as OrganisationBrandingRow
	};
};

const mapTemplateContext = (
	adminClient: SupabaseClient,
	source: ResolvedTemplateContext['source'],
	row: TemplateRow | null,
	organisationId: string | null
): ResolvedTemplateContext => {
	const organisation = resolveOrganisation(row?.organisations);
	const brandingTheme = resolveOrganisationBrandingTheme(organisation?.brand_settings ?? null);
	const isPixelCode = resolveIsPixelCode(organisation?.brand_settings ?? null);
	const mainFont = resolveOrganisationMainFont(organisation?.brand_settings ?? null, {
		pathToUrl: (path) => resolveOrganisationAssetUrl(adminClient, path)
	});
	return {
		source,
		organisationId,
		templateKey: row?.template_key ?? 'default',
		templateJson: parseTemplateJson(row?.template_json),
		templateVersion: row?.template_version ?? 1,
		mainLogotypeUrl: resolveOrganisationAssetUrl(adminClient, row?.main_logotype_path),
		accentLogoUrl: resolveOrganisationAssetUrl(adminClient, row?.accent_logo_path),
		endLogoUrl: resolveOrganisationAssetUrl(adminClient, row?.end_logo_path),
		homepageUrl: organisation?.homepage_url ?? null,
		brandingTheme,
		isPixelCode,
		mainFontCssStack: mainFont.cssStack,
		mainFontFaceCss: mainFont.fontFaceCss
	};
};

const buildDefaultTemplateContext = (): ResolvedTemplateContext => {
	const mainFont = resolveOrganisationMainFont(null);
	return {
		source: 'default',
		organisationId: null,
		templateKey: 'default',
		templateJson: {},
		templateVersion: 1,
		mainLogotypeUrl: null,
		accentLogoUrl: null,
		endLogoUrl: null,
		homepageUrl: null,
		brandingTheme: DEFAULT_ORGANISATION_BRANDING_THEME,
		isPixelCode: false,
		mainFontCssStack: mainFont.cssStack,
		mainFontFaceCss: null
	};
};

export const resolveOrganisationTemplateContext = async (
	adminClient: SupabaseClient | null,
	organisationId: string | null,
	options?: {
		source?: ResolvedTemplateContext['source'];
	}
): Promise<ResolvedTemplateContext> => {
	if (!adminClient || !organisationId) {
		return buildDefaultTemplateContext();
	}

	const row = await getTemplateForOrganisation(adminClient, organisationId);
	return mapTemplateContext(adminClient, options?.source ?? 'source_org', row, organisationId);
};

export const resolvePrintTemplateContext = async (
	adminClient: SupabaseClient | null,
	context: ActorAccessContext,
	talentId: string,
	options?: {
		templateMode?: PrintTemplateMode;
	}
): Promise<ResolvedTemplateContext> => {
	if (!adminClient) {
		return buildDefaultTemplateContext();
	}

	const templateMode = options?.templateMode ?? 'auto';
	const talentOrganisationId = await loadTalentOrganisation(adminClient, talentId);

	const loadSourceTemplate = async () => {
		if (!talentOrganisationId) return buildDefaultTemplateContext();
		const sourceTemplate = await getTemplateForOrganisation(adminClient, talentOrganisationId);
		return mapTemplateContext(adminClient, 'source_org', sourceTemplate, talentOrganisationId);
	};

	const loadTargetTemplate = async () => {
		if (!context.homeOrganisationId) return loadSourceTemplate();
		const targetTemplate = await getTemplateForOrganisation(
			adminClient,
			context.homeOrganisationId
		);
		return mapTemplateContext(
			adminClient,
			'target_org',
			targetTemplate,
			context.homeOrganisationId
		);
	};

	if (templateMode === 'source') {
		return loadSourceTemplate();
	}

	if (templateMode === 'target') {
		return loadTargetTemplate();
	}

	if (
		(context.isBroker || context.isEmployer) &&
		talentOrganisationId &&
		context.homeOrganisationId &&
		talentOrganisationId !== context.homeOrganisationId
	) {
		const effectiveShare = await resolveEffectiveTalentShare(
			adminClient,
			talentOrganisationId,
			context.homeOrganisationId,
			talentId
		);
		if (effectiveShare.accessLevel !== 'none' && effectiveShare.allowTargetLogoExport) {
			return loadTargetTemplate();
		}
	}

	return loadSourceTemplate();
};
