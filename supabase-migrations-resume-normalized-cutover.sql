-- Hard cutover assumption:
-- Existing data in public.resumes.content is disposable in this environment.
-- This migration intentionally removes the JSON payload column with no backfill.
ALTER TABLE public.resumes
	DROP COLUMN IF EXISTS content;
