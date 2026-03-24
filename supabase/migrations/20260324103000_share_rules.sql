DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'share_access_level') THEN
		CREATE TYPE public.share_access_level AS ENUM ('none', 'read', 'write');
	END IF;
END
$$;

ALTER TYPE public.audit_action_type ADD VALUE IF NOT EXISTS 'SHARE_RULE_CONFIGURED';
ALTER TYPE public.audit_action_type ADD VALUE IF NOT EXISTS 'SHARE_RULE_REVOKED';

CREATE TABLE IF NOT EXISTS public.organisation_share_rules (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	source_organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
	target_organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
	access_level public.share_access_level NOT NULL,
	allow_target_logo_export boolean NOT NULL DEFAULT false,
	created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
	updated_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT organisation_share_rules_no_self_share_chk CHECK (
		source_organisation_id <> target_organisation_id
	),
	CONSTRAINT organisation_share_rules_access_level_chk CHECK (
		access_level IN ('read'::public.share_access_level, 'write'::public.share_access_level)
	),
	CONSTRAINT organisation_share_rules_unique_pair_key UNIQUE (
		source_organisation_id,
		target_organisation_id
	)
);

CREATE TABLE IF NOT EXISTS public.talent_share_rules (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	source_organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
	target_organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
	talent_id uuid NOT NULL REFERENCES public.talents(id) ON DELETE CASCADE,
	access_level public.share_access_level NOT NULL,
	allow_target_logo_export boolean NOT NULL DEFAULT false,
	created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
	updated_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT talent_share_rules_no_self_share_chk CHECK (
		source_organisation_id <> target_organisation_id
	),
	CONSTRAINT talent_share_rules_unique_pair_key UNIQUE (
		source_organisation_id,
		target_organisation_id,
		talent_id
	)
);

CREATE INDEX IF NOT EXISTS organisation_share_rules_target_source_idx
	ON public.organisation_share_rules (target_organisation_id, source_organisation_id);

CREATE INDEX IF NOT EXISTS talent_share_rules_target_source_idx
	ON public.talent_share_rules (target_organisation_id, source_organisation_id);

CREATE INDEX IF NOT EXISTS talent_share_rules_target_talent_idx
	ON public.talent_share_rules (target_organisation_id, talent_id);

CREATE OR REPLACE FUNCTION public.resolve_talent_share_access(
	source_org_id uuid,
	target_org_id uuid,
	target_talent_id uuid
)
RETURNS TABLE(
	access_level public.share_access_level,
	allow_target_logo_export boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	WITH direct_rule AS (
		SELECT tsr.access_level, tsr.allow_target_logo_export
		FROM public.talent_share_rules tsr
		WHERE tsr.source_organisation_id = source_org_id
			AND tsr.target_organisation_id = target_org_id
			AND tsr.talent_id = target_talent_id
		LIMIT 1
	),
	org_rule AS (
		SELECT osr.access_level, osr.allow_target_logo_export
		FROM public.organisation_share_rules osr
		WHERE osr.source_organisation_id = source_org_id
			AND osr.target_organisation_id = target_org_id
		LIMIT 1
	)
	SELECT
		COALESCE(
			(SELECT access_level FROM direct_rule),
			(SELECT access_level FROM org_rule),
			'none'::public.share_access_level
		) AS access_level,
		COALESCE(
			(SELECT allow_target_logo_export FROM direct_rule),
			(SELECT allow_target_logo_export FROM org_rule),
			false
		) AS allow_target_logo_export;
$$;

CREATE OR REPLACE FUNCTION public.current_user_accessible_org_ids()
RETURNS TABLE(organisation_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT o.id
	FROM public.organisations o
	WHERE public.is_admin()

	UNION

	SELECT ou.organisation_id
	FROM public.organisation_users ou
	WHERE ou.user_id = auth.uid()

	UNION

	SELECT osr.source_organisation_id
	FROM public.organisation_share_rules osr
	WHERE osr.target_organisation_id = public.current_user_home_org_id()
		AND (
			public.has_role('broker')
			OR public.has_role('employer')
		)

	UNION

	SELECT tsr.source_organisation_id
	FROM public.talent_share_rules tsr
	WHERE tsr.target_organisation_id = public.current_user_home_org_id()
		AND tsr.access_level <> 'none'::public.share_access_level
		AND (
			public.has_role('broker')
			OR public.has_role('employer')
		)

	UNION

	SELECT ot.organisation_id
	FROM public.organisation_talents ot
	JOIN public.talents t ON t.id = ot.talent_id
	WHERE t.user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.can_access_talent(target_talent_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	WITH actor_home AS (
		SELECT public.current_user_home_org_id() AS organisation_id
	),
	talent_org AS (
		SELECT ot.organisation_id
		FROM public.organisation_talents ot
		WHERE ot.talent_id = target_talent_id
		ORDER BY COALESCE(ot.updated_at, ot.created_at) DESC, ot.created_at DESC
		LIMIT 1
	),
	effective_access AS (
		SELECT
			CASE
				WHEN talent_org.organisation_id IS NULL THEN 'none'::public.share_access_level
				WHEN actor_home.organisation_id IS NULL THEN 'none'::public.share_access_level
				WHEN talent_org.organisation_id = actor_home.organisation_id THEN 'write'::public.share_access_level
				ELSE (
					SELECT resolved.access_level
					FROM public.resolve_talent_share_access(
						talent_org.organisation_id,
						actor_home.organisation_id,
						target_talent_id
					) resolved
				)
			END AS access_level
		FROM actor_home
		CROSS JOIN talent_org
	)
	SELECT
		public.is_admin()
		OR EXISTS (
			SELECT 1
			FROM public.talents t
			WHERE t.id = target_talent_id
				AND t.user_id = auth.uid()
		)
		OR EXISTS (
			SELECT 1
			FROM effective_access ea
			WHERE (public.has_role('broker') OR public.has_role('employer'))
				AND ea.access_level IN ('read'::public.share_access_level, 'write'::public.share_access_level)
		);
$$;

CREATE OR REPLACE FUNCTION public.can_edit_talent(target_talent_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	WITH actor_home AS (
		SELECT public.current_user_home_org_id() AS organisation_id
	),
	talent_org AS (
		SELECT ot.organisation_id
		FROM public.organisation_talents ot
		WHERE ot.talent_id = target_talent_id
		ORDER BY COALESCE(ot.updated_at, ot.created_at) DESC, ot.created_at DESC
		LIMIT 1
	),
	effective_access AS (
		SELECT
			CASE
				WHEN talent_org.organisation_id IS NULL THEN 'none'::public.share_access_level
				WHEN actor_home.organisation_id IS NULL THEN 'none'::public.share_access_level
				WHEN talent_org.organisation_id = actor_home.organisation_id THEN 'write'::public.share_access_level
				ELSE (
					SELECT resolved.access_level
					FROM public.resolve_talent_share_access(
						talent_org.organisation_id,
						actor_home.organisation_id,
						target_talent_id
					) resolved
				)
			END AS access_level
		FROM actor_home
		CROSS JOIN talent_org
	)
	SELECT
		public.is_admin()
		OR EXISTS (
			SELECT 1
			FROM public.talents t
			WHERE t.id = target_talent_id
				AND t.user_id = auth.uid()
		)
		OR EXISTS (
			SELECT 1
			FROM effective_access ea
			WHERE (public.has_role('broker') OR public.has_role('employer'))
				AND ea.access_level = 'write'::public.share_access_level
		);
$$;

ALTER TABLE public.organisation_share_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.talent_share_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "organisation share rules read" ON public.organisation_share_rules;
DROP POLICY IF EXISTS "organisation share rules insert" ON public.organisation_share_rules;
DROP POLICY IF EXISTS "organisation share rules update" ON public.organisation_share_rules;
DROP POLICY IF EXISTS "organisation share rules delete" ON public.organisation_share_rules;

CREATE POLICY "organisation share rules read" ON public.organisation_share_rules
FOR SELECT USING (
	public.is_admin()
	OR source_organisation_id = public.current_user_home_org_id()
	OR target_organisation_id = public.current_user_home_org_id()
);

CREATE POLICY "organisation share rules insert" ON public.organisation_share_rules
FOR INSERT WITH CHECK (
	public.is_admin()
	OR (
		(public.has_role('broker') OR public.has_role('employer'))
		AND source_organisation_id = public.current_user_home_org_id()
		AND created_by_user_id = auth.uid()
		AND updated_by_user_id = auth.uid()
	)
);

CREATE POLICY "organisation share rules update" ON public.organisation_share_rules
FOR UPDATE USING (
	public.is_admin()
	OR (
		(public.has_role('broker') OR public.has_role('employer'))
		AND source_organisation_id = public.current_user_home_org_id()
	)
)
WITH CHECK (
	public.is_admin()
	OR (
		(public.has_role('broker') OR public.has_role('employer'))
		AND source_organisation_id = public.current_user_home_org_id()
		AND updated_by_user_id = auth.uid()
	)
);

CREATE POLICY "organisation share rules delete" ON public.organisation_share_rules
FOR DELETE USING (
	public.is_admin()
	OR (
		(public.has_role('broker') OR public.has_role('employer'))
		AND source_organisation_id = public.current_user_home_org_id()
	)
);

DROP POLICY IF EXISTS "talent share rules read" ON public.talent_share_rules;
DROP POLICY IF EXISTS "talent share rules insert" ON public.talent_share_rules;
DROP POLICY IF EXISTS "talent share rules update" ON public.talent_share_rules;
DROP POLICY IF EXISTS "talent share rules delete" ON public.talent_share_rules;

CREATE POLICY "talent share rules read" ON public.talent_share_rules
FOR SELECT USING (
	public.is_admin()
	OR source_organisation_id = public.current_user_home_org_id()
	OR target_organisation_id = public.current_user_home_org_id()
);

CREATE POLICY "talent share rules insert" ON public.talent_share_rules
FOR INSERT WITH CHECK (
	public.is_admin()
	OR (
		(public.has_role('broker') OR public.has_role('employer'))
		AND source_organisation_id = public.current_user_home_org_id()
		AND created_by_user_id = auth.uid()
		AND updated_by_user_id = auth.uid()
	)
);

CREATE POLICY "talent share rules update" ON public.talent_share_rules
FOR UPDATE USING (
	public.is_admin()
	OR (
		(public.has_role('broker') OR public.has_role('employer'))
		AND source_organisation_id = public.current_user_home_org_id()
	)
)
WITH CHECK (
	public.is_admin()
	OR (
		(public.has_role('broker') OR public.has_role('employer'))
		AND source_organisation_id = public.current_user_home_org_id()
		AND updated_by_user_id = auth.uid()
	)
);

CREATE POLICY "talent share rules delete" ON public.talent_share_rules
FOR DELETE USING (
	public.is_admin()
	OR (
		(public.has_role('broker') OR public.has_role('employer'))
		AND source_organisation_id = public.current_user_home_org_id()
	)
);
