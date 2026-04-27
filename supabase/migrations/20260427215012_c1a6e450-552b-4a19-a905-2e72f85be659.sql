
-- ─────────────────────────────────────────────────────────────
-- Rate limiting
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rate_limits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup
  ON public.rate_limits (user_id, endpoint, window_start DESC);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- No public policies: only security-definer functions touch this table.

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id uuid,
  p_endpoint text,
  p_max_per_minute integer DEFAULT 10
)
RETURNS TABLE (
  allowed boolean,
  current_count integer,
  reset_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window timestamptz := date_trunc('minute', now());
  v_count integer;
BEGIN
  INSERT INTO public.rate_limits (user_id, endpoint, window_start, request_count)
  VALUES (p_user_id, p_endpoint, v_window, 1)
  ON CONFLICT (user_id, endpoint, window_start)
  DO UPDATE SET request_count = public.rate_limits.request_count + 1
  RETURNING request_count INTO v_count;

  RETURN QUERY SELECT
    v_count <= p_max_per_minute AS allowed,
    v_count AS current_count,
    v_window + interval '1 minute' AS reset_at;
END $$;

CREATE OR REPLACE FUNCTION public.cleanup_rate_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.rate_limits
  WHERE window_start < now() - interval '1 hour';
END $$;

-- ─────────────────────────────────────────────────────────────
-- RGPD : DELETE policies on messages
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can delete their own messages" ON public.messages;
CREATE POLICY "Users can delete their own messages"
  ON public.messages
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND c.user_id = auth.uid()
    )
  );
