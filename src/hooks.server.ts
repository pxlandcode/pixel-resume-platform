import { redirect, type Handle } from '@sveltejs/kit';
import { clearAuthCookies } from '$lib/server/supabase';
import { createRequestContext } from '$lib/server/requestContext';
import {
	normalizeSafeRedirect,
	isLegalExemptPath,
	resolveLegalAcceptanceState
} from '$lib/server/legalGate';
import {
	guardRoute,
	isDataRequestPathname,
	isManagedAppPath,
	isPublicPagePath,
	normalizePolicyPathname
} from '$lib/server/routePolicy';
import { resolveHomeOrganisationId } from '$lib/server/homeOrganisation';
import type { AppRole } from '$lib/server/access';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.requestContext = createRequestContext(event.cookies);
	const requestContext = event.locals.requestContext;

	if (!event.url.pathname.startsWith('/auth/')) {
		await requestContext.ensureSession();
	}

	const policyPathname = normalizePolicyPathname(event.url.pathname);

	if (!isManagedAppPath(policyPathname)) {
		return resolve(event);
	}

	const accessToken = requestContext.accessToken;
	if (!accessToken) {
		if (isPublicPagePath(policyPathname)) {
			return resolve(event);
		}
		const redirectParam = encodeURIComponent(policyPathname);
		throw redirect(303, `/login?redirect=${redirectParam}`);
	}

	if (isPublicPagePath(policyPathname)) {
		return resolve(event);
	}

	const supabase = requestContext.getSupabaseClient();
	if (!supabase) {
		clearAuthCookies(event.cookies);
		throw redirect(303, '/login');
	}

	const authUser = await requestContext.getAuthenticatedUser();
	if (!authUser) {
		clearAuthCookies(event.cookies);
		throw redirect(303, '/login');
	}

	if (authUser.app_metadata?.active === false) {
		clearAuthCookies(event.cookies);
		throw redirect(303, '/login?inactive=1');
	}

	const actorContext = await requestContext.getActorContext();
	const effectiveRoles: AppRole[] = actorContext.roles.length > 0 ? actorContext.roles : ['talent'];
	const roleRedirect = guardRoute(policyPathname, effectiveRoles);
	if (roleRedirect) throw redirect(303, roleRedirect);

	const adminClient = requestContext.getAdminClient();
	if (adminClient && !isLegalExemptPath(policyPathname)) {
		const homeOrganisationId = await resolveHomeOrganisationId({
			adminClient,
			homeOrganisationId: actorContext.homeOrganisationId,
			talentId: actorContext.talentId
		});
		const legalState = await resolveLegalAcceptanceState({
			adminClient,
			userId: authUser.id,
			homeOrganisationId
		});
		if (!legalState.homeOrganisationId || !legalState.status?.hasAcceptedCurrent) {
			const isDataRequest = isDataRequestPathname(event.url.pathname);
			const requestedPath = isDataRequest
				? policyPathname
				: `${policyPathname}${event.url.search || ''}`;
			const destination = normalizeSafeRedirect(requestedPath, '/');
			throw redirect(303, `/legal/accept?redirect=${encodeURIComponent(destination)}`);
		}
	}

	return resolve(event);
};
