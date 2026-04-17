import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
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

	const canManageOrg = actor.isAdmin || actor.isEmployer || actor.isBroker;
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
	}
};
