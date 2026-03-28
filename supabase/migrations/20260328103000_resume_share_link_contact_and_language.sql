DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resume_share_language_mode') THEN
		CREATE TYPE public.resume_share_language_mode AS ENUM ('sv', 'en', 'both');
	END IF;
END
$$;

ALTER TABLE public.resume_share_links
	ADD COLUMN IF NOT EXISTS language_mode public.resume_share_language_mode NOT NULL DEFAULT 'both',
	ADD COLUMN IF NOT EXISTS contact_name text,
	ADD COLUMN IF NOT EXISTS contact_email text,
	ADD COLUMN IF NOT EXISTS contact_phone text,
	ADD COLUMN IF NOT EXISTS contact_note text;

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'resume_share_links_contact_name_length_chk'
	) THEN
		ALTER TABLE public.resume_share_links
			ADD CONSTRAINT resume_share_links_contact_name_length_chk
			CHECK (contact_name IS NULL OR char_length(contact_name) <= 120);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'resume_share_links_contact_email_length_chk'
	) THEN
		ALTER TABLE public.resume_share_links
			ADD CONSTRAINT resume_share_links_contact_email_length_chk
			CHECK (contact_email IS NULL OR char_length(contact_email) <= 320);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'resume_share_links_contact_phone_length_chk'
	) THEN
		ALTER TABLE public.resume_share_links
			ADD CONSTRAINT resume_share_links_contact_phone_length_chk
			CHECK (contact_phone IS NULL OR char_length(contact_phone) <= 64);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'resume_share_links_contact_note_length_chk'
	) THEN
		ALTER TABLE public.resume_share_links
			ADD CONSTRAINT resume_share_links_contact_note_length_chk
			CHECK (contact_note IS NULL OR char_length(contact_note) <= 1000);
	END IF;
END
$$;
