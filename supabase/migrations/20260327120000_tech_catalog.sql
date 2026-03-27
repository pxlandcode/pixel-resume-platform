CREATE TABLE IF NOT EXISTS public.tech_categories (
	id text PRIMARY KEY,
	name text NOT NULL,
	sort_order integer NOT NULL DEFAULT 0,
	is_active boolean NOT NULL DEFAULT true,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT tech_categories_id_format_chk CHECK (id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT tech_categories_name_not_empty_chk CHECK (length(btrim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS public.tech_catalog_items (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	scope text NOT NULL,
	organisation_id uuid REFERENCES public.organisations(id) ON DELETE CASCADE,
	category_id text NOT NULL REFERENCES public.tech_categories(id) ON DELETE RESTRICT,
	slug text NOT NULL,
	label text NOT NULL,
	normalized_label text NOT NULL,
	aliases text[] NOT NULL DEFAULT '{}'::text[],
	sort_order integer NOT NULL DEFAULT 0,
	is_active boolean NOT NULL DEFAULT true,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT tech_catalog_items_scope_chk CHECK (scope IN ('global', 'organisation')),
	CONSTRAINT tech_catalog_items_scope_org_chk CHECK (
		(scope = 'global' AND organisation_id IS NULL)
		OR (scope = 'organisation' AND organisation_id IS NOT NULL)
	),
	CONSTRAINT tech_catalog_items_slug_not_empty_chk CHECK (length(btrim(slug)) > 0),
	CONSTRAINT tech_catalog_items_label_not_empty_chk CHECK (length(btrim(label)) > 0),
	CONSTRAINT tech_catalog_items_normalized_label_not_empty_chk CHECK (
		length(btrim(normalized_label)) > 0
	)
);

CREATE TABLE IF NOT EXISTS public.organisation_tech_catalog_exclusions (
	organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
	tech_catalog_item_id uuid NOT NULL REFERENCES public.tech_catalog_items(id) ON DELETE CASCADE,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (organisation_id, tech_catalog_item_id)
);

CREATE INDEX IF NOT EXISTS tech_categories_sort_order_idx
	ON public.tech_categories (sort_order, name);

CREATE INDEX IF NOT EXISTS tech_catalog_items_category_idx
	ON public.tech_catalog_items (category_id, sort_order, label);

CREATE INDEX IF NOT EXISTS tech_catalog_items_organisation_scope_idx
	ON public.tech_catalog_items (organisation_id, scope, is_active);

CREATE UNIQUE INDEX IF NOT EXISTS tech_catalog_items_global_slug_uidx
	ON public.tech_catalog_items (slug)
	WHERE scope = 'global';

CREATE UNIQUE INDEX IF NOT EXISTS tech_catalog_items_org_slug_uidx
	ON public.tech_catalog_items (organisation_id, slug)
	WHERE scope = 'organisation' AND organisation_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tech_catalog_items_global_normalized_label_uidx
	ON public.tech_catalog_items (normalized_label)
	WHERE scope = 'global';

CREATE UNIQUE INDEX IF NOT EXISTS tech_catalog_items_org_normalized_label_uidx
	ON public.tech_catalog_items (organisation_id, normalized_label)
	WHERE scope = 'organisation' AND organisation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_tech_catalog_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	NEW.updated_at = now();
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tech_categories_set_updated_at ON public.tech_categories;
CREATE TRIGGER trg_tech_categories_set_updated_at
BEFORE UPDATE ON public.tech_categories
FOR EACH ROW
EXECUTE FUNCTION public.set_tech_catalog_updated_at();

DROP TRIGGER IF EXISTS trg_tech_catalog_items_set_updated_at ON public.tech_catalog_items;
CREATE TRIGGER trg_tech_catalog_items_set_updated_at
BEFORE UPDATE ON public.tech_catalog_items
FOR EACH ROW
EXECUTE FUNCTION public.set_tech_catalog_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_global_tech_catalog_exclusion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	target_scope text;
BEGIN
	SELECT tci.scope
	INTO target_scope
	FROM public.tech_catalog_items tci
	WHERE tci.id = NEW.tech_catalog_item_id;

	IF target_scope IS DISTINCT FROM 'global' THEN
		RAISE EXCEPTION 'Organisation tech catalog exclusions may only target global technologies.';
	END IF;

	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_org_tech_catalog_exclusions_global_only ON public.organisation_tech_catalog_exclusions;
CREATE TRIGGER trg_org_tech_catalog_exclusions_global_only
BEFORE INSERT OR UPDATE ON public.organisation_tech_catalog_exclusions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_global_tech_catalog_exclusion();

INSERT INTO public.tech_categories (id, name, sort_order, is_active)
VALUES
	('frontend', 'Frontend', 10, true),
	('backend', 'Backend', 20, true),
	('database', 'Database', 30, true),
	('devops', 'DevOps', 40, true),
	('methods', 'Methods', 50, true),
	('architecture', 'Architecture', 60, true),
	('design', 'Design', 70, true),
	('soft-skills', 'Soft Skills', 80, true)
ON CONFLICT (id) DO UPDATE
SET
	name = EXCLUDED.name,
	sort_order = EXCLUDED.sort_order,
	is_active = EXCLUDED.is_active,
	updated_at = now();

WITH seed_items(scope, organisation_id, category_id, slug, label, normalized_label, sort_order) AS (
	VALUES
		('global', NULL::uuid, 'frontend', 'react', 'React', 'react', 10),
		('global', NULL::uuid, 'frontend', 'vue', 'Vue', 'vue', 20),
		('global', NULL::uuid, 'frontend', 'svelte', 'Svelte', 'svelte', 30),
		('global', NULL::uuid, 'frontend', 'angular', 'Angular', 'angular', 40),
		('global', NULL::uuid, 'frontend', 'typescript', 'TypeScript', 'typescript', 50),
		('global', NULL::uuid, 'frontend', 'javascript', 'JavaScript', 'javascript', 60),
		('global', NULL::uuid, 'frontend', 'html', 'HTML', 'html', 70),
		('global', NULL::uuid, 'frontend', 'css', 'CSS', 'css', 80),
		('global', NULL::uuid, 'frontend', 'tailwind', 'Tailwind', 'tailwind', 90),
		('global', NULL::uuid, 'frontend', 'sass', 'SASS', 'sass', 100),
		('global', NULL::uuid, 'backend', 'node-js', 'Node.js', 'node.js', 10),
		('global', NULL::uuid, 'backend', 'python', 'Python', 'python', 20),
		('global', NULL::uuid, 'backend', 'java', 'Java', 'java', 30),
		('global', NULL::uuid, 'backend', 'go', 'Go', 'go', 40),
		('global', NULL::uuid, 'backend', 'php', 'PHP', 'php', 50),
		('global', NULL::uuid, 'backend', 'ruby', 'Ruby', 'ruby', 60),
		('global', NULL::uuid, 'backend', 'c-sharp', 'C#', 'c#', 70),
		('global', NULL::uuid, 'backend', 'dotnet', '.NET', '.net', 80),
		('global', NULL::uuid, 'backend', 'express', 'Express', 'express', 90),
		('global', NULL::uuid, 'backend', 'django', 'Django', 'django', 100),
		('global', NULL::uuid, 'backend', 'spring-boot', 'Spring Boot', 'spring boot', 110),
		('global', NULL::uuid, 'database', 'postgresql', 'PostgreSQL', 'postgresql', 10),
		('global', NULL::uuid, 'database', 'mysql', 'MySQL', 'mysql', 20),
		('global', NULL::uuid, 'database', 'mongodb', 'MongoDB', 'mongodb', 30),
		('global', NULL::uuid, 'database', 'redis', 'Redis', 'redis', 40),
		('global', NULL::uuid, 'database', 'sql', 'SQL', 'sql', 50),
		('global', NULL::uuid, 'database', 'neo4j', 'Neo4j', 'neo4j', 60),
		('global', NULL::uuid, 'database', 'supabase', 'Supabase', 'supabase', 70),
		('global', NULL::uuid, 'database', 'firebase', 'Firebase', 'firebase', 80),
		('global', NULL::uuid, 'devops', 'docker', 'Docker', 'docker', 10),
		('global', NULL::uuid, 'devops', 'kubernetes', 'Kubernetes', 'kubernetes', 20),
		('global', NULL::uuid, 'devops', 'aws', 'AWS', 'aws', 30),
		('global', NULL::uuid, 'devops', 'azure', 'Azure', 'azure', 40),
		('global', NULL::uuid, 'devops', 'gcp', 'GCP', 'gcp', 50),
		('global', NULL::uuid, 'devops', 'git', 'Git', 'git', 60),
		('global', NULL::uuid, 'devops', 'github-actions', 'GitHub Actions', 'github actions', 70),
		('global', NULL::uuid, 'devops', 'ci-cd', 'CI/CD', 'ci/cd', 80),
		('global', NULL::uuid, 'methods', 'agile', 'Agile', 'agile', 10),
		('global', NULL::uuid, 'methods', 'scrum', 'Scrum', 'scrum', 20),
		('global', NULL::uuid, 'methods', 'kanban', 'Kanban', 'kanban', 30),
		('global', NULL::uuid, 'methods', 'tdd', 'TDD', 'tdd', 40),
		('global', NULL::uuid, 'architecture', 'rest-api', 'REST API', 'rest api', 10),
		('global', NULL::uuid, 'architecture', 'graphql', 'GraphQL', 'graphql', 20),
		('global', NULL::uuid, 'architecture', 'microservices', 'Microservices', 'microservices', 30),
		('global', NULL::uuid, 'architecture', 'serverless', 'Serverless', 'serverless', 40),
		('global', NULL::uuid, 'design', 'figma', 'Figma', 'figma', 10),
		('global', NULL::uuid, 'design', 'adobe-illustrator', 'Adobe Illustrator', 'adobe illustrator', 20),
		('global', NULL::uuid, 'design', 'photoshop', 'Photoshop', 'photoshop', 30),
		('global', NULL::uuid, 'design', 'ui-ux', 'UI/UX', 'ui/ux', 40),
		('global', NULL::uuid, 'design', 'responsive-design', 'Responsive Design', 'responsive design', 50),
		('global', NULL::uuid, 'soft-skills', 'leadership', 'Leadership', 'leadership', 10),
		('global', NULL::uuid, 'soft-skills', 'communication', 'Communication', 'communication', 20),
		('global', NULL::uuid, 'soft-skills', 'team-collaboration', 'Team Collaboration', 'team collaboration', 30),
		('global', NULL::uuid, 'soft-skills', 'problem-solving', 'Problem Solving', 'problem solving', 40),
		('global', NULL::uuid, 'soft-skills', 'project-management', 'Project Management', 'project management', 50)
)
INSERT INTO public.tech_catalog_items (
	scope,
	organisation_id,
	category_id,
	slug,
	label,
	normalized_label,
	sort_order,
	is_active
)
SELECT
	seed.scope,
	seed.organisation_id,
	seed.category_id,
	seed.slug,
	seed.label,
	seed.normalized_label,
	seed.sort_order,
	true
FROM seed_items seed
WHERE NOT EXISTS (
	SELECT 1
	FROM public.tech_catalog_items existing
	WHERE existing.scope = 'global'
		AND existing.slug = seed.slug
);

ALTER TABLE public.tech_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tech_catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_tech_catalog_exclusions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tech categories authenticated select" ON public.tech_categories;
DROP POLICY IF EXISTS "tech categories admin manage" ON public.tech_categories;

CREATE POLICY "tech categories authenticated select" ON public.tech_categories
FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "tech categories admin manage" ON public.tech_categories
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "tech catalog items authenticated select" ON public.tech_catalog_items;
DROP POLICY IF EXISTS "tech catalog items admin insert global" ON public.tech_catalog_items;
DROP POLICY IF EXISTS "tech catalog items admin update global" ON public.tech_catalog_items;
DROP POLICY IF EXISTS "tech catalog items admin delete global" ON public.tech_catalog_items;
DROP POLICY IF EXISTS "tech catalog items org insert by home org" ON public.tech_catalog_items;
DROP POLICY IF EXISTS "tech catalog items org update by home org" ON public.tech_catalog_items;
DROP POLICY IF EXISTS "tech catalog items org delete by home org" ON public.tech_catalog_items;

CREATE POLICY "tech catalog items authenticated select" ON public.tech_catalog_items
FOR SELECT USING (
	auth.uid() IS NOT NULL
	AND (
		scope = 'global'
		OR (
			organisation_id IS NOT NULL
			AND public.can_access_organisation(organisation_id)
		)
	)
);

CREATE POLICY "tech catalog items admin insert global" ON public.tech_catalog_items
FOR INSERT WITH CHECK (
	scope = 'global'
	AND public.is_admin()
);

CREATE POLICY "tech catalog items admin update global" ON public.tech_catalog_items
FOR UPDATE USING (
	scope = 'global'
	AND public.is_admin()
)
WITH CHECK (
	scope = 'global'
	AND public.is_admin()
);

CREATE POLICY "tech catalog items admin delete global" ON public.tech_catalog_items
FOR DELETE USING (
	scope = 'global'
	AND public.is_admin()
);

CREATE POLICY "tech catalog items org insert by home org" ON public.tech_catalog_items
FOR INSERT WITH CHECK (
	scope = 'organisation'
	AND (
		public.is_admin()
		OR (
			(public.has_role('broker') OR public.has_role('employer'))
			AND organisation_id = public.current_user_home_org_id()
		)
	)
);

CREATE POLICY "tech catalog items org update by home org" ON public.tech_catalog_items
FOR UPDATE USING (
	scope = 'organisation'
	AND (
		public.is_admin()
		OR (
			(public.has_role('broker') OR public.has_role('employer'))
			AND organisation_id = public.current_user_home_org_id()
		)
	)
)
WITH CHECK (
	scope = 'organisation'
	AND (
		public.is_admin()
		OR (
			(public.has_role('broker') OR public.has_role('employer'))
			AND organisation_id = public.current_user_home_org_id()
		)
	)
);

CREATE POLICY "tech catalog items org delete by home org" ON public.tech_catalog_items
FOR DELETE USING (
	scope = 'organisation'
	AND (
		public.is_admin()
		OR (
			(public.has_role('broker') OR public.has_role('employer'))
			AND organisation_id = public.current_user_home_org_id()
		)
	)
);

DROP POLICY IF EXISTS "org tech exclusions select by access" ON public.organisation_tech_catalog_exclusions;
DROP POLICY IF EXISTS "org tech exclusions manage by home org" ON public.organisation_tech_catalog_exclusions;

CREATE POLICY "org tech exclusions select by access" ON public.organisation_tech_catalog_exclusions
FOR SELECT USING (
	auth.uid() IS NOT NULL
	AND public.can_access_organisation(organisation_id)
);

CREATE POLICY "org tech exclusions manage by home org" ON public.organisation_tech_catalog_exclusions
USING (
	public.is_admin()
	OR (
		(public.has_role('broker') OR public.has_role('employer'))
		AND organisation_id = public.current_user_home_org_id()
	)
)
WITH CHECK (
	public.is_admin()
	OR (
		(public.has_role('broker') OR public.has_role('employer'))
		AND organisation_id = public.current_user_home_org_id()
	)
);
