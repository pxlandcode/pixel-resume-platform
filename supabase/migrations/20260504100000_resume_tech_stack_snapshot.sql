ALTER TABLE public.resume_basics
	ADD COLUMN IF NOT EXISTS tech_stack jsonb;
