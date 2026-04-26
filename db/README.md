# JurisAI — SQL Migrations

## Phase 1 : Fondations multi-tenant

**À exécuter manuellement dans Supabase Dashboard → SQL Editor.**

1. Ouvre [https://supabase.com/dashboard/project/yuvysjsyumxpekzvlzsx/sql/new](https://supabase.com/dashboard/project/yuvysjsyumxpekzvlzsx/sql/new)
2. Copie tout le contenu de `phase1_init.sql`
3. Colle dans l'éditeur SQL
4. Clique sur **Run** (ou Cmd+Enter)
5. Vérifie qu'aucune erreur ne s'affiche

## Vérification post-exécution

Après l'exécution, va dans **Database → Tables** et confirme que ces 5 tables existent :
- `tenants`
- `profiles`
- `user_roles`
- `invitations`
- `usage_logs`

Et dans **Database → Functions** :
- `has_role`
- `current_tenant_id`
- `is_member_of_tenant`
- `handle_new_user`
- `set_updated_at`

## Re-exécution

Le script est **idempotent** — tu peux le relancer sans risque, il utilise `if not exists`, `drop policy if exists`, etc.
