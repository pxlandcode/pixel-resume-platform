CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.roles DROP CONSTRAINT IF EXISTS roles_key_check;
ALTER TABLE public.roles
	ADD CONSTRAINT roles_key_check
	CHECK (key IN ('admin', 'organisation_admin', 'talent', 'employer', 'broker'));

INSERT INTO public.roles (key)
VALUES ('organisation_admin')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_organisation_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT public.has_role('organisation_admin');
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT
		public.is_admin()
		OR (
			public.is_organisation_admin()
			AND public.current_user_home_org_id() = org_id
		);
$$;

CREATE TABLE IF NOT EXISTS public.billing_plan_versions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	plan_family text NOT NULL CHECK (plan_family IN ('standard', 'broker')),
	plan_code text NOT NULL,
	version_number integer NOT NULL CHECK (version_number > 0),
	plan_name text NOT NULL,
	currency_code text NOT NULL DEFAULT 'SEK',
	monthly_price_ore bigint NOT NULL CHECK (monthly_price_ore >= 0),
	included_talent_profiles integer CHECK (included_talent_profiles IS NULL OR included_talent_profiles >= 0),
	included_talent_user_seats integer CHECK (included_talent_user_seats IS NULL OR included_talent_user_seats >= 0),
	included_admin_seats integer CHECK (included_admin_seats IS NULL OR included_admin_seats >= 0),
	sort_order integer NOT NULL DEFAULT 100,
	features_json jsonb NOT NULL DEFAULT '[]'::jsonb,
	metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
	is_active boolean NOT NULL DEFAULT true,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT billing_plan_versions_unique_key UNIQUE (plan_family, plan_code, version_number),
	CONSTRAINT billing_plan_versions_features_array_chk CHECK (jsonb_typeof(features_json) = 'array'),
	CONSTRAINT billing_plan_versions_metadata_object_chk CHECK (jsonb_typeof(metadata_json) = 'object')
);

CREATE TABLE IF NOT EXISTS public.billing_addon_versions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	addon_code text NOT NULL,
	version_number integer NOT NULL CHECK (version_number > 0),
	addon_name text NOT NULL,
	billing_type text NOT NULL CHECK (billing_type IN ('monthly', 'one_time')),
	currency_code text NOT NULL DEFAULT 'SEK',
	unit_price_ore bigint NOT NULL CHECK (unit_price_ore >= 0),
	package_quantity integer CHECK (package_quantity IS NULL OR package_quantity > 0),
	applies_to_metric text CHECK (
		applies_to_metric IS NULL
		OR applies_to_metric IN ('talent_profiles', 'talent_user_seats', 'admin_seats')
	),
	sort_order integer NOT NULL DEFAULT 100,
	metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
	is_active boolean NOT NULL DEFAULT true,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT billing_addon_versions_unique_key UNIQUE (addon_code, version_number),
	CONSTRAINT billing_addon_versions_metadata_object_chk CHECK (jsonb_typeof(metadata_json) = 'object')
);

CREATE TABLE IF NOT EXISTS public.organisation_billing_assignments (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
	plan_version_id uuid NOT NULL REFERENCES public.billing_plan_versions(id) ON DELETE RESTRICT,
	effective_month date NOT NULL,
	price_override_ore bigint CHECK (price_override_ore IS NULL OR price_override_ore >= 0),
	included_talent_profiles_override integer CHECK (
		included_talent_profiles_override IS NULL OR included_talent_profiles_override >= 0
	),
	included_talent_user_seats_override integer CHECK (
		included_talent_user_seats_override IS NULL OR included_talent_user_seats_override >= 0
	),
	included_admin_seats_override integer CHECK (
		included_admin_seats_override IS NULL OR included_admin_seats_override >= 0
	),
	notes text,
	created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT organisation_billing_assignments_unique_month UNIQUE (organisation_id, effective_month),
	CONSTRAINT organisation_billing_assignments_month_start_chk CHECK (
		date_trunc('month', effective_month::timestamp) = effective_month::timestamp
	)
);

CREATE TABLE IF NOT EXISTS public.organisation_billing_addons (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
	addon_version_id uuid NOT NULL REFERENCES public.billing_addon_versions(id) ON DELETE RESTRICT,
	effective_month date NOT NULL,
	end_month date,
	quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
	price_override_ore bigint CHECK (price_override_ore IS NULL OR price_override_ore >= 0),
	notes text,
	created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT organisation_billing_addons_month_start_chk CHECK (
		date_trunc('month', effective_month::timestamp) = effective_month::timestamp
	),
	CONSTRAINT organisation_billing_addons_end_month_start_chk CHECK (
		end_month IS NULL OR date_trunc('month', end_month::timestamp) = end_month::timestamp
	),
	CONSTRAINT organisation_billing_addons_end_after_effective_chk CHECK (
		end_month IS NULL OR end_month > effective_month
	)
);

CREATE TABLE IF NOT EXISTS public.organisation_usage_snapshots (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
	captured_at timestamptz NOT NULL DEFAULT now(),
	talent_profiles_count integer NOT NULL CHECK (talent_profiles_count >= 0),
	talent_user_seats_count integer NOT NULL CHECK (talent_user_seats_count >= 0),
	admin_seats_count integer NOT NULL CHECK (admin_seats_count >= 0),
	source_table text,
	source_action text,
	metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT organisation_usage_snapshots_metadata_object_chk CHECK (
		jsonb_typeof(metadata_json) = 'object'
	)
);

CREATE TABLE IF NOT EXISTS public.organisation_billing_periods (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
	period_month date NOT NULL,
	currency_code text NOT NULL DEFAULT 'SEK',
	plan_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
	addons_snapshot_json jsonb NOT NULL DEFAULT '[]'::jsonb,
	metrics_json jsonb NOT NULL DEFAULT '{}'::jsonb,
	totals_json jsonb NOT NULL DEFAULT '{}'::jsonb,
	frozen_at timestamptz NOT NULL DEFAULT now(),
	source_generated_at timestamptz NOT NULL DEFAULT now(),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT organisation_billing_periods_unique_month UNIQUE (organisation_id, period_month),
	CONSTRAINT organisation_billing_periods_month_start_chk CHECK (
		date_trunc('month', period_month::timestamp) = period_month::timestamp
	),
	CONSTRAINT organisation_billing_periods_plan_snapshot_object_chk CHECK (
		jsonb_typeof(plan_snapshot_json) = 'object'
	),
	CONSTRAINT organisation_billing_periods_addons_snapshot_array_chk CHECK (
		jsonb_typeof(addons_snapshot_json) = 'array'
	),
	CONSTRAINT organisation_billing_periods_metrics_snapshot_object_chk CHECK (
		jsonb_typeof(metrics_json) = 'object'
	),
	CONSTRAINT organisation_billing_periods_totals_snapshot_object_chk CHECK (
		jsonb_typeof(totals_json) = 'object'
	)
);

CREATE TABLE IF NOT EXISTS public.organisation_billing_period_reviews (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
	period_month date NOT NULL,
	billing_period_id uuid REFERENCES public.organisation_billing_periods(id) ON DELETE SET NULL,
	decision_flags_json jsonb NOT NULL DEFAULT '{}'::jsonb,
	notes text,
	updated_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT organisation_billing_period_reviews_unique_month UNIQUE (organisation_id, period_month),
	CONSTRAINT organisation_billing_period_reviews_month_start_chk CHECK (
		date_trunc('month', period_month::timestamp) = period_month::timestamp
	),
	CONSTRAINT organisation_billing_period_reviews_flags_object_chk CHECK (
		jsonb_typeof(decision_flags_json) = 'object'
	)
);

CREATE INDEX IF NOT EXISTS billing_plan_versions_family_active_idx
	ON public.billing_plan_versions (plan_family, is_active, sort_order, created_at DESC);

CREATE INDEX IF NOT EXISTS billing_addon_versions_active_idx
	ON public.billing_addon_versions (is_active, billing_type, sort_order, created_at DESC);

CREATE INDEX IF NOT EXISTS organisation_billing_assignments_lookup_idx
	ON public.organisation_billing_assignments (organisation_id, effective_month DESC);

CREATE INDEX IF NOT EXISTS organisation_billing_addons_lookup_idx
	ON public.organisation_billing_addons (organisation_id, effective_month DESC, end_month);

CREATE INDEX IF NOT EXISTS organisation_usage_snapshots_lookup_idx
	ON public.organisation_usage_snapshots (organisation_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS organisation_billing_periods_lookup_idx
	ON public.organisation_billing_periods (organisation_id, period_month DESC);

CREATE INDEX IF NOT EXISTS organisation_billing_period_reviews_lookup_idx
	ON public.organisation_billing_period_reviews (organisation_id, period_month DESC);

INSERT INTO public.billing_plan_versions (
	plan_family,
	plan_code,
	version_number,
	plan_name,
	currency_code,
	monthly_price_ore,
	included_talent_profiles,
	included_talent_user_seats,
	included_admin_seats,
	sort_order,
	features_json,
	metadata_json
)
VALUES
	(
		'standard',
		'basic',
		1,
		'Basic',
		'SEK',
		150000,
		50,
		50,
		3,
		10,
		'["White-label plattform","Profilredigering","PDF-export","AI-assistans"]'::jsonb,
		'{}'::jsonb
	),
	(
		'standard',
		'pro',
		1,
		'Pro',
		'SEK',
		400000,
		150,
		150,
		10,
		20,
		'["Prioriterad support"]'::jsonb,
		'{}'::jsonb
	),
	(
		'standard',
		'custom',
		1,
		'Custom',
		'SEK',
		1000000,
		500,
		500,
		25,
		30,
		'["Anpassade villkor"]'::jsonb,
		'{"minimum_price": true}'::jsonb
	),
	(
		'broker',
		'basic',
		1,
		'Broker Basic',
		'SEK',
		400000,
		100,
		NULL,
		3,
		40,
		'[]'::jsonb,
		'{}'::jsonb
	),
	(
		'broker',
		'pro',
		1,
		'Broker Pro',
		'SEK',
		800000,
		300,
		NULL,
		10,
		50,
		'[]'::jsonb,
		'{}'::jsonb
	),
	(
		'broker',
		'custom',
		1,
		'Broker Custom',
		'SEK',
		1900000,
		1000,
		NULL,
		25,
		60,
		'[]'::jsonb,
		'{"minimum_price": true}'::jsonb
	)
ON CONFLICT (plan_family, plan_code, version_number) DO NOTHING;

INSERT INTO public.billing_addon_versions (
	addon_code,
	version_number,
	addon_name,
	billing_type,
	currency_code,
	unit_price_ore,
	package_quantity,
	applies_to_metric,
	sort_order,
	metadata_json
)
VALUES
	(
		'standalone_talent_users_10',
		1,
		'Standalone talent users 10',
		'monthly',
		'SEK',
		75000,
		10,
		'talent_user_seats',
		10,
		'{}'::jsonb
	),
	(
		'standalone_talent_users_25',
		1,
		'Standalone talent users 25',
		'monthly',
		'SEK',
		150000,
		25,
		'talent_user_seats',
		20,
		'{}'::jsonb
	),
	(
		'standalone_talent_users_50',
		1,
		'Standalone talent users 50',
		'monthly',
		'SEK',
		250000,
		50,
		'talent_user_seats',
		30,
		'{}'::jsonb
	),
	(
		'setup_launch_support',
		1,
		'Setup / launch support',
		'one_time',
		'SEK',
		500000,
		NULL,
		NULL,
		40,
		'{}'::jsonb
	),
	(
		'custom_cv_template',
		1,
		'Custom CV template',
		'one_time',
		'SEK',
		100000,
		NULL,
		NULL,
		50,
		'{"price_range":"1000-3000 SEK"}'::jsonb
	),
	(
		'custom_mail_template',
		1,
		'Custom mail template',
		'one_time',
		'SEK',
		100000,
		NULL,
		NULL,
		60,
		'{"price_range":"1000-3000 SEK"}'::jsonb
	)
ON CONFLICT (addon_code, version_number) DO NOTHING;

CREATE OR REPLACE FUNCTION public.billing_current_usage_counts(p_organisation_id uuid)
RETURNS TABLE (
	talent_profiles_count integer,
	talent_user_seats_count integer,
	admin_seats_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT
		COALESCE((
			SELECT COUNT(DISTINCT ot.talent_id)::integer
			FROM public.organisation_talents ot
			WHERE ot.organisation_id = p_organisation_id
		), 0) AS talent_profiles_count,
		COALESCE((
			SELECT COUNT(DISTINCT ou.user_id)::integer
			FROM public.organisation_users ou
			JOIN public.user_roles ur ON ur.user_id = ou.user_id
			JOIN public.roles r ON r.id = ur.role_id
			WHERE ou.organisation_id = p_organisation_id
				AND r.key = 'talent'
		), 0) AS talent_user_seats_count,
		COALESCE((
			SELECT COUNT(DISTINCT ou.user_id)::integer
			FROM public.organisation_users ou
			JOIN public.user_roles ur ON ur.user_id = ou.user_id
			JOIN public.roles r ON r.id = ur.role_id
			WHERE ou.organisation_id = p_organisation_id
				AND r.key IN ('organisation_admin', 'broker', 'employer')
		), 0) AS admin_seats_count;
$$;

CREATE OR REPLACE FUNCTION public.billing_insert_usage_snapshot_if_changed(
	p_organisation_id uuid,
	p_source_table text DEFAULT NULL,
	p_source_action text DEFAULT NULL,
	p_metadata_json jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
	v_counts record;
	v_last_snapshot record;
BEGIN
	IF p_organisation_id IS NULL THEN
		RETURN;
	END IF;

	SELECT * INTO v_counts
	FROM public.billing_current_usage_counts(p_organisation_id);

	SELECT
		s.talent_profiles_count,
		s.talent_user_seats_count,
		s.admin_seats_count
	INTO v_last_snapshot
	FROM public.organisation_usage_snapshots s
	WHERE s.organisation_id = p_organisation_id
	ORDER BY s.captured_at DESC, s.id DESC
	LIMIT 1;

	IF v_last_snapshot.talent_profiles_count IS NOT NULL
		AND v_last_snapshot.talent_profiles_count = v_counts.talent_profiles_count
		AND v_last_snapshot.talent_user_seats_count = v_counts.talent_user_seats_count
		AND v_last_snapshot.admin_seats_count = v_counts.admin_seats_count THEN
		RETURN;
	END IF;

	INSERT INTO public.organisation_usage_snapshots (
		organisation_id,
		captured_at,
		talent_profiles_count,
		talent_user_seats_count,
		admin_seats_count,
		source_table,
		source_action,
		metadata_json
	)
	VALUES (
		p_organisation_id,
		now(),
		v_counts.talent_profiles_count,
		v_counts.talent_user_seats_count,
		v_counts.admin_seats_count,
		p_source_table,
		p_source_action,
		COALESCE(p_metadata_json, '{}'::jsonb)
	);
END;
$$;

CREATE OR REPLACE FUNCTION public.billing_refresh_usage_snapshot_for_org_memberships(
	p_user_id uuid,
	p_source_table text DEFAULT NULL,
	p_source_action text DEFAULT NULL,
	p_metadata_json jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
	v_organisation_id uuid;
BEGIN
	IF p_user_id IS NULL THEN
		RETURN;
	END IF;

	FOR v_organisation_id IN
		SELECT DISTINCT ou.organisation_id
		FROM public.organisation_users ou
		WHERE ou.user_id = p_user_id
	LOOP
		PERFORM public.billing_insert_usage_snapshot_if_changed(
			v_organisation_id,
			p_source_table,
			p_source_action,
			p_metadata_json
		);
	END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.billing_handle_organisation_talents_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
	IF TG_OP IN ('DELETE', 'UPDATE') THEN
		PERFORM public.billing_insert_usage_snapshot_if_changed(
			OLD.organisation_id,
			TG_TABLE_NAME,
			TG_OP,
			jsonb_build_object('talent_id', OLD.talent_id)
		);
	END IF;

	IF TG_OP IN ('INSERT', 'UPDATE') THEN
		PERFORM public.billing_insert_usage_snapshot_if_changed(
			NEW.organisation_id,
			TG_TABLE_NAME,
			TG_OP,
			jsonb_build_object('talent_id', NEW.talent_id)
		);
	END IF;

	RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.billing_handle_organisation_users_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
	IF TG_OP IN ('DELETE', 'UPDATE') THEN
		PERFORM public.billing_insert_usage_snapshot_if_changed(
			OLD.organisation_id,
			TG_TABLE_NAME,
			TG_OP,
			jsonb_build_object('user_id', OLD.user_id)
		);
	END IF;

	IF TG_OP IN ('INSERT', 'UPDATE') THEN
		PERFORM public.billing_insert_usage_snapshot_if_changed(
			NEW.organisation_id,
			TG_TABLE_NAME,
			TG_OP,
			jsonb_build_object('user_id', NEW.user_id)
		);
	END IF;

	RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.billing_handle_user_roles_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
	IF TG_OP IN ('DELETE', 'UPDATE') THEN
		PERFORM public.billing_refresh_usage_snapshot_for_org_memberships(
			OLD.user_id,
			TG_TABLE_NAME,
			TG_OP,
			jsonb_build_object('user_id', OLD.user_id)
		);
	END IF;

	IF TG_OP IN ('INSERT', 'UPDATE') THEN
		PERFORM public.billing_refresh_usage_snapshot_for_org_memberships(
			NEW.user_id,
			TG_TABLE_NAME,
			TG_OP,
			jsonb_build_object('user_id', NEW.user_id)
		);
	END IF;

	RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS billing_organisation_talents_usage_trigger ON public.organisation_talents;
CREATE TRIGGER billing_organisation_talents_usage_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.organisation_talents
FOR EACH ROW
EXECUTE FUNCTION public.billing_handle_organisation_talents_change();

DROP TRIGGER IF EXISTS billing_organisation_users_usage_trigger ON public.organisation_users;
CREATE TRIGGER billing_organisation_users_usage_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.organisation_users
FOR EACH ROW
EXECUTE FUNCTION public.billing_handle_organisation_users_change();

DROP TRIGGER IF EXISTS billing_user_roles_usage_trigger ON public.user_roles;
CREATE TRIGGER billing_user_roles_usage_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.billing_handle_user_roles_change();

INSERT INTO public.organisation_usage_snapshots (
	organisation_id,
	captured_at,
	talent_profiles_count,
	talent_user_seats_count,
	admin_seats_count,
	source_table,
	source_action,
	metadata_json
)
SELECT
	o.id,
	now(),
	counts.talent_profiles_count,
	counts.talent_user_seats_count,
	counts.admin_seats_count,
	'billing_seed',
	'INSERT',
	'{}'::jsonb
FROM public.organisations o
CROSS JOIN LATERAL public.billing_current_usage_counts(o.id) counts
WHERE NOT EXISTS (
	SELECT 1
	FROM public.organisation_usage_snapshots s
	WHERE s.organisation_id = o.id
);

ALTER TABLE public.billing_plan_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_addon_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_billing_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_billing_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_usage_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_billing_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_billing_period_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "billing plan versions read by billing viewers" ON public.billing_plan_versions;
DROP POLICY IF EXISTS "billing plan versions admin write" ON public.billing_plan_versions;
CREATE POLICY "billing plan versions read by billing viewers" ON public.billing_plan_versions
FOR SELECT USING (public.is_admin() OR public.is_organisation_admin());
CREATE POLICY "billing plan versions admin write" ON public.billing_plan_versions
FOR ALL USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "billing addon versions read by billing viewers" ON public.billing_addon_versions;
DROP POLICY IF EXISTS "billing addon versions admin write" ON public.billing_addon_versions;
CREATE POLICY "billing addon versions read by billing viewers" ON public.billing_addon_versions
FOR SELECT USING (public.is_admin() OR public.is_organisation_admin());
CREATE POLICY "billing addon versions admin write" ON public.billing_addon_versions
FOR ALL USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "organisation billing assignments read by billing viewers" ON public.organisation_billing_assignments;
DROP POLICY IF EXISTS "organisation billing assignments admin write" ON public.organisation_billing_assignments;
CREATE POLICY "organisation billing assignments read by billing viewers" ON public.organisation_billing_assignments
FOR SELECT USING (public.is_admin() OR public.is_org_admin(organisation_id));
CREATE POLICY "organisation billing assignments admin write" ON public.organisation_billing_assignments
FOR ALL USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "organisation billing addons read by billing viewers" ON public.organisation_billing_addons;
DROP POLICY IF EXISTS "organisation billing addons admin write" ON public.organisation_billing_addons;
CREATE POLICY "organisation billing addons read by billing viewers" ON public.organisation_billing_addons
FOR SELECT USING (public.is_admin() OR public.is_org_admin(organisation_id));
CREATE POLICY "organisation billing addons admin write" ON public.organisation_billing_addons
FOR ALL USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "organisation usage snapshots read by billing viewers" ON public.organisation_usage_snapshots;
CREATE POLICY "organisation usage snapshots read by billing viewers" ON public.organisation_usage_snapshots
FOR SELECT USING (public.is_admin() OR public.is_org_admin(organisation_id));

DROP POLICY IF EXISTS "organisation billing periods read by billing viewers" ON public.organisation_billing_periods;
CREATE POLICY "organisation billing periods read by billing viewers" ON public.organisation_billing_periods
FOR SELECT USING (public.is_admin() OR public.is_org_admin(organisation_id));

DROP POLICY IF EXISTS "organisation billing reviews read by billing viewers" ON public.organisation_billing_period_reviews;
DROP POLICY IF EXISTS "organisation billing reviews admin write" ON public.organisation_billing_period_reviews;
CREATE POLICY "organisation billing reviews read by billing viewers" ON public.organisation_billing_period_reviews
FOR SELECT USING (public.is_admin() OR public.is_org_admin(organisation_id));
CREATE POLICY "organisation billing reviews admin write" ON public.organisation_billing_period_reviews
FOR ALL USING (public.is_admin())
WITH CHECK (public.is_admin());
