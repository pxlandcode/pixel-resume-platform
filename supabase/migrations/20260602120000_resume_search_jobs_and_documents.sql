CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TABLE IF NOT EXISTS public.resume_search_documents (
	talent_id uuid PRIMARY KEY REFERENCES public.talents(id) ON DELETE CASCADE,
	display_name text NOT NULL DEFAULT '',
	profile_title text NULL,
	avatar_url text NULL,
	organisation_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
	search_text text NOT NULL DEFAULT '',
	search_text_normalized text NOT NULL DEFAULT '',
	search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', search_text_normalized)) STORED,
	field_snippets jsonb NOT NULL DEFAULT '[]'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resume_search_documents_org_ids_gin_idx
	ON public.resume_search_documents USING gin (organisation_ids);

CREATE INDEX IF NOT EXISTS resume_search_documents_search_vector_gin_idx
	ON public.resume_search_documents USING gin (search_vector);

CREATE INDEX IF NOT EXISTS resume_search_documents_search_text_trgm_idx
	ON public.resume_search_documents USING gin (search_text_normalized gin_trgm_ops);

CREATE INDEX IF NOT EXISTS resume_search_documents_updated_at_idx
	ON public.resume_search_documents (updated_at DESC);

CREATE TABLE IF NOT EXISTS public.resume_search_jobs (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	requested_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
	status text NOT NULL CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
	title text NULL,
	query text NOT NULL,
	scope_org_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
	scope_signature text NOT NULL DEFAULT 'default',
	term_overrides jsonb NULL,
	result_json jsonb NULL,
	error_message text NULL,
	request_id text NULL,
	model text NULL,
	usage jsonb NULL,
	started_at timestamptz NULL,
	completed_at timestamptz NULL,
	read_at timestamptz NULL,
	expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resume_search_jobs_requested_by_user_id_idx
	ON public.resume_search_jobs (requested_by_user_id);

CREATE INDEX IF NOT EXISTS resume_search_jobs_status_idx
	ON public.resume_search_jobs (status);

CREATE INDEX IF NOT EXISTS resume_search_jobs_created_at_desc_idx
	ON public.resume_search_jobs (created_at DESC);

CREATE INDEX IF NOT EXISTS resume_search_jobs_expires_at_idx
	ON public.resume_search_jobs (expires_at);

CREATE INDEX IF NOT EXISTS resume_search_jobs_unread_completed_idx
	ON public.resume_search_jobs (requested_by_user_id, completed_at DESC)
	WHERE status = 'succeeded' AND read_at IS NULL;

ALTER TABLE public.resume_search_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resume_search_jobs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'resume_search_documents'
			AND policyname = 'admin full access'
	) THEN
		EXECUTE 'DROP POLICY "admin full access" ON public.resume_search_documents';
	END IF;

	EXECUTE $policy$
		CREATE POLICY "admin full access" ON public.resume_search_documents
			USING (public.is_admin()) WITH CHECK (public.is_admin());
	$policy$;
END$$;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'resume_search_jobs'
			AND policyname = 'admin full access'
	) THEN
		EXECUTE 'DROP POLICY "admin full access" ON public.resume_search_jobs';
	END IF;

	EXECUTE $policy$
		CREATE POLICY "admin full access" ON public.resume_search_jobs
			USING (public.is_admin()) WITH CHECK (public.is_admin());
	$policy$;
END$$;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'resume_search_jobs'
			AND policyname = 'requester read own search jobs'
	) THEN
		EXECUTE 'DROP POLICY "requester read own search jobs" ON public.resume_search_jobs';
	END IF;

	EXECUTE $policy$
		CREATE POLICY "requester read own search jobs" ON public.resume_search_jobs
			FOR SELECT USING (requested_by_user_id = auth.uid());
	$policy$;
END$$;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'resume_search_jobs'
			AND policyname = 'requester mark own search jobs read'
	) THEN
		EXECUTE 'DROP POLICY "requester mark own search jobs read" ON public.resume_search_jobs';
	END IF;

	EXECUTE $policy$
		CREATE POLICY "requester mark own search jobs read" ON public.resume_search_jobs
			FOR UPDATE USING (requested_by_user_id = auth.uid())
			WITH CHECK (requested_by_user_id = auth.uid());
	$policy$;
END$$;

CREATE OR REPLACE FUNCTION public.resume_search_normalize(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
	SELECT trim(regexp_replace(lower(public.unaccent(coalesce(value, ''))), '[^a-z0-9]+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.rebuild_resume_search_document(p_talent_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
	v_talent public.talents%ROWTYPE;
	v_organisation_ids uuid[];
	v_search_text text;
BEGIN
	SELECT *
	INTO v_talent
	FROM public.talents
	WHERE id = p_talent_id;

	IF NOT FOUND THEN
		DELETE FROM public.resume_search_documents WHERE talent_id = p_talent_id;
		RETURN;
	END IF;

	SELECT coalesce(array_agg(DISTINCT organisation_id), '{}'::uuid[])
	INTO v_organisation_ids
	FROM public.organisation_talents
	WHERE talent_id = p_talent_id;

	SELECT concat_ws(
		' ',
		v_talent.first_name,
		v_talent.last_name,
		v_talent.title,
		v_talent.bio,
		v_talent.tech_stack::text,
		(
			SELECT string_agg(
				concat_ws(
					' ',
					r.version_name,
					rb.name,
					rb.title_sv,
					rb.title_en,
					rb.summary_sv,
					rb.summary_en,
					rb.tech_stack::text,
					rb.footer_note_sv,
					rb.footer_note_en
				),
				' '
			)
			FROM public.resumes r
			LEFT JOIN public.resume_basics rb ON rb.resume_id = r.id
			WHERE r.talent_id = p_talent_id
		),
		(
			SELECT string_agg(rsi.value, ' ')
			FROM public.resume_skill_items rsi
			JOIN public.resumes r ON r.id = rsi.resume_id
			WHERE r.talent_id = p_talent_id
		),
		(
			SELECT string_agg(concat_ws(' ', rli.label_sv, rli.label_en, rli.value_sv, rli.value_en), ' ')
			FROM public.resume_labeled_items rli
			JOIN public.resumes r ON r.id = rli.resume_id
			WHERE r.talent_id = p_talent_id
		),
		(
			SELECT string_agg(
				concat_ws(
					' ',
					coalesce(rei.company_override, el.company),
					coalesce(rei.location_sv_override, el.location_sv),
					coalesce(rei.location_en_override, el.location_en),
					coalesce(rei.role_sv_override, el.role_sv),
					coalesce(rei.role_en_override, el.role_en),
					coalesce(rei.description_sv_override, el.description_sv),
					coalesce(rei.description_en_override, el.description_en)
				),
				' '
			)
			FROM public.resume_experience_items rei
			JOIN public.resumes r ON r.id = rei.resume_id
			LEFT JOIN public.experience_library el ON el.id = rei.experience_id
			WHERE r.talent_id = p_talent_id
		),
		(
			SELECT string_agg(elt.value, ' ')
			FROM public.experience_library_technologies elt
			JOIN public.experience_library el ON el.id = elt.experience_id
			WHERE el.talent_id = p_talent_id
		),
		(
			SELECT string_agg(reto.value, ' ')
			FROM public.resume_experience_tech_overrides reto
			JOIN public.resume_experience_items rei ON rei.id = reto.resume_experience_item_id
			JOIN public.resumes r ON r.id = rei.resume_id
			WHERE r.talent_id = p_talent_id
		)
	)
	INTO v_search_text;

	INSERT INTO public.resume_search_documents (
		talent_id,
		display_name,
		profile_title,
		avatar_url,
		organisation_ids,
		search_text,
		search_text_normalized,
		field_snippets,
		updated_at
	)
	VALUES (
		p_talent_id,
		trim(concat_ws(' ', v_talent.first_name, v_talent.last_name)),
		nullif(v_talent.title, ''),
		v_talent.avatar_url,
		v_organisation_ids,
		coalesce(v_search_text, ''),
		public.resume_search_normalize(v_search_text),
		'[]'::jsonb,
		now()
	)
	ON CONFLICT (talent_id)
	DO UPDATE SET
		display_name = EXCLUDED.display_name,
		profile_title = EXCLUDED.profile_title,
		avatar_url = EXCLUDED.avatar_url,
		organisation_ids = EXCLUDED.organisation_ids,
		search_text = EXCLUDED.search_text,
		search_text_normalized = EXCLUDED.search_text_normalized,
		updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.search_resume_documents(
	p_query text,
	p_org_ids uuid[] DEFAULT '{}'::uuid[],
	p_talent_ids uuid[] DEFAULT NULL,
	p_limit integer DEFAULT 50,
	p_offset integer DEFAULT 0
)
RETURNS TABLE (
	talent_id uuid,
	display_name text,
	profile_title text,
	avatar_url text,
	organisation_ids uuid[],
	field_snippets jsonb,
	score real
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
	WITH normalized AS (
		SELECT public.resume_search_normalize(p_query) AS q
	),
	tokens AS (
		SELECT token
		FROM normalized, regexp_split_to_table(normalized.q, '\s+') AS token
		WHERE token <> ''
	),
	query AS (
		SELECT q, websearch_to_tsquery('simple', q) AS tsq
		FROM normalized
	),
	scored AS (
		SELECT
			d.talent_id,
			d.display_name,
			d.profile_title,
			d.avatar_url,
			d.organisation_ids,
			d.field_snippets,
			(
				CASE
					WHEN d.search_vector @@ query.tsq THEN ts_rank_cd(d.search_vector, query.tsq)
					ELSE 0
				END
				+ similarity(d.search_text_normalized, query.q)
				+ (
					SELECT count(*)::real * 0.05
					FROM tokens t
					WHERE d.search_text_normalized ILIKE '%' || t.token || '%'
				)
			)::real AS score
		FROM public.resume_search_documents d
		CROSS JOIN query
		WHERE query.q <> ''
			AND (
				coalesce(cardinality(p_org_ids), 0) = 0
				OR d.organisation_ids && p_org_ids
			)
			AND (
				p_talent_ids IS NULL
				OR d.talent_id = ANY (p_talent_ids)
			)
			AND (
				d.search_vector @@ query.tsq
				OR NOT EXISTS (
					SELECT 1
					FROM tokens t
					WHERE d.search_text_normalized NOT ILIKE '%' || t.token || '%'
				)
			)
	)
	SELECT
		scored.talent_id,
		scored.display_name,
		scored.profile_title,
		scored.avatar_url,
		scored.organisation_ids,
		scored.field_snippets,
		scored.score
	FROM scored
	ORDER BY scored.score DESC, scored.display_name ASC, scored.talent_id ASC
	LIMIT least(greatest(coalesce(p_limit, 50), 1), 101)
	OFFSET greatest(coalesce(p_offset, 0), 0);
$$;

SELECT public.rebuild_resume_search_document(id)
FROM public.talents;
