-- Vues : forcer security_invoker pour respecter RLS
ALTER VIEW public.v_ingestion_progress SET (security_invoker = true);
ALTER VIEW public.v_legal_sources_summary SET (security_invoker = true);
ALTER VIEW public.v_legal_chunks_summary SET (security_invoker = true);

-- Fonctions : retirer explicitement anon et authenticated
REVOKE EXECUTE ON FUNCTION public.start_ingestion_batch(text, text, jsonb, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_next_batch_items(uuid, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_items_processed(uuid, jsonb, integer, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_items_failed(uuid, jsonb, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finalize_batch(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_zombie_batches() FROM anon, authenticated;