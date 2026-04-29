CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.organisations
	ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false,
	ADD COLUMN IF NOT EXISTS demo_reset_at timestamptz,
	ADD COLUMN IF NOT EXISTS demo_expires_at timestamptz,
	ADD COLUMN IF NOT EXISTS internal_notes text;

CREATE INDEX IF NOT EXISTS organisations_is_demo_idx
	ON public.organisations (is_demo, demo_reset_at DESC)
	WHERE is_demo = true;

CREATE OR REPLACE FUNCTION public.reset_demo_organisation(
	p_admin_email text DEFAULT 'demo.admin@test.se',
	p_talent_email text DEFAULT 'demo.talent@test.se'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
	v_org_id constant uuid := '00000000-0000-4000-8000-000000000101'::uuid;
	v_talent_id constant uuid := '00000000-0000-4000-8000-000000000201'::uuid;
	v_resume_id constant uuid := '00000000-0000-4000-8000-000000000301'::uuid;
	v_exp_platform_id constant uuid := '00000000-0000-4000-8000-000000000401'::uuid;
	v_exp_ai_id constant uuid := '00000000-0000-4000-8000-000000000402'::uuid;
	v_exp_data_id constant uuid := '00000000-0000-4000-8000-000000000403'::uuid;
	v_exp_design_id constant uuid := '00000000-0000-4000-8000-000000000404'::uuid;
	v_exp_admin_id constant uuid := '00000000-0000-4000-8000-000000000405'::uuid;
	v_exp_analytics_id constant uuid := '00000000-0000-4000-8000-000000000406'::uuid;
	v_exp_mobile_id constant uuid := '00000000-0000-4000-8000-000000000407'::uuid;
	v_exp_cms_id constant uuid := '00000000-0000-4000-8000-000000000408'::uuid;
	v_exp_integration_id constant uuid := '00000000-0000-4000-8000-000000000409'::uuid;
	v_admin_email text := lower(btrim(coalesce(p_admin_email, '')));
	v_talent_email text := lower(btrim(coalesce(p_talent_email, '')));
	v_admin_user_id uuid;
	v_talent_user_id uuid;
	v_org_admin_role_id uuid;
	v_employer_role_id uuid;
	v_talent_role_id uuid;
	v_plan_version_id uuid;
	v_effective_month date := date_trunc('month', current_date)::date;
	v_old_talent_ids uuid[] := ARRAY[]::uuid[];
	v_active_ids record;
BEGIN
	IF v_admin_email = '' OR v_talent_email = '' THEN
		RAISE EXCEPTION 'Demo admin and talent emails are required.';
	END IF;

	SELECT u.id INTO v_admin_user_id
	FROM auth.users u
	WHERE lower(u.email) = v_admin_email
	LIMIT 1;

	SELECT u.id INTO v_talent_user_id
	FROM auth.users u
	WHERE lower(u.email) = v_talent_email
	LIMIT 1;

	IF v_admin_user_id IS NULL THEN
		RAISE EXCEPTION 'Demo admin auth user % does not exist. Run npm run demo:setup or create it in Supabase Auth first.', v_admin_email;
	END IF;

	IF v_talent_user_id IS NULL THEN
		RAISE EXCEPTION 'Demo talent auth user % does not exist. Run npm run demo:setup or create it in Supabase Auth first.', v_talent_email;
	END IF;

	SELECT id INTO v_org_admin_role_id FROM public.roles WHERE key = 'organisation_admin' LIMIT 1;
	SELECT id INTO v_employer_role_id FROM public.roles WHERE key = 'employer' LIMIT 1;
	SELECT id INTO v_talent_role_id FROM public.roles WHERE key = 'talent' LIMIT 1;

	IF v_org_admin_role_id IS NULL OR v_employer_role_id IS NULL OR v_talent_role_id IS NULL THEN
		RAISE EXCEPTION 'Required demo roles are missing from public.roles.';
	END IF;

	SELECT id INTO v_plan_version_id
	FROM public.billing_plan_versions
	WHERE plan_family = 'standard'
		AND plan_code = 'basic'
		AND is_active = true
	ORDER BY version_number DESC, created_at DESC
	LIMIT 1;

	SELECT COALESCE(array_agg(ot.talent_id), ARRAY[]::uuid[]) INTO v_old_talent_ids
	FROM public.organisation_talents ot
	JOIN public.organisations o ON o.id = ot.organisation_id
	WHERE o.id = v_org_id
		OR o.slug::text = 'demo';

	DELETE FROM public.organisation_users
	WHERE user_id IN (v_admin_user_id, v_talent_user_id);

	DELETE FROM public.user_roles
	WHERE user_id IN (v_admin_user_id, v_talent_user_id)
		AND role_id IN (v_org_admin_role_id, v_employer_role_id, v_talent_role_id);

	UPDATE public.talents
	SET user_id = NULL,
		updated_at = now()
	WHERE user_id = v_talent_user_id;

	DELETE FROM public.talents
	WHERE id = ANY(v_old_talent_ids)
		OR id = v_talent_id;

	DELETE FROM public.organisations
	WHERE id = v_org_id
		OR slug::text = 'demo'
		OR name = 'Demo Organisation';

	INSERT INTO public.organisations (
		id,
		name,
		slug,
		homepage_url,
		brand_settings,
		created_by_user_id,
		is_demo,
		demo_reset_at,
		internal_notes
	)
	VALUES (
		v_org_id,
		'Demo Organisation',
		'demo',
		'https://example.com',
		'{
			"isPixelCode": false,
			"theme": {
				"primary": "#111827",
				"accent": "#22c55e",
				"surface": "#ffffff",
				"text": "#111827"
			},
			"typography": {
				"mainFontKey": "inter"
			}
		}'::jsonb,
		v_admin_user_id,
		true,
		now(),
		'Shared sandbox organisation. Reset nightly; never store real client or personal data here.'
	);

	INSERT INTO public.organisation_templates (
		organisation_id,
		template_key,
		template_json,
		template_version
	)
	VALUES (
		v_org_id,
		'default',
		'{"demo": true, "resumeTone": "clear, senior, client-ready"}'::jsonb,
		1
	)
	ON CONFLICT (organisation_id) DO UPDATE
	SET template_key = EXCLUDED.template_key,
		template_json = EXCLUDED.template_json,
		template_version = EXCLUDED.template_version,
		updated_at = now();

	INSERT INTO public.user_profiles (user_id, first_name, last_name, email)
	VALUES
		(v_admin_user_id, 'Demo', 'Admin', v_admin_email),
		(v_talent_user_id, 'Alex', 'Lind', v_talent_email)
	ON CONFLICT (user_id) DO UPDATE
	SET first_name = EXCLUDED.first_name,
		last_name = EXCLUDED.last_name,
		email = EXCLUDED.email,
		updated_at = now();

	INSERT INTO public.user_roles (user_id, role_id)
	VALUES
		(v_admin_user_id, v_org_admin_role_id),
		(v_admin_user_id, v_employer_role_id),
		(v_talent_user_id, v_talent_role_id)
	ON CONFLICT (user_id, role_id) DO NOTHING;

	INSERT INTO public.organisation_users (organisation_id, user_id)
	VALUES
		(v_org_id, v_admin_user_id),
		(v_org_id, v_talent_user_id)
	ON CONFLICT (organisation_id, user_id) DO UPDATE
	SET updated_at = now();

	INSERT INTO public.talents (
		id,
		user_id,
		first_name,
		last_name,
		title,
		bio,
		tech_stack
	)
	VALUES (
		v_talent_id,
		v_talent_user_id,
		'Alex',
		'Lind',
		'Senior Fullstack Developer',
		'Alex is a senior fullstack developer with a strong frontend focus and a practical eye for product quality. Alex enjoys turning unclear ideas into maintainable digital products, combining system design, clean implementation, and thoughtful user experience.',
		jsonb_build_array(
			jsonb_build_object('id', 'frontend', 'name', 'Frontend', 'skills', jsonb_build_array('React', 'Svelte', 'Angular', 'JavaScript', 'TypeScript', 'HTML', 'CSS', 'SASS', 'Tailwind')),
			jsonb_build_object('id', 'backend', 'name', 'Backend', 'skills', jsonb_build_array('Node.js', 'SvelteKit', 'Next.js', '.NET', 'C#')),
			jsonb_build_object('id', 'database', 'name', 'Database', 'skills', jsonb_build_array('PostgreSQL', 'MySQL', 'SQL', 'Supabase')),
			jsonb_build_object('id', 'devops', 'name', 'DevOps', 'skills', jsonb_build_array('Azure', 'Git', 'CI/CD', 'Netlify', 'Heroku', 'Contentful')),
			jsonb_build_object('id', 'methods', 'name', 'Methods', 'skills', jsonb_build_array('Scrum', 'Agile', 'Kanban')),
			jsonb_build_object('id', 'architecture', 'name', 'Architecture', 'skills', jsonb_build_array('REST API', 'GraphQL')),
			jsonb_build_object('id', 'design', 'name', 'Design', 'skills', jsonb_build_array('Figma', 'Adobe Illustrator', 'Photoshop', 'UI/UX')),
			jsonb_build_object('id', 'soft-skills', 'name', 'Soft Skills', 'skills', '[]'::jsonb)
		)
	);

	INSERT INTO public.organisation_talents (organisation_id, talent_id)
	VALUES (v_org_id, v_talent_id)
	ON CONFLICT (organisation_id, talent_id) DO UPDATE
	SET updated_at = now();

	INSERT INTO public.profile_availability (
		profile_id,
		availability_now_percent,
		availability_future_percent,
		availability_notice_period_days,
		availability_planned_from_date
	)
	VALUES (v_talent_id, 60, 100, 30, current_date + 30)
	ON CONFLICT (profile_id) DO UPDATE
	SET availability_now_percent = EXCLUDED.availability_now_percent,
		availability_future_percent = EXCLUDED.availability_future_percent,
		availability_notice_period_days = EXCLUDED.availability_notice_period_days,
		availability_planned_from_date = EXCLUDED.availability_planned_from_date,
		updated_at = now();

	INSERT INTO public.resumes (
		id,
		talent_id,
		version_name,
		is_main,
		is_active,
		allow_word_export,
		preview_html
	)
	VALUES (
		v_resume_id,
		v_talent_id,
		'Main demo resume',
		true,
		true,
		true,
		'<p>Senior Fullstack Developer with SvelteKit, TypeScript, PostgreSQL, and Supabase experience.</p>'
	);

	INSERT INTO public.resume_basics (
		resume_id,
		name,
		title_sv,
		title_en,
		summary_sv,
		summary_en,
		footer_note_sv,
		footer_note_en
	)
	VALUES (
		v_resume_id,
		'Alex Lind',
		'Senior Fullstack-utvecklare',
		'Senior Fullstack Developer',
		'<p><strong>Alex ar en senior fullstackutvecklare med stark frontend-kompetens och fokus pa valbyggda digitala produkter.</strong></p><p><br></p><p>Alex trivs med att ta ansvar fran ide till lansering, dar tydlig arkitektur kombineras med genomtankt anvandarupplevelse. I team bidrar Alex med lugn, struktur och pragmatiska tekniska beslut som gor produkten enklare att vidareutveckla over tid.</p>',
		'<p><strong>Alex is a senior fullstack developer with a strong frontend focus and a focus on well-built digital products.</strong></p><p><br></p><p>Alex enjoys taking responsibility from idea to launch, combining clear architecture with thoughtful user experience. In teams, Alex contributes calm structure and pragmatic technical decisions that make products easier to evolve over time.</p>',
		'',
		''
	);

	INSERT INTO public.resume_contacts (resume_id, position, name, phone, email)
	VALUES
		(v_resume_id, 1, 'Demo Admin', '+46 8 555 0100', v_admin_email),
		(v_resume_id, 2, 'Alex Lind', '+46 8 555 0101', v_talent_email);

	INSERT INTO public.resume_skill_items (resume_id, kind, position, value)
	VALUES
		(v_resume_id, 'example', 0, 'React'),
		(v_resume_id, 'example', 1, 'Svelte'),
		(v_resume_id, 'example', 2, 'Angular'),
		(v_resume_id, 'example', 3, 'TypeScript'),
		(v_resume_id, 'example', 4, 'JavaScript'),
		(v_resume_id, 'example', 5, 'HTML'),
		(v_resume_id, 'example', 6, 'CSS'),
		(v_resume_id, 'example', 7, 'Tailwind'),
		(v_resume_id, 'example', 8, 'SASS'),
		(v_resume_id, 'example', 9, 'Node.js'),
		(v_resume_id, 'example', 10, 'C#'),
		(v_resume_id, 'example', 11, '.NET'),
		(v_resume_id, 'example', 12, 'PostgreSQL'),
		(v_resume_id, 'example', 13, 'SQL'),
		(v_resume_id, 'example', 14, 'Azure'),
		(v_resume_id, 'example', 15, 'Git'),
		(v_resume_id, 'example', 16, 'REST API'),
		(v_resume_id, 'example', 17, 'Figma'),
		(v_resume_id, 'example', 18, 'UI/UX'),
		(v_resume_id, 'technique', 0, 'React'),
		(v_resume_id, 'technique', 1, 'Svelte'),
		(v_resume_id, 'technique', 2, 'Angular'),
		(v_resume_id, 'technique', 3, 'JavaScript'),
		(v_resume_id, 'technique', 4, 'TypeScript'),
		(v_resume_id, 'technique', 5, 'CSS'),
		(v_resume_id, 'technique', 6, 'SASS'),
		(v_resume_id, 'technique', 7, 'HTML'),
		(v_resume_id, 'technique', 8, 'Tailwind'),
		(v_resume_id, 'technique', 9, '.NET'),
		(v_resume_id, 'technique', 10, 'C#'),
		(v_resume_id, 'technique', 11, 'Next.js'),
		(v_resume_id, 'technique', 12, 'Node.js'),
		(v_resume_id, 'technique', 13, 'SvelteKit'),
		(v_resume_id, 'technique', 14, 'MySQL'),
		(v_resume_id, 'technique', 15, 'SQL'),
		(v_resume_id, 'technique', 16, 'PostgreSQL'),
		(v_resume_id, 'technique', 17, 'Supabase'),
		(v_resume_id, 'technique', 18, 'Azure'),
		(v_resume_id, 'technique', 19, 'Git'),
		(v_resume_id, 'technique', 20, 'CI/CD'),
		(v_resume_id, 'technique', 21, 'Netlify'),
		(v_resume_id, 'technique', 22, 'Heroku'),
		(v_resume_id, 'technique', 23, 'Contentful'),
		(v_resume_id, 'technique', 24, 'Scrum'),
		(v_resume_id, 'technique', 25, 'Agile'),
		(v_resume_id, 'technique', 26, 'Kanban'),
		(v_resume_id, 'technique', 27, 'REST API'),
		(v_resume_id, 'technique', 28, 'GraphQL'),
		(v_resume_id, 'technique', 29, 'Figma'),
		(v_resume_id, 'technique', 30, 'Adobe Illustrator'),
		(v_resume_id, 'technique', 31, 'Photoshop'),
		(v_resume_id, 'technique', 32, 'UI/UX');

	INSERT INTO public.resume_labeled_items (
		resume_id,
		kind,
		position,
		label_sv,
		label_en,
		value_sv,
		value_en
	)
	VALUES
		(v_resume_id, 'language', 1, 'Svenska', 'Swedish', 'Flytande', 'Fluent'),
		(v_resume_id, 'language', 2, 'Engelska', 'English', 'Flytande', 'Fluent'),
		(v_resume_id, 'education', 1, 'Utbildning', 'Education', 'Civilingenjor, datateknik', 'M.Sc. Computer Science'),
		(v_resume_id, 'education', 2, 'Certifiering', 'Certification', 'Azure Fundamentals', 'Azure Fundamentals');

	INSERT INTO public.resume_portfolio_items (resume_id, position, url)
	VALUES
		(v_resume_id, 1, 'https://example.com');

	INSERT INTO public.experience_library (
		id,
		talent_id,
		start_date,
		end_date,
		company,
		location_sv,
		location_en,
		role_sv,
		role_en,
		description_sv,
		description_en
	)
	VALUES
		(
			v_exp_platform_id,
			v_talent_id,
			'2024-01',
			NULL,
			'Demo SaaS Company',
			'Stockholm',
			'Stockholm',
			'Lead Fullstack-utvecklare',
			'Lead Fullstack Developer',
			'<p>Alex ledde utvecklingen av en kundportal med fokus pa prestanda, anvandbarhet och langsiktig forvaltbarhet. Arbetet omfattade arkitektur, granskning av pull requests och nara dialog med produktagare.</p>',
			'<p>Alex led development of a customer portal with focus on performance, usability, and long-term maintainability. The work included architecture, pull request review, and close collaboration with product owners.</p>'
		),
		(
			v_exp_ai_id,
			v_talent_id,
			'2023-03',
			'2023-12',
			'Demo Consulting Group',
			'Goteborg',
			'Gothenburg',
			'AI- och integrationsutvecklare',
			'AI and Integration Developer',
			'<p>Alex byggde AI-stod for redigering, sokning och kvalitetssakring av konsultprofiler. Losningen kombinerade strukturerad data, promptdesign och granskningsfloden som gav anvandarna kontroll.</p>',
			'<p>Alex built AI support for editing, search, and quality assurance of consultant profiles. The solution combined structured data, prompt design, and review workflows that kept users in control.</p>'
		),
		(
			v_exp_data_id,
			v_talent_id,
			'2021-08',
			'2023-02',
			'Demo Energy Company',
			'Malmo',
			'Malmo',
			'Backend-utvecklare',
			'Backend Developer',
			'<p>Alex moderniserade datamodeller, API:er och interna verktyg for planering och uppfoljning. Fokus lag pa tydliga granssnitt, battre datakvalitet och stegvisa forbattringar utan stora driftstorningar.</p>',
			'<p>Alex modernized data models, APIs, and internal tools for planning and follow-up. The focus was clear interfaces, better data quality, and gradual improvements without major operational disruption.</p>'
		),
		(
			v_exp_design_id,
			v_talent_id,
			'2020-02',
			'2021-07',
			'Demo Design Studio',
			'Stockholm',
			'Stockholm',
			'Frontend lead och UX/UI',
			'Frontend Lead and UX/UI',
			'<p>Alex tog fram ett nytt granssnitt for ett arbetsverktyg dar komplex information behovde bli lattare att skanna. Arbetet rorde komponentstruktur, tillganglighet och nara samarbete med design.</p>',
			'<p>Alex created a new interface for an operational tool where complex information needed to be easier to scan. The work covered component structure, accessibility, and close collaboration with design.</p>'
		),
		(
			v_exp_admin_id,
			v_talent_id,
			'2019-01',
			'2020-01',
			'Demo Admin Platform',
			'Remote',
			'Remote',
			'Fullstack-utvecklare',
			'Fullstack Developer',
			'<p>Alex byggde administrativa vyer for arendehantering, rapportering och rollstyrning. Projektet kravde robust formularhantering, tydliga behorigheter och en stabil grund for fortsatt produktutveckling.</p>',
			'<p>Alex built administrative views for case handling, reporting, and role-based access. The project required robust form handling, clear permissions, and a stable base for continued product development.</p>'
		),
		(
			v_exp_analytics_id,
			v_talent_id,
			'2018-03',
			'2018-12',
			'Demo Analytics Lab',
			'Uppsala',
			'Uppsala',
			'Frontend-utvecklare',
			'Frontend Developer',
			'<p>Alex utvecklade dashboards for nyckeltal, filtrering och visualisering av verksamhetsdata. Arbetet inneholl prestandaoptimering, komponentbibliotek och samarbete med analytiker.</p>',
			'<p>Alex developed dashboards for metrics, filtering, and visualization of operational data. The work included performance optimization, component libraries, and collaboration with analysts.</p>'
		),
		(
			v_exp_mobile_id,
			v_talent_id,
			'2017-01',
			'2018-02',
			'Demo Mobile Services',
			'Stockholm',
			'Stockholm',
			'Webbutvecklare',
			'Web Developer',
			'<p>Alex arbetade med responsiva webbtjanster for bokning och sjalvservice. Fokus var tydliga floden, mobil anvandbarhet och integrationer mot bakomliggande system.</p>',
			'<p>Alex worked on responsive web services for booking and self-service. The focus was clear flows, mobile usability, and integrations with underlying systems.</p>'
		),
		(
			v_exp_cms_id,
			v_talent_id,
			'2016-02',
			'2016-12',
			'Demo Content Team',
			'Goteborg',
			'Gothenburg',
			'Frontend-utvecklare och CMS-specialist',
			'Frontend Developer and CMS Specialist',
			'<p>Alex implementerade kampanjsidor och innehallsmodeller i ett headless CMS. Losningen gjorde det enklare for redaktorer att publicera utan att kompromissa med design eller prestanda.</p>',
			'<p>Alex implemented campaign pages and content models in a headless CMS. The solution made it easier for editors to publish without compromising design or performance.</p>'
		),
		(
			v_exp_integration_id,
			v_talent_id,
			'2015-04',
			'2016-01',
			'Demo Integration Partner',
			'Malmo',
			'Malmo',
			'Junior fullstack-utvecklare',
			'Junior Fullstack Developer',
			'<p>Alex utvecklade integrationer, enklare administrationsvyer och automatiserade importer. Rollen gav bred erfarenhet av API:er, databaser och vardagsnara problemlosning.</p>',
			'<p>Alex developed integrations, simpler administration views, and automated imports. The role gave broad experience with APIs, databases, and practical everyday problem solving.</p>'
		);

	INSERT INTO public.experience_library_technologies (experience_id, position, value)
	VALUES
		(v_exp_platform_id, 0, 'React'),
		(v_exp_platform_id, 1, 'TypeScript'),
		(v_exp_platform_id, 2, 'SvelteKit'),
		(v_exp_platform_id, 3, 'PostgreSQL'),
		(v_exp_platform_id, 4, 'Supabase'),
		(v_exp_platform_id, 5, 'REST API'),
		(v_exp_platform_id, 6, 'Tailwind'),
		(v_exp_platform_id, 7, 'Git'),
		(v_exp_ai_id, 0, 'Svelte'),
		(v_exp_ai_id, 1, 'SvelteKit'),
		(v_exp_ai_id, 2, 'OpenAI API'),
		(v_exp_ai_id, 3, 'Node.js'),
		(v_exp_ai_id, 4, 'PostgreSQL'),
		(v_exp_ai_id, 5, 'TypeScript'),
		(v_exp_ai_id, 6, 'REST API'),
		(v_exp_ai_id, 7, 'Supabase'),
		(v_exp_data_id, 0, 'PostgreSQL'),
		(v_exp_data_id, 1, 'SQL'),
		(v_exp_data_id, 2, 'Node.js'),
		(v_exp_data_id, 3, 'REST API'),
		(v_exp_data_id, 4, 'Docker'),
		(v_exp_data_id, 5, 'Azure'),
		(v_exp_design_id, 0, 'React'),
		(v_exp_design_id, 1, 'TypeScript'),
		(v_exp_design_id, 2, 'Figma'),
		(v_exp_design_id, 3, 'UI/UX'),
		(v_exp_design_id, 4, 'CSS'),
		(v_exp_design_id, 5, 'Tailwind'),
		(v_exp_admin_id, 0, 'Angular'),
		(v_exp_admin_id, 1, '.NET'),
		(v_exp_admin_id, 2, 'C#'),
		(v_exp_admin_id, 3, 'SQL'),
		(v_exp_admin_id, 4, 'Azure'),
		(v_exp_admin_id, 5, 'Git'),
		(v_exp_analytics_id, 0, 'React'),
		(v_exp_analytics_id, 1, 'JavaScript'),
		(v_exp_analytics_id, 2, 'GraphQL'),
		(v_exp_analytics_id, 3, 'CSS'),
		(v_exp_analytics_id, 4, 'Figma'),
		(v_exp_mobile_id, 0, 'Svelte'),
		(v_exp_mobile_id, 1, 'SvelteKit'),
		(v_exp_mobile_id, 2, 'Responsive Design'),
		(v_exp_mobile_id, 3, 'REST API'),
		(v_exp_mobile_id, 4, 'Tailwind'),
		(v_exp_cms_id, 0, 'Contentful'),
		(v_exp_cms_id, 1, 'SvelteKit'),
		(v_exp_cms_id, 2, 'SASS'),
		(v_exp_cms_id, 3, 'Netlify'),
		(v_exp_cms_id, 4, 'UI/UX'),
		(v_exp_integration_id, 0, 'Node.js'),
		(v_exp_integration_id, 1, 'PostgreSQL'),
		(v_exp_integration_id, 2, 'REST API'),
		(v_exp_integration_id, 3, 'Git'),
		(v_exp_integration_id, 4, 'Scrum');

	INSERT INTO public.resume_experience_items (
		resume_id,
		experience_id,
		section,
		position
	)
	VALUES
		(v_resume_id, v_exp_platform_id, 'highlighted', 1),
		(v_resume_id, v_exp_ai_id, 'highlighted', 2),
		(v_resume_id, v_exp_platform_id, 'experience', 1),
		(v_resume_id, v_exp_ai_id, 'experience', 2),
		(v_resume_id, v_exp_data_id, 'experience', 3),
		(v_resume_id, v_exp_design_id, 'experience', 4),
		(v_resume_id, v_exp_admin_id, 'experience', 5);

	IF v_plan_version_id IS NOT NULL THEN
		INSERT INTO public.organisation_billing_assignments (
			organisation_id,
			plan_version_id,
			effective_month,
			price_override_ore,
			included_talent_profiles_override,
			included_talent_user_seats_override,
			included_admin_seats_override,
			notes,
			created_by_user_id
		)
		VALUES (
			v_org_id,
			v_plan_version_id,
			v_effective_month,
			0,
			10,
			10,
			2,
			'Demo organisation. Excluded from real billing.',
			v_admin_user_id
		)
		ON CONFLICT (organisation_id, effective_month) DO UPDATE
		SET plan_version_id = EXCLUDED.plan_version_id,
			price_override_ore = EXCLUDED.price_override_ore,
			included_talent_profiles_override = EXCLUDED.included_talent_profiles_override,
			included_talent_user_seats_override = EXCLUDED.included_talent_user_seats_override,
			included_admin_seats_override = EXCLUDED.included_admin_seats_override,
			notes = EXCLUDED.notes,
			updated_at = now();
	END IF;

	SELECT * INTO v_active_ids FROM public.get_active_legal_document_ids();
	IF v_active_ids.tos_document_id IS NOT NULL
		AND v_active_ids.privacy_document_id IS NOT NULL
		AND v_active_ids.ai_notice_document_id IS NOT NULL
		AND v_active_ids.data_sharing_document_id IS NOT NULL
		AND v_active_ids.data_processing_agreement_document_id IS NOT NULL
		AND v_active_ids.subprocessor_list_document_id IS NOT NULL THEN
		INSERT INTO public.user_legal_acceptances (
			user_id,
			organisation_id,
			tos_document_id,
			privacy_document_id,
			ai_notice_document_id,
			data_sharing_document_id,
			data_processing_agreement_document_id,
			subprocessor_list_document_id,
			accepted_at,
			user_agent
		)
		VALUES
			(
				v_admin_user_id,
				v_org_id,
				v_active_ids.tos_document_id,
				v_active_ids.privacy_document_id,
				v_active_ids.ai_notice_document_id,
				v_active_ids.data_sharing_document_id,
				v_active_ids.data_processing_agreement_document_id,
				v_active_ids.subprocessor_list_document_id,
				now(),
				'demo-reset'
			),
			(
				v_talent_user_id,
				v_org_id,
				v_active_ids.tos_document_id,
				v_active_ids.privacy_document_id,
				v_active_ids.ai_notice_document_id,
				v_active_ids.data_sharing_document_id,
				v_active_ids.data_processing_agreement_document_id,
				v_active_ids.subprocessor_list_document_id,
				now(),
				'demo-reset'
			)
		ON CONFLICT DO NOTHING;
	END IF;

	RETURN jsonb_build_object(
		'organisation_id', v_org_id,
		'organisation_slug', 'demo',
		'admin_user_id', v_admin_user_id,
		'talent_user_id', v_talent_user_id,
		'talent_id', v_talent_id,
		'resume_id', v_resume_id,
		'reset_at', now()
	);
END;
$$;

REVOKE ALL ON FUNCTION public.reset_demo_organisation(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_demo_organisation(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.reset_demo_organisation(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reset_demo_organisation(text, text) TO service_role;

DO $$
BEGIN
	BEGIN
		CREATE EXTENSION IF NOT EXISTS pg_cron;
	EXCEPTION
		WHEN OTHERS THEN
			RAISE NOTICE 'pg_cron is not available in this environment: %', SQLERRM;
	END;

	IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
		BEGIN
			IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reset-demo-organisation-nightly') THEN
				PERFORM cron.unschedule('reset-demo-organisation-nightly');
			END IF;

			PERFORM cron.schedule(
				'reset-demo-organisation-nightly',
				'0 2 * * *',
				'SELECT public.reset_demo_organisation();'
			);
		EXCEPTION
			WHEN OTHERS THEN
				RAISE NOTICE 'Could not schedule demo organisation reset: %', SQLERRM;
		END;
	END IF;
END
$$;
