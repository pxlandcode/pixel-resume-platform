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

export const load: PageServerLoad = async ({ locals }) => {
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

	const [legalDocumentsResult, sharingData] = await Promise.all([
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
		})
	]);

	if (legalDocumentsResult.error) {
		throw error(500, legalDocumentsResult.error.message);
	}

	return {
		canManageLegalDocuments: isAdmin,
		canManageSharing: sharingEnabled,
		homeOrganisationId: actor.homeOrganisationId ?? null,
		legalDocuments: legalDocumentsResult.data ?? [],
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
	}
};
