-- Organisation access + template rules migration
-- Adds organisation templates, cross-organisation access grants,
-- one-home-org constraints, and org-scoped RLS helpers/policies.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.organisation_templates (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
	template_key text NOT NULL DEFAULT 'default',
	template_json jsonb NOT NULL DEFAULT '{}'::jsonb,
	template_version integer NOT NULL DEFAULT 1,
	main_logotype_path text,
	accent_logo_path text,
	end_logo_path text,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.organisations
	ADD COLUMN IF NOT EXISTS homepage_url text;

ALTER TABLE public.organisation_templates
	ADD COLUMN IF NOT EXISTS main_logotype_path text,
	ADD COLUMN IF NOT EXISTS accent_logo_path text,
	ADD COLUMN IF NOT EXISTS end_logo_path text;

CREATE TABLE IF NOT EXISTS public.organisation_access_grants (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
	grantee_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
	created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT organisation_access_grants_organisation_id_grantee_user_id_key UNIQUE (organisation_id, grantee_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS organisation_templates_organisation_id_uidx
	ON public.organisation_templates (organisation_id);

CREATE INDEX IF NOT EXISTS organisation_access_grants_organisation_id_idx
	ON public.organisation_access_grants (organisation_id);

CREATE INDEX IF NOT EXISTS organisation_access_grants_grantee_user_id_idx
	ON public.organisation_access_grants (grantee_user_id);

INSERT INTO storage.buckets (
	id,
	name,
	public,
	file_size_limit
)
VALUES (
	'organisation-images',
	'organisation-images',
	true,
	10485760
)
ON CONFLICT (id)
DO UPDATE SET
	name = EXCLUDED.name,
	public = EXCLUDED.public,
	file_size_limit = EXCLUDED.file_size_limit;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'storage'
			AND tablename = 'objects'
			AND policyname = 'organisation images public read'
	) THEN
		EXECUTE 'DROP POLICY "organisation images public read" ON storage.objects';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "organisation images public read" ON storage.objects
		FOR SELECT USING (bucket_id = 'organisation-images');
	$policy$;

	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'storage'
			AND tablename = 'objects'
			AND policyname = 'organisation images admin manage'
	) THEN
		EXECUTE 'DROP POLICY "organisation images admin manage" ON storage.objects';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "organisation images admin manage" ON storage.objects
		FOR ALL USING (
			bucket_id = 'organisation-images'
			AND public.is_admin()
		)
		WITH CHECK (
			bucket_id = 'organisation-images'
			AND public.is_admin()
		);
	$policy$;
END$$;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'organisation_templates'
			AND column_name = 'logo_url'
	) THEN
		EXECUTE '
			UPDATE public.organisation_templates
			SET main_logotype_path = COALESCE(main_logotype_path, logo_url),
				updated_at = now()
			WHERE logo_url IS NOT NULL
		';
	END IF;
END$$;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'organisation_templates'
			AND column_name = 'header_logo_path'
	) THEN
		EXECUTE '
			UPDATE public.organisation_templates
			SET main_logotype_path = COALESCE(main_logotype_path, header_logo_path),
				updated_at = now()
			WHERE header_logo_path IS NOT NULL
		';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'organisation_templates'
			AND column_name = 'footer_logo_path'
	) THEN
		EXECUTE '
			UPDATE public.organisation_templates
			SET end_logo_path = COALESCE(end_logo_path, footer_logo_path),
				updated_at = now()
			WHERE footer_logo_path IS NOT NULL
		';
	END IF;
END$$;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'organisations'
			AND column_name = 'logo_url'
	) THEN
		INSERT INTO public.organisation_templates (
			organisation_id,
			template_key,
			template_json,
			template_version,
			main_logotype_path,
			accent_logo_path,
			end_logo_path
		)
		SELECT
			o.id,
			'default',
			COALESCE(o.brand_settings, '{}'::jsonb),
			1,
			o.logo_url,
			NULL,
			NULL
		FROM public.organisations o
		ON CONFLICT (organisation_id) DO UPDATE
		SET
			main_logotype_path = COALESCE(
				public.organisation_templates.main_logotype_path,
				EXCLUDED.main_logotype_path
			),
			updated_at = now();
	END IF;
END$$;

INSERT INTO public.organisation_templates (
	organisation_id,
	template_key,
	template_json,
	template_version,
	main_logotype_path,
	accent_logo_path,
	end_logo_path
)
SELECT
	o.id,
	'default',
	COALESCE(o.brand_settings, '{}'::jsonb),
	1,
	NULL,
	NULL,
	NULL
FROM public.organisations o
ON CONFLICT (organisation_id) DO UPDATE
SET
	template_json = EXCLUDED.template_json,
	main_logotype_path = COALESCE(
		public.organisation_templates.main_logotype_path,
		EXCLUDED.main_logotype_path
	),
	accent_logo_path = COALESCE(
		public.organisation_templates.accent_logo_path,
		EXCLUDED.accent_logo_path
	),
	end_logo_path = COALESCE(
		public.organisation_templates.end_logo_path,
		EXCLUDED.end_logo_path
	),
	updated_at = now();

ALTER TABLE public.organisations
	DROP COLUMN IF EXISTS logo_url;

ALTER TABLE public.organisation_templates
	DROP COLUMN IF EXISTS logo_url,
	DROP COLUMN IF EXISTS header_logo_path,
	DROP COLUMN IF EXISTS footer_logo_path;

WITH ranked_user_homes AS (
	SELECT
		ou.id,
		ou.organisation_id,
		ou.user_id,
		ROW_NUMBER() OVER (
			PARTITION BY ou.user_id
			ORDER BY COALESCE(ou.updated_at, ou.created_at) DESC, ou.created_at DESC, ou.id DESC
		) AS rn
	FROM public.organisation_users ou
),
extra_user_homes AS (
	SELECT id, organisation_id, user_id
	FROM ranked_user_homes
	WHERE rn > 1
),
grantable_extra_user_homes AS (
	SELECT DISTINCT
		e.organisation_id,
		e.user_id
	FROM extra_user_homes e
	WHERE EXISTS (
		SELECT 1
		FROM public.user_roles ur
		JOIN public.roles r ON r.id = ur.role_id
		WHERE ur.user_id = e.user_id
			AND r.key IN ('broker', 'employer')
	)
)
INSERT INTO public.organisation_access_grants (organisation_id, grantee_user_id)
SELECT
	g.organisation_id,
	g.user_id
FROM grantable_extra_user_homes g
ON CONFLICT (organisation_id, grantee_user_id) DO NOTHING;

WITH ranked_user_homes AS (
	SELECT
		ou.id,
		ROW_NUMBER() OVER (
			PARTITION BY ou.user_id
			ORDER BY COALESCE(ou.updated_at, ou.created_at) DESC, ou.created_at DESC, ou.id DESC
		) AS rn
	FROM public.organisation_users ou
)
DELETE FROM public.organisation_users ou
USING ranked_user_homes r
WHERE ou.id = r.id
	AND r.rn > 1;

WITH ranked_talent_homes AS (
	SELECT
		ot.id,
		ROW_NUMBER() OVER (
			PARTITION BY ot.talent_id
			ORDER BY COALESCE(ot.updated_at, ot.created_at) DESC, ot.created_at DESC, ot.id DESC
		) AS rn
	FROM public.organisation_talents ot
)
DELETE FROM public.organisation_talents ot
USING ranked_talent_homes r
WHERE ot.id = r.id
	AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS organisation_users_one_home_per_user_uidx
	ON public.organisation_users (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS organisation_talents_one_home_per_talent_uidx
	ON public.organisation_talents (talent_id);

CREATE OR REPLACE FUNCTION public.current_user_home_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT ou.organisation_id
	FROM public.organisation_users ou
	WHERE ou.user_id = auth.uid()
	ORDER BY COALESCE(ou.updated_at, ou.created_at) DESC, ou.created_at DESC
	LIMIT 1;
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

	SELECT g.organisation_id
	FROM public.organisation_access_grants g
	WHERE g.grantee_user_id = auth.uid()
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

CREATE OR REPLACE FUNCTION public.can_access_organisation(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT EXISTS (
		SELECT 1
		FROM public.current_user_accessible_org_ids() ids
		WHERE ids.organisation_id = org_id
	);
$$;

CREATE OR REPLACE FUNCTION public.can_access_talent(target_talent_id uuid)
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
			FROM public.talents t
			WHERE t.id = target_talent_id
				AND t.user_id = auth.uid()
		)
		OR EXISTS (
			SELECT 1
			FROM public.organisation_talents ot
			WHERE ot.talent_id = target_talent_id
				AND public.can_access_organisation(ot.organisation_id)
		);
$$;

CREATE OR REPLACE FUNCTION public.can_edit_talent(target_talent_id uuid)
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
			FROM public.talents t
			WHERE t.id = target_talent_id
				AND t.user_id = auth.uid()
		)
		OR (
			(public.has_role('broker') OR public.has_role('employer'))
			AND EXISTS (
				SELECT 1
				FROM public.organisation_talents ot
				WHERE ot.talent_id = target_talent_id
					AND public.can_access_organisation(ot.organisation_id)
			)
		);
$$;

CREATE OR REPLACE FUNCTION public.can_access_resume(target_resume_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT EXISTS (
		SELECT 1
		FROM public.resumes r
		WHERE r.id = target_resume_id
			AND public.can_access_talent(r.talent_id)
	);
$$;

CREATE OR REPLACE FUNCTION public.can_edit_resume(target_resume_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT EXISTS (
		SELECT 1
		FROM public.resumes r
		WHERE r.id = target_resume_id
			AND public.can_edit_talent(r.talent_id)
	);
$$;

CREATE OR REPLACE FUNCTION public.can_read_organisation_template(target_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT
		public.is_admin()
		OR (
			public.has_role('broker')
			AND target_org_id = public.current_user_home_org_id()
		)
		OR (
			public.has_role('employer')
			AND public.can_access_organisation(target_org_id)
		)
		OR (
			public.has_role('talent')
			AND EXISTS (
				SELECT 1
				FROM public.organisation_talents ot
				JOIN public.talents t ON t.id = ot.talent_id
				WHERE t.user_id = auth.uid()
					AND ot.organisation_id = target_org_id
			)
		);
$$;

ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_talents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.talents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_availability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members read organisation" ON public.organisations;
DROP POLICY IF EXISTS "users create organisation" ON public.organisations;
DROP POLICY IF EXISTS "org admins update organisation" ON public.organisations;
DROP POLICY IF EXISTS "org admins delete organisation" ON public.organisations;
DROP POLICY IF EXISTS "organisations select by access" ON public.organisations;
DROP POLICY IF EXISTS "organisations admin insert" ON public.organisations;
DROP POLICY IF EXISTS "organisations admin update" ON public.organisations;
DROP POLICY IF EXISTS "organisations admin delete" ON public.organisations;

CREATE POLICY "organisations select by access" ON public.organisations
FOR SELECT USING (public.can_access_organisation(id));

CREATE POLICY "organisations admin insert" ON public.organisations
FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "organisations admin update" ON public.organisations
FOR UPDATE USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "organisations admin delete" ON public.organisations
FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS "org members read organisation users" ON public.organisation_users;
DROP POLICY IF EXISTS "org admins insert organisation users" ON public.organisation_users;
DROP POLICY IF EXISTS "org admins delete organisation users" ON public.organisation_users;
DROP POLICY IF EXISTS "organisation users select by access" ON public.organisation_users;
DROP POLICY IF EXISTS "organisation users admin insert" ON public.organisation_users;
DROP POLICY IF EXISTS "organisation users admin update" ON public.organisation_users;
DROP POLICY IF EXISTS "organisation users admin delete" ON public.organisation_users;

CREATE POLICY "organisation users select by access" ON public.organisation_users
FOR SELECT USING (
	public.is_admin()
	OR user_id = auth.uid()
	OR public.can_access_organisation(organisation_id)
);

CREATE POLICY "organisation users admin insert" ON public.organisation_users
FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "organisation users admin update" ON public.organisation_users
FOR UPDATE USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "organisation users admin delete" ON public.organisation_users
FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS "org members read organisation talents" ON public.organisation_talents;
DROP POLICY IF EXISTS "org admins insert organisation talents" ON public.organisation_talents;
DROP POLICY IF EXISTS "org admins delete organisation talents" ON public.organisation_talents;
DROP POLICY IF EXISTS "organisation talents select by access" ON public.organisation_talents;
DROP POLICY IF EXISTS "organisation talents admin insert" ON public.organisation_talents;
DROP POLICY IF EXISTS "organisation talents admin update" ON public.organisation_talents;
DROP POLICY IF EXISTS "organisation talents admin delete" ON public.organisation_talents;

CREATE POLICY "organisation talents select by access" ON public.organisation_talents
FOR SELECT USING (
	public.is_admin()
	OR public.can_access_talent(talent_id)
	OR public.can_access_organisation(organisation_id)
);

CREATE POLICY "organisation talents admin insert" ON public.organisation_talents
FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "organisation talents admin update" ON public.organisation_talents
FOR UPDATE USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "organisation talents admin delete" ON public.organisation_talents
FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS "organisation templates select by access" ON public.organisation_templates;
DROP POLICY IF EXISTS "organisation templates admin insert" ON public.organisation_templates;
DROP POLICY IF EXISTS "organisation templates admin update" ON public.organisation_templates;
DROP POLICY IF EXISTS "organisation templates admin delete" ON public.organisation_templates;

CREATE POLICY "organisation templates select by access" ON public.organisation_templates
FOR SELECT USING (public.can_read_organisation_template(organisation_id));

CREATE POLICY "organisation templates admin insert" ON public.organisation_templates
FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "organisation templates admin update" ON public.organisation_templates
FOR UPDATE USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "organisation templates admin delete" ON public.organisation_templates
FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS "organisation access grants read own" ON public.organisation_access_grants;
DROP POLICY IF EXISTS "organisation access grants admin insert" ON public.organisation_access_grants;
DROP POLICY IF EXISTS "organisation access grants admin update" ON public.organisation_access_grants;
DROP POLICY IF EXISTS "organisation access grants admin delete" ON public.organisation_access_grants;

CREATE POLICY "organisation access grants read own" ON public.organisation_access_grants
FOR SELECT USING (public.is_admin() OR grantee_user_id = auth.uid());

CREATE POLICY "organisation access grants admin insert" ON public.organisation_access_grants
FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "organisation access grants admin update" ON public.organisation_access_grants
FOR UPDATE USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "organisation access grants admin delete" ON public.organisation_access_grants
FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS "users read own linked talent" ON public.talents;
DROP POLICY IF EXISTS "users update own linked talent" ON public.talents;
DROP POLICY IF EXISTS "talents select by access" ON public.talents;
DROP POLICY IF EXISTS "talents update by access" ON public.talents;
DROP POLICY IF EXISTS "talents insert by manager role" ON public.talents;
DROP POLICY IF EXISTS "talents delete by admin" ON public.talents;

CREATE POLICY "talents select by access" ON public.talents
FOR SELECT USING (public.can_access_talent(id));

CREATE POLICY "talents update by access" ON public.talents
FOR UPDATE USING (public.can_edit_talent(id))
WITH CHECK (public.can_edit_talent(id));

CREATE POLICY "talents insert by manager role" ON public.talents
FOR INSERT WITH CHECK (public.is_admin() OR public.has_role('broker') OR public.has_role('employer'));

CREATE POLICY "talents delete by admin" ON public.talents
FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS "talent owns resume" ON public.resumes;
DROP POLICY IF EXISTS "client read assigned resume" ON public.resumes;
DROP POLICY IF EXISTS "resumes select by access" ON public.resumes;
DROP POLICY IF EXISTS "resumes insert by access" ON public.resumes;
DROP POLICY IF EXISTS "resumes update by access" ON public.resumes;
DROP POLICY IF EXISTS "resumes delete by access" ON public.resumes;

CREATE POLICY "resumes select by access" ON public.resumes
FOR SELECT USING (public.can_access_resume(id));

CREATE POLICY "resumes insert by access" ON public.resumes
FOR INSERT WITH CHECK (public.can_edit_talent(talent_id));

CREATE POLICY "resumes update by access" ON public.resumes
FOR UPDATE USING (public.can_edit_resume(id))
WITH CHECK (public.can_edit_talent(talent_id));

CREATE POLICY "resumes delete by access" ON public.resumes
FOR DELETE USING (public.can_edit_resume(id));

DO $$
DECLARE
	table_name text;
	tables text[] := ARRAY[
		'resume_basics',
		'resume_contacts',
		'resume_skill_items',
		'resume_labeled_items',
		'resume_portfolio_items',
		'resume_experience_items'
	];
BEGIN
	FOREACH table_name IN ARRAY tables
	LOOP
		EXECUTE format('DROP POLICY IF EXISTS "owner manage" ON public.%I', table_name);
		EXECUTE format('DROP POLICY IF EXISTS "client read assigned" ON public.%I', table_name);
		EXECUTE format('DROP POLICY IF EXISTS "resume item select by access" ON public.%I', table_name);
		EXECUTE format('DROP POLICY IF EXISTS "resume item manage by access" ON public.%I', table_name);

		EXECUTE format(
			'CREATE POLICY "resume item select by access" ON public.%I FOR SELECT USING (public.can_access_resume(resume_id))',
			table_name
		);

		EXECUTE format(
			'CREATE POLICY "resume item manage by access" ON public.%I USING (public.can_edit_resume(resume_id)) WITH CHECK (public.can_edit_resume(resume_id))',
			table_name
		);
	END LOOP;
END$$;

DROP POLICY IF EXISTS "owner manage" ON public.resume_experience_tech_overrides;
DROP POLICY IF EXISTS "client read assigned" ON public.resume_experience_tech_overrides;
DROP POLICY IF EXISTS "resume experience tech overrides select by access" ON public.resume_experience_tech_overrides;
DROP POLICY IF EXISTS "resume experience tech overrides manage by access" ON public.resume_experience_tech_overrides;

CREATE POLICY "resume experience tech overrides select by access" ON public.resume_experience_tech_overrides
FOR SELECT USING (
	EXISTS (
		SELECT 1
		FROM public.resume_experience_items rei
		WHERE rei.id = resume_experience_tech_overrides.resume_experience_item_id
			AND public.can_access_resume(rei.resume_id)
	)
);

CREATE POLICY "resume experience tech overrides manage by access" ON public.resume_experience_tech_overrides
USING (
	EXISTS (
		SELECT 1
		FROM public.resume_experience_items rei
		WHERE rei.id = resume_experience_tech_overrides.resume_experience_item_id
			AND public.can_edit_resume(rei.resume_id)
	)
)
WITH CHECK (
	EXISTS (
		SELECT 1
		FROM public.resume_experience_items rei
		WHERE rei.id = resume_experience_tech_overrides.resume_experience_item_id
			AND public.can_edit_resume(rei.resume_id)
	)
);

DROP POLICY IF EXISTS "owner manage" ON public.experience_library;
DROP POLICY IF EXISTS "experience library select by access" ON public.experience_library;
DROP POLICY IF EXISTS "experience library manage by access" ON public.experience_library;

CREATE POLICY "experience library select by access" ON public.experience_library
FOR SELECT USING (public.can_access_talent(talent_id));

CREATE POLICY "experience library manage by access" ON public.experience_library
USING (public.can_edit_talent(talent_id))
WITH CHECK (public.can_edit_talent(talent_id));

DROP POLICY IF EXISTS "owner manage" ON public.experience_library_technologies;
DROP POLICY IF EXISTS "experience library tech select by access" ON public.experience_library_technologies;
DROP POLICY IF EXISTS "experience library tech manage by access" ON public.experience_library_technologies;

CREATE POLICY "experience library tech select by access" ON public.experience_library_technologies
FOR SELECT USING (
	EXISTS (
		SELECT 1
		FROM public.experience_library el
		WHERE el.id = experience_library_technologies.experience_id
			AND public.can_access_talent(el.talent_id)
	)
);

CREATE POLICY "experience library tech manage by access" ON public.experience_library_technologies
USING (
	EXISTS (
		SELECT 1
		FROM public.experience_library el
		WHERE el.id = experience_library_technologies.experience_id
			AND public.can_edit_talent(el.talent_id)
	)
)
WITH CHECK (
	EXISTS (
		SELECT 1
		FROM public.experience_library el
		WHERE el.id = experience_library_technologies.experience_id
			AND public.can_edit_talent(el.talent_id)
	)
);

DROP POLICY IF EXISTS "talents read own availability" ON public.profile_availability;
DROP POLICY IF EXISTS "talents insert own availability" ON public.profile_availability;
DROP POLICY IF EXISTS "talents update own availability" ON public.profile_availability;
DROP POLICY IF EXISTS "profile availability select by access" ON public.profile_availability;
DROP POLICY IF EXISTS "profile availability manage by access" ON public.profile_availability;

CREATE POLICY "profile availability select by access" ON public.profile_availability
FOR SELECT USING (public.can_access_talent(profile_id));

CREATE POLICY "profile availability manage by access" ON public.profile_availability
USING (public.can_edit_talent(profile_id))
WITH CHECK (public.can_edit_talent(profile_id));

-- Keep legacy resume_client_access table and policies in place for backward compatibility.
