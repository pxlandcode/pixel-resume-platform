import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequestEvent } from '@sveltejs/kit';
import { writeAuditLog as writeAuditLogImpl, type AuditActionType } from '$lib/server/auditService';

export type LegalDocumentType = 'tos' | 'privacy' | 'ai_notice' | 'data_sharing';
export type SharingScope = 'view' | 'export_org_template' | 'export_broker_template';
export type LawfulBasisType = 'consent_obtained' | 'contract' | 'legitimate_interest' | 'other';

export type LegalDocumentRecord = {
	id: string;
	doc_type: LegalDocumentType;
	version: string;
	content_html: string;
	effective_date: string;
	created_at: string;
};

export type ActiveLegalVersions = {
	tos: LegalDocumentRecord | null;
	privacy: LegalDocumentRecord | null;
	ai_notice: LegalDocumentRecord | null;
	data_sharing: LegalDocumentRecord | null;
};

export type AcceptanceSnapshot = {
	id: string;
	user_id: string;
	organisation_id: string;
	tos_document_id: string;
	privacy_document_id: string;
	ai_notice_document_id: string;
	data_sharing_document_id: string;
	accepted_at: string;
	ip_address: string | null;
	user_agent: string | null;
};

export type UserAcceptanceStatus = {
	hasAcceptedCurrent: boolean;
	missingActiveDocuments: boolean;
	activeDocumentIds: {
		tos_document_id: string | null;
		privacy_document_id: string | null;
		ai_notice_document_id: string | null;
		data_sharing_document_id: string | null;
	};
	latestAcceptance: AcceptanceSnapshot | null;
};

const isLegalDocType = (value: unknown): value is LegalDocumentType =>
	value === 'tos' || value === 'privacy' || value === 'ai_notice' || value === 'data_sharing';

const asLegalDocumentRecord = (value: unknown): LegalDocumentRecord | null => {
	if (!value || typeof value !== 'object') return null;
	const row = value as Record<string, unknown>;
	if (
		typeof row.id !== 'string' ||
		!isLegalDocType(row.doc_type) ||
		typeof row.version !== 'string' ||
		typeof row.content_html !== 'string' ||
		typeof row.effective_date !== 'string'
	) {
		return null;
	}
	return {
		id: row.id,
		doc_type: row.doc_type,
		version: row.version,
		content_html: row.content_html,
		effective_date: row.effective_date,
		created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString()
	};
};

const buildActiveVersions = (rows: LegalDocumentRecord[]): ActiveLegalVersions => {
	const active: ActiveLegalVersions = {
		tos: null,
		privacy: null,
		ai_notice: null,
		data_sharing: null
	};

	for (const row of rows) {
		active[row.doc_type] = row;
	}

	return active;
};

const mapAcceptanceSnapshot = (value: unknown): AcceptanceSnapshot | null => {
	if (!value || typeof value !== 'object') return null;
	const row = value as Record<string, unknown>;
	if (
		typeof row.id !== 'string' ||
		typeof row.user_id !== 'string' ||
		typeof row.organisation_id !== 'string' ||
		typeof row.tos_document_id !== 'string' ||
		typeof row.privacy_document_id !== 'string' ||
		typeof row.ai_notice_document_id !== 'string' ||
		typeof row.data_sharing_document_id !== 'string' ||
		typeof row.accepted_at !== 'string'
	) {
		return null;
	}

	return {
		id: row.id,
		user_id: row.user_id,
		organisation_id: row.organisation_id,
		tos_document_id: row.tos_document_id,
		privacy_document_id: row.privacy_document_id,
		ai_notice_document_id: row.ai_notice_document_id,
		data_sharing_document_id: row.data_sharing_document_id,
		accepted_at: row.accepted_at,
		ip_address: typeof row.ip_address === 'string' ? row.ip_address : null,
		user_agent: typeof row.user_agent === 'string' ? row.user_agent : null
	};
};

export const extractRequestMetadata = (event: Pick<RequestEvent, 'request' | 'getClientAddress'>) => {
	const forwardedFor = event.request.headers.get('x-forwarded-for');
	const ipFromForwarded = forwardedFor
		?.split(',')
		.map((part) => part.trim())
		.filter(Boolean)[0];

	const ipAddress = ipFromForwarded || event.getClientAddress?.() || null;
	const userAgent = event.request.headers.get('user-agent')?.trim() || null;

	return {
		ipAddress,
		userAgent
	};
};

export const getHomeOrganisationIdForUser = async (
	client: SupabaseClient,
	userId: string
): Promise<string | null> => {
	const { data, error } = await client
		.from('organisation_users')
		.select('organisation_id')
		.eq('user_id', userId)
		.order('updated_at', { ascending: false })
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();

	if (error) {
		return null;
	}

	return typeof data?.organisation_id === 'string' ? data.organisation_id : null;
};

export const getActiveLegalVersions = async (client: SupabaseClient): Promise<ActiveLegalVersions> => {
	const { data, error } = await client
		.from('view_active_legal_documents')
		.select('id, doc_type, version, content_html, effective_date, created_at');

	if (error) {
		throw new Error(error.message);
	}

	const parsedRows = (data ?? [])
		.map((row) => asLegalDocumentRecord(row))
		.filter((row): row is LegalDocumentRecord => row !== null);

	return buildActiveVersions(parsedRows);
};

export const getUserAcceptanceStatus = async (
	client: SupabaseClient,
	userId: string,
	organisationId: string
): Promise<UserAcceptanceStatus> => {
	const activeVersions = await getActiveLegalVersions(client);
	const activeDocumentIds = {
		tos_document_id: activeVersions.tos?.id ?? null,
		privacy_document_id: activeVersions.privacy?.id ?? null,
		ai_notice_document_id: activeVersions.ai_notice?.id ?? null,
		data_sharing_document_id: activeVersions.data_sharing?.id ?? null
	};

	const missingActiveDocuments = Object.values(activeDocumentIds).some((value) => !value);

	const { data, error } = await client
		.from('user_legal_acceptances')
		.select(
			'id, user_id, organisation_id, tos_document_id, privacy_document_id, ai_notice_document_id, data_sharing_document_id, accepted_at, ip_address, user_agent'
		)
		.eq('user_id', userId)
		.eq('organisation_id', organisationId)
		.order('accepted_at', { ascending: false })
		.limit(1)
		.maybeSingle();

	if (error) {
		throw new Error(error.message);
	}

	const latestAcceptance = mapAcceptanceSnapshot(data);

	const hasAcceptedCurrent =
		!missingActiveDocuments &&
		Boolean(
			latestAcceptance &&
			latestAcceptance.tos_document_id === activeDocumentIds.tos_document_id &&
			latestAcceptance.privacy_document_id === activeDocumentIds.privacy_document_id &&
			latestAcceptance.ai_notice_document_id === activeDocumentIds.ai_notice_document_id &&
			latestAcceptance.data_sharing_document_id === activeDocumentIds.data_sharing_document_id
		);

	return {
		hasAcceptedCurrent,
		missingActiveDocuments,
		activeDocumentIds,
		latestAcceptance
	};
};

export const recordUserAcceptance = async (payload: {
	supabase: SupabaseClient;
	organisationId: string;
	ipAddress?: string | null;
	userAgent?: string | null;
}): Promise<AcceptanceSnapshot> => {
	const { data, error } = await payload.supabase.rpc('record_user_legal_acceptance', {
		p_organisation_id: payload.organisationId,
		p_ip_address: payload.ipAddress ?? null,
		p_user_agent: payload.userAgent ?? null
	});

	if (error) {
		throw new Error(error.message);
	}

	const row = Array.isArray(data) ? data[0] : data;
	const mapped = mapAcceptanceSnapshot(row);
	if (!mapped) {
		throw new Error('Could not parse acceptance record');
	}

	return mapped;
};

export const recordEmployerAssertion = async (payload: {
	client: SupabaseClient;
	employerUserId: string;
	organisationId: string;
	talentId: string;
	lawfulBasisType: LawfulBasisType;
	lawfulBasisDetails?: string | null;
	ipAddress?: string | null;
	userAgent?: string | null;
}) => {
	const { data, error } = await payload.client
		.from('employer_talent_assertions')
		.insert({
			employer_user_id: payload.employerUserId,
			organisation_id: payload.organisationId,
			talent_id: payload.talentId,
			lawful_basis_type: payload.lawfulBasisType,
			lawful_basis_details: payload.lawfulBasisDetails?.trim() || null,
			confirmed_at: new Date().toISOString(),
			ip_address: payload.ipAddress ?? null,
			user_agent: payload.userAgent ?? null
		})
		.select(
			'id, employer_user_id, organisation_id, talent_id, lawful_basis_type, lawful_basis_details, confirmed_at, ip_address, user_agent'
		)
		.single();

	if (error) {
		throw new Error(error.message);
	}

	return data;
};

export const hasDataSharingPermission = async (
	client: SupabaseClient,
	sourceOrganisationId: string,
	targetOrganisationId: string,
	requiredScope: SharingScope
): Promise<boolean> => {
	const { data, error } = await client.rpc('has_data_sharing_permission', {
		source_org_id: sourceOrganisationId,
		target_org_id: targetOrganisationId,
		required_scope: requiredScope
	});

	if (error) {
		throw new Error(error.message);
	}

	return Boolean(data);
};

export const writeAuditLog = async (payload: {
	actorUserId?: string | null;
	organisationId: string;
	actionType: AuditActionType;
	resourceType: string;
	resourceId?: string | null;
	metadata?: Record<string, unknown>;
}) => writeAuditLogImpl(payload);
