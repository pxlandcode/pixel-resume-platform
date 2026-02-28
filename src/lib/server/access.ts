import type { SupabaseClient } from '@supabase/supabase-js';

export type AppRole = 'admin' | 'broker' | 'talent' | 'employer';

const KNOWN_ROLES = new Set<AppRole>(['admin', 'broker', 'talent', 'employer']);

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
	organisations?: { homepage_url?: string | null } | Array<{ homepage_url?: string | null }> | null;
};

export type ActorAccessContext = {
	userId: string | null;
	roles: AppRole[];
	primaryRole: AppRole | null;
	isAdmin: boolean;
	isBroker: boolean;
	isEmployer: boolean;
	isTalent: boolean;
	homeOrganisationId: string | null;
	accessibleOrganisationIds: string[];
	talentId: string | null;
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
};

export type ResolvedTemplateContext = {
	source: 'broker_home_org' | 'talent_org' | 'default';
	organisationId: string | null;
	templateKey: string;
	templateJson: Record<string, unknown>;
	templateVersion: number;
	mainLogotypeUrl: string | null;
	accentLogoUrl: string | null;
	endLogoUrl: string | null;
	homepageUrl: string | null;
};

const normalizeRole = (value: string | null | undefined): AppRole | null => {
	if (!value) return null;
	const role = value.toLowerCase().replace(/\s+/g, '_');
	if (!KNOWN_ROLES.has(role as AppRole)) return null;
	return role as AppRole;
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

const parseTemplateJson = (value: unknown): Record<string, unknown> => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return value as Record<string, unknown>;
};

const resolveOrganisation = (
	organisations: TemplateRow['organisations']
): { homepage_url?: string | null } | null => {
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

export const getActorAccessContext = async (
	supabase: SupabaseClient | null,
	adminClient: SupabaseClient | null
): Promise<ActorAccessContext> => {
	if (!supabase || !adminClient) {
		return {
			userId: null,
			roles: [],
			primaryRole: null,
			isAdmin: false,
			isBroker: false,
			isEmployer: false,
			isTalent: false,
			homeOrganisationId: null,
			accessibleOrganisationIds: [],
			talentId: null
		};
	}

	const {
		data: { user }
	} = await supabase.auth.getUser();
	const authUser = user;

	if (!authUser?.id) {
		return {
			userId: null,
			roles: [],
			primaryRole: null,
			isAdmin: false,
			isBroker: false,
			isEmployer: false,
			isTalent: false,
			homeOrganisationId: null,
			accessibleOrganisationIds: [],
			talentId: null
		};
	}
	const userId = authUser.id;

	const [roleResult, homeOrgResult, grantsResult, ownTalentResult] = await Promise.all([
		adminClient.from('user_roles').select('roles(key)').eq('user_id', userId),
		adminClient
			.from('organisation_users')
			.select('organisation_id')
			.eq('user_id', userId)
			.order('updated_at', { ascending: false })
			.order('created_at', { ascending: false })
			.limit(1)
			.maybeSingle(),
		adminClient
			.from('organisation_access_grants')
			.select('organisation_id')
			.eq('grantee_user_id', userId),
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

	const roles = Array.from(new Set([...rolesFromTable, ...rolesFromMetadata]));
	const isAdmin = roles.includes('admin');
	const isBroker = roles.includes('broker');
	const isEmployer = roles.includes('employer');
	const isTalent = roles.includes('talent');
	const homeOrganisationId = homeOrgResult.data?.organisation_id ?? null;
	const grantOrgIds =
		(grantsResult.data as Array<{ organisation_id?: string | null }> | null)
			?.map((row) => (typeof row.organisation_id === 'string' ? row.organisation_id : null))
			.filter((value): value is string => value !== null) ?? [];
	const accessibleOrganisationIds = isAdmin
		? []
		: unique([homeOrganisationId ?? '', ...(isBroker || isEmployer ? grantOrgIds : [])]);

	return {
		userId,
		roles,
		primaryRole: roles[0] ?? null,
		isAdmin,
		isBroker,
		isEmployer,
		isTalent,
		homeOrganisationId,
		accessibleOrganisationIds,
		talentId: ownTalentResult.data?.id ?? null
	};
};

export const getAccessibleTalentIds = async (
	adminClient: SupabaseClient | null,
	context: ActorAccessContext
): Promise<string[] | null> => {
	if (!adminClient || !context.userId) return [];
	if (context.isAdmin) return null;

	const orgIds = context.accessibleOrganisationIds;
	const canUseOrgScope = context.isBroker || context.isEmployer;
	const fromOrgMemberships =
		!canUseOrgScope || orgIds.length === 0
			? []
			: (((
					await adminClient
						.from('organisation_talents')
						.select('talent_id')
						.in('organisation_id', orgIds)
				).data as Array<{ talent_id?: string | null }> | null) ?? []);

	const talentIds = fromOrgMemberships
		.map((row) => (typeof row.talent_id === 'string' ? row.talent_id : null))
		.filter((value): value is string => value !== null);

	if (context.talentId) {
		talentIds.push(context.talentId);
	}

	return unique(talentIds);
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
			isOwnProfile: false
		};
	}

	const [talentResult, orgMembershipResult] = await Promise.all([
		adminClient.from('talents').select('id, user_id').eq('id', talentId).maybeSingle(),
		adminClient
			.from('organisation_talents')
			.select('organisation_id')
			.eq('talent_id', talentId)
			.order('updated_at', { ascending: false })
			.order('created_at', { ascending: false })
			.limit(1)
			.maybeSingle()
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
			isOwnProfile: false
		};
	}

	const talentUserId = talentResult.data.user_id ?? null;
	const talentOrganisationId = orgMembershipResult.data?.organisation_id ?? null;
	const isOwnProfile = Boolean(talentUserId && talentUserId === context.userId);
	const canUseOrgScope = context.isAdmin || context.isBroker || context.isEmployer;
	const orgAccessible = Boolean(
		talentOrganisationId &&
			canUseOrgScope &&
			(context.isAdmin || context.accessibleOrganisationIds.includes(talentOrganisationId))
	);
	const canView = context.isAdmin || isOwnProfile || orgAccessible;
	const canEdit =
		context.isAdmin || isOwnProfile || ((context.isBroker || context.isEmployer) && orgAccessible);

	return {
		exists: true,
		talentId,
		talentUserId,
		talentOrganisationId,
		canView,
		canEdit,
		canEditAll: context.isAdmin || context.isBroker || context.isEmployer,
		isOwnProfile
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
			isOwnProfile: false
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
			isOwnProfile: false
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
		isOwnProfile: talentAccess.isOwnProfile
	};
};

const getTemplateForOrganisation = async (
	adminClient: SupabaseClient,
	organisationId: string
): Promise<TemplateRow | null> => {
	const { data } = await adminClient
		.from('organisation_templates')
		.select(
			'organisation_id, template_key, template_json, template_version, main_logotype_path, accent_logo_path, end_logo_path, organisations(homepage_url)'
		)
		.eq('organisation_id', organisationId)
		.maybeSingle();
	return (data as TemplateRow | null) ?? null;
};

const mapTemplateContext = (
	adminClient: SupabaseClient,
	source: ResolvedTemplateContext['source'],
	row: TemplateRow | null,
	organisationId: string | null
): ResolvedTemplateContext => {
	const organisation = resolveOrganisation(row?.organisations);
	return {
		source,
		organisationId,
		templateKey: row?.template_key ?? 'default',
		templateJson: parseTemplateJson(row?.template_json),
		templateVersion: row?.template_version ?? 1,
		mainLogotypeUrl: resolveOrganisationAssetUrl(adminClient, row?.main_logotype_path),
		accentLogoUrl: resolveOrganisationAssetUrl(adminClient, row?.accent_logo_path),
		endLogoUrl: resolveOrganisationAssetUrl(adminClient, row?.end_logo_path),
		homepageUrl: organisation?.homepage_url ?? null
	};
};

export const resolvePrintTemplateContext = async (
	adminClient: SupabaseClient | null,
	context: ActorAccessContext,
	talentId: string
): Promise<ResolvedTemplateContext> => {
	if (!adminClient) {
		return {
			source: 'default',
			organisationId: null,
			templateKey: 'default',
			templateJson: {},
			templateVersion: 1,
			mainLogotypeUrl: null,
			accentLogoUrl: null,
			endLogoUrl: null,
			homepageUrl: null
		};
	}

	const { data: talentOrgRow } = await adminClient
		.from('organisation_talents')
		.select('organisation_id')
		.eq('talent_id', talentId)
		.order('updated_at', { ascending: false })
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();

	const talentOrganisationId = talentOrgRow?.organisation_id ?? null;

	if (context.isBroker) {
		if (!context.homeOrganisationId) {
			return {
				source: 'default',
				organisationId: null,
				templateKey: 'default',
				templateJson: {},
				templateVersion: 1,
				mainLogotypeUrl: null,
				accentLogoUrl: null,
				endLogoUrl: null,
				homepageUrl: null
			};
		}
		const brokerTemplate = await getTemplateForOrganisation(
			adminClient,
			context.homeOrganisationId
		);
		return mapTemplateContext(
			adminClient,
			'broker_home_org',
			brokerTemplate,
			context.homeOrganisationId
		);
	}

	if (talentOrganisationId) {
		const talentOrgTemplate = await getTemplateForOrganisation(adminClient, talentOrganisationId);
		return mapTemplateContext(adminClient, 'talent_org', talentOrgTemplate, talentOrganisationId);
	}

	return {
		source: 'default',
		organisationId: null,
		templateKey: 'default',
		templateJson: {},
		templateVersion: 1,
		mainLogotypeUrl: null,
		accentLogoUrl: null,
		endLogoUrl: null,
		homepageUrl: null
	};
};
