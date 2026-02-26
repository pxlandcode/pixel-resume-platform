CREATE TABLE IF NOT EXISTS public.profile_availability (
	profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
	availability_now_percent integer,
	availability_future_percent integer,
	availability_notice_period_days integer,
	availability_planned_from_date date,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profile_availability
	ADD COLUMN IF NOT EXISTS availability_now_percent integer,
	ADD COLUMN IF NOT EXISTS availability_future_percent integer,
	ADD COLUMN IF NOT EXISTS availability_notice_period_days integer,
	ADD COLUMN IF NOT EXISTS availability_planned_from_date date,
	ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
	ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.profile_availability
	DROP CONSTRAINT IF EXISTS profile_availability_now_percent_check,
	DROP CONSTRAINT IF EXISTS profile_availability_future_percent_check,
	DROP CONSTRAINT IF EXISTS profile_availability_notice_period_days_check;

ALTER TABLE public.profile_availability
	ADD CONSTRAINT profile_availability_now_percent_check CHECK (
		availability_now_percent IS NULL OR (
			availability_now_percent >= 0 AND availability_now_percent <= 100
		)
	),
	ADD CONSTRAINT profile_availability_future_percent_check CHECK (
		availability_future_percent IS NULL OR (
			availability_future_percent >= 0 AND availability_future_percent <= 100
		)
	),
	ADD CONSTRAINT profile_availability_notice_period_days_check CHECK (
		availability_notice_period_days IS NULL OR availability_notice_period_days >= 0
	);
