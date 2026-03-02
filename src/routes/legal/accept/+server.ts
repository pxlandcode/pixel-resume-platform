import { error, json, type RequestHandler } from '@sveltejs/kit';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import {
	extractRequestMetadata,
	getActiveLegalVersions,
	getHomeOrganisationIdForUser,
	getUserAcceptanceStatus,
	recordUserAcceptance,
	writeAuditLog
} from '$lib/server/legalService';
import { normalizeSafeRedirect } from '$lib/server/legalGate';

const requireAuthenticatedContext = async (accessToken: string | null) => {
	const supabase = createSupabaseServerClient(accessToken);
	if (!supabase) {
		throw error(401, 'Unauthorized');
	}

	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();
	if (userError || !user?.id) {
		throw error(401, 'Unauthorized');
	}

	const adminClient = getSupabaseAdminClient();
	if (!adminClient) {
		throw error(500, 'Supabase admin client not available');
	}

	return { supabase, adminClient, userId: user.id };
};

export const GET: RequestHandler = async ({ cookies }) => {
	const { adminClient, userId } = await requireAuthenticatedContext(
		cookies.get(AUTH_COOKIE_NAMES.access) ?? null
	);

	const activeVersions = await getActiveLegalVersions(adminClient);
	const homeOrganisationId = await getHomeOrganisationIdForUser(adminClient, userId);
	const acceptanceStatus = homeOrganisationId
		? await getUserAcceptanceStatus(adminClient, userId, homeOrganisationId)
		: null;

	return json({
		activeVersions,
		homeOrganisationId,
		acceptanceStatus
	});
};

export const POST: RequestHandler = async (event) => {
	const { supabase, adminClient, userId } = await requireAuthenticatedContext(
		event.cookies.get(AUTH_COOKIE_NAMES.access) ?? null
	);

	const homeOrganisationId = await getHomeOrganisationIdForUser(adminClient, userId);
	if (!homeOrganisationId) {
		return json(
			{ ok: false, message: 'Your account must be linked to a home organisation first.' },
			{ status: 400 }
		);
	}

	const activeVersions = await getActiveLegalVersions(adminClient);
	if (!activeVersions.tos || !activeVersions.privacy || !activeVersions.ai_notice || !activeVersions.data_sharing) {
		return json(
			{ ok: false, message: 'Active legal documents are not fully configured.' },
			{ status: 503 }
		);
	}

	let requestedRedirect = event.url.searchParams.get('redirect') ?? '/';

	if (event.request.headers.get('content-type')?.includes('application/json')) {
		const payload = (await event.request.json().catch(() => ({}))) as { redirectTo?: unknown };
		if (typeof payload.redirectTo === 'string') {
			requestedRedirect = payload.redirectTo;
		}
	} else {
		const formData = await event.request.formData().catch(() => null);
		const redirectValue = formData?.get('redirect_to');
		if (typeof redirectValue === 'string') {
			requestedRedirect = redirectValue;
		}
	}

	const redirectTo = normalizeSafeRedirect(requestedRedirect, '/');
	const requestMeta = extractRequestMetadata(event);

	const acceptance = await recordUserAcceptance({
		supabase,
		organisationId: homeOrganisationId,
		ipAddress: requestMeta.ipAddress,
		userAgent: requestMeta.userAgent
	});

	await writeAuditLog({
		actorUserId: userId,
		organisationId: homeOrganisationId,
		actionType: 'LEGAL_ACCEPTED',
		resourceType: 'legal_document',
		resourceId: null,
		metadata: {
			tos_document_id: acceptance.tos_document_id,
			privacy_document_id: acceptance.privacy_document_id,
			ai_notice_document_id: acceptance.ai_notice_document_id,
			data_sharing_document_id: acceptance.data_sharing_document_id,
			accepted_at: acceptance.accepted_at,
			redirect_to: redirectTo
		}
	});

	return json({
		ok: true,
		redirectTo,
		acceptance
	});
};
