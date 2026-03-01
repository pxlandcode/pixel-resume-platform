-- Incremental refactor from legacy text roles and metadata-heavy organisation links
-- to normalized roles + pure join tables.
-- Safe to re-run.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

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

ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS role_id uuid;

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conrelid = 'public.user_roles'::regclass
			AND conname = 'user_roles_role_id_fkey'
	) THEN
		ALTER TABLE public.user_roles
			ADD CONSTRAINT user_roles_role_id_fkey
			FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE RESTRICT;
	END IF;
END$$;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'user_roles'
			AND column_name = 'role'
	) THEN
		UPDATE public.user_roles ur
		SET role_id = r.id
		FROM public.roles r
		WHERE ur.role_id IS NULL
			AND ur.role = r.key;
	END IF;
END$$;

UPDATE public.user_roles
SET id = gen_random_uuid()
WHERE id IS NULL;

DO $$
DECLARE
	missing_count bigint;
BEGIN
	SELECT COUNT(*) INTO missing_count
	FROM public.user_roles
	WHERE role_id IS NULL;

	IF missing_count > 0 THEN
		RAISE EXCEPTION
			'Cannot migrate user_roles: % row(s) have NULL role_id after backfill. Ensure role keys exist and rerun.',
			missing_count;
	END IF;
END$$;

ALTER TABLE public.user_roles ALTER COLUMN id SET NOT NULL;
ALTER TABLE public.user_roles ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.user_roles ALTER COLUMN role_id SET NOT NULL;

DO $$
DECLARE
	id_attnum smallint;
	pkey_on_id boolean;
BEGIN
	SELECT attnum INTO id_attnum
	FROM pg_attribute
	WHERE attrelid = 'public.user_roles'::regclass
		AND attname = 'id'
		AND NOT attisdropped;

	SELECT EXISTS (
		SELECT 1
		FROM pg_constraint c
		WHERE c.conrelid = 'public.user_roles'::regclass
			AND c.conname = 'user_roles_pkey'
			AND c.conkey = ARRAY[id_attnum]
	)
	INTO pkey_on_id;

	IF NOT pkey_on_id THEN
		IF EXISTS (
			SELECT 1
			FROM pg_constraint
			WHERE conrelid = 'public.user_roles'::regclass
				AND conname = 'user_roles_pkey'
		) THEN
			ALTER TABLE public.user_roles DROP CONSTRAINT user_roles_pkey;
		END IF;

		ALTER TABLE public.user_roles
			ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);
	END IF;
END$$;

ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_id_key;
ALTER TABLE public.user_roles
	ADD CONSTRAINT user_roles_user_id_role_id_key UNIQUE (user_id, role_id);

DROP INDEX IF EXISTS public.user_roles_role_idx;

ALTER TABLE public.user_roles DROP COLUMN IF EXISTS role;

CREATE INDEX IF NOT EXISTS user_roles_user_id_idx ON public.user_roles (user_id);
CREATE INDEX IF NOT EXISTS user_roles_role_id_idx ON public.user_roles (role_id);

ALTER TABLE public.organisation_users DROP CONSTRAINT IF EXISTS organisation_users_membership_role_check;
ALTER TABLE public.organisation_users DROP CONSTRAINT IF EXISTS organisation_users_status_check;
DROP INDEX IF EXISTS public.organisation_users_one_active_primary_per_user_idx;
ALTER TABLE public.organisation_users DROP COLUMN IF EXISTS membership_role;
ALTER TABLE public.organisation_users DROP COLUMN IF EXISTS status;
ALTER TABLE public.organisation_users DROP COLUMN IF EXISTS is_primary;

ALTER TABLE public.organisation_talents DROP CONSTRAINT IF EXISTS organisation_talents_status_check;
ALTER TABLE public.organisation_talents DROP COLUMN IF EXISTS status;

CREATE INDEX IF NOT EXISTS organisation_users_organisation_id_idx
	ON public.organisation_users (organisation_id);
CREATE INDEX IF NOT EXISTS organisation_users_user_id_idx
	ON public.organisation_users (user_id);
CREATE INDEX IF NOT EXISTS organisation_talents_organisation_id_idx
	ON public.organisation_talents (organisation_id);
CREATE INDEX IF NOT EXISTS organisation_talents_talent_id_idx
	ON public.organisation_talents (talent_id);

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

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.talents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_talents ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
	table_name text;
	tables text[] := ARRAY[
		'roles',
		'user_profiles',
		'talents',
		'organisations',
		'user_roles',
		'organisation_users',
		'organisation_talents'
	];
BEGIN
	FOREACH table_name IN ARRAY tables
	LOOP
		EXECUTE format('DROP POLICY IF EXISTS "admin full access" ON public.%I', table_name);
		EXECUTE format(
			'CREATE POLICY "admin full access" ON public.%I USING (public.is_admin()) WITH CHECK (public.is_admin())',
			table_name
		);
	END LOOP;
END$$;

DROP POLICY IF EXISTS "users read own profile" ON public.user_profiles;
CREATE POLICY "users read own profile" ON public.user_profiles
FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users insert own profile" ON public.user_profiles;
CREATE POLICY "users insert own profile" ON public.user_profiles
FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users update own profile" ON public.user_profiles;
CREATE POLICY "users update own profile" ON public.user_profiles
FOR UPDATE USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "authenticated read roles" ON public.roles;
CREATE POLICY "authenticated read roles" ON public.roles
FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "users read own roles" ON public.user_roles;
CREATE POLICY "users read own roles" ON public.user_roles
FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users read own linked talent" ON public.talents;
CREATE POLICY "users read own linked talent" ON public.talents
FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users update own linked talent" ON public.talents;
CREATE POLICY "users update own linked talent" ON public.talents
FOR UPDATE USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "org members read organisation" ON public.organisations;
CREATE POLICY "org members read organisation" ON public.organisations
FOR SELECT USING (public.is_org_member(id) OR public.is_org_admin(id));

DROP POLICY IF EXISTS "users create organisation" ON public.organisations;
CREATE POLICY "users create organisation" ON public.organisations
FOR INSERT WITH CHECK (
	auth.uid() IS NOT NULL
	AND created_by_user_id = auth.uid()
);

DROP POLICY IF EXISTS "org admins update organisation" ON public.organisations;
CREATE POLICY "org admins update organisation" ON public.organisations
FOR UPDATE USING (public.is_org_admin(id))
WITH CHECK (public.is_org_admin(id));

DROP POLICY IF EXISTS "org admins delete organisation" ON public.organisations;
CREATE POLICY "org admins delete organisation" ON public.organisations
FOR DELETE USING (public.is_org_admin(id));

DROP POLICY IF EXISTS "org members read organisation users" ON public.organisation_users;
CREATE POLICY "org members read organisation users" ON public.organisation_users
FOR SELECT USING (public.is_org_member(organisation_id) OR public.is_org_admin(organisation_id));

DROP POLICY IF EXISTS "org admins insert organisation users" ON public.organisation_users;
CREATE POLICY "org admins insert organisation users" ON public.organisation_users
FOR INSERT WITH CHECK (public.is_org_admin(organisation_id));

DROP POLICY IF EXISTS "org admins update organisation users" ON public.organisation_users;
DROP POLICY IF EXISTS "org admins delete organisation users" ON public.organisation_users;
CREATE POLICY "org admins delete organisation users" ON public.organisation_users
FOR DELETE USING (public.is_org_admin(organisation_id));

DROP POLICY IF EXISTS "org members read organisation talents" ON public.organisation_talents;
CREATE POLICY "org members read organisation talents" ON public.organisation_talents
FOR SELECT USING (public.is_org_member(organisation_id) OR public.is_org_admin(organisation_id));

DROP POLICY IF EXISTS "org admins insert organisation talents" ON public.organisation_talents;
CREATE POLICY "org admins insert organisation talents" ON public.organisation_talents
FOR INSERT WITH CHECK (public.is_org_admin(organisation_id));

DROP POLICY IF EXISTS "org admins update organisation talents" ON public.organisation_talents;
DROP POLICY IF EXISTS "org admins delete organisation talents" ON public.organisation_talents;
CREATE POLICY "org admins delete organisation talents" ON public.organisation_talents
FOR DELETE USING (public.is_org_admin(organisation_id));
