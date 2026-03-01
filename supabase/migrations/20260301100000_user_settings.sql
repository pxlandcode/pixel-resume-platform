-- Per-user application settings (JSONB for forward-compatible preference expansion).

CREATE TABLE IF NOT EXISTS public.user_settings (
	user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
	settings jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT user_settings_settings_object_chk CHECK (jsonb_typeof(settings) = 'object')
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user settings select own or admin" ON public.user_settings;
DROP POLICY IF EXISTS "user settings insert own or admin" ON public.user_settings;
DROP POLICY IF EXISTS "user settings update own or admin" ON public.user_settings;

CREATE POLICY "user settings select own or admin" ON public.user_settings
FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "user settings insert own or admin" ON public.user_settings
FOR INSERT WITH CHECK (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "user settings update own or admin" ON public.user_settings
FOR UPDATE USING (auth.uid() = user_id OR public.is_admin())
WITH CHECK (auth.uid() = user_id OR public.is_admin());
