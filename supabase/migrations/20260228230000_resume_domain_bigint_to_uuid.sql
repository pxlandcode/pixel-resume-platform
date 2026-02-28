-- Convert resume-domain bigint identifiers to UUID for existing databases.
-- Assumes 20260228224000_resume_domain_uid_columns.sql has run (uid columns present).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Ensure uid columns exist and are populated (defensive in case prior migration was skipped).
ALTER TABLE public.resumes ADD COLUMN IF NOT EXISTS uid uuid;
UPDATE public.resumes SET uid = gen_random_uuid() WHERE uid IS NULL;
ALTER TABLE public.resumes ALTER COLUMN uid SET DEFAULT gen_random_uuid();
ALTER TABLE public.resumes ALTER COLUMN uid SET NOT NULL;

ALTER TABLE public.resume_client_access ADD COLUMN IF NOT EXISTS uid uuid;
UPDATE public.resume_client_access SET uid = gen_random_uuid() WHERE uid IS NULL;
ALTER TABLE public.resume_client_access ALTER COLUMN uid SET DEFAULT gen_random_uuid();
ALTER TABLE public.resume_client_access ALTER COLUMN uid SET NOT NULL;

ALTER TABLE public.resume_contacts ADD COLUMN IF NOT EXISTS uid uuid;
UPDATE public.resume_contacts SET uid = gen_random_uuid() WHERE uid IS NULL;
ALTER TABLE public.resume_contacts ALTER COLUMN uid SET DEFAULT gen_random_uuid();
ALTER TABLE public.resume_contacts ALTER COLUMN uid SET NOT NULL;

ALTER TABLE public.resume_skill_items ADD COLUMN IF NOT EXISTS uid uuid;
UPDATE public.resume_skill_items SET uid = gen_random_uuid() WHERE uid IS NULL;
ALTER TABLE public.resume_skill_items ALTER COLUMN uid SET DEFAULT gen_random_uuid();
ALTER TABLE public.resume_skill_items ALTER COLUMN uid SET NOT NULL;

ALTER TABLE public.resume_labeled_items ADD COLUMN IF NOT EXISTS uid uuid;
UPDATE public.resume_labeled_items SET uid = gen_random_uuid() WHERE uid IS NULL;
ALTER TABLE public.resume_labeled_items ALTER COLUMN uid SET DEFAULT gen_random_uuid();
ALTER TABLE public.resume_labeled_items ALTER COLUMN uid SET NOT NULL;

ALTER TABLE public.resume_portfolio_items ADD COLUMN IF NOT EXISTS uid uuid;
UPDATE public.resume_portfolio_items SET uid = gen_random_uuid() WHERE uid IS NULL;
ALTER TABLE public.resume_portfolio_items ALTER COLUMN uid SET DEFAULT gen_random_uuid();
ALTER TABLE public.resume_portfolio_items ALTER COLUMN uid SET NOT NULL;

ALTER TABLE public.experience_library ADD COLUMN IF NOT EXISTS uid uuid;
UPDATE public.experience_library SET uid = gen_random_uuid() WHERE uid IS NULL;
ALTER TABLE public.experience_library ALTER COLUMN uid SET DEFAULT gen_random_uuid();
ALTER TABLE public.experience_library ALTER COLUMN uid SET NOT NULL;

ALTER TABLE public.experience_library_technologies ADD COLUMN IF NOT EXISTS uid uuid;
UPDATE public.experience_library_technologies SET uid = gen_random_uuid() WHERE uid IS NULL;
ALTER TABLE public.experience_library_technologies ALTER COLUMN uid SET DEFAULT gen_random_uuid();
ALTER TABLE public.experience_library_technologies ALTER COLUMN uid SET NOT NULL;

ALTER TABLE public.resume_experience_items ADD COLUMN IF NOT EXISTS uid uuid;
UPDATE public.resume_experience_items SET uid = gen_random_uuid() WHERE uid IS NULL;
ALTER TABLE public.resume_experience_items ALTER COLUMN uid SET DEFAULT gen_random_uuid();
ALTER TABLE public.resume_experience_items ALTER COLUMN uid SET NOT NULL;

ALTER TABLE public.resume_experience_tech_overrides ADD COLUMN IF NOT EXISTS uid uuid;
UPDATE public.resume_experience_tech_overrides SET uid = gen_random_uuid() WHERE uid IS NULL;
ALTER TABLE public.resume_experience_tech_overrides ALTER COLUMN uid SET DEFAULT gen_random_uuid();
ALTER TABLE public.resume_experience_tech_overrides ALTER COLUMN uid SET NOT NULL;

-- Persist legacy bigint -> uuid mappings for traceability.
CREATE TABLE IF NOT EXISTS public.resume_legacy_id_map (
	legacy_id bigint PRIMARY KEY,
	id uuid NOT NULL UNIQUE,
	captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.resume_client_access_legacy_id_map (
	legacy_id bigint PRIMARY KEY,
	id uuid NOT NULL UNIQUE,
	captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.resume_contacts_legacy_id_map (
	legacy_id bigint PRIMARY KEY,
	id uuid NOT NULL UNIQUE,
	captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.resume_skill_items_legacy_id_map (
	legacy_id bigint PRIMARY KEY,
	id uuid NOT NULL UNIQUE,
	captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.resume_labeled_items_legacy_id_map (
	legacy_id bigint PRIMARY KEY,
	id uuid NOT NULL UNIQUE,
	captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.resume_portfolio_items_legacy_id_map (
	legacy_id bigint PRIMARY KEY,
	id uuid NOT NULL UNIQUE,
	captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.experience_library_legacy_id_map (
	legacy_id bigint PRIMARY KEY,
	id uuid NOT NULL UNIQUE,
	captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.experience_library_technologies_legacy_id_map (
	legacy_id bigint PRIMARY KEY,
	id uuid NOT NULL UNIQUE,
	captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.resume_experience_items_legacy_id_map (
	legacy_id bigint PRIMARY KEY,
	id uuid NOT NULL UNIQUE,
	captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.resume_experience_tech_overrides_legacy_id_map (
	legacy_id bigint PRIMARY KEY,
	id uuid NOT NULL UNIQUE,
	captured_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.resume_legacy_id_map (legacy_id, id)
SELECT id, uid FROM public.resumes
ON CONFLICT (legacy_id) DO NOTHING;

INSERT INTO public.resume_client_access_legacy_id_map (legacy_id, id)
SELECT id, uid FROM public.resume_client_access
ON CONFLICT (legacy_id) DO NOTHING;

INSERT INTO public.resume_contacts_legacy_id_map (legacy_id, id)
SELECT id, uid FROM public.resume_contacts
ON CONFLICT (legacy_id) DO NOTHING;

INSERT INTO public.resume_skill_items_legacy_id_map (legacy_id, id)
SELECT id, uid FROM public.resume_skill_items
ON CONFLICT (legacy_id) DO NOTHING;

INSERT INTO public.resume_labeled_items_legacy_id_map (legacy_id, id)
SELECT id, uid FROM public.resume_labeled_items
ON CONFLICT (legacy_id) DO NOTHING;

INSERT INTO public.resume_portfolio_items_legacy_id_map (legacy_id, id)
SELECT id, uid FROM public.resume_portfolio_items
ON CONFLICT (legacy_id) DO NOTHING;

INSERT INTO public.experience_library_legacy_id_map (legacy_id, id)
SELECT id, uid FROM public.experience_library
ON CONFLICT (legacy_id) DO NOTHING;

INSERT INTO public.experience_library_technologies_legacy_id_map (legacy_id, id)
SELECT id, uid FROM public.experience_library_technologies
ON CONFLICT (legacy_id) DO NOTHING;

INSERT INTO public.resume_experience_items_legacy_id_map (legacy_id, id)
SELECT id, uid FROM public.resume_experience_items
ON CONFLICT (legacy_id) DO NOTHING;

INSERT INTO public.resume_experience_tech_overrides_legacy_id_map (legacy_id, id)
SELECT id, uid FROM public.resume_experience_tech_overrides
ON CONFLICT (legacy_id) DO NOTHING;

-- Temporary uuid FK columns.
ALTER TABLE public.resume_client_access ADD COLUMN IF NOT EXISTS resume_id_new uuid;
ALTER TABLE public.resume_basics ADD COLUMN IF NOT EXISTS resume_id_new uuid;
ALTER TABLE public.resume_contacts ADD COLUMN IF NOT EXISTS resume_id_new uuid;
ALTER TABLE public.resume_skill_items ADD COLUMN IF NOT EXISTS resume_id_new uuid;
ALTER TABLE public.resume_labeled_items ADD COLUMN IF NOT EXISTS resume_id_new uuid;
ALTER TABLE public.resume_portfolio_items ADD COLUMN IF NOT EXISTS resume_id_new uuid;
ALTER TABLE public.resume_experience_items ADD COLUMN IF NOT EXISTS resume_id_new uuid;
ALTER TABLE public.experience_library_technologies ADD COLUMN IF NOT EXISTS experience_id_new uuid;
ALTER TABLE public.resume_experience_items ADD COLUMN IF NOT EXISTS experience_id_new uuid;
ALTER TABLE public.resume_experience_tech_overrides ADD COLUMN IF NOT EXISTS resume_experience_item_id_new uuid;

DO $$
BEGIN
	IF to_regclass('public.resume_import_jobs') IS NOT NULL THEN
		EXECUTE 'ALTER TABLE public.resume_import_jobs ADD COLUMN IF NOT EXISTS resume_id_new uuid';
	END IF;
END
$$;

-- Backfill FK uuid columns from existing bigint ids.
UPDATE public.resume_client_access rca
SET resume_id_new = r.uid
FROM public.resumes r
WHERE rca.resume_id_new IS NULL
	AND rca.resume_id = r.id;

UPDATE public.resume_basics rb
SET resume_id_new = r.uid
FROM public.resumes r
WHERE rb.resume_id_new IS NULL
	AND rb.resume_id = r.id;

UPDATE public.resume_contacts rc
SET resume_id_new = r.uid
FROM public.resumes r
WHERE rc.resume_id_new IS NULL
	AND rc.resume_id = r.id;

UPDATE public.resume_skill_items rsi
SET resume_id_new = r.uid
FROM public.resumes r
WHERE rsi.resume_id_new IS NULL
	AND rsi.resume_id = r.id;

UPDATE public.resume_labeled_items rli
SET resume_id_new = r.uid
FROM public.resumes r
WHERE rli.resume_id_new IS NULL
	AND rli.resume_id = r.id;

UPDATE public.resume_portfolio_items rpi
SET resume_id_new = r.uid
FROM public.resumes r
WHERE rpi.resume_id_new IS NULL
	AND rpi.resume_id = r.id;

UPDATE public.resume_experience_items rei
SET resume_id_new = r.uid
FROM public.resumes r
WHERE rei.resume_id_new IS NULL
	AND rei.resume_id = r.id;

UPDATE public.experience_library_technologies elt
SET experience_id_new = el.uid
FROM public.experience_library el
WHERE elt.experience_id_new IS NULL
	AND elt.experience_id = el.id;

UPDATE public.resume_experience_items rei
SET experience_id_new = el.uid
FROM public.experience_library el
WHERE rei.experience_id_new IS NULL
	AND rei.experience_id IS NOT NULL
	AND rei.experience_id = el.id;

UPDATE public.resume_experience_tech_overrides reto
SET resume_experience_item_id_new = rei.uid
FROM public.resume_experience_items rei
WHERE reto.resume_experience_item_id_new IS NULL
	AND reto.resume_experience_item_id = rei.id;

DO $$
BEGIN
	IF to_regclass('public.resume_import_jobs') IS NOT NULL THEN
		EXECUTE $q$
			UPDATE public.resume_import_jobs rij
			SET resume_id_new = r.uid
			FROM public.resumes r
			WHERE rij.resume_id_new IS NULL
				AND rij.resume_id IS NOT NULL
				AND rij.resume_id = r.id
		$q$;
	END IF;
END
$$;

-- Required FK columns must be fully backfilled.
ALTER TABLE public.resume_client_access ALTER COLUMN resume_id_new SET NOT NULL;
ALTER TABLE public.resume_basics ALTER COLUMN resume_id_new SET NOT NULL;
ALTER TABLE public.resume_contacts ALTER COLUMN resume_id_new SET NOT NULL;
ALTER TABLE public.resume_skill_items ALTER COLUMN resume_id_new SET NOT NULL;
ALTER TABLE public.resume_labeled_items ALTER COLUMN resume_id_new SET NOT NULL;
ALTER TABLE public.resume_portfolio_items ALTER COLUMN resume_id_new SET NOT NULL;
ALTER TABLE public.resume_experience_items ALTER COLUMN resume_id_new SET NOT NULL;
ALTER TABLE public.experience_library_technologies ALTER COLUMN experience_id_new SET NOT NULL;
ALTER TABLE public.resume_experience_tech_overrides ALTER COLUMN resume_experience_item_id_new SET NOT NULL;

-- Drop policies that depend on legacy bigint ids before column/function swaps.
DROP POLICY IF EXISTS "talent owns resume" ON public.resumes;
DROP POLICY IF EXISTS "client read assigned resume" ON public.resumes;
DROP POLICY IF EXISTS "resumes select by access" ON public.resumes;
DROP POLICY IF EXISTS "resumes insert by access" ON public.resumes;
DROP POLICY IF EXISTS "resumes update by access" ON public.resumes;
DROP POLICY IF EXISTS "resumes delete by access" ON public.resumes;

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
	END LOOP;
END
$$;

DROP POLICY IF EXISTS "owner manage" ON public.resume_experience_tech_overrides;
DROP POLICY IF EXISTS "client read assigned" ON public.resume_experience_tech_overrides;
DROP POLICY IF EXISTS "resume experience tech overrides select by access" ON public.resume_experience_tech_overrides;
DROP POLICY IF EXISTS "resume experience tech overrides manage by access" ON public.resume_experience_tech_overrides;

DROP POLICY IF EXISTS "owner manage" ON public.experience_library;
DROP POLICY IF EXISTS "experience library select by access" ON public.experience_library;
DROP POLICY IF EXISTS "experience library manage by access" ON public.experience_library;

DROP POLICY IF EXISTS "owner manage" ON public.experience_library_technologies;
DROP POLICY IF EXISTS "experience library tech select by access" ON public.experience_library_technologies;
DROP POLICY IF EXISTS "experience library tech manage by access" ON public.experience_library_technologies;

-- Drop old FK constraints.
ALTER TABLE public.resume_client_access DROP CONSTRAINT IF EXISTS resume_client_access_resume_id_fkey;
ALTER TABLE public.resume_basics DROP CONSTRAINT IF EXISTS resume_basics_resume_id_fkey;
ALTER TABLE public.resume_contacts DROP CONSTRAINT IF EXISTS resume_contacts_resume_id_fkey;
ALTER TABLE public.resume_skill_items DROP CONSTRAINT IF EXISTS resume_skill_items_resume_id_fkey;
ALTER TABLE public.resume_labeled_items DROP CONSTRAINT IF EXISTS resume_labeled_items_resume_id_fkey;
ALTER TABLE public.resume_portfolio_items DROP CONSTRAINT IF EXISTS resume_portfolio_items_resume_id_fkey;
ALTER TABLE public.resume_experience_items DROP CONSTRAINT IF EXISTS resume_experience_items_resume_id_fkey;
ALTER TABLE public.resume_experience_items DROP CONSTRAINT IF EXISTS resume_experience_items_experience_id_fkey;
ALTER TABLE public.resume_experience_tech_overrides DROP CONSTRAINT IF EXISTS resume_experience_tech_overrides_resume_experience_item_id_fkey;
ALTER TABLE public.experience_library_technologies DROP CONSTRAINT IF EXISTS experience_library_technologies_experience_id_fkey;

DO $$
BEGIN
	IF to_regclass('public.resume_import_jobs') IS NOT NULL THEN
		EXECUTE 'ALTER TABLE public.resume_import_jobs DROP CONSTRAINT IF EXISTS resume_import_jobs_resume_id_fkey';
	END IF;
END
$$;

-- Drop constraints/indexes tied to soon-to-be-removed columns.
ALTER TABLE public.resume_basics DROP CONSTRAINT IF EXISTS resume_basics_pkey;

DROP INDEX IF EXISTS public.resume_client_access_resume_id_client_user_id_uidx;
DROP INDEX IF EXISTS public.resume_client_access_resume_id_idx;
DROP INDEX IF EXISTS public.resume_contacts_resume_id_position_uidx;
DROP INDEX IF EXISTS public.resume_contacts_resume_id_idx;
DROP INDEX IF EXISTS public.resume_skill_items_resume_id_kind_position_uidx;
DROP INDEX IF EXISTS public.resume_skill_items_resume_id_idx;
DROP INDEX IF EXISTS public.resume_labeled_items_resume_id_kind_position_uidx;
DROP INDEX IF EXISTS public.resume_labeled_items_resume_id_idx;
DROP INDEX IF EXISTS public.resume_portfolio_items_resume_id_position_uidx;
DROP INDEX IF EXISTS public.resume_portfolio_items_resume_id_idx;
DROP INDEX IF EXISTS public.experience_library_technologies_experience_id_position_uidx;
DROP INDEX IF EXISTS public.experience_library_technologies_experience_id_idx;
DROP INDEX IF EXISTS public.resume_experience_items_resume_id_section_position_uidx;
DROP INDEX IF EXISTS public.resume_experience_items_resume_id_idx;
DROP INDEX IF EXISTS public.resume_experience_items_experience_id_idx;
DROP INDEX IF EXISTS public.resume_experience_items_resume_id_section_position_idx;
DROP INDEX IF EXISTS public.resume_experience_tech_overrides_item_id_position_uidx;
DROP INDEX IF EXISTS public.resume_experience_tech_overrides_item_id_idx;

DROP INDEX IF EXISTS public.resumes_uid_uidx;
DROP INDEX IF EXISTS public.resume_client_access_uid_uidx;
DROP INDEX IF EXISTS public.resume_contacts_uid_uidx;
DROP INDEX IF EXISTS public.resume_skill_items_uid_uidx;
DROP INDEX IF EXISTS public.resume_labeled_items_uid_uidx;
DROP INDEX IF EXISTS public.resume_portfolio_items_uid_uidx;
DROP INDEX IF EXISTS public.experience_library_uid_uidx;
DROP INDEX IF EXISTS public.experience_library_technologies_uid_uidx;
DROP INDEX IF EXISTS public.resume_experience_items_uid_uidx;
DROP INDEX IF EXISTS public.resume_experience_tech_overrides_uid_uidx;

-- Swap FK columns to uuid.
ALTER TABLE public.resume_client_access DROP COLUMN resume_id;
ALTER TABLE public.resume_client_access RENAME COLUMN resume_id_new TO resume_id;

ALTER TABLE public.resume_basics DROP COLUMN resume_id;
ALTER TABLE public.resume_basics RENAME COLUMN resume_id_new TO resume_id;

ALTER TABLE public.resume_contacts DROP COLUMN resume_id;
ALTER TABLE public.resume_contacts RENAME COLUMN resume_id_new TO resume_id;

ALTER TABLE public.resume_skill_items DROP COLUMN resume_id;
ALTER TABLE public.resume_skill_items RENAME COLUMN resume_id_new TO resume_id;

ALTER TABLE public.resume_labeled_items DROP COLUMN resume_id;
ALTER TABLE public.resume_labeled_items RENAME COLUMN resume_id_new TO resume_id;

ALTER TABLE public.resume_portfolio_items DROP COLUMN resume_id;
ALTER TABLE public.resume_portfolio_items RENAME COLUMN resume_id_new TO resume_id;

ALTER TABLE public.resume_experience_items DROP COLUMN resume_id;
ALTER TABLE public.resume_experience_items RENAME COLUMN resume_id_new TO resume_id;

ALTER TABLE public.experience_library_technologies DROP COLUMN experience_id;
ALTER TABLE public.experience_library_technologies RENAME COLUMN experience_id_new TO experience_id;

ALTER TABLE public.resume_experience_items DROP COLUMN experience_id;
ALTER TABLE public.resume_experience_items RENAME COLUMN experience_id_new TO experience_id;

ALTER TABLE public.resume_experience_tech_overrides DROP COLUMN resume_experience_item_id;
ALTER TABLE public.resume_experience_tech_overrides RENAME COLUMN resume_experience_item_id_new TO resume_experience_item_id;

DO $$
BEGIN
	IF to_regclass('public.resume_import_jobs') IS NOT NULL THEN
		IF EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema = 'public'
				AND table_name = 'resume_import_jobs'
				AND column_name = 'resume_id_new'
		) THEN
			EXECUTE 'ALTER TABLE public.resume_import_jobs DROP COLUMN IF EXISTS resume_id';
			EXECUTE 'ALTER TABLE public.resume_import_jobs RENAME COLUMN resume_id_new TO resume_id';
		END IF;
	END IF;
END
$$;

-- Convert bigint PK id columns to uuid via uid.
ALTER TABLE public.resumes DROP CONSTRAINT IF EXISTS resumes_pkey;
ALTER TABLE public.resumes DROP COLUMN id;
ALTER TABLE public.resumes RENAME COLUMN uid TO id;
ALTER TABLE public.resumes ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.resumes ALTER COLUMN id SET NOT NULL;
ALTER TABLE public.resumes ADD CONSTRAINT resumes_pkey PRIMARY KEY (id);

ALTER TABLE public.resume_client_access DROP CONSTRAINT IF EXISTS resume_client_access_pkey;
ALTER TABLE public.resume_client_access DROP COLUMN id;
ALTER TABLE public.resume_client_access RENAME COLUMN uid TO id;
ALTER TABLE public.resume_client_access ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.resume_client_access ALTER COLUMN id SET NOT NULL;
ALTER TABLE public.resume_client_access ADD CONSTRAINT resume_client_access_pkey PRIMARY KEY (id);

ALTER TABLE public.resume_contacts DROP CONSTRAINT IF EXISTS resume_contacts_pkey;
ALTER TABLE public.resume_contacts DROP COLUMN id;
ALTER TABLE public.resume_contacts RENAME COLUMN uid TO id;
ALTER TABLE public.resume_contacts ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.resume_contacts ALTER COLUMN id SET NOT NULL;
ALTER TABLE public.resume_contacts ADD CONSTRAINT resume_contacts_pkey PRIMARY KEY (id);

ALTER TABLE public.resume_skill_items DROP CONSTRAINT IF EXISTS resume_skill_items_pkey;
ALTER TABLE public.resume_skill_items DROP COLUMN id;
ALTER TABLE public.resume_skill_items RENAME COLUMN uid TO id;
ALTER TABLE public.resume_skill_items ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.resume_skill_items ALTER COLUMN id SET NOT NULL;
ALTER TABLE public.resume_skill_items ADD CONSTRAINT resume_skill_items_pkey PRIMARY KEY (id);

ALTER TABLE public.resume_labeled_items DROP CONSTRAINT IF EXISTS resume_labeled_items_pkey;
ALTER TABLE public.resume_labeled_items DROP COLUMN id;
ALTER TABLE public.resume_labeled_items RENAME COLUMN uid TO id;
ALTER TABLE public.resume_labeled_items ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.resume_labeled_items ALTER COLUMN id SET NOT NULL;
ALTER TABLE public.resume_labeled_items ADD CONSTRAINT resume_labeled_items_pkey PRIMARY KEY (id);

ALTER TABLE public.resume_portfolio_items DROP CONSTRAINT IF EXISTS resume_portfolio_items_pkey;
ALTER TABLE public.resume_portfolio_items DROP COLUMN id;
ALTER TABLE public.resume_portfolio_items RENAME COLUMN uid TO id;
ALTER TABLE public.resume_portfolio_items ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.resume_portfolio_items ALTER COLUMN id SET NOT NULL;
ALTER TABLE public.resume_portfolio_items ADD CONSTRAINT resume_portfolio_items_pkey PRIMARY KEY (id);

ALTER TABLE public.experience_library DROP CONSTRAINT IF EXISTS experience_library_pkey;
ALTER TABLE public.experience_library DROP COLUMN id;
ALTER TABLE public.experience_library RENAME COLUMN uid TO id;
ALTER TABLE public.experience_library ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.experience_library ALTER COLUMN id SET NOT NULL;
ALTER TABLE public.experience_library ADD CONSTRAINT experience_library_pkey PRIMARY KEY (id);

ALTER TABLE public.experience_library_technologies DROP CONSTRAINT IF EXISTS experience_library_technologies_pkey;
ALTER TABLE public.experience_library_technologies DROP COLUMN id;
ALTER TABLE public.experience_library_technologies RENAME COLUMN uid TO id;
ALTER TABLE public.experience_library_technologies ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.experience_library_technologies ALTER COLUMN id SET NOT NULL;
ALTER TABLE public.experience_library_technologies ADD CONSTRAINT experience_library_technologies_pkey PRIMARY KEY (id);

ALTER TABLE public.resume_experience_items DROP CONSTRAINT IF EXISTS resume_experience_items_pkey;
ALTER TABLE public.resume_experience_items DROP COLUMN id;
ALTER TABLE public.resume_experience_items RENAME COLUMN uid TO id;
ALTER TABLE public.resume_experience_items ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.resume_experience_items ALTER COLUMN id SET NOT NULL;
ALTER TABLE public.resume_experience_items ADD CONSTRAINT resume_experience_items_pkey PRIMARY KEY (id);

ALTER TABLE public.resume_experience_tech_overrides DROP CONSTRAINT IF EXISTS resume_experience_tech_overrides_pkey;
ALTER TABLE public.resume_experience_tech_overrides DROP COLUMN id;
ALTER TABLE public.resume_experience_tech_overrides RENAME COLUMN uid TO id;
ALTER TABLE public.resume_experience_tech_overrides ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.resume_experience_tech_overrides ALTER COLUMN id SET NOT NULL;
ALTER TABLE public.resume_experience_tech_overrides ADD CONSTRAINT resume_experience_tech_overrides_pkey PRIMARY KEY (id);

-- Recreate constraints on converted uuid keys.
ALTER TABLE public.resume_client_access
	ADD CONSTRAINT resume_client_access_resume_id_fkey
	FOREIGN KEY (resume_id) REFERENCES public.resumes(id) ON DELETE CASCADE;

ALTER TABLE public.resume_basics
	ADD CONSTRAINT resume_basics_pkey PRIMARY KEY (resume_id);
ALTER TABLE public.resume_basics
	ADD CONSTRAINT resume_basics_resume_id_fkey
	FOREIGN KEY (resume_id) REFERENCES public.resumes(id) ON DELETE CASCADE;

ALTER TABLE public.resume_contacts
	ADD CONSTRAINT resume_contacts_resume_id_fkey
	FOREIGN KEY (resume_id) REFERENCES public.resumes(id) ON DELETE CASCADE;

ALTER TABLE public.resume_skill_items
	ADD CONSTRAINT resume_skill_items_resume_id_fkey
	FOREIGN KEY (resume_id) REFERENCES public.resumes(id) ON DELETE CASCADE;

ALTER TABLE public.resume_labeled_items
	ADD CONSTRAINT resume_labeled_items_resume_id_fkey
	FOREIGN KEY (resume_id) REFERENCES public.resumes(id) ON DELETE CASCADE;

ALTER TABLE public.resume_portfolio_items
	ADD CONSTRAINT resume_portfolio_items_resume_id_fkey
	FOREIGN KEY (resume_id) REFERENCES public.resumes(id) ON DELETE CASCADE;

ALTER TABLE public.experience_library_technologies
	ADD CONSTRAINT experience_library_technologies_experience_id_fkey
	FOREIGN KEY (experience_id) REFERENCES public.experience_library(id) ON DELETE CASCADE;

ALTER TABLE public.resume_experience_items
	ADD CONSTRAINT resume_experience_items_resume_id_fkey
	FOREIGN KEY (resume_id) REFERENCES public.resumes(id) ON DELETE CASCADE;
ALTER TABLE public.resume_experience_items
	ADD CONSTRAINT resume_experience_items_experience_id_fkey
	FOREIGN KEY (experience_id) REFERENCES public.experience_library(id) ON DELETE SET NULL;

ALTER TABLE public.resume_experience_tech_overrides
	ADD CONSTRAINT resume_experience_tech_overrides_resume_experience_item_id_fkey
	FOREIGN KEY (resume_experience_item_id) REFERENCES public.resume_experience_items(id) ON DELETE CASCADE;

DO $$
BEGIN
	IF to_regclass('public.resume_import_jobs') IS NOT NULL THEN
		IF NOT EXISTS (
			SELECT 1
			FROM pg_constraint
			WHERE conname = 'resume_import_jobs_resume_id_fkey'
				AND conrelid = 'public.resume_import_jobs'::regclass
		) THEN
			EXECUTE 'ALTER TABLE public.resume_import_jobs ADD CONSTRAINT resume_import_jobs_resume_id_fkey FOREIGN KEY (resume_id) REFERENCES public.resumes(id) ON DELETE SET NULL';
		END IF;
	END IF;
END
$$;

-- Recreate dropped indexes that depended on converted FK columns.
CREATE UNIQUE INDEX IF NOT EXISTS resume_client_access_resume_id_client_user_id_uidx
	ON public.resume_client_access (resume_id, client_user_id);
CREATE INDEX IF NOT EXISTS resume_client_access_resume_id_idx
	ON public.resume_client_access (resume_id);

CREATE UNIQUE INDEX IF NOT EXISTS resume_contacts_resume_id_position_uidx
	ON public.resume_contacts (resume_id, position);
CREATE INDEX IF NOT EXISTS resume_contacts_resume_id_idx
	ON public.resume_contacts (resume_id);

CREATE UNIQUE INDEX IF NOT EXISTS resume_skill_items_resume_id_kind_position_uidx
	ON public.resume_skill_items (resume_id, kind, position);
CREATE INDEX IF NOT EXISTS resume_skill_items_resume_id_idx
	ON public.resume_skill_items (resume_id);

CREATE UNIQUE INDEX IF NOT EXISTS resume_labeled_items_resume_id_kind_position_uidx
	ON public.resume_labeled_items (resume_id, kind, position);
CREATE INDEX IF NOT EXISTS resume_labeled_items_resume_id_idx
	ON public.resume_labeled_items (resume_id);

CREATE UNIQUE INDEX IF NOT EXISTS resume_portfolio_items_resume_id_position_uidx
	ON public.resume_portfolio_items (resume_id, position);
CREATE INDEX IF NOT EXISTS resume_portfolio_items_resume_id_idx
	ON public.resume_portfolio_items (resume_id);

CREATE UNIQUE INDEX IF NOT EXISTS experience_library_technologies_experience_id_position_uidx
	ON public.experience_library_technologies (experience_id, position);
CREATE INDEX IF NOT EXISTS experience_library_technologies_experience_id_idx
	ON public.experience_library_technologies (experience_id);

CREATE UNIQUE INDEX IF NOT EXISTS resume_experience_items_resume_id_section_position_uidx
	ON public.resume_experience_items (resume_id, section, position);
CREATE INDEX IF NOT EXISTS resume_experience_items_resume_id_idx
	ON public.resume_experience_items (resume_id);
CREATE INDEX IF NOT EXISTS resume_experience_items_experience_id_idx
	ON public.resume_experience_items (experience_id);
CREATE INDEX IF NOT EXISTS resume_experience_items_resume_id_section_position_idx
	ON public.resume_experience_items (resume_id, section, position);

CREATE UNIQUE INDEX IF NOT EXISTS resume_experience_tech_overrides_item_id_position_uidx
	ON public.resume_experience_tech_overrides (resume_experience_item_id, position);
CREATE INDEX IF NOT EXISTS resume_experience_tech_overrides_item_id_idx
	ON public.resume_experience_tech_overrides (resume_experience_item_id);

-- Keep helper functions aligned with UUID resume ids.
DROP FUNCTION IF EXISTS public.can_access_resume(bigint);
DROP FUNCTION IF EXISTS public.can_edit_resume(bigint);

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

-- Recreate resume-domain access policies against UUID ids.
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
		EXECUTE format(
			'CREATE POLICY "resume item select by access" ON public.%I FOR SELECT USING (public.can_access_resume(resume_id))',
			table_name
		);

		EXECUTE format(
			'CREATE POLICY "resume item manage by access" ON public.%I USING (public.can_edit_resume(resume_id)) WITH CHECK (public.can_edit_resume(resume_id))',
			table_name
		);
	END LOOP;
END
$$;

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

CREATE POLICY "experience library select by access" ON public.experience_library
FOR SELECT USING (public.can_access_talent(talent_id));

CREATE POLICY "experience library manage by access" ON public.experience_library
USING (public.can_edit_talent(talent_id))
WITH CHECK (public.can_edit_talent(talent_id));

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

-- Clean up obsolete serial sequences.
DROP SEQUENCE IF EXISTS public.resumes_id_seq;
DROP SEQUENCE IF EXISTS public.resume_client_access_id_seq;
DROP SEQUENCE IF EXISTS public.resume_contacts_id_seq;
DROP SEQUENCE IF EXISTS public.resume_skill_items_id_seq;
DROP SEQUENCE IF EXISTS public.resume_labeled_items_id_seq;
DROP SEQUENCE IF EXISTS public.resume_portfolio_items_id_seq;
DROP SEQUENCE IF EXISTS public.experience_library_id_seq;
DROP SEQUENCE IF EXISTS public.experience_library_technologies_id_seq;
DROP SEQUENCE IF EXISTS public.resume_experience_items_id_seq;
DROP SEQUENCE IF EXISTS public.resume_experience_tech_overrides_id_seq;
