
-- 1. Supprimer les chunks vectoriels liés aux sources KALI
DELETE FROM public.legal_chunks
WHERE source_id IN (SELECT id FROM public.legal_sources WHERE connector IN ('kali','kali-full'));

-- 2. Supprimer les chunks de staging éventuels
DELETE FROM public.legal_chunks_staging
WHERE source_id IN (SELECT id FROM public.legal_sources WHERE connector IN ('kali','kali-full'));

-- 3. Supprimer les sources légales KALI
DELETE FROM public.legal_sources WHERE connector IN ('kali','kali-full');

-- 4. Vider les conventions collectives
DELETE FROM public.conventions_collectives;

-- 5. Supprimer les batches d'ingestion KALI (running, paused, completed, failed)
DELETE FROM public.ingestion_batch_state WHERE connector IN ('kali','kali-full');

-- 6. Supprimer les erreurs d'ingestion KALI
DELETE FROM public.ingestion_errors WHERE connector IN ('kali','kali-full');

-- 7. Supprimer les jobs d'ingestion KALI
DELETE FROM public.ingestion_jobs WHERE connector IN ('kali','kali-full');
