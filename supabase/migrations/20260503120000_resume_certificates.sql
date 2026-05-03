ALTER TABLE public.resume_labeled_items
	DROP CONSTRAINT IF EXISTS resume_labeled_items_kind_check;

ALTER TABLE public.resume_labeled_items
	ADD CONSTRAINT resume_labeled_items_kind_check
	CHECK (kind IN ('language', 'education', 'certificate'));

UPDATE public.resume_labeled_items
SET kind = 'certificate'
WHERE kind = 'education'
	AND (
		lower(label_sv) IN ('certifiering', 'certifieringar', 'certifikat')
		OR lower(label_en) IN ('certification', 'certifications', 'certificate', 'certificates')
	);
