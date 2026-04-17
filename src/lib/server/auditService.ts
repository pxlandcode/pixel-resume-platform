import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '$lib/server/supabase';

export type AuditActionType =
	| 'RESUME_VIEW'
	| 'RESUME_EXPORT'
	| 'RESUME_SHARE_CREATED'
	| 'RESUME_SHARE_UPDATED'
	| 'RESUME_SHARE_REVOKED'
	| 'RESUME_SHARE_REGENERATED'
	| 'SHARING_APPROVED'
	| 'SHARE_RULE_CONFIGURED'
	| 'SHARE_RULE_REVOKED'
	| 'LEGAL_ACCEPTED'
	| 'TALENT_CREATED'
	| 'TALENT_UPDATED'
	| 'TALENT_DELETED'
	| 'ASSERTION_CONFIRMED'
	| 'TALENT_COMMENT_CREATED'
	| 'TALENT_COMMENT_ARCHIVED';

export type AuditLogPayload = {
	actorUserId?: string | null;
	organisationId: string;
	actionType: AuditActionType;
	resourceType: string;
	resourceId?: string | null;
	metadata?: Record<string, unknown>;
};

export const writeAuditLog = async (
	payload: AuditLogPayload,
	client?: SupabaseClient | null
): Promise<{ ok: true } | { ok: false; error: string }> => {
	const adminClient = client ?? getSupabaseAdminClient();
	if (!adminClient) {
		return { ok: false, error: 'Supabase admin client unavailable' };
	}

	const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};

	const { error } = await adminClient.from('audit_logs').insert({
		actor_user_id: payload.actorUserId ?? null,
		organisation_id: payload.organisationId,
		action_type: payload.actionType,
		resource_type: payload.resourceType,
		resource_id: payload.resourceId ?? null,
		metadata_json: metadata,
		created_at: new Date().toISOString()
	});

	if (error) {
		return { ok: false, error: error.message };
	}

	return { ok: true };
};
