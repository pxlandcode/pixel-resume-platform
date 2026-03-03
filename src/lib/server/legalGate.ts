import type { SupabaseClient } from '@supabase/supabase-js';
import { error } from '@sveltejs/kit';
import {
	getHomeOrganisationIdForUser,
	getUserAcceptanceStatus,
	type UserAcceptanceStatus
} from '$lib/server/legalService';

export const isLegalExemptPath = (pathname: string) => {
	const normalized = pathname.replace(/\/$/, '') || '/';
	return (
		normalized === '/login' ||
		normalized === '/reset-password' ||
		normalized.startsWith('/print/') ||
		normalized.startsWith('/legal/')
	);
};

export const normalizeSafeRedirect = (value: string | null | undefined, fallback = '/') => {
	if (!value || typeof value !== 'string') return fallback;
	if (!value.startsWith('/')) return fallback;
	if (value.startsWith('//')) return fallback;
	return value;
};

export const resolveLegalAcceptanceState = async (payload: {
	adminClient: SupabaseClient;
	userId: string;
	homeOrganisationId?: string | null;
}): Promise<{
	homeOrganisationId: string | null;
	status: UserAcceptanceStatus | null;
}> => {
	const homeOrganisationId =
		payload.homeOrganisationId ??
		(await getHomeOrganisationIdForUser(payload.adminClient, payload.userId));

	if (!homeOrganisationId) {
		return { homeOrganisationId: null, status: null };
	}

	const status = await getUserAcceptanceStatus(payload.adminClient, payload.userId, homeOrganisationId);
	return { homeOrganisationId, status };
};

export const assertAcceptedForSensitiveAction = async (payload: {
	adminClient: SupabaseClient;
	userId: string;
	homeOrganisationId?: string | null;
}) => {
	const { homeOrganisationId, status } = await resolveLegalAcceptanceState(payload);

	if (!homeOrganisationId) {
		throw error(403, 'A home organisation is required before legal acceptance can be recorded.');
	}
	if (!status || status.missingActiveDocuments) {
		throw error(503, 'Active legal documents are not fully configured.');
	}
	if (!status.hasAcceptedCurrent) {
		throw error(403, 'You must accept the latest legal documents before continuing.');
	}

	return { homeOrganisationId, status };
};
