-- ─── 1. Repartitionnement de public.usage_logs ─────────────────────────────
-- La table actuelle ne contient que quelques lignes ; on peut faire la bascule
-- en sécurité. Stratégie : créer une nouvelle table partitionnée par
-- created_at (RANGE), recopier les données, swap.

CREATE TABLE IF NOT EXISTS public.usage_logs_part (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  user_id uuid,
  action text NOT NULL,
  tokens_used integer,
  cost_cents integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Partition par défaut (filet de sécurité).
CREATE TABLE IF NOT EXISTS public.usage_logs_part_default
  PARTITION OF public.usage_logs_part DEFAULT;

-- Helper pour créer dynamiquement les partitions mensuelles.
CREATE OR REPLACE FUNCTION public.ensure_usage_logs_partition(p_month date DEFAULT date_trunc('month', now())::date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (v_start + interval '1 month')::date;
  v_name  text := 'usage_logs_part_' || to_char(v_start, 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.usage_logs_part FOR VALUES FROM (%L) TO (%L)',
    v_name, v_start, v_end
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_usage_logs_partition(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_usage_logs_partition(date) TO service_role;

-- Pré-création : mois précédent + 12 mois à venir.
DO $$
DECLARE m date;
BEGIN
  FOR m IN
    SELECT (date_trunc('month', now())::date + (i || ' months')::interval)::date
    FROM generate_series(-1, 12) g(i)
  LOOP
    PERFORM public.ensure_usage_logs_partition(m);
  END LOOP;
END $$;

-- Recopie des données existantes.
INSERT INTO public.usage_logs_part (id, tenant_id, user_id, action, tokens_used, cost_cents, metadata, created_at)
SELECT id, tenant_id, user_id, action, tokens_used, cost_cents, metadata, created_at
FROM public.usage_logs;

-- Swap des noms.
ALTER TABLE public.usage_logs RENAME TO usage_logs_legacy;
ALTER TABLE public.usage_logs_part RENAME TO usage_logs;

-- Index identiques à l'original.
CREATE INDEX IF NOT EXISTS usage_logs_tenant_idx ON public.usage_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_logs_user_idx   ON public.usage_logs (user_id, created_at DESC);

-- RLS identique.
ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members view tenant usage" ON public.usage_logs;
CREATE POLICY "Members view tenant usage"
  ON public.usage_logs
  FOR SELECT
  USING (public.is_member_of_tenant(auth.uid(), tenant_id));

-- Suppression de l'ancienne table.
DROP TABLE public.usage_logs_legacy;

-- ─── 2. Nettoyage des index strictement redondants ─────────────────────────
DROP INDEX IF EXISTS public.legal_chunks_embedding_hnsw_idx;
DROP INDEX IF EXISTS public.legal_chunks_fts_idx;
DROP INDEX IF EXISTS public.legal_chunks_source_id_idx;
DROP INDEX IF EXISTS public.legal_sources_idcc_idx;
DROP INDEX IF EXISTS public.tenants_slug_idx;            -- doublon de tenants_slug_key (UNIQUE)
DROP INDEX IF EXISTS public.workflow_instances_tenant_idx;
DROP INDEX IF EXISTS public.workflow_step_runs_instance_idx;
DROP INDEX IF EXISTS public.conventions_collectives_idcc_idx; -- doublon de _key (UNIQUE)
DROP INDEX IF EXISTS public.idx_rate_limits_lookup;       -- couvert par la clé UNIQUE (user_id,endpoint,window_start)
DROP INDEX IF EXISTS public.idx_analyses_tenant;          -- doublon de idx_document_analyses_tenant_created
