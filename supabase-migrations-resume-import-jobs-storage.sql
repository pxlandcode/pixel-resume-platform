ALTER TABLE public.resume_import_jobs
	ADD COLUMN IF NOT EXISTS source_bucket text NULL,
	ADD COLUMN IF NOT EXISTS source_object_path text NULL,
	ADD COLUMN IF NOT EXISTS source_uploaded_at timestamptz NULL,
	ADD COLUMN IF NOT EXISTS source_deleted_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS resume_import_jobs_source_bucket_idx
	ON public.resume_import_jobs (source_bucket);

CREATE INDEX IF NOT EXISTS resume_import_jobs_source_object_path_idx
	ON public.resume_import_jobs (source_object_path);
