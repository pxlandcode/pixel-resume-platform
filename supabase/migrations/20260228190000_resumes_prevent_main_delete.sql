-- Prevent accidental deletion of a talent's main resume.

CREATE OR REPLACE FUNCTION public.prevent_main_resume_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD.is_main
		AND EXISTS (
			SELECT 1
			FROM public.talents t
			WHERE t.id = OLD.talent_id
		)
	THEN
		RAISE EXCEPTION 'Main resume cannot be deleted. Set another resume as main first.';
	END IF;

	RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS prevent_main_resume_delete ON public.resumes;

CREATE TRIGGER prevent_main_resume_delete
BEFORE DELETE ON public.resumes
FOR EACH ROW
EXECUTE FUNCTION public.prevent_main_resume_delete();
