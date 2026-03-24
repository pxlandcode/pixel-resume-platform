import type { AppRole } from '$lib/server/access';

export const TALENT_COMMENT_BODY_MAX_LENGTH = 1000;

export type TalentCommentType = {
	id: string;
	key: string;
	label: string;
	icon_name: string;
	sort_order: number;
	is_active: boolean;
};

export type TalentCommentAuthorRole = AppRole;

export type TalentComment = {
	id: string;
	talent_id: string;
	comment_type_id: string;
	author_user_id: string;
	author_role: TalentCommentAuthorRole;
	author_name: string | null;
	body_text: string;
	created_at: string;
	comment_type: TalentCommentType;
	canArchive: boolean;
};
