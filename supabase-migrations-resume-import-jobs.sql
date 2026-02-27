CREATE TABLE IF NOT EXISTS public.resume_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  talent_id uuid NOT NULL REFERENCES public.talents(id) ON DELETE CASCADE,
  requested_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
  source_filename text NOT NULL,
  source_size_bytes integer NOT NULL CHECK (source_size_bytes > 0),
  source_bucket text NULL,
  source_object_path text NULL,
  source_uploaded_at timestamptz NULL,
  source_deleted_at timestamptz NULL,
  error_message text NULL,
  resume_id bigint NULL REFERENCES public.resumes(id) ON DELETE SET NULL,
  resume_version_name text NULL,
  request_id text NULL,
  model text NULL,
  usage jsonb NULL,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resume_import_jobs_talent_id_idx
  ON public.resume_import_jobs (talent_id);

CREATE INDEX IF NOT EXISTS resume_import_jobs_requested_by_user_id_idx
  ON public.resume_import_jobs (requested_by_user_id);

CREATE INDEX IF NOT EXISTS resume_import_jobs_status_idx
  ON public.resume_import_jobs (status);

CREATE INDEX IF NOT EXISTS resume_import_jobs_created_at_desc_idx
  ON public.resume_import_jobs (created_at DESC);

CREATE INDEX IF NOT EXISTS resume_import_jobs_source_bucket_idx
  ON public.resume_import_jobs (source_bucket);

CREATE INDEX IF NOT EXISTS resume_import_jobs_source_object_path_idx
  ON public.resume_import_jobs (source_object_path);

ALTER TABLE public.resume_import_jobs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'resume_import_jobs'
      AND policyname = 'admin full access'
  ) THEN
    EXECUTE 'DROP POLICY "admin full access" ON public.resume_import_jobs';
  END IF;
  EXECUTE $policy$
    CREATE POLICY "admin full access" ON public.resume_import_jobs
      USING (public.is_admin()) WITH CHECK (public.is_admin());
  $policy$;
END$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'resume_import_jobs'
      AND policyname = 'requester read own jobs'
  ) THEN
    EXECUTE 'DROP POLICY "requester read own jobs" ON public.resume_import_jobs';
  END IF;
  EXECUTE $policy$
    CREATE POLICY "requester read own jobs" ON public.resume_import_jobs
      FOR SELECT USING (requested_by_user_id = auth.uid());
  $policy$;
END$$;
