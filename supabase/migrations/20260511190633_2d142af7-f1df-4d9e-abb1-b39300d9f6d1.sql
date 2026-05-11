DELETE FROM public.ingestion_batch_state
 WHERE connector = 'kali-full'
   AND status IN ('paused','running','pending')
   AND total_count <= 60;