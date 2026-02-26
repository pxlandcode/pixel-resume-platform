DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'resumes'
      AND policyname = 'admin full access'
  ) THEN
    EXECUTE 'DROP POLICY "admin full access" ON public.resumes';
  END IF;
  EXECUTE $policy$
    CREATE POLICY "admin full access" ON public.resumes
      USING (public.is_admin()) WITH CHECK (public.is_admin());
  $policy$;
END$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'resumes'
      AND policyname = 'consultant owns resume'
  ) THEN
    EXECUTE 'DROP POLICY "consultant owns resume" ON public.resumes';
  END IF;
  EXECUTE $policy$
    CREATE POLICY "consultant owns resume" ON public.resumes
      USING (public.is_employee() AND user_id = auth.uid())
      WITH CHECK (public.is_employee() AND user_id = auth.uid());
  $policy$;
END$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'resumes'
      AND policyname = 'client read assigned resume'
  ) THEN
    EXECUTE 'DROP POLICY "client read assigned resume" ON public.resumes';
  END IF;
  EXECUTE $policy$
    CREATE POLICY "client read assigned resume" ON public.resumes
      FOR SELECT USING (
        public.is_employer() AND EXISTS (
          SELECT 1 FROM public.resume_client_access rca
          WHERE rca.resume_id = resumes.id AND rca.client_user_id = auth.uid()
        )
      );
  $policy$;
END$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'resume_versions'
      AND policyname = 'admin full access'
  ) THEN
    EXECUTE 'DROP POLICY "admin full access" ON public.resume_versions';
  END IF;
  EXECUTE $policy$
    CREATE POLICY "admin full access" ON public.resume_versions
      USING (public.is_admin()) WITH CHECK (public.is_admin());
  $policy$;
END$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'resume_versions'
      AND policyname = 'owner manage versions'
  ) THEN
    EXECUTE 'DROP POLICY "owner manage versions" ON public.resume_versions';
  END IF;
  EXECUTE $policy$
    CREATE POLICY "owner manage versions" ON public.resume_versions
      USING (
        public.is_employee() AND EXISTS (
          SELECT 1 FROM public.resumes r
          WHERE r.id = resume_versions.resume_id AND r.user_id = auth.uid()
        )
      )
      WITH CHECK (
        public.is_employee() AND EXISTS (
          SELECT 1 FROM public.resumes r
          WHERE r.id = resume_versions.resume_id AND r.user_id = auth.uid()
        )
      );
  $policy$;
END$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'resume_versions'
      AND policyname = 'client read assigned version'
  ) THEN
    EXECUTE 'DROP POLICY "client read assigned version" ON public.resume_versions';
  END IF;
  EXECUTE $policy$
    CREATE POLICY "client read assigned version" ON public.resume_versions
      FOR SELECT USING (
        public.is_employer() AND EXISTS (
          SELECT 1 FROM public.resume_client_access rca
          JOIN public.resumes r ON rca.resume_id = r.id
          WHERE r.id = resume_versions.resume_id AND rca.client_user_id = auth.uid()
        )
      );
  $policy$;
END$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'resume_client_access'
      AND policyname = 'admin manage access'
  ) THEN
    EXECUTE 'DROP POLICY "admin manage access" ON public.resume_client_access';
  END IF;
  EXECUTE $policy$
    CREATE POLICY "admin manage access" ON public.resume_client_access
      USING (public.is_admin()) WITH CHECK (public.is_admin());
  $policy$;
END$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'resume_client_access'
      AND policyname = 'client read own access'
  ) THEN
    EXECUTE 'DROP POLICY "client read own access" ON public.resume_client_access';
  END IF;
  EXECUTE $policy$
    CREATE POLICY "client read own access" ON public.resume_client_access
      FOR SELECT USING (public.is_employer() AND client_user_id = auth.uid());
  $policy$;
END$$;