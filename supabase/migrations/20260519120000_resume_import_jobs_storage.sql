-- Staging support for PDF resume imports.
-- The app uploads the source PDF to this private bucket, then the import worker
-- downloads it by path and deletes it after processing.

ALTER TABLE public.resume_import_jobs
	ADD COLUMN IF NOT EXISTS source_bucket text NULL,
	ADD COLUMN IF NOT EXISTS source_object_path text NULL,
	ADD COLUMN IF NOT EXISTS source_uploaded_at timestamptz NULL,
	ADD COLUMN IF NOT EXISTS source_deleted_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS resume_import_jobs_source_bucket_idx
	ON public.resume_import_jobs (source_bucket);

CREATE INDEX IF NOT EXISTS resume_import_jobs_source_object_path_idx
	ON public.resume_import_jobs (source_object_path);

INSERT INTO storage.buckets (
	id,
	name,
	public,
	file_size_limit,
	allowed_mime_types
)
VALUES (
	'resume-imports-temp',
	'resume-imports-temp',
	false,
	10485760,
	ARRAY['application/pdf']::text[]
)
ON CONFLICT (id)
DO UPDATE SET
	name = EXCLUDED.name,
	public = EXCLUDED.public,
	file_size_limit = EXCLUDED.file_size_limit,
	allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'storage'
			AND tablename = 'objects'
			AND policyname = 'resume temp admin access'
	) THEN
		EXECUTE 'DROP POLICY "resume temp admin access" ON storage.objects';
	END IF;

	EXECUTE $policy$
		CREATE POLICY "resume temp admin access" ON storage.objects
		FOR ALL USING (
			bucket_id = 'resume-imports-temp'
			AND public.is_admin()
		)
		WITH CHECK (
			bucket_id = 'resume-imports-temp'
			AND public.is_admin()
		);
	$policy$;
END$$;
