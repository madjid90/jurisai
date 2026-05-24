# Migrations Supabase JurisAI

## ⚠️ Drift git ↔ Supabase au 2026-05-24

L'audit V6 (`docs/AUDIT-JURISAI-V6.md` §3 P2) a relevé un drift entre les
migrations en prod et celles présentes en git :

- **30+ migrations** dans `supabase_migrations.schema_migrations` depuis le 17/05
- **~10 fichiers** dans ce dossier pour cette période

### Migrations appliquées en prod via MCP — sans fichier git

À récupérer via `npx supabase db pull` lors de la prochaine session avec CLI
Supabase installée. En attendant, leur SQL complet est stocké dans
`supabase_migrations.schema_migrations.statements` (colonne text[]) en prod et
accessible via :

```sql
SELECT version, name, array_to_string(statements, E'\n\n') AS sql
FROM supabase_migrations.schema_migrations
WHERE version >= '20260517123215'
ORDER BY version;
```

**Liste des 20+ migrations LRE V1 / RPCs SECURITY DEFINER appliquées le 17/05** :
```
20260517123728  seed_baremes_2026
20260517123942  macron_scale_small_11_29
20260517124013  calculation_history_immutable
20260517130606  agent_recovery_tick_cron
20260517130734  hybrid_search_perf_optim
20260517130936  hybrid_search_plpgsql_inline
20260517135833  baremes_orchestrator_cron
20260517153111  parse_french_date_helper
20260517153920  parse_french_date_handle_1er
20260517153955  backfill_legal_date_conventions
20260517154338  backfill_legal_date_proxy_created_at
20260517154438  hybrid_search_precompute_tsquery
20260517154603  rag_eval_cases_validation_columns
20260517163009  fix_advisors_security_definer_and_search_path
20260517164012  gdpr_retention_purge_cron
20260517180014  legal_normative_hierarchy_seed     ← LRE V1
20260517180038  legal_reasoning_traces             ← LRE V1
20260517180114  hybrid_search_typed_lre            ← LRE V1
20260517180134  rag_eval_cases_lre_expected        ← LRE V1
20260517191459  get_user_tenant_id_rpc             ← Lovable workaround
20260517202156  grant_authenticated_security_definer_rpcs
20260517203441  insert_agent_run_secdef            ← Lovable workaround
20260517210340  lock_agent_run_secdef              ← Lovable workaround
20260517214545  agent_runs_status_check_add_executing
20260517221408  start_procedure_full_secdef        ← Lovable workaround
```

### Migrations récupérées (versionnées ici)

- `20260522131437_create_dossier_for_run_secdef.sql` — RPC pour intents sans workflow
- `20260523120000_rpc_instantiate_workflow.sql` — RPC `instantiate_workflow`
- `20260524000000_rpc_agent_run_force_fail.sql` — RPC watchdog SECURITY DEFINER

## Procédure pour éviter le drift à l'avenir

1. **En fin de session significative**, exécuter `npx supabase db pull` localement
2. Ou — pour les changements de DDL — toujours créer un fichier `supabase/migrations/YYYYMMDDHHMMSS_nom.sql` AVANT d'appliquer via MCP
3. Commit + push le fichier en même temps que les changements code qui en dépendent

## Convention de nommage

```
YYYYMMDDHHMMSS_nom_en_snake_case.sql
```

Le timestamp doit correspondre à la version Supabase (UTC). Plus ancien = appliqué en premier.
