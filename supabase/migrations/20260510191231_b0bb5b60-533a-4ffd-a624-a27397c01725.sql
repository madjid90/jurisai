CREATE OR REPLACE FUNCTION public.increment_embedding_cache_hit(_query_hash text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.embedding_cache
     SET hit_count = COALESCE(hit_count, 0) + 1,
         last_hit_at = now()
   WHERE query_hash = _query_hash;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_embedding_cache_hit(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_embedding_cache_hit(text) TO service_role;