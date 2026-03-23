import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActorAccessContext, AppRole } from '$lib/server/access';
import type { ResumeEditPermissions } from '$lib/server/resumes/permissions';
import { writeAuditLog } from '$lib/server/legalService';
import {
	TALENT_COMMENT_BODY_MAX_LENGTH,
	type TalentComment,
	type TalentCommentType
} from '$lib/types/talentComments';

export class TalentCommentServiceError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'TalentCommentServiceError';
		this.status = status;
	}
}

type CommentTypeJoinRow = {
	id?: unknown;
	key?: unknown;
	label?: unknown;
	icon_name?: unknown;
	sort_order?: unknown;
	is_active?: unknown;
};

type TalentCommentRow = {
	id?: unknown;
	talent_id?: unknown;
	comment_type_id?: unknown;
	author_user_id?: unknown;
	author_role?: unknown;
	body_text?: unknown;
	created_at?: unknown;
	archived_at?: unknown;
	talent_comment_types?: CommentTypeJoinRow | CommentTypeJoinRow[] | null;
};

type AuthorProfileRow = {
	user_id?: unknown;
	first_name?: unknown;
	last_name?: unknown;
};

const isMissingSchemaCacheError = (error: unknown): boolean =>
	Boolean(
		error &&
			typeof error === 'object' &&
			'code' in error &&
			(error as { code?: unknown }).code === 'PGRST205'
	);

const missingTableMessage =
	'Talent comments are not available until migration 20260323110000_talent_comments.sql has been applied.';

const COMMENT_AUTHOR_ROLE_PRIORITY: AppRole[] = ['admin', 'broker', 'employer', 'talent'];
const KNOWN_AUTHOR_ROLES = new Set<AppRole>(['admin', 'broker', 'employer', 'talent']);

const normalizeString = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
};

const normalizeAppRole = (value: unknown): AppRole | null => {
	const normalized = normalizeString(value)?.toLowerCase() ?? null;
	if (!normalized || !KNOWN_AUTHOR_ROLES.has(normalized as AppRole)) return null;
	return normalized as AppRole;
};

const normalizeCommentTypeRow = (
	value: CommentTypeJoinRow | CommentTypeJoinRow[] | null | undefined
): TalentCommentType | null => {
	const row = Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
	if (!row) return null;

	const id = normalizeString(row.id);
	const key = normalizeString(row.key);
	const label = normalizeString(row.label);
	const iconName = normalizeString(row.icon_name) ?? 'message-square';
	if (!id || !key || !label) return null;

	return {
		id,
		key,
		label,
		icon_name: iconName,
		sort_order: typeof row.sort_order === 'number' ? row.sort_order : 0,
		is_active: Boolean(row.is_active)
	};
};

const fallbackCommentType = (commentTypeId: string): TalentCommentType => ({
	id: commentTypeId,
	key: 'general',
	label: 'General',
	icon_name: 'message-square',
	sort_order: 999,
	is_active: false
});

const formatAuthorName = (firstName: unknown, lastName: unknown) => {
	const parts = [normalizeString(firstName), normalizeString(lastName)].filter(
		(value): value is string => Boolean(value)
	);
	return parts.length > 0 ? parts.join(' ') : null;
};

const sanitizeCommentBody = (value: string) => {
	const normalizedNewlines = value.replace(/\r\n?/g, '\n');
	const withoutHtml = normalizedNewlines.replace(/<[^>]*>/g, '');
	const trimmedLines = withoutHtml.split('\n').map((line) => line.replace(/[ \t]+$/g, ''));
	const cleaned = trimmedLines.join('\n').trim();
	if (!cleaned) return null;
	if (cleaned.length <= TALENT_COMMENT_BODY_MAX_LENGTH) return cleaned;
	return cleaned.slice(0, TALENT_COMMENT_BODY_MAX_LENGTH).trim();
};

export const resolveCommentAuthorRole = (roles: AppRole[]): AppRole | null =>
	COMMENT_AUTHOR_ROLE_PRIORITY.find((role) => roles.includes(role)) ?? null;

export const canCreateTalentComment = (
	actor: Pick<ActorAccessContext, 'userId' | 'isAdmin' | 'isBroker' | 'isEmployer' | 'isTalent'>,
	permissions: Pick<ResumeEditPermissions, 'canView' | 'isOwnProfile'>
) => {
	if (!actor.userId || !permissions.canView) return false;
	if (actor.isAdmin || actor.isBroker || actor.isEmployer) return true;
	return actor.isTalent && permissions.isOwnProfile;
};

export const canArchiveTalentComment = (payload: {
	actor: Pick<
		ActorAccessContext,
		'userId' | 'homeOrganisationId' | 'isAdmin' | 'isBroker' | 'isEmployer'
	>;
	talentOrganisationId: string | null;
	commentAuthorUserId: string;
}) => {
	if (!payload.actor.userId) return false;
	if (payload.actor.isAdmin) return true;
	if (payload.commentAuthorUserId === payload.actor.userId) return true;

	const sameHomeOrganisation = Boolean(
		payload.actor.homeOrganisationId &&
			payload.talentOrganisationId &&
			payload.actor.homeOrganisationId === payload.talentOrganisationId
	);

	return sameHomeOrganisation && (payload.actor.isBroker || payload.actor.isEmployer);
};

export const loadActiveTalentCommentTypes = async (
	adminClient: SupabaseClient | null
): Promise<TalentCommentType[]> => {
	if (!adminClient) return [];

	const { data, error } = await adminClient
		.from('talent_comment_types')
		.select('id, key, label, icon_name, sort_order, is_active')
		.eq('is_active', true)
		.order('sort_order', { ascending: true })
		.order('label', { ascending: true });

	if (error) {
		if (isMissingSchemaCacheError(error)) {
			return [];
		}
		console.warn('[talent comments] could not load comment types', error);
		return [];
	}

	return (data ?? [])
		.map((row) => normalizeCommentTypeRow(row as CommentTypeJoinRow))
		.filter((row): row is TalentCommentType => row !== null);
};

export const listVisibleTalentComments = async (payload: {
	adminClient: SupabaseClient | null;
	talentId: string;
	actor: Pick<
		ActorAccessContext,
		'userId' | 'homeOrganisationId' | 'isAdmin' | 'isBroker' | 'isEmployer'
	>;
	permissions: Pick<ResumeEditPermissions, 'canView' | 'talentOrganisationId'>;
}): Promise<TalentComment[]> => {
	if (!payload.adminClient || !payload.permissions.canView) return [];

	const { data, error } = await payload.adminClient
		.from('talent_comments')
		.select(
			'id, talent_id, comment_type_id, author_user_id, author_role, body_text, created_at, archived_at, talent_comment_types(id, key, label, icon_name, sort_order, is_active)'
		)
		.eq('talent_id', payload.talentId)
		.is('archived_at', null)
		.order('created_at', { ascending: false });

	if (error) {
		if (isMissingSchemaCacheError(error)) {
			return [];
		}
		console.warn('[talent comments] could not load comments', error);
		return [];
	}

	const authorIds = Array.from(
		new Set(
			(data ?? [])
				.map((row) => normalizeString((row as TalentCommentRow).author_user_id))
				.filter((value): value is string => Boolean(value))
		)
	);

	const authorNameByUserId = new Map<string, string | null>();
	if (authorIds.length > 0) {
		const { data: profileRows, error: profileError } = await payload.adminClient
			.from('user_profiles')
			.select('user_id, first_name, last_name')
			.in('user_id', authorIds);

		if (profileError) {
			console.warn('[talent comments] could not load author names', profileError);
		} else {
			for (const row of profileRows ?? []) {
				const userId = normalizeString((row as AuthorProfileRow).user_id);
				if (!userId) continue;
				authorNameByUserId.set(
					userId,
					formatAuthorName(
						(row as AuthorProfileRow).first_name,
						(row as AuthorProfileRow).last_name
					)
				);
			}
		}
	}

	return (data ?? [])
		.map((row) => {
			const commentRow = row as TalentCommentRow;
			const id = normalizeString(commentRow.id);
			const talentId = normalizeString(commentRow.talent_id);
			const commentTypeId = normalizeString(commentRow.comment_type_id);
			const authorUserId = normalizeString(commentRow.author_user_id);
			const authorRole = normalizeAppRole(commentRow.author_role);
			const bodyText = typeof commentRow.body_text === 'string' ? commentRow.body_text : null;
			const createdAt = normalizeString(commentRow.created_at);

			if (
				!id ||
				!talentId ||
				!commentTypeId ||
				!authorUserId ||
				!authorRole ||
				!bodyText ||
				!createdAt
			) {
				return null;
			}

			const commentType =
				normalizeCommentTypeRow(commentRow.talent_comment_types) ??
				fallbackCommentType(commentTypeId);

			return {
				id,
				talent_id: talentId,
				comment_type_id: commentTypeId,
				author_user_id: authorUserId,
				author_role: authorRole,
				author_name: authorNameByUserId.get(authorUserId) ?? null,
				body_text: bodyText,
				created_at: createdAt,
				comment_type: commentType,
				canArchive: canArchiveTalentComment({
					actor: payload.actor,
					talentOrganisationId: payload.permissions.talentOrganisationId,
					commentAuthorUserId: authorUserId
				})
			} satisfies TalentComment;
		})
		.filter((row): row is TalentComment => row !== null);
};

export const createTalentComment = async (payload: {
	adminClient: SupabaseClient | null;
	talentId: string;
	commentTypeId: string;
	bodyText: string;
	actor: ActorAccessContext;
	permissions: Pick<ResumeEditPermissions, 'canView' | 'isOwnProfile' | 'talentOrganisationId'>;
}) => {
	if (!payload.adminClient) {
		throw new TalentCommentServiceError(500, 'Comment service is unavailable.');
	}
	if (!canCreateTalentComment(payload.actor, payload.permissions)) {
		throw new TalentCommentServiceError(403, 'Not authorized to comment on this profile.');
	}
	if (!payload.actor.userId) {
		throw new TalentCommentServiceError(401, 'Unauthorized.');
	}

	const commentTypeId = normalizeString(payload.commentTypeId);
	if (!commentTypeId) {
		throw new TalentCommentServiceError(400, 'Choose a comment type.');
	}

	const sanitizedBody = sanitizeCommentBody(payload.bodyText);
	if (!sanitizedBody) {
		throw new TalentCommentServiceError(400, 'Enter a comment before saving.');
	}

	const authorRole = resolveCommentAuthorRole(payload.actor.roles);
	if (!authorRole) {
		throw new TalentCommentServiceError(403, 'No eligible role is available for commenting.');
	}

	const { data: commentTypeRow, error: commentTypeError } = await payload.adminClient
		.from('talent_comment_types')
		.select('id, key, label, icon_name, sort_order, is_active')
		.eq('id', commentTypeId)
		.eq('is_active', true)
		.maybeSingle();

	if (commentTypeError) {
		if (isMissingSchemaCacheError(commentTypeError)) {
			throw new TalentCommentServiceError(503, missingTableMessage);
		}
		throw new TalentCommentServiceError(500, commentTypeError.message);
	}

	const commentType = normalizeCommentTypeRow(commentTypeRow as CommentTypeJoinRow | null);
	if (!commentType) {
		throw new TalentCommentServiceError(400, 'The selected comment type is not available.');
	}

	const { data: createdComment, error: createError } = await payload.adminClient
		.from('talent_comments')
		.insert({
			talent_id: payload.talentId,
			comment_type_id: commentType.id,
			author_user_id: payload.actor.userId,
			author_role: authorRole,
			body_text: sanitizedBody
		})
		.select('id, created_at')
		.single();

	if (createError || !createdComment?.id) {
		if (isMissingSchemaCacheError(createError)) {
			throw new TalentCommentServiceError(503, missingTableMessage);
		}
		throw new TalentCommentServiceError(
			500,
			createError?.message ?? 'Could not create comment right now.'
		);
	}

	const organisationId =
		payload.permissions.talentOrganisationId ?? payload.actor.homeOrganisationId ?? null;
	if (organisationId) {
		const auditResult = await writeAuditLog({
			actorUserId: payload.actor.userId,
			organisationId,
			actionType: 'TALENT_COMMENT_CREATED',
			resourceType: 'talent_comment',
			resourceId: String(createdComment.id),
			metadata: {
				talent_id: payload.talentId,
				comment_type_id: commentType.id,
				comment_type_key: commentType.key,
				author_role: authorRole
			}
		});

		if (!auditResult.ok) {
			console.warn('[talent comments] could not write create audit log', auditResult.error);
		}
	}

	return {
		id: String(createdComment.id),
		createdAt:
			typeof createdComment.created_at === 'string'
				? createdComment.created_at
				: new Date().toISOString()
	};
};

export const archiveTalentComment = async (payload: {
	adminClient: SupabaseClient | null;
	commentId: string;
	talentId: string;
	actor: ActorAccessContext;
	permissions: Pick<ResumeEditPermissions, 'canView' | 'talentOrganisationId'>;
}) => {
	if (!payload.adminClient) {
		throw new TalentCommentServiceError(500, 'Comment service is unavailable.');
	}
	if (!payload.actor.userId) {
		throw new TalentCommentServiceError(401, 'Unauthorized.');
	}
	if (!payload.permissions.canView) {
		throw new TalentCommentServiceError(403, 'Not authorized to view this profile.');
	}

	const commentId = normalizeString(payload.commentId);
	if (!commentId) {
		throw new TalentCommentServiceError(400, 'Invalid comment id.');
	}

	const { data: existingComment, error: existingCommentError } = await payload.adminClient
		.from('talent_comments')
		.select('id, talent_id, author_user_id, archived_at')
		.eq('id', commentId)
		.maybeSingle();

	if (existingCommentError) {
		if (isMissingSchemaCacheError(existingCommentError)) {
			throw new TalentCommentServiceError(503, missingTableMessage);
		}
		throw new TalentCommentServiceError(500, existingCommentError.message);
	}

	const existingTalentId =
		typeof existingComment?.talent_id === 'string' ? existingComment.talent_id : null;
	const authorUserId =
		typeof existingComment?.author_user_id === 'string' ? existingComment.author_user_id : null;

	if (!existingComment?.id || !existingTalentId || !authorUserId) {
		throw new TalentCommentServiceError(404, 'Comment not found.');
	}
	if (existingTalentId !== payload.talentId) {
		throw new TalentCommentServiceError(400, 'Comment does not belong to this profile.');
	}
	if (existingComment.archived_at) {
		return { ok: true as const };
	}

	if (
		!canArchiveTalentComment({
			actor: payload.actor,
			talentOrganisationId: payload.permissions.talentOrganisationId,
			commentAuthorUserId: authorUserId
		})
	) {
		throw new TalentCommentServiceError(403, 'Not authorized to archive this comment.');
	}

	const archivedAt = new Date().toISOString();
	const { error: archiveError } = await payload.adminClient
		.from('talent_comments')
		.update({
			archived_at: archivedAt,
			archived_by_user_id: payload.actor.userId
		})
		.eq('id', commentId)
		.is('archived_at', null);

	if (archiveError) {
		if (isMissingSchemaCacheError(archiveError)) {
			throw new TalentCommentServiceError(503, missingTableMessage);
		}
		throw new TalentCommentServiceError(500, archiveError.message);
	}

	const organisationId =
		payload.permissions.talentOrganisationId ?? payload.actor.homeOrganisationId ?? null;
	if (organisationId) {
		const auditResult = await writeAuditLog({
			actorUserId: payload.actor.userId,
			organisationId,
			actionType: 'TALENT_COMMENT_ARCHIVED',
			resourceType: 'talent_comment',
			resourceId: commentId,
			metadata: {
				talent_id: payload.talentId
			}
		});

		if (!auditResult.ok) {
			console.warn('[talent comments] could not write archive audit log', auditResult.error);
		}
	}

	return { ok: true as const };
};
