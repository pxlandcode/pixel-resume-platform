CREATE TABLE IF NOT EXISTS public.organisation_tech_catalog_item_overrides (
	organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
	tech_catalog_item_id uuid NOT NULL REFERENCES public.tech_catalog_items(id) ON DELETE CASCADE,
	sort_order integer,
	is_hidden boolean NOT NULL DEFAULT false,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (organisation_id, tech_catalog_item_id)
);

CREATE INDEX IF NOT EXISTS org_tech_catalog_item_overrides_sort_idx
	ON public.organisation_tech_catalog_item_overrides (organisation_id, sort_order);

CREATE INDEX IF NOT EXISTS org_tech_catalog_item_overrides_item_idx
	ON public.organisation_tech_catalog_item_overrides (tech_catalog_item_id);

CREATE OR REPLACE FUNCTION public.enforce_org_tech_catalog_item_override_target()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	target_scope text;
	target_organisation_id uuid;
BEGIN
	SELECT tci.scope, tci.organisation_id
	INTO target_scope, target_organisation_id
	FROM public.tech_catalog_items tci
	WHERE tci.id = NEW.tech_catalog_item_id;

	IF target_scope IS NULL THEN
		RAISE EXCEPTION 'Tech catalog item override target not found.';
	END IF;

	IF target_scope = 'organisation' AND target_organisation_id IS DISTINCT FROM NEW.organisation_id THEN
		RAISE EXCEPTION 'Organisation tech catalog item overrides may only target organisation items from the same organisation.';
	END IF;

	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_org_tech_catalog_item_overrides_set_updated_at
	ON public.organisation_tech_catalog_item_overrides;
CREATE TRIGGER trg_org_tech_catalog_item_overrides_set_updated_at
BEFORE UPDATE ON public.organisation_tech_catalog_item_overrides
FOR EACH ROW
EXECUTE FUNCTION public.set_tech_catalog_updated_at();

DROP TRIGGER IF EXISTS trg_org_tech_catalog_item_overrides_valid_target
	ON public.organisation_tech_catalog_item_overrides;
CREATE TRIGGER trg_org_tech_catalog_item_overrides_valid_target
BEFORE INSERT OR UPDATE ON public.organisation_tech_catalog_item_overrides
FOR EACH ROW
EXECUTE FUNCTION public.enforce_org_tech_catalog_item_override_target();

DO $$
BEGIN
	IF to_regclass('public.organisation_tech_catalog_exclusions') IS NOT NULL THEN
		INSERT INTO public.organisation_tech_catalog_item_overrides (
			organisation_id,
			tech_catalog_item_id,
			is_hidden,
			created_at,
			updated_at
		)
		SELECT
			organisation_id,
			tech_catalog_item_id,
			true,
			created_at,
			now()
		FROM public.organisation_tech_catalog_exclusions
		ON CONFLICT (organisation_id, tech_catalog_item_id) DO UPDATE
		SET
			is_hidden = true,
			updated_at = now();

		DROP TABLE public.organisation_tech_catalog_exclusions;
	END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.enforce_global_tech_catalog_exclusion();

ALTER TABLE public.organisation_tech_catalog_item_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org tech item overrides select by access"
	ON public.organisation_tech_catalog_item_overrides;
DROP POLICY IF EXISTS "org tech item overrides manage by home org"
	ON public.organisation_tech_catalog_item_overrides;

CREATE POLICY "org tech item overrides select by access"
ON public.organisation_tech_catalog_item_overrides
FOR SELECT USING (
	auth.uid() IS NOT NULL
	AND public.can_access_organisation(organisation_id)
);

CREATE POLICY "org tech item overrides manage by home org"
ON public.organisation_tech_catalog_item_overrides
USING (
	public.is_admin()
	OR (
		(public.has_role('broker') OR public.has_role('employer'))
		AND organisation_id = public.current_user_home_org_id()
	)
)
WITH CHECK (
	public.is_admin()
	OR (
		(public.has_role('broker') OR public.has_role('employer'))
		AND organisation_id = public.current_user_home_org_id()
	)
);
