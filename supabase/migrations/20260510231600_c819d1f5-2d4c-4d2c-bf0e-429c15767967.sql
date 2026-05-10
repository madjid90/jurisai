
-- =========================================================
-- LOT 11 — Cache RAG + Email outbox
-- =========================================================

-- 1) Cache RAG ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rag_response_cache (
  cache_key text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  question text NOT NULL,
  payload jsonb NOT NULL,
  hit_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rag_response_cache_tenant_exp
  ON public.rag_response_cache (tenant_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_rag_response_cache_expires
  ON public.rag_response_cache (expires_at);

ALTER TABLE public.rag_response_cache ENABLE ROW LEVEL SECURITY;

-- Aucun accès direct depuis le client : tout passe par les server fns (service role).
CREATE POLICY "rag_cache_service_only"
ON public.rag_response_cache FOR ALL
USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.increment_rag_cache_hit(_key text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.rag_response_cache
     SET hit_count = hit_count + 1
   WHERE cache_key = _key;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_rag_cache_hit(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.increment_rag_cache_hit(text) TO service_role;

CREATE OR REPLACE FUNCTION public.purge_expired_rag_cache()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_deleted int;
BEGIN
  DELETE FROM public.rag_response_cache WHERE expires_at < now();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END $$;

REVOKE EXECUTE ON FUNCTION public.purge_expired_rag_cache() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.purge_expired_rag_cache() TO service_role;


-- 2) Email outbox -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid,
  to_email text NOT NULL,
  subject text NOT NULL,
  body_html text,
  body_text text,
  template text,
  template_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sending','sent','failed','dead')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_outbox_pending
  ON public.email_outbox (status, next_attempt_at)
  WHERE status IN ('pending','sending');
CREATE INDEX IF NOT EXISTS idx_email_outbox_tenant
  ON public.email_outbox (tenant_id, created_at DESC);

ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;

-- Pas de lecture/écriture directe : tout passe par les server fns.
CREATE POLICY "email_outbox_service_only"
ON public.email_outbox FOR ALL
USING (false) WITH CHECK (false);

CREATE TRIGGER trg_email_outbox_updated_at
BEFORE UPDATE ON public.email_outbox
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
