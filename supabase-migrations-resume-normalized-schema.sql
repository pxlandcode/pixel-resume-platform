-- Normalized resume schema for fresh DBs using the talent+organisations foundation model.
-- Requires: supabase-migrations-foundation-talent-org.sql to be applied first.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.resumes (
	id bigserial PRIMARY KEY,
	talent_id uuid NOT NULL REFERENCES public.talents(id) ON DELETE CASCADE,
	version_name text NOT NULL DEFAULT 'Main',
	is_main boolean NOT NULL DEFAULT false,
	is_active boolean NOT NULL DEFAULT true,
	allow_word_export boolean NOT NULL DEFAULT false,
	preview_html text,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.resume_client_access (
	id bigserial PRIMARY KEY,
	resume_id bigint NOT NULL REFERENCES public.resumes(id) ON DELETE CASCADE,
	client_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
	granted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS resumes_one_main_per_talent_uidx
	ON public.resumes (talent_id)
	WHERE is_main = true;

CREATE INDEX IF NOT EXISTS resumes_talent_id_idx ON public.resumes (talent_id);
CREATE INDEX IF NOT EXISTS resumes_created_at_idx ON public.resumes (created_at);
CREATE INDEX IF NOT EXISTS resumes_updated_at_idx ON public.resumes (updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS resume_client_access_resume_id_client_user_id_uidx
	ON public.resume_client_access (resume_id, client_user_id);

CREATE INDEX IF NOT EXISTS resume_client_access_resume_id_idx
	ON public.resume_client_access (resume_id);

CREATE INDEX IF NOT EXISTS resume_client_access_client_user_id_idx
	ON public.resume_client_access (client_user_id);

CREATE TABLE IF NOT EXISTS public.resume_basics (
	resume_id bigint PRIMARY KEY REFERENCES public.resumes(id) ON DELETE CASCADE,
	name text NOT NULL DEFAULT '',
	title_sv text NOT NULL DEFAULT '',
	title_en text NOT NULL DEFAULT '',
	summary_sv text NOT NULL DEFAULT '',
	summary_en text NOT NULL DEFAULT '',
	footer_note_sv text NOT NULL DEFAULT '',
	footer_note_en text NOT NULL DEFAULT '',
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.resume_contacts (
	id bigserial PRIMARY KEY,
	resume_id bigint NOT NULL REFERENCES public.resumes(id) ON DELETE CASCADE,
	position integer NOT NULL,
	name text NOT NULL DEFAULT '',
	phone text,
	email text,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.resume_skill_items (
	id bigserial PRIMARY KEY,
	resume_id bigint NOT NULL REFERENCES public.resumes(id) ON DELETE CASCADE,
	kind text NOT NULL CHECK (kind IN ('example', 'technique', 'method')),
	position integer NOT NULL,
	value text NOT NULL DEFAULT '',
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.resume_labeled_items (
	id bigserial PRIMARY KEY,
	resume_id bigint NOT NULL REFERENCES public.resumes(id) ON DELETE CASCADE,
	kind text NOT NULL CHECK (kind IN ('language', 'education')),
	position integer NOT NULL,
	label_sv text NOT NULL DEFAULT '',
	label_en text NOT NULL DEFAULT '',
	value_sv text NOT NULL DEFAULT '',
	value_en text NOT NULL DEFAULT '',
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.resume_portfolio_items (
	id bigserial PRIMARY KEY,
	resume_id bigint NOT NULL REFERENCES public.resumes(id) ON DELETE CASCADE,
	position integer NOT NULL,
	url text NOT NULL DEFAULT '',
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.experience_library (
	id bigserial PRIMARY KEY,
	talent_id uuid NOT NULL REFERENCES public.talents(id) ON DELETE CASCADE,
	start_date text NOT NULL DEFAULT '',
	end_date text NULL,
	company text NOT NULL DEFAULT '',
	location_sv text NOT NULL DEFAULT '',
	location_en text NOT NULL DEFAULT '',
	role_sv text NOT NULL DEFAULT '',
	role_en text NOT NULL DEFAULT '',
	description_sv text NOT NULL DEFAULT '',
	description_en text NOT NULL DEFAULT '',
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.experience_library_technologies (
	id bigserial PRIMARY KEY,
	experience_id bigint NOT NULL REFERENCES public.experience_library(id) ON DELETE CASCADE,
	position integer NOT NULL,
	value text NOT NULL DEFAULT '',
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.resume_experience_items (
	id bigserial PRIMARY KEY,
	resume_id bigint NOT NULL REFERENCES public.resumes(id) ON DELETE CASCADE,
	experience_id bigint NOT NULL REFERENCES public.experience_library(id) ON DELETE RESTRICT,
	section text NOT NULL CHECK (section IN ('highlighted', 'experience')),
	position integer NOT NULL,
	hidden boolean NOT NULL DEFAULT false,
	start_date_override text,
	end_date_override text,
	company_override text,
	location_sv_override text,
	location_en_override text,
	role_sv_override text,
	role_en_override text,
	description_sv_override text,
	description_en_override text,
	use_tech_override boolean NOT NULL DEFAULT false,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.resume_experience_tech_overrides (
	id bigserial PRIMARY KEY,
	resume_experience_item_id bigint NOT NULL REFERENCES public.resume_experience_items(id) ON DELETE CASCADE,
	position integer NOT NULL,
	value text NOT NULL DEFAULT '',
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS resume_contacts_resume_id_position_uidx
	ON public.resume_contacts (resume_id, position);

CREATE UNIQUE INDEX IF NOT EXISTS resume_skill_items_resume_id_kind_position_uidx
	ON public.resume_skill_items (resume_id, kind, position);

CREATE UNIQUE INDEX IF NOT EXISTS resume_labeled_items_resume_id_kind_position_uidx
	ON public.resume_labeled_items (resume_id, kind, position);

CREATE UNIQUE INDEX IF NOT EXISTS resume_portfolio_items_resume_id_position_uidx
	ON public.resume_portfolio_items (resume_id, position);

CREATE UNIQUE INDEX IF NOT EXISTS experience_library_technologies_experience_id_position_uidx
	ON public.experience_library_technologies (experience_id, position);

CREATE UNIQUE INDEX IF NOT EXISTS resume_experience_items_resume_id_section_position_uidx
	ON public.resume_experience_items (resume_id, section, position);

CREATE UNIQUE INDEX IF NOT EXISTS resume_experience_tech_overrides_item_id_position_uidx
	ON public.resume_experience_tech_overrides (resume_experience_item_id, position);

CREATE INDEX IF NOT EXISTS resume_contacts_resume_id_idx
	ON public.resume_contacts (resume_id);

CREATE INDEX IF NOT EXISTS resume_skill_items_resume_id_idx
	ON public.resume_skill_items (resume_id);

CREATE INDEX IF NOT EXISTS resume_labeled_items_resume_id_idx
	ON public.resume_labeled_items (resume_id);

CREATE INDEX IF NOT EXISTS resume_portfolio_items_resume_id_idx
	ON public.resume_portfolio_items (resume_id);

CREATE INDEX IF NOT EXISTS experience_library_talent_id_idx
	ON public.experience_library (talent_id);

CREATE INDEX IF NOT EXISTS experience_library_technologies_experience_id_idx
	ON public.experience_library_technologies (experience_id);

CREATE INDEX IF NOT EXISTS resume_experience_items_resume_id_idx
	ON public.resume_experience_items (resume_id);

CREATE INDEX IF NOT EXISTS resume_experience_items_experience_id_idx
	ON public.resume_experience_items (experience_id);

CREATE INDEX IF NOT EXISTS resume_experience_items_section_idx
	ON public.resume_experience_items (section);

CREATE INDEX IF NOT EXISTS resume_experience_items_position_idx
	ON public.resume_experience_items (position);

CREATE INDEX IF NOT EXISTS resume_experience_items_resume_id_section_position_idx
	ON public.resume_experience_items (resume_id, section, position);

CREATE INDEX IF NOT EXISTS resume_experience_tech_overrides_item_id_idx
	ON public.resume_experience_tech_overrides (resume_experience_item_id);

CREATE INDEX IF NOT EXISTS experience_library_company_trgm_idx
	ON public.experience_library USING gin (company gin_trgm_ops);

CREATE INDEX IF NOT EXISTS experience_library_role_sv_trgm_idx
	ON public.experience_library USING gin (role_sv gin_trgm_ops);

CREATE INDEX IF NOT EXISTS experience_library_role_en_trgm_idx
	ON public.experience_library USING gin (role_en gin_trgm_ops);

CREATE INDEX IF NOT EXISTS experience_library_description_sv_trgm_idx
	ON public.experience_library USING gin (description_sv gin_trgm_ops);

CREATE INDEX IF NOT EXISTS experience_library_description_en_trgm_idx
	ON public.experience_library USING gin (description_en gin_trgm_ops);

CREATE INDEX IF NOT EXISTS experience_library_technologies_value_trgm_idx
	ON public.experience_library_technologies USING gin (value gin_trgm_ops);

CREATE INDEX IF NOT EXISTS resume_skill_items_value_trgm_idx
	ON public.resume_skill_items USING gin (value gin_trgm_ops);

CREATE INDEX IF NOT EXISTS resume_experience_tech_overrides_value_trgm_idx
	ON public.resume_experience_tech_overrides USING gin (value gin_trgm_ops);

ALTER TABLE public.resumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resume_client_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resume_basics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resume_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resume_skill_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resume_labeled_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resume_portfolio_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experience_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experience_library_technologies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resume_experience_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resume_experience_tech_overrides ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
	table_name text;
	tables text[] := ARRAY[
		'resumes',
		'resume_client_access',
		'resume_basics',
		'resume_contacts',
		'resume_skill_items',
		'resume_labeled_items',
		'resume_portfolio_items',
		'experience_library',
		'experience_library_technologies',
		'resume_experience_items',
		'resume_experience_tech_overrides'
	];
BEGIN
	FOREACH table_name IN ARRAY tables
	LOOP
		IF EXISTS (
			SELECT 1 FROM pg_policies
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
			AND tablename = 'resumes'
			AND policyname = 'talent owns resume'
	) THEN
		EXECUTE 'DROP POLICY "talent owns resume" ON public.resumes';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "talent owns resume" ON public.resumes
		USING (
			public.is_talent() AND EXISTS (
				SELECT 1
				FROM public.talents t
				WHERE t.id = resumes.talent_id
					AND t.user_id = auth.uid()
			)
		)
		WITH CHECK (
			public.is_talent() AND EXISTS (
				SELECT 1
				FROM public.talents t
				WHERE t.id = resumes.talent_id
					AND t.user_id = auth.uid()
			)
		);
	$policy$;

	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'resumes'
			AND policyname = 'client read assigned resume'
	) THEN
		EXECUTE 'DROP POLICY "client read assigned resume" ON public.resumes';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "client read assigned resume" ON public.resumes
		FOR SELECT USING (
			public.is_employer() AND EXISTS (
				SELECT 1
				FROM public.resume_client_access rca
				WHERE rca.resume_id = resumes.id
					AND rca.client_user_id = auth.uid()
			)
		);
	$policy$;
END$$;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'resume_client_access'
			AND policyname = 'admin manage access'
	) THEN
		EXECUTE 'DROP POLICY "admin manage access" ON public.resume_client_access';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "admin manage access" ON public.resume_client_access
		USING (public.is_admin())
		WITH CHECK (public.is_admin());
	$policy$;

	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'resume_client_access'
			AND policyname = 'client read own access'
	) THEN
		EXECUTE 'DROP POLICY "client read own access" ON public.resume_client_access';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "client read own access" ON public.resume_client_access
		FOR SELECT USING (
			public.is_employer() AND client_user_id = auth.uid()
		);
	$policy$;
END$$;

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
		IF EXISTS (
			SELECT 1 FROM pg_policies
			WHERE schemaname = 'public'
				AND tablename = table_name
				AND policyname = 'owner manage'
		) THEN
			EXECUTE format('DROP POLICY "owner manage" ON public.%I', table_name);
		END IF;

		EXECUTE format(
			'CREATE POLICY "owner manage" ON public.%I USING (
				public.is_talent() AND EXISTS (
					SELECT 1
					FROM public.resumes r
					JOIN public.talents t ON t.id = r.talent_id
					WHERE r.id = %I.resume_id
						AND t.user_id = auth.uid()
				)
			) WITH CHECK (
				public.is_talent() AND EXISTS (
					SELECT 1
					FROM public.resumes r
					JOIN public.talents t ON t.id = r.talent_id
					WHERE r.id = %I.resume_id
						AND t.user_id = auth.uid()
				)
			)',
			table_name,
			table_name,
			table_name
		);

		IF EXISTS (
			SELECT 1 FROM pg_policies
			WHERE schemaname = 'public'
				AND tablename = table_name
				AND policyname = 'client read assigned'
		) THEN
			EXECUTE format('DROP POLICY "client read assigned" ON public.%I', table_name);
		END IF;

		EXECUTE format(
			'CREATE POLICY "client read assigned" ON public.%I FOR SELECT USING (
				public.is_employer() AND EXISTS (
					SELECT 1
					FROM public.resume_client_access rca
					WHERE rca.resume_id = %I.resume_id
						AND rca.client_user_id = auth.uid()
				)
			)',
			table_name,
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
			AND tablename = 'resume_experience_tech_overrides'
			AND policyname = 'owner manage'
	) THEN
		EXECUTE 'DROP POLICY "owner manage" ON public.resume_experience_tech_overrides';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "owner manage" ON public.resume_experience_tech_overrides
		USING (
			public.is_talent() AND EXISTS (
				SELECT 1
				FROM public.resume_experience_items rei
				JOIN public.resumes r ON r.id = rei.resume_id
				JOIN public.talents t ON t.id = r.talent_id
				WHERE rei.id = resume_experience_tech_overrides.resume_experience_item_id
					AND t.user_id = auth.uid()
			)
		)
		WITH CHECK (
			public.is_talent() AND EXISTS (
				SELECT 1
				FROM public.resume_experience_items rei
				JOIN public.resumes r ON r.id = rei.resume_id
				JOIN public.talents t ON t.id = r.talent_id
				WHERE rei.id = resume_experience_tech_overrides.resume_experience_item_id
					AND t.user_id = auth.uid()
			)
		);
	$policy$;

	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'resume_experience_tech_overrides'
			AND policyname = 'client read assigned'
	) THEN
		EXECUTE 'DROP POLICY "client read assigned" ON public.resume_experience_tech_overrides';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "client read assigned" ON public.resume_experience_tech_overrides
		FOR SELECT USING (
			public.is_employer() AND EXISTS (
				SELECT 1
				FROM public.resume_experience_items rei
				JOIN public.resume_client_access rca ON rca.resume_id = rei.resume_id
				WHERE rei.id = resume_experience_tech_overrides.resume_experience_item_id
					AND rca.client_user_id = auth.uid()
			)
		);
	$policy$;
END$$;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'experience_library'
			AND policyname = 'owner manage'
	) THEN
		EXECUTE 'DROP POLICY "owner manage" ON public.experience_library';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "owner manage" ON public.experience_library
		USING (
			public.is_talent() AND EXISTS (
				SELECT 1
				FROM public.talents t
				WHERE t.id = experience_library.talent_id
					AND t.user_id = auth.uid()
			)
		)
		WITH CHECK (
			public.is_talent() AND EXISTS (
				SELECT 1
				FROM public.talents t
				WHERE t.id = experience_library.talent_id
					AND t.user_id = auth.uid()
			)
		);
	$policy$;
END$$;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'experience_library_technologies'
			AND policyname = 'owner manage'
	) THEN
		EXECUTE 'DROP POLICY "owner manage" ON public.experience_library_technologies';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "owner manage" ON public.experience_library_technologies
		USING (
			public.is_talent() AND EXISTS (
				SELECT 1
				FROM public.experience_library el
				JOIN public.talents t ON t.id = el.talent_id
				WHERE el.id = experience_library_technologies.experience_id
					AND t.user_id = auth.uid()
			)
		)
		WITH CHECK (
			public.is_talent() AND EXISTS (
				SELECT 1
				FROM public.experience_library el
				JOIN public.talents t ON t.id = el.talent_id
				WHERE el.id = experience_library_technologies.experience_id
					AND t.user_id = auth.uid()
			)
		);
	$policy$;
END$$;
