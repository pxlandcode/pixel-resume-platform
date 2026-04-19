UPDATE public.billing_plan_versions
SET
	included_talent_user_seats = 0,
	updated_at = now()
WHERE plan_family = 'broker' AND included_talent_user_seats IS NULL;
