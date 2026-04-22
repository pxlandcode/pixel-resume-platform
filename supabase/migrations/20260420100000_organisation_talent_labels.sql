ALTER TYPE public.audit_action_type ADD VALUE IF NOT EXISTS 'TALENT_LABEL_ASSIGNED';
ALTER TYPE public.audit_action_type ADD VALUE IF NOT EXISTS 'TALENT_LABEL_REMOVED';
ALTER TYPE public.audit_action_type ADD VALUE IF NOT EXISTS 'TALENT_LABEL_DEFINITION_CREATED';
ALTER TYPE public.audit_action_type ADD VALUE IF NOT EXISTS 'TALENT_LABEL_DEFINITION_UPDATED';
ALTER TYPE public.audit_action_type ADD VALUE IF NOT EXISTS 'TALENT_LABEL_DEFINITION_DELETED';

CREATE TABLE IF NOT EXISTS public.organisation_talent_label_definitions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
	name text NOT NULL,
	color_hex text NOT NULL,
	sort_order integer NOT NULL DEFAULT 0,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT organisation_talent_label_definitions_name_chk
		CHECK (length(trim(name)) BETWEEN 1 AND 60),
	CONSTRAINT organisation_talent_label_definitions_color_chk
		CHECK (color_hex ~ '^#[0-9A-F]{6}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS organisation_talent_label_definitions_org_id_id_uidx
	ON public.organisation_talent_label_definitions (organisation_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS organisation_talent_label_definitions_org_lower_name_uidx
	ON public.organisation_talent_label_definitions (organisation_id, lower(name));

CREATE INDEX IF NOT EXISTS organisation_talent_label_definitions_org_sort_idx
	ON public.organisation_talent_label_definitions (organisation_id, sort_order, created_at);

CREATE TABLE IF NOT EXISTS public.organisation_talent_label_assignments (
	organisation_id uuid NOT NULL,
	talent_id uuid NOT NULL REFERENCES public.talents(id) ON DELETE CASCADE,
	label_definition_id uuid NOT NULL,
	created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (organisation_id, talent_id, label_definition_id),
	CONSTRAINT organisation_talent_label_assignments_definition_fkey
		FOREIGN KEY (organisation_id, label_definition_id)
		REFERENCES public.organisation_talent_label_definitions (organisation_id, id)
		ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS organisation_talent_label_assignments_org_talent_idx
	ON public.organisation_talent_label_assignments (organisation_id, talent_id, created_at);

CREATE OR REPLACE FUNCTION public.touch_organisation_talent_label_definitions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	NEW.updated_at = now();
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organisation_talent_label_definitions_updated_at
	ON public.organisation_talent_label_definitions;

CREATE TRIGGER trg_organisation_talent_label_definitions_updated_at
BEFORE UPDATE ON public.organisation_talent_label_definitions
FOR EACH ROW
EXECUTE FUNCTION public.touch_organisation_talent_label_definitions_updated_at();

CREATE OR REPLACE FUNCTION public.seed_default_talent_label_definitions(target_organisation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
	seed_row record;
BEGIN
	IF target_organisation_id IS NULL THEN
		RETURN;
	END IF;

	FOR seed_row IN
		SELECT *
		FROM (
		VALUES
			('Red', '#FF5F57', 0),
			('Orange', '#FF9F0A', 1),
			('Yellow', '#FFD60A', 2),
			('Green', '#32D74B', 3),
			('Blue', '#0A84FF', 4),
			('Purple', '#BF5AF2', 5),
			('Gray', '#8E8E93', 6)
		) AS seed(name, color_hex, sort_order)
	LOOP
		BEGIN
			INSERT INTO public.organisation_talent_label_definitions (
				organisation_id,
				name,
				color_hex,
				sort_order
			)
			VALUES (
				target_organisation_id,
				seed_row.name,
				seed_row.color_hex,
				seed_row.sort_order
			);
		EXCEPTION
			WHEN unique_violation THEN
				NULL;
		END;
	END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_seed_default_talent_label_definitions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
	PERFORM public.seed_default_talent_label_definitions(NEW.id);
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_default_talent_label_definitions ON public.organisations;

CREATE TRIGGER trg_seed_default_talent_label_definitions
AFTER INSERT ON public.organisations
FOR EACH ROW
EXECUTE FUNCTION public.handle_seed_default_talent_label_definitions();

SELECT public.seed_default_talent_label_definitions(id)
FROM public.organisations;

CREATE OR REPLACE FUNCTION public.can_read_talent_label_definitions(target_organisation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT
		target_organisation_id IS NOT NULL
		AND public.current_user_home_org_id() IS NOT NULL
		AND target_organisation_id = public.current_user_home_org_id()
		AND (
			public.is_admin()
			OR public.has_role('organisation_admin')
			OR public.has_role('broker')
			OR public.has_role('employer')
		);
$$;

CREATE OR REPLACE FUNCTION public.can_manage_talent_label_definitions(target_organisation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT
		target_organisation_id IS NOT NULL
		AND public.current_user_home_org_id() IS NOT NULL
		AND target_organisation_id = public.current_user_home_org_id()
		AND (
			public.is_admin()
			OR public.has_role('organisation_admin')
		);
$$;

CREATE OR REPLACE FUNCTION public.can_manage_talent_label_assignment(
	target_organisation_id uuid,
	target_talent_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT
		target_organisation_id IS NOT NULL
		AND target_talent_id IS NOT NULL
		AND public.current_user_home_org_id() IS NOT NULL
		AND target_organisation_id = public.current_user_home_org_id()
		AND (
			public.is_admin()
			OR public.has_role('organisation_admin')
			OR public.has_role('broker')
			OR public.has_role('employer')
		)
		AND public.can_access_talent(target_talent_id);
$$;

ALTER TABLE public.organisation_talent_label_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_talent_label_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "talent label definitions read" ON public.organisation_talent_label_definitions;
DROP POLICY IF EXISTS "talent label definitions insert" ON public.organisation_talent_label_definitions;
DROP POLICY IF EXISTS "talent label definitions update" ON public.organisation_talent_label_definitions;
DROP POLICY IF EXISTS "talent label definitions delete" ON public.organisation_talent_label_definitions;

CREATE POLICY "talent label definitions read" ON public.organisation_talent_label_definitions
FOR SELECT USING (public.can_read_talent_label_definitions(organisation_id));

CREATE POLICY "talent label definitions insert" ON public.organisation_talent_label_definitions
FOR INSERT WITH CHECK (public.can_manage_talent_label_definitions(organisation_id));

CREATE POLICY "talent label definitions update" ON public.organisation_talent_label_definitions
FOR UPDATE USING (public.can_manage_talent_label_definitions(organisation_id))
WITH CHECK (public.can_manage_talent_label_definitions(organisation_id));

CREATE POLICY "talent label definitions delete" ON public.organisation_talent_label_definitions
FOR DELETE USING (public.can_manage_talent_label_definitions(organisation_id));

DROP POLICY IF EXISTS "talent label assignments read" ON public.organisation_talent_label_assignments;
DROP POLICY IF EXISTS "talent label assignments insert" ON public.organisation_talent_label_assignments;
DROP POLICY IF EXISTS "talent label assignments delete" ON public.organisation_talent_label_assignments;

CREATE POLICY "talent label assignments read" ON public.organisation_talent_label_assignments
FOR SELECT USING (public.can_manage_talent_label_assignment(organisation_id, talent_id));

CREATE POLICY "talent label assignments insert" ON public.organisation_talent_label_assignments
FOR INSERT WITH CHECK (
	public.can_manage_talent_label_assignment(organisation_id, talent_id)
	AND EXISTS (
		SELECT 1
		FROM public.organisation_talent_label_definitions d
		WHERE d.organisation_id = organisation_talent_label_assignments.organisation_id
			AND d.id = organisation_talent_label_assignments.label_definition_id
	)
);

CREATE POLICY "talent label assignments delete" ON public.organisation_talent_label_assignments
FOR DELETE USING (public.can_manage_talent_label_assignment(organisation_id, talent_id));
