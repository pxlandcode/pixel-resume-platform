-- Fresh-start foundation schema for an empty Supabase database.
-- Legacy compatibility aliases are intentionally excluded.
-- No seed data is inserted by this migration beyond canonical role keys.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS public.user_profiles (
	user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
	first_name text,
	last_name text,
	email text,
	avatar_url text,
	phone text,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.talents (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
	first_name text NOT NULL DEFAULT '',
	last_name text NOT NULL DEFAULT '',
	title text NOT NULL DEFAULT '',
	bio text NOT NULL DEFAULT '',
	avatar_url text,
	tech_stack jsonb NOT NULL DEFAULT '[]'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organisations (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	name text NOT NULL,
	slug citext NOT NULL UNIQUE,
	logo_url text,
	brand_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT organisations_name_key UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS public.roles (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	key text NOT NULL UNIQUE CHECK (key IN ('admin', 'talent', 'employer', 'broker')),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.roles (key)
VALUES ('admin'), ('talent'), ('employer'), ('broker')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.user_roles (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
	role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
	granted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT user_roles_user_id_role_id_key UNIQUE (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS public.organisation_users (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
	user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT organisation_users_organisation_id_user_id_key UNIQUE (organisation_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.organisation_talents (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
	talent_id uuid NOT NULL REFERENCES public.talents(id) ON DELETE CASCADE,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT organisation_talents_organisation_id_talent_id_key UNIQUE (organisation_id, talent_id)
);

CREATE INDEX IF NOT EXISTS user_roles_user_id_idx ON public.user_roles (user_id);
CREATE INDEX IF NOT EXISTS user_roles_role_id_idx ON public.user_roles (role_id);

CREATE INDEX IF NOT EXISTS organisation_users_organisation_id_idx
	ON public.organisation_users (organisation_id);

CREATE INDEX IF NOT EXISTS organisation_users_user_id_idx ON public.organisation_users (user_id);

CREATE INDEX IF NOT EXISTS organisation_talents_organisation_id_idx
	ON public.organisation_talents (organisation_id);

CREATE INDEX IF NOT EXISTS organisation_talents_talent_id_idx ON public.organisation_talents (talent_id);

CREATE OR REPLACE FUNCTION public.has_role(role_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT EXISTS (
		SELECT 1
		FROM public.user_roles ur
		JOIN public.roles r ON r.id = ur.role_id
		WHERE ur.user_id = auth.uid()
			AND r.key = role_name
	);
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT public.has_role('admin');
$$;

CREATE OR REPLACE FUNCTION public.is_talent()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT public.has_role('talent');
$$;

CREATE OR REPLACE FUNCTION public.is_employer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT public.has_role('employer');
$$;

CREATE OR REPLACE FUNCTION public.is_broker()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT public.has_role('broker');
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT EXISTS (
		SELECT 1
		FROM public.organisation_users ou
		WHERE ou.organisation_id = org_id
			AND ou.user_id = auth.uid()
	);
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT public.is_admin()
		OR EXISTS (
			SELECT 1
			FROM public.organisations o
			WHERE o.id = org_id
				AND o.created_by_user_id = auth.uid()
		);
$$;

CREATE OR REPLACE FUNCTION public.current_talent_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT t.id
	FROM public.talents t
	WHERE t.user_id = auth.uid()
	LIMIT 1;
$$;

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.talents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_talents ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
	table_name text;
	tables text[] := ARRAY[
		'user_profiles',
		'talents',
		'organisations',
		'roles',
		'user_roles',
		'organisation_users',
		'organisation_talents'
	];
BEGIN
	FOREACH table_name IN ARRAY tables
	LOOP
		IF EXISTS (
			SELECT 1
			FROM pg_policies
			WHERE schemaname = 'public'
				AND tablename = table_name
				AND policyname = 'admin full access'
		) THEN
			EXECUTE format('DROP POLICY "admin full access" ON public.%I', table_name);
		END IF;

		EXECUTE format(
			'CREATE POLICY "admin full access" ON public.%I USING (public.is_admin()) WITH CHECK (public.is_admin())',
			table_name
		);
	END LOOP;
END$$;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'user_profiles'
			AND policyname = 'users read own profile'
	) THEN
		EXECUTE 'DROP POLICY "users read own profile" ON public.user_profiles';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "users read own profile" ON public.user_profiles
		FOR SELECT USING (auth.uid() = user_id);
	$policy$;

	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'user_profiles'
			AND policyname = 'users insert own profile'
	) THEN
		EXECUTE 'DROP POLICY "users insert own profile" ON public.user_profiles';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "users insert own profile" ON public.user_profiles
		FOR INSERT WITH CHECK (auth.uid() = user_id);
	$policy$;

	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'user_profiles'
			AND policyname = 'users update own profile'
	) THEN
		EXECUTE 'DROP POLICY "users update own profile" ON public.user_profiles';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "users update own profile" ON public.user_profiles
		FOR UPDATE USING (auth.uid() = user_id)
		WITH CHECK (auth.uid() = user_id);
	$policy$;
END$$;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'roles'
			AND policyname = 'authenticated read roles'
	) THEN
		EXECUTE 'DROP POLICY "authenticated read roles" ON public.roles';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "authenticated read roles" ON public.roles
		FOR SELECT USING (auth.uid() IS NOT NULL);
	$policy$;
END$$;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'user_roles'
			AND policyname = 'users read own roles'
	) THEN
		EXECUTE 'DROP POLICY "users read own roles" ON public.user_roles';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "users read own roles" ON public.user_roles
		FOR SELECT USING (auth.uid() = user_id);
	$policy$;
END$$;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'talents'
			AND policyname = 'users read own linked talent'
	) THEN
		EXECUTE 'DROP POLICY "users read own linked talent" ON public.talents';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "users read own linked talent" ON public.talents
		FOR SELECT USING (auth.uid() = user_id);
	$policy$;

	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'talents'
			AND policyname = 'users update own linked talent'
	) THEN
		EXECUTE 'DROP POLICY "users update own linked talent" ON public.talents';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "users update own linked talent" ON public.talents
		FOR UPDATE USING (auth.uid() = user_id)
		WITH CHECK (auth.uid() = user_id);
	$policy$;
END$$;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'organisations'
			AND policyname = 'org members read organisation'
	) THEN
		EXECUTE 'DROP POLICY "org members read organisation" ON public.organisations';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "org members read organisation" ON public.organisations
		FOR SELECT USING (public.is_org_member(id) OR public.is_org_admin(id));
	$policy$;

	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'organisations'
			AND policyname = 'users create organisation'
	) THEN
		EXECUTE 'DROP POLICY "users create organisation" ON public.organisations';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "users create organisation" ON public.organisations
		FOR INSERT WITH CHECK (
			auth.uid() IS NOT NULL
			AND created_by_user_id = auth.uid()
		);
	$policy$;

	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'organisations'
			AND policyname = 'org admins update organisation'
	) THEN
		EXECUTE 'DROP POLICY "org admins update organisation" ON public.organisations';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "org admins update organisation" ON public.organisations
		FOR UPDATE USING (public.is_org_admin(id))
		WITH CHECK (public.is_org_admin(id));
	$policy$;

	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'organisations'
			AND policyname = 'org admins delete organisation'
	) THEN
		EXECUTE 'DROP POLICY "org admins delete organisation" ON public.organisations';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "org admins delete organisation" ON public.organisations
		FOR DELETE USING (public.is_org_admin(id));
	$policy$;
END$$;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'organisation_users'
			AND policyname = 'org members read organisation users'
	) THEN
		EXECUTE 'DROP POLICY "org members read organisation users" ON public.organisation_users';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "org members read organisation users" ON public.organisation_users
		FOR SELECT USING (public.is_org_member(organisation_id) OR public.is_org_admin(organisation_id));
	$policy$;

	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'organisation_users'
			AND policyname = 'org admins insert organisation users'
	) THEN
		EXECUTE 'DROP POLICY "org admins insert organisation users" ON public.organisation_users';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "org admins insert organisation users" ON public.organisation_users
		FOR INSERT WITH CHECK (public.is_org_admin(organisation_id));
	$policy$;

	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'organisation_users'
			AND policyname = 'org admins delete organisation users'
	) THEN
		EXECUTE 'DROP POLICY "org admins delete organisation users" ON public.organisation_users';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "org admins delete organisation users" ON public.organisation_users
		FOR DELETE USING (public.is_org_admin(organisation_id));
	$policy$;
END$$;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'organisation_talents'
			AND policyname = 'org members read organisation talents'
	) THEN
		EXECUTE 'DROP POLICY "org members read organisation talents" ON public.organisation_talents';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "org members read organisation talents" ON public.organisation_talents
		FOR SELECT USING (public.is_org_member(organisation_id) OR public.is_org_admin(organisation_id));
	$policy$;

	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'organisation_talents'
			AND policyname = 'org admins insert organisation talents'
	) THEN
		EXECUTE 'DROP POLICY "org admins insert organisation talents" ON public.organisation_talents';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "org admins insert organisation talents" ON public.organisation_talents
		FOR INSERT WITH CHECK (public.is_org_admin(organisation_id));
	$policy$;

	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'organisation_talents'
			AND policyname = 'org admins delete organisation talents'
	) THEN
		EXECUTE 'DROP POLICY "org admins delete organisation talents" ON public.organisation_talents';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "org admins delete organisation talents" ON public.organisation_talents
		FOR DELETE USING (public.is_org_admin(organisation_id));
	$policy$;
END$$;
