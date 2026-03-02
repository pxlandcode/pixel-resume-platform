import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	AUTH_COOKIE_NAMES,
	createSupabaseServerClient,
	getSupabaseAdminClient
} from '$lib/server/supabase';
import {
	getActiveLegalVersions,
	getHomeOrganisationIdForUser,
	getUserAcceptanceStatus,
	type LegalDocumentRecord
} from '$lib/server/legalService';
import { normalizeSafeRedirect } from '$lib/server/legalGate';

const DOC_TYPE_ORDER = ['tos', 'privacy', 'ai_notice', 'data_sharing'] as const;

const toOrderedDocuments = (active: {
	tos: LegalDocumentRecord | null;
	privacy: LegalDocumentRecord | null;
	ai_notice: LegalDocumentRecord | null;
	data_sharing: LegalDocumentRecord | null;
}) =>
	DOC_TYPE_ORDER.map((type) => active[type]).filter(
		(doc): doc is LegalDocumentRecord => doc !== null
	);

export const load: PageServerLoad = async ({ cookies, url }) => {
	const accessToken = cookies.get(AUTH_COOKIE_NAMES.access) ?? null;
	const supabase = createSupabaseServerClient(accessToken);

	if (!supabase) {
		throw redirect(303, `/login?redirect=${encodeURIComponent('/legal/accept')}`);
	}

	const {
		data: { user },
		error: userError
	} = await supabase.auth.getUser();

	if (userError || !user?.id) {
		throw redirect(303, `/login?redirect=${encodeURIComponent('/legal/accept')}`);
	}

	const adminClient = getSupabaseAdminClient();
	if (!adminClient) {
		throw error(500, 'Supabase admin client not available');
	}

	const activeVersions = await getActiveLegalVersions(adminClient);
	const orderedDocuments = toOrderedDocuments(activeVersions);
	const homeOrganisationId = await getHomeOrganisationIdForUser(adminClient, user.id);

	const acceptanceStatus = homeOrganisationId
		? await getUserAcceptanceStatus(adminClient, user.id, homeOrganisationId)
		: null;

	const redirectTo = normalizeSafeRedirect(url.searchParams.get('redirect') ?? '/', '/');

	if (acceptanceStatus?.hasAcceptedCurrent && redirectTo !== '/legal/accept') {
		throw redirect(303, redirectTo);
	}

	return {
		activeDocuments: orderedDocuments,
		homeOrganisationId,
		acceptanceStatus,
		redirectTo,
		meta: {
			title: 'Legal Acceptance',
			description: 'Accept current legal documents to continue.',
			noindex: true,
			path: '/legal/accept'
		}
	};
};
