-- ============================================================================
-- Core tables: tenants, profiles, user_roles, invitations
-- Helper functions: has_role(), is_member_of_tenant()
-- RPC: match_workflow_definitions() for vector similarity search
-- ============================================================================

-- ─── Extensions ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ─── Enums (idempotent) ────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM (
    'admin','manager','user','super_admin',
    'operationnel_terrain','comptable','daf','dirigeant',
    'juriste','avocat_partenaire','cabinet_comptable_admin',
    'collaborateur_cabinet','admin_tenant','rh'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.plan_type AS ENUM ('starter','pro','business');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.user_profile_kind AS ENUM (
    'dirigeant','rh','juriste','expert_comptable','manager_multi_sites'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── set_updated_at trigger function ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 1. TENANTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.tenants (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT        NOT NULL,
  slug        TEXT        NOT NULL UNIQUE,
  plan        public.plan_type NOT NULL DEFAULT 'starter',
  idcc        TEXT,
  sector      TEXT,
  siret       TEXT,
  chat_model  TEXT        NOT NULL DEFAULT 'gpt-4o',
  rag_mode    TEXT,
  questions_used   INTEGER NOT NULL DEFAULT 0,
  quota_questions  INTEGER NOT NULL DEFAULT 50,
  quota_reset_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON public.tenants(slug);

DROP TRIGGER IF EXISTS set_tenants_updated_at ON public.tenants;
CREATE TRIGGER set_tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. PROFILES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id              UUID        NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           TEXT        NOT NULL,
  full_name       TEXT,
  avatar_url      TEXT,
  phone           TEXT,
  job_title       TEXT,
  profile_kind    public.user_profile_kind,
  preferred_rag_mode TEXT,
  onboarded       BOOLEAN     NOT NULL DEFAULT false,
  tenant_id       UUID        REFERENCES public.tenants(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_tenant ON public.profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email  ON public.profiles(email);

DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 3. USER_ROLES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.user_roles (
  id         UUID           NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID           NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id  UUID           NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role       public.app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ    NOT NULL DEFAULT now(),
  UNIQUE (user_id, tenant_id, role)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user   ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_tenant ON public.user_roles(tenant_id);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 4. INVITATIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.invitations (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email       TEXT        NOT NULL,
  role        public.app_role NOT NULL DEFAULT 'user',
  token       TEXT        NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex') UNIQUE,
  invited_by  UUID        NOT NULL REFERENCES auth.users(id),
  accepted_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitations_tenant ON public.invitations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email  ON public.invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_token  ON public.invitations(token);

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 5. HELPER FUNCTIONS
-- ============================================================================

-- has_role(user_id, role, tenant_id) — 3-arg overload used across RLS policies
CREATE OR REPLACE FUNCTION public.has_role(
  _user_id   UUID,
  _role      public.app_role,
  _tenant_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id   = _user_id
      AND tenant_id = _tenant_id
      AND role      = _role
  );
$$;

-- has_role(tenant_id, role_text) — 2-arg overload (uses auth.uid() implicitly)
CREATE OR REPLACE FUNCTION public.has_role(
  p_tenant_id UUID,
  p_role      TEXT
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id   = auth.uid()
      AND tenant_id = p_tenant_id
      AND role      = p_role::public.app_role
  );
$$;

-- is_member_of_tenant(user_id, tenant_id) — 2-arg overload
CREATE OR REPLACE FUNCTION public.is_member_of_tenant(
  _user_id   UUID,
  _tenant_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id   = _user_id
      AND tenant_id = _tenant_id
  );
$$;

-- is_member_of_tenant(tenant_id) — 1-arg overload (uses auth.uid() implicitly)
CREATE OR REPLACE FUNCTION public.is_member_of_tenant(
  p_tenant_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id   = auth.uid()
      AND tenant_id = p_tenant_id
  );
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, TEXT)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_member_of_tenant(UUID, UUID)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_member_of_tenant(UUID)             TO authenticated;

-- ============================================================================
-- 6. RLS POLICIES
-- ============================================================================

-- ── tenants ─────────────────────────────────────────────────────────────────────
CREATE POLICY "Members can view their own tenant"
  ON public.tenants FOR SELECT TO authenticated
  USING (public.is_member_of_tenant(auth.uid(), id));

CREATE POLICY "Admins can update their tenant"
  ON public.tenants FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role, id))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role, id));

-- ── profiles ────────────────────────────────────────────────────────────────────
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Users in same tenant can view profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND public.is_member_of_tenant(auth.uid(), tenant_id)
  );

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

-- ── user_roles ──────────────────────────────────────────────────────────────────
CREATE POLICY "Users can view own roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Members can view tenant roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (public.is_member_of_tenant(auth.uid(), tenant_id));

CREATE POLICY "Admins can manage roles"
  ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role, tenant_id))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role, tenant_id));

-- ── invitations ─────────────────────────────────────────────────────────────────
CREATE POLICY "Members can view tenant invitations"
  ON public.invitations FOR SELECT TO authenticated
  USING (public.is_member_of_tenant(auth.uid(), tenant_id));

CREATE POLICY "Admins can create invitations"
  ON public.invitations FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role, tenant_id)
    OR public.has_role(auth.uid(), 'admin_tenant'::public.app_role, tenant_id)
  );

CREATE POLICY "Admins can delete invitations"
  ON public.invitations FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role, tenant_id)
    OR public.has_role(auth.uid(), 'admin_tenant'::public.app_role, tenant_id)
  );

-- ============================================================================
-- 7. match_workflow_definitions RPC — vector similarity search
-- ============================================================================
-- Called by workflow-generator-core.server.ts:
--   sb.rpc("match_workflow_definitions", {
--     query_embedding, match_threshold, match_count, tenant_id_filter
--   })
-- Returns matching workflow_definitions sorted by cosine similarity.

CREATE OR REPLACE FUNCTION public.match_workflow_definitions(
  query_embedding   vector(1536),
  match_threshold   FLOAT DEFAULT 0.8,
  match_count       INT   DEFAULT 5,
  tenant_id_filter  UUID  DEFAULT NULL
)
RETURNS TABLE (
  id                UUID,
  title             TEXT,
  slug              TEXT,
  category          TEXT,
  description       TEXT,
  lifecycle_status  TEXT,
  similarity        FLOAT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    wd.id,
    wd.title,
    wd.slug,
    wd.category,
    wd.description,
    wd.lifecycle_status::TEXT,
    1 - (wd.topic_embedding::vector(1536) <=> query_embedding) AS similarity
  FROM public.workflow_definitions wd
  WHERE
    wd.topic_embedding IS NOT NULL
    AND wd.lifecycle_status = 'human_validated'
    AND (tenant_id_filter IS NULL OR wd.tenant_id IS NULL OR wd.tenant_id = tenant_id_filter)
    AND 1 - (wd.topic_embedding::vector(1536) <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_workflow_definitions(vector, FLOAT, INT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_workflow_definitions(vector, FLOAT, INT, UUID) TO service_role;
