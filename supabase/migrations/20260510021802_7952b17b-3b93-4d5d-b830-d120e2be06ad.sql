TRUNCATE TABLE
  public.legal_chunks,
  public.legal_chunks_staging,
  public.legal_sources,
  public.conventions_collectives,
  public.ingestion_batch_state,
  public.ingestion_errors,
  public.ingestion_jobs
RESTART IDENTITY CASCADE;