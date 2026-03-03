DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_enum e
		JOIN pg_type t ON t.oid = e.enumtypid
		WHERE t.typname = 'legal_document_type'
			AND e.enumlabel = 'data_processing_agreement'
	) THEN
		ALTER TYPE public.legal_document_type ADD VALUE 'data_processing_agreement';
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM pg_enum e
		JOIN pg_type t ON t.oid = e.enumtypid
		WHERE t.typname = 'legal_document_type'
			AND e.enumlabel = 'subprocessor_list'
	) THEN
		ALTER TYPE public.legal_document_type ADD VALUE 'subprocessor_list';
	END IF;
END
$$;

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'legal_acceptance_scope') THEN
		CREATE TYPE public.legal_acceptance_scope AS ENUM ('platform_access', 'none');
	END IF;
END
$$;

ALTER TABLE public.legal_documents
	ADD COLUMN IF NOT EXISTS acceptance_scope public.legal_acceptance_scope NOT NULL
	DEFAULT 'platform_access'::public.legal_acceptance_scope;

ALTER TABLE public.user_legal_acceptances
	ADD COLUMN IF NOT EXISTS data_processing_agreement_document_id uuid REFERENCES public.legal_documents(id) ON DELETE RESTRICT,
	ADD COLUMN IF NOT EXISTS subprocessor_list_document_id uuid REFERENCES public.legal_documents(id) ON DELETE RESTRICT;

ALTER TABLE public.user_legal_acceptances
	ALTER COLUMN tos_document_id DROP NOT NULL,
	ALTER COLUMN privacy_document_id DROP NOT NULL,
	ALTER COLUMN ai_notice_document_id DROP NOT NULL,
	ALTER COLUMN data_sharing_document_id DROP NOT NULL;

DROP INDEX IF EXISTS public.user_legal_acceptances_snapshot_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS user_legal_acceptances_snapshot_uidx
	ON public.user_legal_acceptances (
		user_id,
		organisation_id,
		COALESCE(tos_document_id, '00000000-0000-0000-0000-000000000000'::uuid),
		COALESCE(privacy_document_id, '00000000-0000-0000-0000-000000000000'::uuid),
		COALESCE(ai_notice_document_id, '00000000-0000-0000-0000-000000000000'::uuid),
		COALESCE(data_sharing_document_id, '00000000-0000-0000-0000-000000000000'::uuid),
		COALESCE(data_processing_agreement_document_id, '00000000-0000-0000-0000-000000000000'::uuid),
		COALESCE(subprocessor_list_document_id, '00000000-0000-0000-0000-000000000000'::uuid)
	);

CREATE OR REPLACE VIEW public.view_active_legal_documents AS
SELECT
	ld.id,
	ld.doc_type,
	ld.version,
	ld.content_html,
	ld.effective_date,
	ld.created_at,
	ld.acceptance_scope
FROM public.legal_documents ld
WHERE ld.is_active = true;

DROP FUNCTION IF EXISTS public.record_user_legal_acceptance(uuid, text, text);
DROP FUNCTION IF EXISTS public.get_active_legal_document_ids();

CREATE OR REPLACE FUNCTION public.get_active_legal_document_ids()
RETURNS TABLE(
	tos_document_id uuid,
	privacy_document_id uuid,
	ai_notice_document_id uuid,
	data_sharing_document_id uuid,
	data_processing_agreement_document_id uuid,
	subprocessor_list_document_id uuid
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
			WHERE doc_type::text = 'tos'
				AND is_active = true
			LIMIT 1
		) AS tos_document_id,
		(
			SELECT id
			FROM public.legal_documents
			WHERE doc_type::text = 'privacy'
				AND is_active = true
			LIMIT 1
		) AS privacy_document_id,
		(
			SELECT id
			FROM public.legal_documents
			WHERE doc_type::text = 'ai_notice'
				AND is_active = true
			LIMIT 1
		) AS ai_notice_document_id,
		(
			SELECT id
			FROM public.legal_documents
			WHERE doc_type::text = 'data_sharing'
				AND is_active = true
			LIMIT 1
		) AS data_sharing_document_id,
		(
			SELECT id
			FROM public.legal_documents
			WHERE doc_type::text = 'data_processing_agreement'
				AND is_active = true
			LIMIT 1
		) AS data_processing_agreement_document_id,
		(
			SELECT id
			FROM public.legal_documents
			WHERE doc_type::text = 'subprocessor_list'
				AND is_active = true
			LIMIT 1
		) AS subprocessor_list_document_id;
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
		OR v_active_ids.data_sharing_document_id IS NULL
		OR v_active_ids.data_processing_agreement_document_id IS NULL
		OR v_active_ids.subprocessor_list_document_id IS NULL THEN
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
			data_processing_agreement_document_id,
			subprocessor_list_document_id,
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
			v_active_ids.data_processing_agreement_document_id,
			v_active_ids.subprocessor_list_document_id,
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
				AND ula.tos_document_id IS NOT DISTINCT FROM v_active_ids.tos_document_id
				AND ula.privacy_document_id IS NOT DISTINCT FROM v_active_ids.privacy_document_id
				AND ula.ai_notice_document_id IS NOT DISTINCT FROM v_active_ids.ai_notice_document_id
				AND ula.data_sharing_document_id IS NOT DISTINCT FROM v_active_ids.data_sharing_document_id
				AND ula.data_processing_agreement_document_id IS NOT DISTINCT FROM v_active_ids.data_processing_agreement_document_id
				AND ula.subprocessor_list_document_id IS NOT DISTINCT FROM v_active_ids.subprocessor_list_document_id
			ORDER BY ula.accepted_at DESC
			LIMIT 1;
	END;

	IF v_row.id IS NULL THEN
		RAISE EXCEPTION 'Could not record legal acceptance';
	END IF;

	RETURN v_row;
END;
$$;
