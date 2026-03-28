CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resume_share_access_mode') THEN
		CREATE TYPE public.resume_share_access_mode AS ENUM ('link', 'password');
	END IF;

	IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resume_share_event_outcome') THEN
		CREATE TYPE public.resume_share_event_outcome AS ENUM (
			'success',
			'invalid_token',
			'wrong_password',
			'expired',
			'revoked',
			'rate_limited'
		);
	END IF;
END
$$;

ALTER TYPE public.audit_action_type ADD VALUE IF NOT EXISTS 'RESUME_SHARE_CREATED';
ALTER TYPE public.audit_action_type ADD VALUE IF NOT EXISTS 'RESUME_SHARE_UPDATED';
ALTER TYPE public.audit_action_type ADD VALUE IF NOT EXISTS 'RESUME_SHARE_REVOKED';
ALTER TYPE public.audit_action_type ADD VALUE IF NOT EXISTS 'RESUME_SHARE_REGENERATED';

CREATE TABLE IF NOT EXISTS public.resume_share_links (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
	talent_id uuid NOT NULL REFERENCES public.talents(id) ON DELETE CASCADE,
	resume_id uuid NOT NULL REFERENCES public.resumes(id) ON DELETE CASCADE,
	created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
	label text,
	is_anonymized boolean NOT NULL DEFAULT false,
	access_mode public.resume_share_access_mode NOT NULL DEFAULT 'password',
	token_hash text NOT NULL UNIQUE,
	token_encrypted text NOT NULL,
	token_hint text NOT NULL,
	password_hash text,
	expires_at timestamptz,
	allow_download boolean NOT NULL DEFAULT false,
	revoked_at timestamptz,
	revoked_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
	revoked_reason text,
	replaced_by_share_link_id uuid REFERENCES public.resume_share_links(id) ON DELETE SET NULL,
	total_request_count integer NOT NULL DEFAULT 0,
	successful_view_count integer NOT NULL DEFAULT 0,
	download_count integer NOT NULL DEFAULT 0,
	first_viewed_at timestamptz,
	last_viewed_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT resume_share_links_label_length_chk CHECK (
		label IS NULL OR char_length(label) <= 120
	),
	CONSTRAINT resume_share_links_token_hash_not_blank_chk CHECK (length(trim(token_hash)) > 0),
	CONSTRAINT resume_share_links_token_encrypted_not_blank_chk CHECK (
		length(trim(token_encrypted)) > 0
	),
	CONSTRAINT resume_share_links_token_hint_not_blank_chk CHECK (length(trim(token_hint)) > 0),
	CONSTRAINT resume_share_links_password_chk CHECK (
		(
			access_mode = 'password'
			AND NULLIF(trim(password_hash), '') IS NOT NULL
		)
		OR (
			access_mode = 'link'
			AND password_hash IS NULL
		)
	)
);

CREATE TABLE IF NOT EXISTS public.resume_share_access_sessions (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	share_link_id uuid NOT NULL REFERENCES public.resume_share_links(id) ON DELETE CASCADE,
	session_hash text NOT NULL UNIQUE,
	client_ip_hash text,
	user_agent text,
	granted_at timestamptz NOT NULL DEFAULT now(),
	last_used_at timestamptz NOT NULL DEFAULT now(),
	expires_at timestamptz NOT NULL,
	CONSTRAINT resume_share_access_sessions_session_hash_not_blank_chk CHECK (
		length(trim(session_hash)) > 0
	)
);

CREATE TABLE IF NOT EXISTS public.resume_share_link_events (
	id bigserial PRIMARY KEY,
	share_link_id uuid REFERENCES public.resume_share_links(id) ON DELETE CASCADE,
	requested_token_hash text,
	outcome public.resume_share_event_outcome NOT NULL,
	occurred_at timestamptz NOT NULL DEFAULT now(),
	user_agent text,
	referrer_url_sanitized text,
	client_ip_hash text,
	download_triggered boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS resume_share_links_organisation_created_at_idx
	ON public.resume_share_links (organisation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS resume_share_links_resume_id_idx
	ON public.resume_share_links (resume_id);

CREATE INDEX IF NOT EXISTS resume_share_links_created_by_user_id_idx
	ON public.resume_share_links (created_by_user_id);

CREATE INDEX IF NOT EXISTS resume_share_links_expires_at_active_idx
	ON public.resume_share_links (expires_at)
	WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS resume_share_access_sessions_share_link_expires_at_idx
	ON public.resume_share_access_sessions (share_link_id, expires_at);

CREATE INDEX IF NOT EXISTS resume_share_link_events_share_link_occurred_at_idx
	ON public.resume_share_link_events (share_link_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS resume_share_link_events_requested_token_occurred_at_idx
	ON public.resume_share_link_events (requested_token_hash, occurred_at DESC);

CREATE INDEX IF NOT EXISTS resume_share_link_events_client_ip_occurred_at_idx
	ON public.resume_share_link_events (client_ip_hash, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.touch_resume_share_links_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	NEW.updated_at = now();
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_resume_share_links_updated_at ON public.resume_share_links;
CREATE TRIGGER trg_resume_share_links_updated_at
BEFORE UPDATE ON public.resume_share_links
FOR EACH ROW
EXECUTE FUNCTION public.touch_resume_share_links_updated_at();

CREATE OR REPLACE FUNCTION public.current_user_talent_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT t.id
	FROM public.talents t
	WHERE t.user_id = auth.uid()
	ORDER BY t.created_at ASC
	LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.resume_share_link_owner_org(target_resume_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT ot.organisation_id
	FROM public.resumes r
	JOIN public.organisation_talents ot ON ot.talent_id = r.talent_id
	WHERE r.id = target_resume_id
	ORDER BY COALESCE(ot.updated_at, ot.created_at) DESC, ot.created_at DESC
	LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.can_read_resume_share_link(target_share_link_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT EXISTS (
		SELECT 1
		FROM public.resume_share_links rsl
		WHERE rsl.id = target_share_link_id
			AND (
				public.is_admin()
				OR rsl.created_by_user_id = auth.uid()
				OR (
					(public.has_role('broker') OR public.has_role('employer'))
					AND rsl.organisation_id = public.current_user_home_org_id()
				)
				OR rsl.talent_id = public.current_user_talent_profile_id()
			)
	);
$$;

CREATE OR REPLACE FUNCTION public.can_manage_resume_share_link(target_share_link_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
	SELECT public.can_read_resume_share_link(target_share_link_id);
$$;

CREATE OR REPLACE FUNCTION public.record_resume_share_event(
	p_share_link_id uuid,
	p_requested_token_hash text,
	p_outcome public.resume_share_event_outcome,
	p_user_agent text DEFAULT NULL,
	p_referrer_url_sanitized text DEFAULT NULL,
	p_client_ip_hash text DEFAULT NULL,
	p_download_triggered boolean DEFAULT false
)
RETURNS public.resume_share_link_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
	v_event public.resume_share_link_events;
BEGIN
	INSERT INTO public.resume_share_link_events (
		share_link_id,
		requested_token_hash,
		outcome,
		user_agent,
		referrer_url_sanitized,
		client_ip_hash,
		download_triggered
	)
	VALUES (
		p_share_link_id,
		NULLIF(trim(COALESCE(p_requested_token_hash, '')), ''),
		p_outcome,
		NULLIF(trim(COALESCE(p_user_agent, '')), ''),
		NULLIF(trim(COALESCE(p_referrer_url_sanitized, '')), ''),
		NULLIF(trim(COALESCE(p_client_ip_hash, '')), ''),
		COALESCE(p_download_triggered, false)
	)
	RETURNING * INTO v_event;

	IF p_share_link_id IS NOT NULL THEN
		UPDATE public.resume_share_links
		SET
			total_request_count = total_request_count + 1,
			successful_view_count = successful_view_count + CASE
				WHEN p_outcome = 'success'::public.resume_share_event_outcome
					AND COALESCE(p_download_triggered, false) = false
				THEN 1
				ELSE 0
			END,
			download_count = download_count + CASE
				WHEN p_outcome = 'success'::public.resume_share_event_outcome
					AND COALESCE(p_download_triggered, false) = true
				THEN 1
				ELSE 0
			END,
			first_viewed_at = CASE
				WHEN p_outcome = 'success'::public.resume_share_event_outcome
					AND COALESCE(p_download_triggered, false) = false
				THEN COALESCE(first_viewed_at, now())
				ELSE first_viewed_at
			END,
			last_viewed_at = CASE
				WHEN p_outcome = 'success'::public.resume_share_event_outcome
					AND COALESCE(p_download_triggered, false) = false
				THEN now()
				ELSE last_viewed_at
			END
		WHERE id = p_share_link_id;
	END IF;

	RETURN v_event;
END;
$$;

ALTER TABLE public.resume_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resume_share_access_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resume_share_link_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "resume share links read" ON public.resume_share_links;
DROP POLICY IF EXISTS "resume share links insert" ON public.resume_share_links;
DROP POLICY IF EXISTS "resume share links update" ON public.resume_share_links;
DROP POLICY IF EXISTS "resume share links delete" ON public.resume_share_links;

CREATE POLICY "resume share links read" ON public.resume_share_links
FOR SELECT USING (public.can_read_resume_share_link(id));

CREATE POLICY "resume share links insert" ON public.resume_share_links
FOR INSERT WITH CHECK (
	created_by_user_id = auth.uid()
	AND public.can_edit_resume(resume_id)
	AND EXISTS (
		SELECT 1
		FROM public.resumes r
		WHERE r.id = resume_share_links.resume_id
			AND r.talent_id = resume_share_links.talent_id
	)
	AND organisation_id = public.resume_share_link_owner_org(resume_id)
);

CREATE POLICY "resume share links update" ON public.resume_share_links
FOR UPDATE USING (public.can_manage_resume_share_link(id))
WITH CHECK (
	public.can_manage_resume_share_link(id)
	AND EXISTS (
		SELECT 1
		FROM public.resumes r
		WHERE r.id = resume_share_links.resume_id
			AND r.talent_id = resume_share_links.talent_id
	)
	AND organisation_id = public.resume_share_link_owner_org(resume_id)
);

CREATE POLICY "resume share links delete" ON public.resume_share_links
FOR DELETE USING (public.can_manage_resume_share_link(id));

DROP POLICY IF EXISTS "resume share link events read" ON public.resume_share_link_events;

CREATE POLICY "resume share link events read" ON public.resume_share_link_events
FOR SELECT USING (
	share_link_id IS NOT NULL
	AND public.can_read_resume_share_link(share_link_id)
);
