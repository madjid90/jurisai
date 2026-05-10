CREATE OR REPLACE VIEW public.v_workflow_generator_stats AS
SELECT
  date_trunc('day', created_at) AS day,
  count(*) AS total_runs,
  count(*) FILTER (WHERE status = 'succeeded') AS completed,
  count(*) FILTER (WHERE status = 'failed') AS failed,
  count(*) FILTER (WHERE status = 'rejected') AS rejected,
  count(*) FILTER (WHERE cache_hit = true) AS from_cache,
  avg((scores->>'overall')::numeric)::int AS avg_quality_score,
  avg(duration_ms)::int AS avg_duration_ms,
  sum(tokens_used) AS total_tokens
FROM public.workflow_generation_runs
WHERE created_at > now() - interval '30 days'
GROUP BY date_trunc('day', created_at)
ORDER BY day DESC;

GRANT SELECT ON public.v_workflow_generator_stats TO authenticated;

CREATE OR REPLACE VIEW public.v_workflow_definitions_health AS
SELECT
  lifecycle_status::text AS status,
  CASE WHEN generated_by_ai THEN 'ai_generator' ELSE 'human' END AS generated_by,
  count(*) AS workflows_count,
  avg(score_overall)::int AS avg_quality,
  count(*) FILTER (WHERE requires_human_review = true OR contains_sensitive_actions = true) AS sensitive_count
FROM public.workflow_definitions
GROUP BY lifecycle_status, generated_by_ai
ORDER BY lifecycle_status, generated_by_ai;

GRANT SELECT ON public.v_workflow_definitions_health TO authenticated;