-- Add stable UUID identifiers to resume-domain tables while preserving existing bigint PK/FK columns.
-- This is a safe first step before any future full PK type migration.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.resumes
	ADD COLUMN IF NOT EXISTS uid uuid;
UPDATE public.resumes SET uid = gen_random_uuid() WHERE uid IS NULL;
ALTER TABLE public.resumes
	ALTER COLUMN uid SET DEFAULT gen_random_uuid(),
	ALTER COLUMN uid SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS resumes_uid_uidx ON public.resumes (uid);

ALTER TABLE public.resume_client_access
	ADD COLUMN IF NOT EXISTS uid uuid;
UPDATE public.resume_client_access SET uid = gen_random_uuid() WHERE uid IS NULL;
ALTER TABLE public.resume_client_access
	ALTER COLUMN uid SET DEFAULT gen_random_uuid(),
	ALTER COLUMN uid SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS resume_client_access_uid_uidx ON public.resume_client_access (uid);

ALTER TABLE public.resume_contacts
	ADD COLUMN IF NOT EXISTS uid uuid;
UPDATE public.resume_contacts SET uid = gen_random_uuid() WHERE uid IS NULL;
ALTER TABLE public.resume_contacts
	ALTER COLUMN uid SET DEFAULT gen_random_uuid(),
	ALTER COLUMN uid SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS resume_contacts_uid_uidx ON public.resume_contacts (uid);

ALTER TABLE public.resume_skill_items
	ADD COLUMN IF NOT EXISTS uid uuid;
UPDATE public.resume_skill_items SET uid = gen_random_uuid() WHERE uid IS NULL;
ALTER TABLE public.resume_skill_items
	ALTER COLUMN uid SET DEFAULT gen_random_uuid(),
	ALTER COLUMN uid SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS resume_skill_items_uid_uidx ON public.resume_skill_items (uid);

ALTER TABLE public.resume_labeled_items
	ADD COLUMN IF NOT EXISTS uid uuid;
UPDATE public.resume_labeled_items SET uid = gen_random_uuid() WHERE uid IS NULL;
ALTER TABLE public.resume_labeled_items
	ALTER COLUMN uid SET DEFAULT gen_random_uuid(),
	ALTER COLUMN uid SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS resume_labeled_items_uid_uidx ON public.resume_labeled_items (uid);

ALTER TABLE public.resume_portfolio_items
	ADD COLUMN IF NOT EXISTS uid uuid;
UPDATE public.resume_portfolio_items SET uid = gen_random_uuid() WHERE uid IS NULL;
ALTER TABLE public.resume_portfolio_items
	ALTER COLUMN uid SET DEFAULT gen_random_uuid(),
	ALTER COLUMN uid SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS resume_portfolio_items_uid_uidx ON public.resume_portfolio_items (uid);

ALTER TABLE public.experience_library
	ADD COLUMN IF NOT EXISTS uid uuid;
UPDATE public.experience_library SET uid = gen_random_uuid() WHERE uid IS NULL;
ALTER TABLE public.experience_library
	ALTER COLUMN uid SET DEFAULT gen_random_uuid(),
	ALTER COLUMN uid SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS experience_library_uid_uidx ON public.experience_library (uid);

ALTER TABLE public.experience_library_technologies
	ADD COLUMN IF NOT EXISTS uid uuid;
UPDATE public.experience_library_technologies SET uid = gen_random_uuid() WHERE uid IS NULL;
ALTER TABLE public.experience_library_technologies
	ALTER COLUMN uid SET DEFAULT gen_random_uuid(),
	ALTER COLUMN uid SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS experience_library_technologies_uid_uidx
	ON public.experience_library_technologies (uid);

ALTER TABLE public.resume_experience_items
	ADD COLUMN IF NOT EXISTS uid uuid;
UPDATE public.resume_experience_items SET uid = gen_random_uuid() WHERE uid IS NULL;
ALTER TABLE public.resume_experience_items
	ALTER COLUMN uid SET DEFAULT gen_random_uuid(),
	ALTER COLUMN uid SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS resume_experience_items_uid_uidx ON public.resume_experience_items (uid);

ALTER TABLE public.resume_experience_tech_overrides
	ADD COLUMN IF NOT EXISTS uid uuid;
UPDATE public.resume_experience_tech_overrides SET uid = gen_random_uuid() WHERE uid IS NULL;
ALTER TABLE public.resume_experience_tech_overrides
	ALTER COLUMN uid SET DEFAULT gen_random_uuid(),
	ALTER COLUMN uid SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS resume_experience_tech_overrides_uid_uidx
	ON public.resume_experience_tech_overrides (uid);
