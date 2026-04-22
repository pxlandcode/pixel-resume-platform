import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { assertAcceptedForSensitiveAction } from '$lib/server/legalGate';
import { invalidateOrganisationContextCache } from '$lib/server/organisationContextCache';
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

	const canManageOrg = actor.isAdmin || actor.isOrganisationAdmin;
	if (!canManageOrg || !actor.homeOrganisationId) {
		throw error(403, 'You do not have a home organisation to manage.');
	}

	const organisationId = actor.homeOrganisationId;

	const { data: organisation, error: orgError } = await adminClient
		.from('organisations')
		.select('id, name, slug, homepage_url, brand_settings, created_at, updated_at')
		.eq('id', organisationId)
		.maybeSingle();

	if (orgError) throw error(500, orgError.message);
	if (!organisation) throw error(404, 'Organisation not found.');

	let emailDomains: string[] = [];
	try {
		const domainMap = await loadOrganisationEmailDomains(adminClient, [organisationId]);
		emailDomains = domainMap.get(organisationId) ?? [];
	} catch (domainError) {
		throw error(
			domainError instanceof OrganisationEmailDomainError ? domainError.status : 500,
			domainError instanceof OrganisationEmailDomainError
				? domainError.message
				: 'Could not load email domains.'
		);
	}

	return {
		organisation: {
			...organisation,
			email_domains: emailDomains
		}
	};
};

const ensureOrgManager = async (
	cookies: { get(name: string): string | undefined },
	formData: FormData
) => {
	const orgId = formData.get('organisation_id');
	const targetOrgId = typeof orgId === 'string' ? orgId : undefined;
	return ensureOrgManagerContext(cookies, targetOrgId);
};

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
			isRecordWithStatus(legalError) && typeof legalError.status === 'number' ? legalError.status : 403;
		const message =
			legalError instanceof Error
				? legalError.message
				: 'You must accept the latest legal documents before continuing.';
		return { status, message };
	}
};

const isRecordWithStatus = (value: unknown): value is { status?: unknown } =>
	typeof value === 'object' && value !== null;

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

export const actions: Actions = {
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
			return fail(context.status, { type: 'connectUserHome', ok: false, message: context.message });
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
			const status =
				actionError instanceof TalentLabelServiceError ? actionError.status : 500;
			return failTalentLabelAction({
				status,
				type: 'createTalentLabelDefinition',
				message:
					actionError instanceof Error ? actionError.message : 'Could not create label.'
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
			const status =
				actionError instanceof TalentLabelServiceError ? actionError.status : 500;
			return failTalentLabelAction({
				status,
				type: 'updateTalentLabelDefinition',
				message:
					actionError instanceof Error ? actionError.message : 'Could not update label.'
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
			const status =
				actionError instanceof TalentLabelServiceError ? actionError.status : 500;
			return failTalentLabelAction({
				status,
				type: 'deleteTalentLabelDefinition',
				message:
					actionError instanceof Error ? actionError.message : 'Could not delete label.'
			});
		}
	}
};
