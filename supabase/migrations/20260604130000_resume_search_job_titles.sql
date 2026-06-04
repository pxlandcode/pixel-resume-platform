ALTER TABLE public.resume_search_jobs
	ADD COLUMN IF NOT EXISTS title text NULL;
