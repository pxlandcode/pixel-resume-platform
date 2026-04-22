import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeHexColor } from '$lib/branding/theme';
import { getTalentAccess, type ActorAccessContext } from '$lib/server/access';
import { writeAuditLog } from '$lib/server/legalService';
import { invalidateResumesIndexCache } from '$lib/server/resumesIndexCache';
import type { TalentLabelDefinition } from '$lib/types/talentLabels';

export const TALENT_LABEL_NAME_MAX_LENGTH = 60;

export const DEFAULT_TALENT_LABEL_DEFINITIONS = [
	{ name: 'Red', color_hex: '#FF5F57', sort_order: 0 },
	{ name: 'Orange', color_hex: '#FF9F0A', sort_order: 1 },
	{ name: 'Yellow', color_hex: '#FFD60A', sort_order: 2 },
	{ name: 'Green', color_hex: '#32D74B', sort_order: 3 },
	{ name: 'Blue', color_hex: '#0A84FF', sort_order: 4 },
	{ name: 'Purple', color_hex: '#BF5AF2', sort_order: 5 },
	{ name: 'Gray', color_hex: '#8E8E93', sort_order: 6 }
] as const;

type TalentLabelDefinitionRow = {
	id?: unknown;
	organisation_id?: unknown;
	name?: unknown;
	color_hex?: unknown;
	sort_order?: unknown;
	created_at?: unknown;
	updated_at?: unknown;
};

type TalentLabelAssignmentRow = {
	talent_id?: unknown;
	label_definition_id?: unknown;
};

const normalizeString = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

const normalizeDefinitionRow = (row: TalentLabelDefinitionRow): TalentLabelDefinition | null => {
	const id = normalizeString(row.id);
	const organisationId = normalizeString(row.organisation_id);
	const name = normalizeString(row.name);
	const colorHex = normalizeHexColor(typeof row.color_hex === 'string' ? row.color_hex : null);
	if (!id || !organisationId || !name || !colorHex) return null;

	return {
		id,
		organisation_id: organisationId,
		name,
		color_hex: colorHex,
		sort_order: typeof row.sort_order === 'number' ? row.sort_order : 0,
		created_at: normalizeString(row.created_at),
		updated_at: normalizeString(row.updated_at)
	};
};

const sortDefinitions = (definitions: TalentLabelDefinition[]) =>
	[...definitions].sort((left, right) => {
		if (left.sort_order !== right.sort_order) return left.sort_order - right.sort_order;
		if (left.created_at && right.created_at && left.created_at !== right.created_at) {
			return left.created_at.localeCompare(right.created_at);
		}
		return left.name.localeCompare(right.name);
	});

const hasTalentLabelAccessRole = (
	actor: Pick<
		ActorAccessContext,
		'userId' | 'homeOrganisationId' | 'isAdmin' | 'isOrganisationAdmin' | 'isBroker' | 'isEmployer'
	>
) =>
	Boolean(
		actor.userId &&
			actor.homeOrganisationId &&
			(actor.isAdmin || actor.isOrganisationAdmin || actor.isBroker || actor.isEmployer)
	);

export const canViewTalentLabels = (
	actor: Pick<
		ActorAccessContext,
		'userId' | 'homeOrganisationId' | 'isAdmin' | 'isOrganisationAdmin' | 'isBroker' | 'isEmployer'
	>
) => hasTalentLabelAccessRole(actor);

export const canManageTalentLabelAssignments = canViewTalentLabels;

export const canManageTalentLabelDefinitions = (
	actor: Pick<ActorAccessContext, 'userId' | 'homeOrganisationId' | 'isAdmin' | 'isOrganisationAdmin'>
) => Boolean(actor.userId && actor.homeOrganisationId && (actor.isAdmin || actor.isOrganisationAdmin));

const normalizeLabelName = (value: unknown) => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim().replace(/\s+/g, ' ');
	if (!trimmed) return null;
	return trimmed.slice(0, TALENT_LABEL_NAME_MAX_LENGTH);
};

const resolveActorLabelOrganisationId = (
	actor: Pick<
		ActorAccessContext,
		'userId' | 'homeOrganisationId' | 'isAdmin' | 'isOrganisationAdmin' | 'isBroker' | 'isEmployer'
	>,
	mode: 'view' | 'assign' | 'define'
) => {
	if (mode === 'define') {
		if (!canManageTalentLabelDefinitions(actor)) {
			throw new TalentLabelServiceError(403, 'You do not have permission to manage labels.');
		}
		return actor.homeOrganisationId!;
	}

	if (mode === 'assign') {
		if (!canManageTalentLabelAssignments(actor)) {
			throw new TalentLabelServiceError(403, 'You do not have permission to manage labels.');
		}
		return actor.homeOrganisationId!;
	}

	if (!canViewTalentLabels(actor)) {
		throw new TalentLabelServiceError(403, 'You do not have permission to view labels.');
	}
	return actor.homeOrganisationId!;
};

const mapSupabaseError = (error: { code?: string; message?: string }) => {
	if (error.code === '23505') {
		return new TalentLabelServiceError(409, 'A label with that name already exists.');
	}
	return new TalentLabelServiceError(500, error.message ?? 'Talent label request failed.');
};

export class TalentLabelServiceError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'TalentLabelServiceError';
		this.status = status;
	}
}

export const listOrganisationTalentLabelDefinitions = async (
	adminClient: SupabaseClient | null,
	organisationId: string | null | undefined
): Promise<TalentLabelDefinition[]> => {
	if (!adminClient || !organisationId) return [];

	const { data, error } = await adminClient
		.from('organisation_talent_label_definitions')
		.select('id, organisation_id, name, color_hex, sort_order, created_at, updated_at')
		.eq('organisation_id', organisationId)
		.order('sort_order', { ascending: true })
		.order('created_at', { ascending: true });

	if (error) {
		console.warn('[talent labels] could not load definitions', error);
		return [];
	}

	return sortDefinitions(
		((data ?? []) as TalentLabelDefinitionRow[])
			.map((row) => normalizeDefinitionRow(row))
			.filter((definition): definition is TalentLabelDefinition => definition !== null)
	);
};

export const listVisibleTalentLabelDefinitions = async (payload: {
	adminClient: SupabaseClient | null;
	actor: Pick<
		ActorAccessContext,
		'userId' | 'homeOrganisationId' | 'isAdmin' | 'isOrganisationAdmin' | 'isBroker' | 'isEmployer'
	>;
}): Promise<TalentLabelDefinition[]> => {
	if (!payload.adminClient || !canViewTalentLabels(payload.actor)) return [];
	return listOrganisationTalentLabelDefinitions(payload.adminClient, payload.actor.homeOrganisationId);
};

export const listTalentLabelsByTalentId = async (payload: {
	adminClient: SupabaseClient | null;
	organisationId: string | null | undefined;
	talentIds: string[];
	definitions?: TalentLabelDefinition[];
}): Promise<Map<string, TalentLabelDefinition[]>> => {
	const labelsByTalentId = new Map<string, TalentLabelDefinition[]>();
	if (!payload.adminClient || !payload.organisationId || payload.talentIds.length === 0) {
		return labelsByTalentId;
	}

	const definitions =
		payload.definitions ?? (await listOrganisationTalentLabelDefinitions(payload.adminClient, payload.organisationId));
	const definitionById = new Map(definitions.map((definition) => [definition.id, definition] as const));

	const { data, error } = await payload.adminClient
		.from('organisation_talent_label_assignments')
		.select('talent_id, label_definition_id')
		.eq('organisation_id', payload.organisationId)
		.in('talent_id', payload.talentIds);

	if (error) {
		console.warn('[talent labels] could not load assignments', error);
		return labelsByTalentId;
	}

	for (const row of (data ?? []) as TalentLabelAssignmentRow[]) {
		const talentId = normalizeString(row.talent_id);
		const labelDefinitionId = normalizeString(row.label_definition_id);
		if (!talentId || !labelDefinitionId) continue;

		const definition = definitionById.get(labelDefinitionId);
		if (!definition) continue;

		const existing = labelsByTalentId.get(talentId) ?? [];
		existing.push(definition);
		labelsByTalentId.set(talentId, existing);
	}

	for (const [talentId, definitionsForTalent] of labelsByTalentId.entries()) {
		labelsByTalentId.set(talentId, sortDefinitions(definitionsForTalent));
	}

	return labelsByTalentId;
};

const listLabelsForTalent = async (payload: {
	adminClient: SupabaseClient;
	organisationId: string;
	talentId: string;
}) => {
	const definitions = await listOrganisationTalentLabelDefinitions(
		payload.adminClient,
		payload.organisationId
	);
	const labelsByTalentId = await listTalentLabelsByTalentId({
		adminClient: payload.adminClient,
		organisationId: payload.organisationId,
		talentIds: [payload.talentId],
		definitions
	});
	return labelsByTalentId.get(payload.talentId) ?? [];
};

const ensureTalentLabelTarget = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
	talentId: string;
}) => {
	const organisationId = resolveActorLabelOrganisationId(payload.actor, 'assign');
	const access = await getTalentAccess(payload.adminClient, payload.actor, payload.talentId);
	if (!access.exists) {
		throw new TalentLabelServiceError(404, 'Talent not found.');
	}
	if (!access.canView) {
		throw new TalentLabelServiceError(403, 'You do not have permission to label this talent.');
	}
	return organisationId;
};

const loadDefinitionForActorOrganisation = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
	labelDefinitionId: string;
	mode: 'assign' | 'define';
}) => {
	const organisationId = resolveActorLabelOrganisationId(payload.actor, payload.mode);

	const { data, error } = await payload.adminClient
		.from('organisation_talent_label_definitions')
		.select('id, organisation_id, name, color_hex, sort_order, created_at, updated_at')
		.eq('organisation_id', organisationId)
		.eq('id', payload.labelDefinitionId)
		.maybeSingle();

	if (error) throw mapSupabaseError(error);

	const definition = data ? normalizeDefinitionRow(data as TalentLabelDefinitionRow) : null;
	if (!definition) {
		throw new TalentLabelServiceError(404, 'Label not found.');
	}

	return definition;
};

export const assignTalentLabel = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
	talentId: string;
	labelDefinitionId: string;
}) => {
	if (!payload.actor.userId) {
		throw new TalentLabelServiceError(401, 'Unauthorized.');
	}

	const organisationId = await ensureTalentLabelTarget(payload);
	const definition = await loadDefinitionForActorOrganisation({
		adminClient: payload.adminClient,
		actor: payload.actor,
		labelDefinitionId: payload.labelDefinitionId,
		mode: 'assign'
	});

	const { error } = await payload.adminClient.from('organisation_talent_label_assignments').insert({
		organisation_id: organisationId,
		talent_id: payload.talentId,
		label_definition_id: definition.id,
		created_by_user_id: payload.actor.userId
	});

	if (error && error.code !== '23505') {
		throw mapSupabaseError(error);
	}

	if (!error) {
		await writeAuditLog({
			actorUserId: payload.actor.userId,
			organisationId,
			actionType: 'TALENT_LABEL_ASSIGNED',
			resourceType: 'talent_label_assignment',
			resourceId: payload.talentId,
			metadata: {
				talentId: payload.talentId,
				labelDefinitionId: definition.id,
				labelName: definition.name,
				colorHex: definition.color_hex
			}
		});
		invalidateResumesIndexCache(organisationId);
	}

	return listLabelsForTalent({
		adminClient: payload.adminClient,
		organisationId,
		talentId: payload.talentId
	});
};

export const removeTalentLabel = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
	talentId: string;
	labelDefinitionId: string;
}) => {
	if (!payload.actor.userId) {
		throw new TalentLabelServiceError(401, 'Unauthorized.');
	}

	const organisationId = await ensureTalentLabelTarget(payload);
	const definition = await loadDefinitionForActorOrganisation({
		adminClient: payload.adminClient,
		actor: payload.actor,
		labelDefinitionId: payload.labelDefinitionId,
		mode: 'assign'
	});

	const { data, error } = await payload.adminClient
		.from('organisation_talent_label_assignments')
		.delete()
		.eq('organisation_id', organisationId)
		.eq('talent_id', payload.talentId)
		.eq('label_definition_id', definition.id)
		.select('talent_id');

	if (error) {
		throw mapSupabaseError(error);
	}

	if ((data ?? []).length > 0) {
		await writeAuditLog({
			actorUserId: payload.actor.userId,
			organisationId,
			actionType: 'TALENT_LABEL_REMOVED',
			resourceType: 'talent_label_assignment',
			resourceId: payload.talentId,
			metadata: {
				talentId: payload.talentId,
				labelDefinitionId: definition.id,
				labelName: definition.name,
				colorHex: definition.color_hex
			}
		});
		invalidateResumesIndexCache(organisationId);
	}

	return listLabelsForTalent({
		adminClient: payload.adminClient,
		organisationId,
		talentId: payload.talentId
	});
};

export const createTalentLabelDefinition = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
	name: string;
	colorHex: string;
}) => {
	if (!payload.actor.userId) {
		throw new TalentLabelServiceError(401, 'Unauthorized.');
	}

	const organisationId = resolveActorLabelOrganisationId(payload.actor, 'define');
	const name = normalizeLabelName(payload.name);
	if (!name) {
		throw new TalentLabelServiceError(400, 'Enter a label name.');
	}

	const colorHex = normalizeHexColor(payload.colorHex);
	if (!colorHex) {
		throw new TalentLabelServiceError(400, 'Choose a valid color.');
	}

	const { data: lastRow, error: lastRowError } = await payload.adminClient
		.from('organisation_talent_label_definitions')
		.select('sort_order')
		.eq('organisation_id', organisationId)
		.order('sort_order', { ascending: false })
		.limit(1)
		.maybeSingle();

	if (lastRowError) {
		throw mapSupabaseError(lastRowError);
	}

	const nextSortOrder =
		typeof lastRow?.sort_order === 'number' && Number.isFinite(lastRow.sort_order)
			? lastRow.sort_order + 1
			: DEFAULT_TALENT_LABEL_DEFINITIONS.length;

	const { data, error } = await payload.adminClient
		.from('organisation_talent_label_definitions')
		.insert({
			organisation_id: organisationId,
			name,
			color_hex: colorHex,
			sort_order: nextSortOrder
		})
		.select('id, organisation_id, name, color_hex, sort_order, created_at, updated_at')
		.maybeSingle();

	if (error) {
		throw mapSupabaseError(error);
	}

	const definition = data ? normalizeDefinitionRow(data as TalentLabelDefinitionRow) : null;
	if (!definition) {
		throw new TalentLabelServiceError(500, 'Could not create label.');
	}

	await writeAuditLog({
		actorUserId: payload.actor.userId,
		organisationId,
		actionType: 'TALENT_LABEL_DEFINITION_CREATED',
		resourceType: 'talent_label_definition',
		resourceId: definition.id,
		metadata: {
			labelName: definition.name,
			colorHex: definition.color_hex,
			sortOrder: definition.sort_order
		}
	});
	invalidateResumesIndexCache(organisationId);

	return definition;
};

export const updateTalentLabelDefinition = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
	labelDefinitionId: string;
	name: string;
	colorHex: string;
}) => {
	if (!payload.actor.userId) {
		throw new TalentLabelServiceError(401, 'Unauthorized.');
	}

	const organisationId = resolveActorLabelOrganisationId(payload.actor, 'define');
	const name = normalizeLabelName(payload.name);
	if (!name) {
		throw new TalentLabelServiceError(400, 'Enter a label name.');
	}

	const colorHex = normalizeHexColor(payload.colorHex);
	if (!colorHex) {
		throw new TalentLabelServiceError(400, 'Choose a valid color.');
	}

	const existing = await loadDefinitionForActorOrganisation({
		adminClient: payload.adminClient,
		actor: payload.actor,
		labelDefinitionId: payload.labelDefinitionId,
		mode: 'define'
	});

	const { data, error } = await payload.adminClient
		.from('organisation_talent_label_definitions')
		.update({
			name,
			color_hex: colorHex,
			updated_at: new Date().toISOString()
		})
		.eq('organisation_id', organisationId)
		.eq('id', payload.labelDefinitionId)
		.select('id, organisation_id, name, color_hex, sort_order, created_at, updated_at')
		.maybeSingle();

	if (error) {
		throw mapSupabaseError(error);
	}

	const definition = data ? normalizeDefinitionRow(data as TalentLabelDefinitionRow) : null;
	if (!definition) {
		throw new TalentLabelServiceError(500, 'Could not update label.');
	}

	await writeAuditLog({
		actorUserId: payload.actor.userId,
		organisationId,
		actionType: 'TALENT_LABEL_DEFINITION_UPDATED',
		resourceType: 'talent_label_definition',
		resourceId: definition.id,
		metadata: {
			previousName: existing.name,
			previousColorHex: existing.color_hex,
			labelName: definition.name,
			colorHex: definition.color_hex
		}
	});
	invalidateResumesIndexCache(organisationId);

	return definition;
};

export const deleteTalentLabelDefinition = async (payload: {
	adminClient: SupabaseClient;
	actor: ActorAccessContext;
	labelDefinitionId: string;
}) => {
	if (!payload.actor.userId) {
		throw new TalentLabelServiceError(401, 'Unauthorized.');
	}

	const organisationId = resolveActorLabelOrganisationId(payload.actor, 'define');
	const existing = await loadDefinitionForActorOrganisation({
		adminClient: payload.adminClient,
		actor: payload.actor,
		labelDefinitionId: payload.labelDefinitionId,
		mode: 'define'
	});

	const { data: assignmentRows, error: assignmentCountError } = await payload.adminClient
		.from('organisation_talent_label_assignments')
		.select('talent_id')
		.eq('organisation_id', organisationId)
		.eq('label_definition_id', payload.labelDefinitionId);

	if (assignmentCountError) {
		throw mapSupabaseError(assignmentCountError);
	}

	const { error } = await payload.adminClient
		.from('organisation_talent_label_definitions')
		.delete()
		.eq('organisation_id', organisationId)
		.eq('id', payload.labelDefinitionId);

	if (error) {
		throw mapSupabaseError(error);
	}

	await writeAuditLog({
		actorUserId: payload.actor.userId,
		organisationId,
		actionType: 'TALENT_LABEL_DEFINITION_DELETED',
		resourceType: 'talent_label_definition',
		resourceId: existing.id,
		metadata: {
			labelName: existing.name,
			colorHex: existing.color_hex,
			removedAssignmentCount: Array.isArray(assignmentRows) ? assignmentRows.length : 0
		}
	});
	invalidateResumesIndexCache(organisationId);
};
