CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'legal_document_type') THEN
		CREATE TYPE public.legal_document_type AS ENUM ('tos', 'privacy', 'ai_notice', 'data_sharing');
	END IF;

	IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lawful_basis_type') THEN
		CREATE TYPE public.lawful_basis_type AS ENUM (
			'consent_obtained',
			'contract',
			'legitimate_interest',
			'other'
		);
	END IF;

	IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sharing_scope') THEN
		CREATE TYPE public.sharing_scope AS ENUM (
			'view',
			'export_org_template',
			'export_broker_template'
		);
	END IF;

	IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_action_type') THEN
		CREATE TYPE public.audit_action_type AS ENUM (
			'RESUME_VIEW',
			'RESUME_EXPORT',
			'SHARING_APPROVED',
			'LEGAL_ACCEPTED',
			'TALENT_CREATED',
			'ASSERTION_CONFIRMED'
		);
	END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.legal_documents (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	doc_type public.legal_document_type NOT NULL,
	version text NOT NULL,
	content_html text NOT NULL,
	effective_date date NOT NULL,
	is_active boolean NOT NULL DEFAULT false,
	created_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT legal_documents_doc_type_version_key UNIQUE (doc_type, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS legal_documents_one_active_per_type_uidx
	ON public.legal_documents (doc_type)
	WHERE is_active = true;

CREATE INDEX IF NOT EXISTS legal_documents_doc_type_effective_date_idx
	ON public.legal_documents (doc_type, effective_date DESC, created_at DESC);

CREATE OR REPLACE FUNCTION public.legal_documents_deactivate_previous_active()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
	IF NEW.is_active THEN
		UPDATE public.legal_documents
		SET is_active = false
		WHERE doc_type = NEW.doc_type
			AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
			AND is_active = true;
	END IF;

	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_legal_documents_single_active ON public.legal_documents;
CREATE TRIGGER trg_legal_documents_single_active
BEFORE INSERT OR UPDATE OF is_active, doc_type
ON public.legal_documents
FOR EACH ROW
EXECUTE FUNCTION public.legal_documents_deactivate_previous_active();

CREATE TABLE IF NOT EXISTS public.user_legal_acceptances (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
	organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
	tos_document_id uuid NOT NULL REFERENCES public.legal_documents(id) ON DELETE RESTRICT,
	privacy_document_id uuid NOT NULL REFERENCES public.legal_documents(id) ON DELETE RESTRICT,
	ai_notice_document_id uuid NOT NULL REFERENCES public.legal_documents(id) ON DELETE RESTRICT,
	data_sharing_document_id uuid NOT NULL REFERENCES public.legal_documents(id) ON DELETE RESTRICT,
	accepted_at timestamptz NOT NULL DEFAULT now(),
	ip_address text,
	user_agent text
);

CREATE UNIQUE INDEX IF NOT EXISTS user_legal_acceptances_snapshot_uidx
	ON public.user_legal_acceptances (
		user_id,
		organisation_id,
		tos_document_id,
		privacy_document_id,
		ai_notice_document_id,
		data_sharing_document_id
	);

CREATE INDEX IF NOT EXISTS user_legal_acceptances_user_org_accepted_at_idx
	ON public.user_legal_acceptances (user_id, organisation_id, accepted_at DESC);

CREATE TABLE IF NOT EXISTS public.employer_talent_assertions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	employer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
	organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
	talent_id uuid NOT NULL REFERENCES public.talents(id) ON DELETE CASCADE,
	lawful_basis_type public.lawful_basis_type NOT NULL,
	lawful_basis_details text,
	confirmed_at timestamptz NOT NULL DEFAULT now(),
	ip_address text,
	user_agent text
);

CREATE INDEX IF NOT EXISTS employer_talent_assertions_org_talent_idx
	ON public.employer_talent_assertions (organisation_id, talent_id, confirmed_at DESC);

CREATE TABLE IF NOT EXISTS public.data_sharing_permissions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	source_organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
	target_organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
	sharing_scope public.sharing_scope NOT NULL,
	approved_by_admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
	approved_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT data_sharing_permissions_no_self_share_chk CHECK (source_organisation_id <> target_organisation_id),
	CONSTRAINT data_sharing_permissions_unique_scope_key UNIQUE (
		source_organisation_id,
		target_organisation_id,
		sharing_scope
	)
);

CREATE INDEX IF NOT EXISTS data_sharing_permissions_lookup_idx
	ON public.data_sharing_permissions (
		source_organisation_id,
		target_organisation_id,
		sharing_scope
	);

CREATE TABLE IF NOT EXISTS public.audit_logs (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
	organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
	action_type public.audit_action_type NOT NULL,
	resource_type text NOT NULL,
	resource_id uuid,
	metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT audit_logs_metadata_object_chk CHECK (jsonb_typeof(metadata_json) = 'object')
);

CREATE INDEX IF NOT EXISTS audit_logs_org_created_at_idx
	ON public.audit_logs (organisation_id, created_at DESC);

CREATE OR REPLACE VIEW public.view_active_legal_documents AS
SELECT
	ld.id,
	ld.doc_type,
	ld.version,
	ld.content_html,
	ld.effective_date,
	ld.created_at
FROM public.legal_documents ld
WHERE ld.is_active = true;

CREATE OR REPLACE FUNCTION public.get_active_legal_document_ids()
RETURNS TABLE(
	tos_document_id uuid,
	privacy_document_id uuid,
	ai_notice_document_id uuid,
	data_sharing_document_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT
		(
			SELECT id
			FROM public.legal_documents
			WHERE doc_type = 'tos'::public.legal_document_type
				AND is_active = true
			LIMIT 1
		) AS tos_document_id,
		(
			SELECT id
			FROM public.legal_documents
			WHERE doc_type = 'privacy'::public.legal_document_type
				AND is_active = true
			LIMIT 1
		) AS privacy_document_id,
		(
			SELECT id
			FROM public.legal_documents
			WHERE doc_type = 'ai_notice'::public.legal_document_type
				AND is_active = true
			LIMIT 1
		) AS ai_notice_document_id,
		(
			SELECT id
			FROM public.legal_documents
			WHERE doc_type = 'data_sharing'::public.legal_document_type
				AND is_active = true
			LIMIT 1
		) AS data_sharing_document_id;
$$;

CREATE OR REPLACE FUNCTION public.has_data_sharing_permission(
	source_org_id uuid,
	target_org_id uuid,
	required_scope public.sharing_scope
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT EXISTS (
		SELECT 1
		FROM public.data_sharing_permissions dsp
		WHERE dsp.source_organisation_id = source_org_id
			AND dsp.target_organisation_id = target_org_id
			AND (
				dsp.sharing_scope = required_scope
				OR (
					required_scope = 'view'::public.sharing_scope
					AND dsp.sharing_scope IN (
						'export_org_template'::public.sharing_scope,
						'export_broker_template'::public.sharing_scope
					)
				)
				OR (
					required_scope = 'export_org_template'::public.sharing_scope
					AND dsp.sharing_scope = 'export_broker_template'::public.sharing_scope
				)
			)
	);
$$;

CREATE OR REPLACE FUNCTION public.record_user_legal_acceptance(
	p_organisation_id uuid,
	p_ip_address text DEFAULT NULL,
	p_user_agent text DEFAULT NULL
)
RETURNS public.user_legal_acceptances
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
	v_actor_id uuid := auth.uid();
	v_home_org_id uuid;
	v_active_ids RECORD;
	v_row public.user_legal_acceptances;
BEGIN
	IF v_actor_id IS NULL THEN
		RAISE EXCEPTION 'Not authenticated';
	END IF;

	IF p_organisation_id IS NULL THEN
		RAISE EXCEPTION 'Organisation is required';
	END IF;

	SELECT public.current_user_home_org_id() INTO v_home_org_id;
	IF v_home_org_id IS NULL OR v_home_org_id <> p_organisation_id THEN
		RAISE EXCEPTION 'Acceptance can only be recorded for your home organisation';
	END IF;

	SELECT * INTO v_active_ids FROM public.get_active_legal_document_ids();
	IF v_active_ids.tos_document_id IS NULL
		OR v_active_ids.privacy_document_id IS NULL
		OR v_active_ids.ai_notice_document_id IS NULL
		OR v_active_ids.data_sharing_document_id IS NULL THEN
		RAISE EXCEPTION 'Active legal documents are not fully configured';
	END IF;

	BEGIN
		INSERT INTO public.user_legal_acceptances (
			user_id,
			organisation_id,
			tos_document_id,
			privacy_document_id,
			ai_notice_document_id,
			data_sharing_document_id,
			accepted_at,
			ip_address,
			user_agent
		)
		VALUES (
			v_actor_id,
			p_organisation_id,
			v_active_ids.tos_document_id,
			v_active_ids.privacy_document_id,
			v_active_ids.ai_notice_document_id,
			v_active_ids.data_sharing_document_id,
			now(),
			NULLIF(trim(coalesce(p_ip_address, '')), ''),
			NULLIF(trim(coalesce(p_user_agent, '')), '')
		)
		RETURNING * INTO v_row;
	EXCEPTION
		WHEN unique_violation THEN
			SELECT * INTO v_row
			FROM public.user_legal_acceptances ula
			WHERE ula.user_id = v_actor_id
				AND ula.organisation_id = p_organisation_id
				AND ula.tos_document_id = v_active_ids.tos_document_id
				AND ula.privacy_document_id = v_active_ids.privacy_document_id
				AND ula.ai_notice_document_id = v_active_ids.ai_notice_document_id
				AND ula.data_sharing_document_id = v_active_ids.data_sharing_document_id
			ORDER BY ula.accepted_at DESC
			LIMIT 1;
	END;

	IF v_row.id IS NULL THEN
		RAISE EXCEPTION 'Could not record legal acceptance';
	END IF;

	RETURN v_row;
END;
$$;

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM public.legal_documents ld
		WHERE ld.doc_type = 'tos'::public.legal_document_type
			AND ld.is_active = true
	) THEN
		INSERT INTO public.legal_documents (
			doc_type,
			version,
			content_html,
			effective_date,
			is_active
		)
		VALUES (
			'tos'::public.legal_document_type,
			'2026-03-01',
			'<h1>Terms of Service</h1><p>Placeholder legal text. Replace with approved policy.</p>',
			DATE '2026-03-01',
			true
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM public.legal_documents ld
		WHERE ld.doc_type = 'privacy'::public.legal_document_type
			AND ld.is_active = true
	) THEN
		INSERT INTO public.legal_documents (
			doc_type,
			version,
			content_html,
			effective_date,
			is_active
		)
		VALUES (
			'privacy'::public.legal_document_type,
			'2026-03-01',
			'<h1>Privacy Notice</h1><p>Placeholder legal text. Replace with approved policy.</p>',
			DATE '2026-03-01',
			true
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM public.legal_documents ld
		WHERE ld.doc_type = 'ai_notice'::public.legal_document_type
			AND ld.is_active = true
	) THEN
		INSERT INTO public.legal_documents (
			doc_type,
			version,
			content_html,
			effective_date,
			is_active
		)
		VALUES (
			'ai_notice'::public.legal_document_type,
			'2026-03-01',
			'<h1>AI Notice</h1><p>Placeholder legal text. Replace with approved policy.</p>',
			DATE '2026-03-01',
			true
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM public.legal_documents ld
		WHERE ld.doc_type = 'data_sharing'::public.legal_document_type
			AND ld.is_active = true
	) THEN
		INSERT INTO public.legal_documents (
			doc_type,
			version,
			content_html,
			effective_date,
			is_active
		)
		VALUES (
			'data_sharing'::public.legal_document_type,
			'2026-03-01',
			'<h1>Data Sharing Notice</h1><p>Placeholder legal text. Replace with approved policy.</p>',
			DATE '2026-03-01',
			true
		);
	END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.can_access_talent(target_talent_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT
		public.is_admin()
		OR EXISTS (
			SELECT 1
			FROM public.talents t
			WHERE t.id = target_talent_id
				AND t.user_id = auth.uid()
		)
		OR EXISTS (
			SELECT 1
			FROM public.organisation_talents ot
			WHERE ot.talent_id = target_talent_id
				AND public.can_access_organisation(ot.organisation_id)
				AND (
					NOT (public.has_role('broker') OR public.has_role('employer'))
					OR ot.organisation_id = public.current_user_home_org_id()
					OR (
						public.current_user_home_org_id() IS NOT NULL
						AND public.has_data_sharing_permission(
							ot.organisation_id,
							public.current_user_home_org_id(),
							'view'::public.sharing_scope
						)
					)
				)
		);
$$;

CREATE OR REPLACE FUNCTION public.can_edit_talent(target_talent_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT
		public.is_admin()
		OR EXISTS (
			SELECT 1
			FROM public.talents t
			WHERE t.id = target_talent_id
				AND t.user_id = auth.uid()
		)
		OR (
			(public.has_role('broker') OR public.has_role('employer'))
			AND EXISTS (
				SELECT 1
				FROM public.organisation_talents ot
				WHERE ot.talent_id = target_talent_id
					AND ot.organisation_id = public.current_user_home_org_id()
			)
		);
$$;

ALTER TABLE public.legal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_legal_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_talent_assertions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_sharing_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "legal documents read active" ON public.legal_documents;
DROP POLICY IF EXISTS "legal documents admin read all" ON public.legal_documents;
DROP POLICY IF EXISTS "legal documents admin insert" ON public.legal_documents;
DROP POLICY IF EXISTS "legal documents admin update" ON public.legal_documents;
DROP POLICY IF EXISTS "legal documents admin delete" ON public.legal_documents;

CREATE POLICY "legal documents read active" ON public.legal_documents
FOR SELECT USING (auth.uid() IS NOT NULL AND is_active = true);

CREATE POLICY "legal documents admin read all" ON public.legal_documents
FOR SELECT USING (public.is_admin());

CREATE POLICY "legal documents admin insert" ON public.legal_documents
FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY "legal documents admin update" ON public.legal_documents
FOR UPDATE USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY "legal documents admin delete" ON public.legal_documents
FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS "user legal acceptances read own" ON public.user_legal_acceptances;
DROP POLICY IF EXISTS "user legal acceptances read org admin" ON public.user_legal_acceptances;
DROP POLICY IF EXISTS "user legal acceptances insert own" ON public.user_legal_acceptances;

CREATE POLICY "user legal acceptances read own" ON public.user_legal_acceptances
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user legal acceptances read org admin" ON public.user_legal_acceptances
FOR SELECT USING (public.is_admin() OR public.is_org_admin(organisation_id));

CREATE POLICY "user legal acceptances insert own" ON public.user_legal_acceptances
FOR INSERT WITH CHECK (
	auth.uid() = user_id
	AND organisation_id = public.current_user_home_org_id()
);

DROP POLICY IF EXISTS "employer talent assertions read org" ON public.employer_talent_assertions;
DROP POLICY IF EXISTS "employer talent assertions insert managers" ON public.employer_talent_assertions;

CREATE POLICY "employer talent assertions read org" ON public.employer_talent_assertions
FOR SELECT USING (
	public.is_admin()
	OR public.is_org_admin(organisation_id)
);

CREATE POLICY "employer talent assertions insert managers" ON public.employer_talent_assertions
FOR INSERT WITH CHECK (
	auth.uid() = employer_user_id
	AND (public.is_admin() OR public.has_role('broker') OR public.has_role('employer'))
	AND organisation_id = public.current_user_home_org_id()
	AND EXISTS (
		SELECT 1
		FROM public.organisation_talents ot
		WHERE ot.talent_id = employer_talent_assertions.talent_id
			AND ot.organisation_id = employer_talent_assertions.organisation_id
	)
);

DROP POLICY IF EXISTS "data sharing permissions read by org" ON public.data_sharing_permissions;
DROP POLICY IF EXISTS "data sharing permissions admin insert" ON public.data_sharing_permissions;
DROP POLICY IF EXISTS "data sharing permissions admin update" ON public.data_sharing_permissions;
DROP POLICY IF EXISTS "data sharing permissions admin delete" ON public.data_sharing_permissions;

CREATE POLICY "data sharing permissions read by org" ON public.data_sharing_permissions
FOR SELECT USING (
	public.is_admin()
	OR public.is_org_admin(source_organisation_id)
	OR public.is_org_admin(target_organisation_id)
);

CREATE POLICY "data sharing permissions admin insert" ON public.data_sharing_permissions
FOR INSERT WITH CHECK (
	public.is_admin()
	AND approved_by_admin_id = auth.uid()
);

CREATE POLICY "data sharing permissions admin update" ON public.data_sharing_permissions
FOR UPDATE USING (public.is_admin())
WITH CHECK (
	public.is_admin()
	AND approved_by_admin_id = auth.uid()
);

CREATE POLICY "data sharing permissions admin delete" ON public.data_sharing_permissions
FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS "audit logs read by org admin" ON public.audit_logs;

CREATE POLICY "audit logs read by org admin" ON public.audit_logs
FOR SELECT USING (
	public.is_admin()
	OR public.is_org_admin(organisation_id)
);

-- Verification examples:
-- 1) Active legal uniqueness per type:
--    SELECT doc_type, COUNT(*) FROM public.legal_documents WHERE is_active GROUP BY doc_type HAVING COUNT(*) > 1;
-- 2) Acceptance idempotency:
--    SELECT public.record_user_legal_acceptance(public.current_user_home_org_id(), '127.0.0.1', 'test-agent');
--    SELECT public.record_user_legal_acceptance(public.current_user_home_org_id(), '127.0.0.1', 'test-agent');
-- 3) Sharing hierarchy check:
--    SELECT public.has_data_sharing_permission('<source-org>'::uuid, '<target-org>'::uuid, 'view'::public.sharing_scope);
