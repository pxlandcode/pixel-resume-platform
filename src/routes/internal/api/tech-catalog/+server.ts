import { json, type RequestHandler } from '@sveltejs/kit';
import {
	loadEffectiveTechCatalog,
	loadTechCatalogManagementPayload
} from '$lib/server/techCatalog';
import type { TechCatalogApiResponse, TechCatalogScopeMode } from '$lib/types/techCatalog';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const parseScopeMode = (value: string | null): TechCatalogScopeMode => {
	if (value === 'global' || value === 'organisation' || value === 'auto') return value;
	return 'auto';
};

const wantsManagementPayload = (value: string | null) => {
	if (!value) return false;
	const normalized = value.trim().toLowerCase();
	return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

export const GET: RequestHandler = async ({ url, locals }) => {
	const requestContext = locals.requestContext;
	const adminClient = requestContext.getAdminClient();
	const actor = await requestContext.getActorContext();

	if (!adminClient || !actor.userId) {
		return json({ message: 'Unauthorized.' }, { status: 401 });
	}

	const requestedMode = parseScopeMode(url.searchParams.get('scope'));
	const requestedOrganisationId = url.searchParams.get('organisationId')?.trim() || null;
	const includeManagement = wantsManagementPayload(url.searchParams.get('includeManagement'));

	if (requestedOrganisationId && !UUID_REGEX.test(requestedOrganisationId)) {
		return json({ message: 'Invalid organisation id.' }, { status: 400 });
	}

	try {
		const catalog = await loadEffectiveTechCatalog({
			adminClient,
			actor,
			requestedMode,
			requestedOrganisationId
		});

		const response: TechCatalogApiResponse = { ...catalog };
		if (includeManagement) {
			response.management = await loadTechCatalogManagementPayload({
				adminClient,
				actor,
				organisationId: catalog.scope.mode === 'organisation' ? catalog.scope.organisationId : null
			});
		}

		return json(response);
	} catch (catalogError) {
		const message =
			catalogError instanceof Error ? catalogError.message : 'Could not load tech catalog.';
		if (/not allowed|not authenticated|only admins/i.test(message)) {
			return json({ message }, { status: 403 });
		}
		return json({ message }, { status: 500 });
	}
};
