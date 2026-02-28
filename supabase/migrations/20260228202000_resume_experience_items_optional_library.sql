-- Allow resume experiences to stay resume-local unless explicitly saved to experience_library.

ALTER TABLE public.resume_experience_items
	ALTER COLUMN experience_id DROP NOT NULL;

ALTER TABLE public.resume_experience_items
	DROP CONSTRAINT IF EXISTS resume_experience_items_experience_id_fkey;

ALTER TABLE public.resume_experience_items
	ADD CONSTRAINT resume_experience_items_experience_id_fkey
	FOREIGN KEY (experience_id)
	REFERENCES public.experience_library(id)
	ON DELETE SET NULL;
