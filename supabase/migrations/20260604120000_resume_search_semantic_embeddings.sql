CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.resume_search_document_embeddings (
	talent_id uuid PRIMARY KEY REFERENCES public.resume_search_documents(talent_id) ON DELETE CASCADE,
	model text NOT NULL,
	content_hash text NOT NULL,
	embedding vector(1536) NOT NULL,
	generated_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resume_search_document_embeddings_model_idx
	ON public.resume_search_document_embeddings (model);

CREATE INDEX IF NOT EXISTS resume_search_document_embeddings_content_hash_idx
	ON public.resume_search_document_embeddings (content_hash);

CREATE INDEX IF NOT EXISTS resume_search_document_embeddings_embedding_idx
	ON public.resume_search_document_embeddings
	USING ivfflat (embedding vector_cosine_ops)
	WITH (lists = 100);

ALTER TABLE public.resume_search_document_embeddings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'resume_search_document_embeddings'
			AND policyname = 'admin full access'
	) THEN
		EXECUTE 'DROP POLICY "admin full access" ON public.resume_search_document_embeddings';
	END IF;

	EXECUTE $policy$
		CREATE POLICY "admin full access" ON public.resume_search_document_embeddings
			USING (public.is_admin()) WITH CHECK (public.is_admin());
	$policy$;
END$$;

CREATE OR REPLACE FUNCTION public.match_resume_search_document_embeddings(
	p_query_embedding vector(1536),
	p_org_ids uuid[] DEFAULT '{}'::uuid[],
	p_talent_ids uuid[] DEFAULT NULL,
	p_model text DEFAULT NULL,
	p_limit integer DEFAULT 200,
	p_min_similarity real DEFAULT 0.2
)
RETURNS TABLE (
	talent_id uuid,
	display_name text,
	profile_title text,
	field_snippets jsonb,
	similarity real
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
	WITH scored AS (
		SELECT
			d.talent_id,
			d.display_name,
			d.profile_title,
			d.field_snippets,
			(1 - (e.embedding <=> p_query_embedding))::real AS similarity
		FROM public.resume_search_document_embeddings e
		JOIN public.resume_search_documents d ON d.talent_id = e.talent_id
		WHERE (p_model IS NULL OR e.model = p_model)
			AND (
				coalesce(cardinality(p_org_ids), 0) = 0
				OR d.organisation_ids && p_org_ids
			)
			AND (
				p_talent_ids IS NULL
				OR d.talent_id = ANY (p_talent_ids)
			)
	)
	SELECT
		scored.talent_id,
		scored.display_name,
		scored.profile_title,
		scored.field_snippets,
		scored.similarity
	FROM scored
	WHERE scored.similarity >= coalesce(p_min_similarity, 0.2)
	ORDER BY scored.similarity DESC, scored.display_name ASC, scored.talent_id ASC
	LIMIT least(greatest(coalesce(p_limit, 200), 1), 500);
$$;
