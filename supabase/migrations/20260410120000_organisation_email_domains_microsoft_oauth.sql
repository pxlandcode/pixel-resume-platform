-- Organisation email-domain mappings for Microsoft OAuth provisioning.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.organisation_email_domains (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
	domain citext NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT organisation_email_domains_domain_key UNIQUE (domain),
	CONSTRAINT organisation_email_domains_domain_format_chk CHECK (
		domain::text = lower(domain::text)
		AND domain::text ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
	)
);

CREATE INDEX IF NOT EXISTS organisation_email_domains_organisation_id_idx
	ON public.organisation_email_domains (organisation_id);

CREATE OR REPLACE FUNCTION public.set_organisation_email_domains_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	NEW.updated_at = now();
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organisation_email_domains_updated_at
	ON public.organisation_email_domains;

CREATE TRIGGER trg_organisation_email_domains_updated_at
BEFORE UPDATE ON public.organisation_email_domains
FOR EACH ROW
EXECUTE FUNCTION public.set_organisation_email_domains_updated_at();

ALTER TABLE public.organisation_email_domains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage organisation email domains"
	ON public.organisation_email_domains;

CREATE POLICY "admins manage organisation email domains"
ON public.organisation_email_domains
FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.hook_restrict_azure_signup_by_email_domain(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
	provider text;
	is_azure boolean;
	email text;
	domain text;
	is_mapped boolean;
BEGIN
	provider := event->'user'->'app_metadata'->>'provider';
	is_azure := provider = 'azure'
		OR coalesce((event->'user'->'app_metadata'->'providers') ? 'azure', false);
	IF NOT is_azure THEN
		RETURN '{}'::jsonb;
	END IF;

	email := lower(coalesce(event->'user'->>'email', ''));
	IF email = '' OR position('@' in email) <= 1 THEN
		RETURN jsonb_build_object(
			'error',
			jsonb_build_object(
				'message', 'A verified Microsoft work email is required.',
				'http_code', 403
			)
		);
	END IF;

	domain := split_part(email, '@', 2);
	SELECT EXISTS (
		SELECT 1
		FROM public.organisation_email_domains oed
		WHERE oed.domain = domain
	)
	INTO is_mapped;

	IF NOT is_mapped THEN
		RETURN jsonb_build_object(
			'error',
			jsonb_build_object(
				'message', 'Your Microsoft email domain is not allowed for this application.',
				'http_code', 403
			)
		);
	END IF;

	RETURN '{}'::jsonb;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hook_restrict_azure_signup_by_email_domain(jsonb)
	TO supabase_auth_admin;

REVOKE EXECUTE ON FUNCTION public.hook_restrict_azure_signup_by_email_domain(jsonb)
	FROM authenticated, anon, public;
