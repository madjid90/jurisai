-- ────────────────────────────────────────────────────────────────────────────
-- P7 : ajout du rôle "rh" (12e profil métier manquant)
-- ────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum WHERE enumtypid = 'public.app_role'::regtype AND enumlabel = 'rh'
  ) THEN
    ALTER TYPE public.app_role ADD VALUE 'rh';
  END IF;
END $$;
