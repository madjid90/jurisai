create or replace function public.count_empty_sources_by_connector()
returns table(connector text, count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select s.connector::text, count(*)::bigint
  from public.legal_sources s
  where not exists (select 1 from public.legal_chunks c where c.source_id = s.id)
  group by s.connector;
$$;

revoke execute on function public.count_empty_sources_by_connector() from public;
grant execute on function public.count_empty_sources_by_connector() to service_role;

create or replace function public.list_empty_sources(p_connector text)
returns table(source_id uuid, external_id text, official_url text, raw_metadata jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.external_id, s.official_url, s.raw_metadata
  from public.legal_sources s
  where s.connector = p_connector
    and not exists (select 1 from public.legal_chunks c where c.source_id = s.id)
  order by s.id
  limit 5000;
$$;

revoke execute on function public.list_empty_sources(text) from public;
grant execute on function public.list_empty_sources(text) to service_role;