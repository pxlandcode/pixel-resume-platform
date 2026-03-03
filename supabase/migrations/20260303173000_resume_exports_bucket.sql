-- Private bucket for generated resume export files.
-- Files are served through short-lived signed URLs.
INSERT INTO storage.buckets (
	id,
	name,
	public,
	file_size_limit
)
VALUES (
	'resume-exports',
	'resume-exports',
	false,
	52428800
)
ON CONFLICT (id)
DO UPDATE SET
	name = EXCLUDED.name,
	public = EXCLUDED.public,
	file_size_limit = EXCLUDED.file_size_limit;
