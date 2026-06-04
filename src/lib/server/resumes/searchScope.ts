import type { SupabaseClient } from '@supabase/supabase-js';
import { getAccessibleTalentIds, type ActorAccessContext } from '$lib/server/access';
import type { ResumeSearchFilterKind, ResumeSearchFilterTerm } from '$lib/types/resumes';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEARCH_FILTER_KINDS = new Set<ResumeSearchFilterKind>(['technology', 'role', 'concept']);

export type ResumeSearchScopeResolution =
	| { ok: true; orgIds: string[]; signature: string }
	| { ok: false; status: number; message: string };

export const parseResumeSearchOrgIds = (
	orgParams: string[]
): { ok: true; orgIds: string[] } | { ok: false; message: string } => {
	if (orgParams.length === 0) return { ok: true, orgIds: [] };

	const uniqueOrgIds = Array.from(
		new Set(orgParams.map((value) => value.trim()).filter(Boolean))
	).sort();
	if (uniqueOrgIds.length === 0) return { ok: true, orgIds: [] };

	for (const orgId of uniqueOrgIds) {
		if (!UUID_REGEX.test(orgId)) {
			return { ok: false, message: `Invalid organisation id: ${orgId}` };
		}
	}

	return { ok: true, orgIds: uniqueOrgIds };
};

export const sanitizeResumeSearchTermOverrides = (
	value: unknown
): ResumeSearchFilterTerm[] | null => {
	if (!Array.isArray(value)) return null;

	const deduped = new Map<string, ResumeSearchFilterTerm>();

	for (const entry of value) {
		if (!entry || typeof entry !== 'object') continue;
		const record = entry as Record<string, unknown>;

		const label = typeof record.label === 'string' ? record.label.trim() : '';
		const kind = typeof record.kind === 'string' ? record.kind.trim() : '';
		if (!label || !SEARCH_FILTER_KINDS.has(kind as ResumeSearchFilterKind)) continue;

		const key =
			typeof record.key === 'string' && record.key.trim().length > 0
				? record.key.trim().toLowerCase()
				: label.toLowerCase();

		const requiredYears =
			kind === 'technology' &&
			typeof record.requiredYears === 'number' &&
			Number.isFinite(record.requiredYears) &&
			record.requiredYears >= 0
				? record.requiredYears
				: null;
		const interpretedFrom =
			typeof record.interpretedFrom === 'string' && record.interpretedFrom.trim().length > 0
				? record.interpretedFrom.trim().slice(0, 120)
				: null;

		deduped.set(key, {
			label,
			key,
			kind: kind as ResumeSearchFilterKind,
			...(requiredYears !== null ? { requiredYears } : {}),
			...(interpretedFrom ? { interpretedFrom } : {})
		});
	}

	return Array.from(deduped.values());
};

export const resolveResumeSearchScope = (
	actor: ActorAccessContext,
	requestedOrgIds: string[]
): ResumeSearchScopeResolution => {
	if (requestedOrgIds.length > 0) {
		if (!actor.isAdmin) {
			const allowed = new Set(actor.accessibleOrganisationIds);
			for (const orgId of requestedOrgIds) {
				if (!allowed.has(orgId)) {
					return {
						ok: false,
						status: 403,
						message: 'Requested organisation scope is not allowed.'
					};
				}
			}
		}

		return {
			ok: true,
			orgIds: requestedOrgIds,
			signature: `org:${requestedOrgIds.join(',')}`
		};
	}

	const defaultOrgIds = actor.isAdmin
		? []
		: Array.from(new Set(actor.accessibleOrganisationIds)).sort();

	return {
		ok: true,
		orgIds: defaultOrgIds,
		signature: defaultOrgIds.length > 0 ? `org:${defaultOrgIds.join(',')}` : 'default'
	};
};

export const resolveScopedResumeSearchTalentIds = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
	scopeOrgIds: string[];
}) => {
	const { adminClient, actor, scopeOrgIds } = payload;

	if (scopeOrgIds.length === 0) {
		return getAccessibleTalentIds(adminClient, actor);
	}

	const orgTalentResult = await adminClient
		.from('organisation_talents')
		.select('talent_id')
		.in('organisation_id', scopeOrgIds);
	if (orgTalentResult.error) throw new Error(orgTalentResult.error.message);

	const scopedTalentIds = Array.from(
		new Set(
			(orgTalentResult.data ?? [])
				.map((row) => (typeof row.talent_id === 'string' ? row.talent_id : null))
				.filter((value): value is string => value !== null)
		)
	);

	if (actor.isAdmin) return scopedTalentIds;

	const accessibleTalentIds = await getAccessibleTalentIds(adminClient, actor);
	if (accessibleTalentIds === null) return scopedTalentIds;
	if (accessibleTalentIds.length === 0 || scopedTalentIds.length === 0) return [];

	const accessibleSet = new Set(accessibleTalentIds);
	return scopedTalentIds.filter((talentId) => accessibleSet.has(talentId));
};
