-- Allow main resumes to be deleted when the delete is triggered by a parent cascade,
-- while still blocking direct/manual deletion of the current main resume.

CREATE OR REPLACE FUNCTION public.prevent_main_resume_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD.is_main
		AND pg_trigger_depth() = 1
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
