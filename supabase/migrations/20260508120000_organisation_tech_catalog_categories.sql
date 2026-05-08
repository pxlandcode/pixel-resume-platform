ALTER TABLE public.tech_categories
	ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'global',
	ADD COLUMN IF NOT EXISTS organisation_id uuid REFERENCES public.organisations(id) ON DELETE CASCADE;

ALTER TABLE public.tech_categories
	DROP CONSTRAINT IF EXISTS tech_categories_scope_chk,
	ADD CONSTRAINT tech_categories_scope_chk CHECK (scope IN ('global', 'organisation'));

ALTER TABLE public.tech_categories
	DROP CONSTRAINT IF EXISTS tech_categories_scope_org_chk,
	ADD CONSTRAINT tech_categories_scope_org_chk CHECK (
		(scope = 'global' AND organisation_id IS NULL)
		OR (scope = 'organisation' AND organisation_id IS NOT NULL)
	);

CREATE INDEX IF NOT EXISTS tech_categories_organisation_scope_idx
	ON public.tech_categories (organisation_id, scope, is_active);

CREATE TABLE IF NOT EXISTS public.organisation_tech_catalog_category_overrides (
	organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
	category_id text NOT NULL REFERENCES public.tech_categories(id) ON DELETE CASCADE,
	sort_order integer,
	is_hidden boolean NOT NULL DEFAULT false,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (organisation_id, category_id)
);

CREATE INDEX IF NOT EXISTS org_tech_catalog_category_overrides_sort_idx
	ON public.organisation_tech_catalog_category_overrides (organisation_id, sort_order);

CREATE INDEX IF NOT EXISTS org_tech_catalog_category_overrides_category_idx
	ON public.organisation_tech_catalog_category_overrides (category_id);

CREATE OR REPLACE FUNCTION public.enforce_org_tech_catalog_category_override_target()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	target_scope text;
	target_organisation_id uuid;
BEGIN
	SELECT tc.scope, tc.organisation_id
	INTO target_scope, target_organisation_id
	FROM public.tech_categories tc
	WHERE tc.id = NEW.category_id;

	IF target_scope IS NULL THEN
		RAISE EXCEPTION 'Tech catalog category override target not found.';
	END IF;

	IF target_scope = 'organisation' AND target_organisation_id IS DISTINCT FROM NEW.organisation_id THEN
		RAISE EXCEPTION 'Organisation tech catalog category overrides may only target organisation categories from the same organisation.';
	END IF;

	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_org_tech_catalog_category_overrides_set_updated_at
	ON public.organisation_tech_catalog_category_overrides;
CREATE TRIGGER trg_org_tech_catalog_category_overrides_set_updated_at
BEFORE UPDATE ON public.organisation_tech_catalog_category_overrides
FOR EACH ROW
EXECUTE FUNCTION public.set_tech_catalog_updated_at();

DROP TRIGGER IF EXISTS trg_org_tech_catalog_category_overrides_valid_target
	ON public.organisation_tech_catalog_category_overrides;
CREATE TRIGGER trg_org_tech_catalog_category_overrides_valid_target
BEFORE INSERT OR UPDATE ON public.organisation_tech_catalog_category_overrides
FOR EACH ROW
EXECUTE FUNCTION public.enforce_org_tech_catalog_category_override_target();

ALTER TABLE public.organisation_tech_catalog_category_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org tech category overrides select by access"
	ON public.organisation_tech_catalog_category_overrides;
DROP POLICY IF EXISTS "org tech category overrides manage by home org"
	ON public.organisation_tech_catalog_category_overrides;

CREATE POLICY "org tech category overrides select by access"
ON public.organisation_tech_catalog_category_overrides
FOR SELECT USING (
	auth.uid() IS NOT NULL
	AND public.can_access_organisation(organisation_id)
);

CREATE POLICY "org tech category overrides manage by home org"
ON public.organisation_tech_catalog_category_overrides
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

DROP POLICY IF EXISTS "tech categories authenticated select" ON public.tech_categories;
DROP POLICY IF EXISTS "tech categories admin manage" ON public.tech_categories;
DROP POLICY IF EXISTS "tech categories org insert by home org" ON public.tech_categories;
DROP POLICY IF EXISTS "tech categories org update by home org" ON public.tech_categories;
DROP POLICY IF EXISTS "tech categories org delete by home org" ON public.tech_categories;

CREATE POLICY "tech categories authenticated select" ON public.tech_categories
FOR SELECT USING (
	auth.uid() IS NOT NULL
	AND (
		scope = 'global'
		OR (
			organisation_id IS NOT NULL
			AND public.can_access_organisation(organisation_id)
		)
	)
);

CREATE POLICY "tech categories admin manage" ON public.tech_categories
USING (
	scope = 'global'
	AND public.is_admin()
)
WITH CHECK (
	scope = 'global'
	AND organisation_id IS NULL
	AND public.is_admin()
);

CREATE POLICY "tech categories org insert by home org" ON public.tech_categories
FOR INSERT WITH CHECK (
	scope = 'organisation'
	AND organisation_id IS NOT NULL
	AND (
		public.is_admin()
		OR (
			(public.has_role('broker') OR public.has_role('employer'))
			AND organisation_id = public.current_user_home_org_id()
		)
	)
);

CREATE POLICY "tech categories org update by home org" ON public.tech_categories
FOR UPDATE USING (
	scope = 'organisation'
	AND organisation_id IS NOT NULL
	AND (
		public.is_admin()
		OR (
			(public.has_role('broker') OR public.has_role('employer'))
			AND organisation_id = public.current_user_home_org_id()
		)
	)
)
WITH CHECK (
	scope = 'organisation'
	AND organisation_id IS NOT NULL
	AND (
		public.is_admin()
		OR (
			(public.has_role('broker') OR public.has_role('employer'))
			AND organisation_id = public.current_user_home_org_id()
		)
	)
);

CREATE POLICY "tech categories org delete by home org" ON public.tech_categories
FOR DELETE USING (
	scope = 'organisation'
	AND organisation_id IS NOT NULL
	AND (
		public.is_admin()
		OR (
			(public.has_role('broker') OR public.has_role('employer'))
			AND organisation_id = public.current_user_home_org_id()
		)
	)
);
