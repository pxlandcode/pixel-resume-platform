-- Storage bucket provisioning for fresh environments.
-- Requires foundation migration first if you want admin policies to use public.is_admin().

INSERT INTO storage.buckets (
	id,
	name,
	public,
	file_size_limit,
	allowed_mime_types
)
VALUES
	(
		'avatars',
		'avatars',
		true,
		5242880,
		ARRAY[
			'image/jpeg',
			'image/png',
			'image/webp',
			'image/gif',
			'image/avif'
		]::text[]
	),
	(
		'resume-imports-temp',
		'resume-imports-temp',
		false,
		10485760,
		ARRAY['application/pdf']::text[]
	)
ON CONFLICT (id)
DO UPDATE SET
	name = EXCLUDED.name,
	public = EXCLUDED.public,
	file_size_limit = EXCLUDED.file_size_limit,
	allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'storage'
			AND tablename = 'objects'
			AND policyname = 'avatars public read'
	) THEN
		EXECUTE 'DROP POLICY "avatars public read" ON storage.objects';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "avatars public read" ON storage.objects
		FOR SELECT USING (bucket_id = 'avatars');
	$policy$;

	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'storage'
			AND tablename = 'objects'
			AND policyname = 'avatars owner upload'
	) THEN
		EXECUTE 'DROP POLICY "avatars owner upload" ON storage.objects';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "avatars owner upload" ON storage.objects
		FOR INSERT WITH CHECK (
			bucket_id = 'avatars'
			AND auth.role() = 'authenticated'
			AND split_part(name, '/', 1) = 'avatars'
			AND split_part(name, '/', 2) = auth.uid()::text
		);
	$policy$;

	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'storage'
			AND tablename = 'objects'
			AND policyname = 'avatars owner update'
	) THEN
		EXECUTE 'DROP POLICY "avatars owner update" ON storage.objects';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "avatars owner update" ON storage.objects
		FOR UPDATE USING (
			bucket_id = 'avatars'
			AND auth.role() = 'authenticated'
			AND split_part(name, '/', 1) = 'avatars'
			AND split_part(name, '/', 2) = auth.uid()::text
		)
		WITH CHECK (
			bucket_id = 'avatars'
			AND auth.role() = 'authenticated'
			AND split_part(name, '/', 1) = 'avatars'
			AND split_part(name, '/', 2) = auth.uid()::text
		);
	$policy$;

	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'storage'
			AND tablename = 'objects'
			AND policyname = 'avatars owner delete'
	) THEN
		EXECUTE 'DROP POLICY "avatars owner delete" ON storage.objects';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "avatars owner delete" ON storage.objects
		FOR DELETE USING (
			bucket_id = 'avatars'
			AND auth.role() = 'authenticated'
			AND split_part(name, '/', 1) = 'avatars'
			AND split_part(name, '/', 2) = auth.uid()::text
		);
	$policy$;

	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'storage'
			AND tablename = 'objects'
			AND policyname = 'resume temp admin access'
	) THEN
		EXECUTE 'DROP POLICY "resume temp admin access" ON storage.objects';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "resume temp admin access" ON storage.objects
		FOR ALL USING (
			bucket_id = 'resume-imports-temp'
			AND public.is_admin()
		)
		WITH CHECK (
			bucket_id = 'resume-imports-temp'
			AND public.is_admin()
		);
	$policy$;
END$$;
