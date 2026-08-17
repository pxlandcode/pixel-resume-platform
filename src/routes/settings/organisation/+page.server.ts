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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

type OrganisationRow = {
	id: string;
	name: string;
	slug: string;
	homepage_url: string | null;
	brand_settings: Record<string, unknown> | null;
	created_at: string | null;
	updated_at: string | null;
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

	const canManageOrg = actor.isAdmin || actor.isOrganisationAdmin;
	if (!canManageOrg) {
		throw error(403, 'You do not have a home organisation to manage.');
	}

	const organisationRowsResult = actor.isAdmin
		? await adminClient
				.from('organisations')
				.select('id, name, slug, homepage_url, brand_settings, created_at, updated_at')
				.order('name', { ascending: true })
		: actor.homeOrganisationId
			? await adminClient
					.from('organisations')
					.select('id, name, slug, homepage_url, brand_settings, created_at, updated_at')
					.eq('id', actor.homeOrganisationId)
			: {
					data: [] as OrganisationRow[],
					error: null
				};

	if (organisationRowsResult.error) throw error(500, organisationRowsResult.error.message);

	const organisationRows = ((organisationRowsResult.data ?? []) as OrganisationRow[]).filter(
		(organisation) => typeof organisation.id === 'string' && typeof organisation.name === 'string'
	);
	const organisationOptions = organisationRows.map((organisation) => ({
		id: organisation.id,
		name: organisation.name
	}));

	if (organisationOptions.length === 0) {
		throw error(
			actor.isAdmin ? 404 : 403,
			actor.isAdmin ? 'No organisations found.' : 'You do not have a home organisation to manage.'
		);
	}

	const requestedOrganisationId = url.searchParams.get('org')?.trim() ?? '';
	const requestedOrganisationIsSelectable =
		UUID_REGEX.test(requestedOrganisationId) &&
		organisationOptions.some((organisation) => organisation.id === requestedOrganisationId);
	const homeOrganisationIsSelectable =
		actor.homeOrganisationId &&
		organisationOptions.some((organisation) => organisation.id === actor.homeOrganisationId);
	const organisationId =
		(requestedOrganisationIsSelectable
			? requestedOrganisationId
			: homeOrganisationIsSelectable
				? actor.homeOrganisationId
				: organisationOptions[0]?.id) ?? null;
	if (!organisationId) throw error(404, 'Organisation not found.');

	const organisation = organisationRows.find((row) => row.id === organisationId);
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
		},
		organisationOptions,
		selectedOrganisationId: organisationId,
		canSelectOrganisation: actor.isAdmin,
		roles: actor.roles
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
	context: Extract<Awaited<ReturnType<typeof ensureOrgManager>>, { ok: true }>,
	organisationId?: string | null
) => {
	try {
		await assertAcceptedForSensitiveAction({
			adminClient: context.adminClient,
			userId: context.actor.userId,
			homeOrganisationId: organisationId ?? context.actor.homeOrganisationId
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

const isRecordWithStatus = (value: unknown): value is { status?: unknown } =>
	typeof value === 'object' && value !== null;

const failTalentLabelAction = (payload: {
	status: number;
	type:
		| 'createTalentLabelDefinition'
		| 'updateTalentLabelDefinition'
		| 'deleteTalentLabelDefinition';
	message: string;
	organisationId?: string | null;
}) =>
	fail(payload.status, {
		type: payload.type,
		ok: false,
		message: payload.message,
		organisation_id: payload.organisationId ?? null
	});

const parseSubmittedOrganisationId = (formData: FormData) => {
	const organisationId = formData.get('organisation_id');
	return typeof organisationId === 'string' && UUID_REGEX.test(organisationId)
		? organisationId
		: null;
};

const withSubmittedOrganisationId = <T>(result: T, organisationId: string | null): T => {
	if (!organisationId || !result || typeof result !== 'object') return result;
	if ('data' in result) {
		const resultWithData = result as { data?: unknown };
		if (
			resultWithData.data &&
			typeof resultWithData.data === 'object' &&
			!Array.isArray(resultWithData.data)
		) {
			(resultWithData.data as Record<string, unknown>).organisation_id = organisationId;
		}
		return result;
	}
	return { ...(result as Record<string, unknown>), organisation_id: organisationId } as T;
};

export const actions: Actions = {
	updateOrganisation: async ({ request, cookies }) => {
		const formData = await request.formData();
		const organisationId = parseSubmittedOrganisationId(formData);
		const context = await ensureOrgManager(cookies, formData);
		if (!context.ok) {
			return fail(context.status, {
				type: 'updateOrganisation',
				ok: false,
				message: context.message,
				organisation_id: organisationId
			});
		}
		return withSubmittedOrganisationId(
			await handleUpdateOrganisation(formData, context),
			organisationId
		);
	},

	updateOrganisationBranding: async ({ request, cookies }) => {
		const formData = await request.formData();
		const organisationId = parseSubmittedOrganisationId(formData);
		const context = await ensureOrgManager(cookies, formData);
		if (!context.ok) {
			return fail(context.status, {
				type: 'updateOrganisationBranding',
				ok: false,
				message: context.message,
				organisation_id: organisationId
			});
		}
		return withSubmittedOrganisationId(
			await handleUpdateOrganisationBranding(formData, context),
			organisationId
		);
	},

	updateOrganisationTemplate: async ({ request, cookies }) => {
		const formData = await request.formData();
		const organisationId = parseSubmittedOrganisationId(formData);
		const context = await ensureOrgManager(cookies, formData);
		if (!context.ok) {
			return fail(context.status, {
				type: 'updateOrganisationTemplate',
				ok: false,
				message: context.message,
				organisation_id: organisationId
			});
		}
		return withSubmittedOrganisationId(
			await handleUpdateOrganisationTemplate(formData, context),
			organisationId
		);
	},

	connectUserHome: async ({ request, cookies }) => {
		const formData = await request.formData();
		const organisationId = parseSubmittedOrganisationId(formData);
		const context = await ensureOrgManager(cookies, formData);
		if (!context.ok) {
			return fail(context.status, {
				type: 'connectUserHome',
				ok: false,
				message: context.message,
				organisation_id: organisationId
			});
		}
		return withSubmittedOrganisationId(
			await handleConnectUserHome(formData, context),
			organisationId
		);
	},

	disconnectUserHome: async ({ request, cookies }) => {
		const formData = await request.formData();
		const organisationId = parseSubmittedOrganisationId(formData);
		const context = await ensureOrgManager(cookies, formData);
		if (!context.ok) {
			return fail(context.status, {
				type: 'disconnectUserHome',
				ok: false,
				message: context.message,
				organisation_id: organisationId
			});
		}
		return withSubmittedOrganisationId(
			await handleDisconnectUserHome(formData, context),
			organisationId
		);
	},

	connectTalentHome: async ({ request, cookies }) => {
		const formData = await request.formData();
		const organisationId = parseSubmittedOrganisationId(formData);
		const context = await ensureOrgManager(cookies, formData);
		if (!context.ok) {
			return fail(context.status, {
				type: 'connectTalentHome',
				ok: false,
				message: context.message,
				organisation_id: organisationId
			});
		}
		return withSubmittedOrganisationId(
			await handleConnectTalentHome(formData, context),
			organisationId
		);
	},

	disconnectTalentHome: async ({ request, cookies }) => {
		const formData = await request.formData();
		const organisationId = parseSubmittedOrganisationId(formData);
		const context = await ensureOrgManager(cookies, formData);
		if (!context.ok) {
			return fail(context.status, {
				type: 'disconnectTalentHome',
				ok: false,
				message: context.message,
				organisation_id: organisationId
			});
		}
		return withSubmittedOrganisationId(
			await handleDisconnectTalentHome(formData, context),
			organisationId
		);
	},

	createTalentLabelDefinition: async ({ request, cookies }) => {
		const formData = await request.formData();
		const organisationId = parseSubmittedOrganisationId(formData);
		if (!organisationId) {
			return failTalentLabelAction({
				status: 400,
				type: 'createTalentLabelDefinition',
				message: 'Invalid organisation id.',
				organisationId
			});
		}
		const context = await ensureOrgManager(cookies, formData);
		if (!context.ok) {
			return failTalentLabelAction({
				status: context.status,
				type: 'createTalentLabelDefinition',
				message: context.message,
				organisationId
			});
		}

		const legalError = await ensureLegalAcceptance(context, organisationId);
		if (legalError) {
			return failTalentLabelAction({
				status: legalError.status,
				type: 'createTalentLabelDefinition',
				message: legalError.message,
				organisationId
			});
		}

		try {
			await createTalentLabelDefinition({
				adminClient: context.adminClient,
				actor: context.actor,
				organisationId,
				name: typeof formData.get('name') === 'string' ? String(formData.get('name')) : '',
				colorHex:
					typeof formData.get('color_hex') === 'string' ? String(formData.get('color_hex')) : ''
			});
			invalidateOrganisationContextCache(organisationId);
			return {
				type: 'createTalentLabelDefinition' as const,
				ok: true,
				message: 'Label created.',
				organisation_id: organisationId
			};
		} catch (actionError) {
			const status = actionError instanceof TalentLabelServiceError ? actionError.status : 500;
			return failTalentLabelAction({
				status,
				type: 'createTalentLabelDefinition',
				message: actionError instanceof Error ? actionError.message : 'Could not create label.',
				organisationId
			});
		}
	},

	updateTalentLabelDefinition: async ({ request, cookies }) => {
		const formData = await request.formData();
		const organisationId = parseSubmittedOrganisationId(formData);
		if (!organisationId) {
			return failTalentLabelAction({
				status: 400,
				type: 'updateTalentLabelDefinition',
				message: 'Invalid organisation id.',
				organisationId
			});
		}
		const context = await ensureOrgManager(cookies, formData);
		if (!context.ok) {
			return failTalentLabelAction({
				status: context.status,
				type: 'updateTalentLabelDefinition',
				message: context.message,
				organisationId
			});
		}

		const legalError = await ensureLegalAcceptance(context, organisationId);
		if (legalError) {
			return failTalentLabelAction({
				status: legalError.status,
				type: 'updateTalentLabelDefinition',
				message: legalError.message,
				organisationId
			});
		}

		const labelDefinitionId = formData.get('label_definition_id');
		if (typeof labelDefinitionId !== 'string' || !labelDefinitionId.trim()) {
			return failTalentLabelAction({
				status: 400,
				type: 'updateTalentLabelDefinition',
				message: 'Invalid label id.',
				organisationId
			});
		}

		try {
			await updateTalentLabelDefinition({
				adminClient: context.adminClient,
				actor: context.actor,
				organisationId,
				labelDefinitionId,
				name: typeof formData.get('name') === 'string' ? String(formData.get('name')) : '',
				colorHex:
					typeof formData.get('color_hex') === 'string' ? String(formData.get('color_hex')) : ''
			});
			invalidateOrganisationContextCache(organisationId);
			return {
				type: 'updateTalentLabelDefinition' as const,
				ok: true,
				message: 'Label updated.',
				organisation_id: organisationId
			};
		} catch (actionError) {
			const status = actionError instanceof TalentLabelServiceError ? actionError.status : 500;
			return failTalentLabelAction({
				status,
				type: 'updateTalentLabelDefinition',
				message: actionError instanceof Error ? actionError.message : 'Could not update label.',
				organisationId
			});
		}
	},

	deleteTalentLabelDefinition: async ({ request, cookies }) => {
		const formData = await request.formData();
		const organisationId = parseSubmittedOrganisationId(formData);
		if (!organisationId) {
			return failTalentLabelAction({
				status: 400,
				type: 'deleteTalentLabelDefinition',
				message: 'Invalid organisation id.',
				organisationId
			});
		}
		const context = await ensureOrgManager(cookies, formData);
		if (!context.ok) {
			return failTalentLabelAction({
				status: context.status,
				type: 'deleteTalentLabelDefinition',
				message: context.message,
				organisationId
			});
		}

		const legalError = await ensureLegalAcceptance(context, organisationId);
		if (legalError) {
			return failTalentLabelAction({
				status: legalError.status,
				type: 'deleteTalentLabelDefinition',
				message: legalError.message,
				organisationId
			});
		}

		const labelDefinitionId = formData.get('label_definition_id');
		if (typeof labelDefinitionId !== 'string' || !labelDefinitionId.trim()) {
			return failTalentLabelAction({
				status: 400,
				type: 'deleteTalentLabelDefinition',
				message: 'Invalid label id.',
				organisationId
			});
		}

		try {
			await deleteTalentLabelDefinition({
				adminClient: context.adminClient,
				actor: context.actor,
				organisationId,
				labelDefinitionId
			});
			invalidateOrganisationContextCache(organisationId);
			return {
				type: 'deleteTalentLabelDefinition' as const,
				ok: true,
				message: 'Label deleted.',
				organisation_id: organisationId
			};
		} catch (actionError) {
			const status = actionError instanceof TalentLabelServiceError ? actionError.status : 500;
			return failTalentLabelAction({
				status,
				type: 'deleteTalentLabelDefinition',
				message: actionError instanceof Error ? actionError.message : 'Could not delete label.',
				organisationId
			});
		}
	}
};
