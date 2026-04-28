INSERT INTO public.billing_plan_versions (
	plan_family,
	plan_code,
	version_number,
	plan_name,
	currency_code,
	monthly_price_ore,
	included_talent_profiles,
	included_talent_user_seats,
	included_admin_seats,
	sort_order,
	features_json,
	metadata_json
)
VALUES
	(
		'standard',
		'basic',
		2,
		'Basic',
		'SEK',
		150000,
		10,
		10,
		2,
		10,
		'["White-label plattform","Profilredigering","PDF-export","AI-assistans"]'::jsonb,
		'{}'::jsonb
	),
	(
		'standard',
		'standard',
		1,
		'Standard',
		'SEK',
		250000,
		50,
		50,
		3,
		20,
		'["White-label plattform","Profilredigering","PDF-export","AI-assistans"]'::jsonb,
		'{}'::jsonb
	),
	(
		'standard',
		'pro',
		2,
		'Pro',
		'SEK',
		450000,
		150,
		150,
		10,
		30,
		'["Prioriterad support"]'::jsonb,
		'{}'::jsonb
	),
	(
		'standard',
		'custom',
		2,
		'Custom',
		'SEK',
		1000000,
		500,
		500,
		25,
		40,
		'["Anpassade villkor"]'::jsonb,
		'{"minimum_price": true}'::jsonb
	),
	(
		'broker',
		'basic',
		2,
		'Basic',
		'SEK',
		400000,
		50,
		0,
		3,
		50,
		'[]'::jsonb,
		'{}'::jsonb
	),
	(
		'broker',
		'standard',
		1,
		'Standard',
		'SEK',
		600000,
		150,
		0,
		3,
		60,
		'[]'::jsonb,
		'{}'::jsonb
	),
	(
		'broker',
		'pro',
		2,
		'Pro',
		'SEK',
		800000,
		300,
		0,
		10,
		70,
		'[]'::jsonb,
		'{}'::jsonb
	),
	(
		'broker',
		'custom',
		2,
		'Custom',
		'SEK',
		1900000,
		1000,
		0,
		25,
		80,
		'[]'::jsonb,
		'{"minimum_price": true}'::jsonb
	)
ON CONFLICT (plan_family, plan_code, version_number) DO NOTHING;

UPDATE public.billing_plan_versions
SET
	is_active = false,
	updated_at = now()
WHERE (plan_family, plan_code, version_number) IN (
	('standard', 'basic', 1),
	('standard', 'pro', 1),
	('standard', 'custom', 1),
	('broker', 'basic', 1),
	('broker', 'pro', 1),
	('broker', 'custom', 1)
);

UPDATE public.billing_plan_versions
SET
	is_active = true,
	updated_at = now()
WHERE (plan_family, plan_code, version_number) IN (
	('standard', 'basic', 2),
	('standard', 'standard', 1),
	('standard', 'pro', 2),
	('standard', 'custom', 2),
	('broker', 'basic', 2),
	('broker', 'standard', 1),
	('broker', 'pro', 2),
	('broker', 'custom', 2)
);

INSERT INTO public.billing_addon_versions (
	addon_code,
	version_number,
	addon_name,
	billing_type,
	currency_code,
	unit_price_ore,
	package_quantity,
	applies_to_metric,
	sort_order,
	metadata_json
)
VALUES
	(
		'custom_support_development',
		1,
		'Custom support/utveckling',
		'one_time',
		'SEK',
		110000,
		NULL,
		NULL,
		50,
		'{"price_suffix":"/h","unit_label":"h","service_areas":["Mallutveckling","Integrationer","Anpassad utveckling"]}'::jsonb
	)
ON CONFLICT (addon_code, version_number) DO NOTHING;

UPDATE public.billing_addon_versions
SET
	is_active = false,
	updated_at = now()
WHERE addon_code IN ('custom_cv_template', 'custom_mail_template');

UPDATE public.billing_addon_versions
SET
	is_active = true,
	updated_at = now()
WHERE (addon_code, version_number) IN (
	('standalone_talent_users_10', 1),
	('standalone_talent_users_25', 1),
	('standalone_talent_users_50', 1),
	('setup_launch_support', 1),
	('custom_support_development', 1)
);
