-- Restore consultant availability persistence after the talent-native refactor.
-- Keeps legacy naming expected by current app code (`profile_availability`, `profile_id`).

CREATE TABLE IF NOT EXISTS public.profile_availability (
	profile_id uuid PRIMARY KEY REFERENCES public.talents(id) ON DELETE CASCADE,
	availability_now_percent integer,
	availability_future_percent integer,
	availability_notice_period_days integer,
	availability_planned_from_date date,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT profile_availability_now_percent_check
		CHECK (
			availability_now_percent IS NULL
			OR (availability_now_percent >= 0 AND availability_now_percent <= 100)
		),
	CONSTRAINT profile_availability_future_percent_check
		CHECK (
			availability_future_percent IS NULL
			OR (availability_future_percent >= 0 AND availability_future_percent <= 100)
		),
	CONSTRAINT profile_availability_notice_period_days_check
		CHECK (
			availability_notice_period_days IS NULL
			OR availability_notice_period_days >= 0
		)
	);

CREATE UNIQUE INDEX IF NOT EXISTS profile_availability_profile_id_key
	ON public.profile_availability (profile_id);

ALTER TABLE public.profile_availability ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'profile_availability'
			AND policyname = 'admin full access'
	) THEN
		EXECUTE 'DROP POLICY "admin full access" ON public.profile_availability';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "admin full access" ON public.profile_availability
		USING (public.is_admin()) WITH CHECK (public.is_admin());
	$policy$;

	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'profile_availability'
			AND policyname = 'talents read own availability'
	) THEN
		EXECUTE 'DROP POLICY "talents read own availability" ON public.profile_availability';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "talents read own availability" ON public.profile_availability
		FOR SELECT
		USING (profile_id = public.current_talent_id());
	$policy$;

	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'profile_availability'
			AND policyname = 'talents insert own availability'
	) THEN
		EXECUTE 'DROP POLICY "talents insert own availability" ON public.profile_availability';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "talents insert own availability" ON public.profile_availability
		FOR INSERT
		WITH CHECK (profile_id = public.current_talent_id());
	$policy$;

	IF EXISTS (
		SELECT 1
		FROM pg_policies
		WHERE schemaname = 'public'
			AND tablename = 'profile_availability'
			AND policyname = 'talents update own availability'
	) THEN
		EXECUTE 'DROP POLICY "talents update own availability" ON public.profile_availability';
	END IF;
	EXECUTE $policy$
		CREATE POLICY "talents update own availability" ON public.profile_availability
		FOR UPDATE
		USING (profile_id = public.current_talent_id())
		WITH CHECK (profile_id = public.current_talent_id());
	$policy$;
END$$;
