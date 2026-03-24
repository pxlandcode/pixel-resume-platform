CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TYPE public.audit_action_type ADD VALUE IF NOT EXISTS 'TALENT_COMMENT_CREATED';
ALTER TYPE public.audit_action_type ADD VALUE IF NOT EXISTS 'TALENT_COMMENT_ARCHIVED';

CREATE TABLE IF NOT EXISTS public.talent_comment_types (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	key text NOT NULL UNIQUE,
	label text NOT NULL,
	icon_name text NOT NULL,
	sort_order integer NOT NULL DEFAULT 0,
	is_active boolean NOT NULL DEFAULT true,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.talent_comment_types (key, label, icon_name, sort_order)
VALUES
	('assignment_wish', 'Assignment wish', 'briefcase-business', 10),
	('availability', 'Availability', 'calendar-clock', 20),
	('process', 'Process', 'workflow', 30),
	('general', 'General', 'message-square', 40)
ON CONFLICT (key) DO UPDATE
SET
	label = EXCLUDED.label,
	icon_name = EXCLUDED.icon_name,
	sort_order = EXCLUDED.sort_order,
	updated_at = now();

CREATE TABLE IF NOT EXISTS public.talent_comments (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	talent_id uuid NOT NULL REFERENCES public.talents(id) ON DELETE CASCADE,
	comment_type_id uuid NOT NULL REFERENCES public.talent_comment_types(id) ON DELETE RESTRICT,
	author_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
	author_role text NOT NULL CHECK (author_role IN ('admin', 'broker', 'employer', 'talent')),
	body_text text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	archived_at timestamptz,
	archived_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
	CONSTRAINT talent_comments_body_text_chk
		CHECK (char_length(btrim(body_text)) > 0 AND char_length(body_text) <= 1000),
	CONSTRAINT talent_comments_archive_fields_chk
		CHECK (
			(archived_at IS NULL AND archived_by_user_id IS NULL)
			OR (archived_at IS NOT NULL AND archived_by_user_id IS NOT NULL)
		)
);

CREATE INDEX IF NOT EXISTS talent_comment_types_active_sort_idx
	ON public.talent_comment_types (is_active, sort_order, label);

CREATE INDEX IF NOT EXISTS talent_comments_talent_created_idx
	ON public.talent_comments (talent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS talent_comments_talent_active_created_idx
	ON public.talent_comments (talent_id, archived_at, created_at DESC);

CREATE INDEX IF NOT EXISTS talent_comments_author_user_id_idx
	ON public.talent_comments (author_user_id);

CREATE INDEX IF NOT EXISTS talent_comments_comment_type_id_idx
	ON public.talent_comments (comment_type_id);

CREATE OR REPLACE FUNCTION public.can_create_talent_comment(target_talent_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT
		public.is_admin()
		OR (
			(public.has_role('broker') OR public.has_role('employer'))
			AND public.can_access_talent(target_talent_id)
		)
		OR (
			public.has_role('talent')
			AND target_talent_id = public.current_talent_id()
		);
$$;

CREATE OR REPLACE FUNCTION public.can_archive_talent_comment(target_comment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT
		public.is_admin()
		OR EXISTS (
			SELECT 1
			FROM public.talent_comments tc
			WHERE tc.id = target_comment_id
				AND tc.author_user_id = auth.uid()
		)
		OR EXISTS (
			SELECT 1
			FROM public.talent_comments tc
			JOIN public.organisation_talents ot ON ot.talent_id = tc.talent_id
			WHERE tc.id = target_comment_id
				AND (public.has_role('broker') OR public.has_role('employer'))
				AND ot.organisation_id = public.current_user_home_org_id()
		);
$$;

CREATE OR REPLACE FUNCTION public.enforce_talent_comment_archive_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
	IF OLD.archived_at IS NOT NULL THEN
		RAISE EXCEPTION 'Archived comments cannot be modified.';
	END IF;

	IF
		OLD.talent_id IS DISTINCT FROM NEW.talent_id
		OR OLD.comment_type_id IS DISTINCT FROM NEW.comment_type_id
		OR OLD.author_user_id IS DISTINCT FROM NEW.author_user_id
		OR OLD.author_role IS DISTINCT FROM NEW.author_role
		OR OLD.body_text IS DISTINCT FROM NEW.body_text
		OR OLD.created_at IS DISTINCT FROM NEW.created_at
	THEN
		RAISE EXCEPTION 'Talent comments are immutable except for archive fields.';
	END IF;

	IF NEW.archived_at IS NULL OR NEW.archived_by_user_id IS NULL THEN
		RAISE EXCEPTION 'Archived comments must include archived_at and archived_by_user_id.';
	END IF;

	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_talent_comments_archive_only ON public.talent_comments;
CREATE TRIGGER trg_talent_comments_archive_only
BEFORE UPDATE ON public.talent_comments
FOR EACH ROW
EXECUTE FUNCTION public.enforce_talent_comment_archive_only();

ALTER TABLE public.talent_comment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.talent_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "talent comment types authenticated select" ON public.talent_comment_types;
DROP POLICY IF EXISTS "talent comment types admin manage" ON public.talent_comment_types;

CREATE POLICY "talent comment types authenticated select" ON public.talent_comment_types
FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "talent comment types admin manage" ON public.talent_comment_types
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "talent comments select by access" ON public.talent_comments;
DROP POLICY IF EXISTS "talent comments insert by access" ON public.talent_comments;
DROP POLICY IF EXISTS "talent comments archive by permission" ON public.talent_comments;

CREATE POLICY "talent comments select by access" ON public.talent_comments
FOR SELECT USING (public.can_access_talent(talent_id));

CREATE POLICY "talent comments insert by access" ON public.talent_comments
FOR INSERT WITH CHECK (
	public.can_create_talent_comment(talent_id)
	AND author_user_id = auth.uid()
	AND public.has_role(author_role)
);

CREATE POLICY "talent comments archive by permission" ON public.talent_comments
FOR UPDATE USING (public.can_archive_talent_comment(id))
WITH CHECK (
	public.can_archive_talent_comment(id)
	AND archived_at IS NOT NULL
	AND archived_by_user_id = auth.uid()
);
