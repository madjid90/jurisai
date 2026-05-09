# AUDIT COMPLET JurisAI — v2 (2026-05-09)

## 1. Vue d'ensemble du code

- **24 routes authentifiées** (`src/routes/_authenticated/*`)
- **31 fichiers `*.functions.ts`** (server functions TanStack)
- **12 edge functions Supabase** (réservées à l'ingestion juridique + OCR + chat)
- **70 tables Postgres**

## 2. CODE MORT / NON BRANCHÉ détecté

### 2.1 Server functions sans aucun import (mortes)
| Fichier | Statut |
|---|---|
| `src/server/agent-validations.functions.ts` | **MORT** — `createAgentValidationRequest` n'est appelé nulle part. Remplacé par le flow `agent_runs` + `validation_requests` côté `agent-runs.functions.ts`. → **À supprimer**. |
| `src/server/chat.functions.ts` | **MORT** — `sendChatMessage` (RAG simple) n'est plus utilisé. Le chat s'est unifié dans `agent.functions.ts` + `agent-runs.functions.ts`. → **À supprimer** (et supprimer `legal-chat` edge fn). |

### 2.2 Composants non importés
| Composant | Statut |
|---|---|
| `src/components/app/MessageFeedback.tsx` | **MORT** — 0 import. → supprimer. |
| `src/components/chat/SourcesPanel.tsx` | **MORT** — 0 import (ancien chat). → supprimer. |

### 2.3 Edge functions à reclasser
| Edge function | Décision |
|---|---|
| `legal-chat` | **À supprimer** (chat migré en server fn, mais server fn elle-même morte → tout sortir). |
| `seed-demo`, `seed-legal` | **Garder** (outils d'amorçage), mais sortir du menu — c'est du dev. |
| `connector-kali`, `connector-cdtn-modeles`, `connector-legifrance`, `connector-judilibre` | **Garder** — appelés via `connectors.functions.ts` & `legal-sources.functions.ts`. |
| `ingest-legal-source`, `evaluate-rag`, `legal-watch-cron`, `ocr-document` | **Garder** — branchés. |

### 2.4 Catégorie « Outils » du menu (sous-menu admin)
Tout le sous-menu Modèles / Procédures / OCR & scan / Analyses / Liaisons est techniquement branché, mais :
- `analyses` & `analyses.$id` ne sont accessibles **que** depuis la sidebar (pas de CTA depuis dossier). → ajouter un lien depuis le dossier.
- `links` (suggestions de rattachement document↔dossier) : 0 lien dans la DB, fonctionnalité jamais utilisée par le flow agent → **soit la brancher dans le pipeline OCR, soit la cacher**.
- `scan` : doublon avec l'upload du dashboard hero (qui appelle déjà `runOcrDocument`). → **fusionner ou supprimer `/scan`**.

### 2.5 DB : tables vides utilisées seulement par le code récent
Vides aujourd'hui mais alimentées par le pipeline → garder :
`reports`, `sites`, `document_links`, `identified_risks`, `contract_deadlines`, `reminders`, `legal_chunks`, `message_feedback`, `legal_alerts`, `generated_documents`, `documents`, `employees`, `document_analyses`.

Vides + jamais écrites par le code actuel → **suspectes** (à confirmer avant suppression) :
- `report_exports` (table `reports` lui suffit)
- `templates_public` (catalogue dupliqué de `document_templates` filtré sur `is_public`)
- `email_queue` (aucune insertion repérée — l'envoi mail passe par `notify.server.ts` direct)
- `digest_runs` (uniquement écrit par `legal-watch-cron` — OK à garder si cron actif)

## 3. AUDIT BD

### 3.1 Tables (70) — regroupement logique
- **Multi-tenant** : `tenants`, `profiles`, `user_roles`, `permissions`, `role_permissions`, `invitations`, `tenant_api_keys`, `tenant_integrations`, `tenant_webhooks`, `tenant_alert_subscriptions`
- **Métier dossier** : `dossiers`, `case_timeline_events`, `dossier_tasks`, `dossier_deadlines`, `dossier_comments`, `dossier_context_index`, `clients`, `employees`, `sites`
- **Documents** : `documents`, `document_analyses`, `document_links`, `document_templates`, `document_generation_sessions`, `generated_documents`, `extracted_fields`, `entity_mentions`
- **Agent** : `agent_runs`, `agent_tool_runs`, `validation_requests`
- **RAG juridique** : `legal_sources`, `legal_chunks`, `legal_chunks_staging`, `legal_article_versions`, `conventions_collectives`, `embedding_cache`, `ingestion_jobs`, `ingestion_errors`, `rag_eval_cases`, `rag_eval_runs`
- **Veille** : `legal_alerts`, `legal_updates`, `legal_update_actions`, `alert_dismissals`
- **Workflows** : `workflow_definitions`, `workflow_instances`, `workflow_step_runs`
- **Risques & échéances** : `identified_risks`, `contract_deadlines`, `reminders`
- **Notifications/comm** : `notifications`, `notification_preferences`, `email_queue`, `webhook_deliveries`, `chat_citations`, `messages`, `conversations`, `message_feedback`
- **Reporting** : `reports`, `report_exports`
- **Observabilité** : `audit_logs`, `usage_logs`, `billing_events`, `system_metrics`, `data_quality_checks`, `server_function_errors`, `rate_limits`

### 3.2 Données réelles (counts)
| Table | Lignes |
|---|---|
| `workflow_definitions` | 46 ✅ |
| `legal_sources` | 26 (toutes IDCC conventions) |
| `conventions_collectives` | 26 |
| `rag_eval_cases` | 20 |
| `document_templates` | 18 |
| `agent_runs` | 11 |
| `workflow_instances` | 7 |
| `dossiers` / `clients` | 3 / 3 |
| `case_timeline_events` | **1** ⚠️ |
| **`legal_chunks`** | **0** ❌ |

### 3.3 Problèmes BD critiques
1. **`legal_chunks` = 0** alors que 26 sources sont marquées `is_active=true` et `last_synced_at` rempli. → l'ingestion **n'a jamais peuplé les chunks**, donc le RAG ne peut renvoyer aucune source. Toutes les réponses agent vont déclencher le « refus faute de source » du système prompt.
   - **Action** : relancer `ingest-legal-source` pour chaque IDCC, ou utiliser le bouton « Promouvoir » dans `/admin/legal-sources` (la fonction `promote_ingestion_job` existe mais 0 staging actuellement).
2. **`case_timeline_events` quasi vide (1 ligne)** alors que la Core rule est « toute action significative doit être loggée ». → vérifier les `logTimelineEvent` côté server functions (manque dans `analysis.functions.ts`, `documents.functions.ts`).
3. **22 warnings `SECURITY DEFINER` accessibles à `anon`/`authenticated`** (`hybrid_search`, `match_dossier_context`, `validate_api_key`, etc.). → Appliquer la Core rule : `REVOKE EXECUTE FROM PUBLIC; GRANT EXECUTE TO service_role`.
4. **Leaked Password Protection désactivé** → activer dans Auth settings.
5. **Extension `vector` dans `public`** → recommandé de la déplacer dans `extensions`.

### 3.4 Triggers & fonctions PG utiles bien branchés
- `notify_document_link_suggestion` (déclenche notif quand suggestion `document_links` arrive) — OK mais inutilisé puisque table vide.
- `fanout_legal_alert_to_notifications` (déclenche notif sur `legal_alerts`) — OK mais 0 alerte.
- `hybrid_search` (RAG RRF + boost autorité) — OK mais inutilisable tant que `legal_chunks` vide.
- `has_role`, `is_member_of_tenant`, `current_tenant_id` — bien utilisés par RLS.

## 4. FLUX D'INGESTION DES API JURIDIQUES

### 4.1 Connecteurs (edge functions)
| Connecteur | Source | Format brut | Edge fn |
|---|---|---|---|
| **Kali** (Légifrance) | conventions collectives IDCC | XML/JSON Légifrance | `connector-kali/index.ts` |
| **CDTN-modèles** | modèles ministère du Travail | JSON CDTN | `connector-cdtn-modeles/index.ts` |
| **Légifrance** | Code du travail, articles | JSON PISTE (`piste.ts`) | `connector-legifrance/index.ts` |
| **JudiLibre** | jurisprudence Cour de cass. | JSON | `connector-judilibre/index.ts` |

### 4.2 Pipeline d'ingestion (universel)

```
[connector-XXX]
   ↓ fetch + parse → texte structuré (titre, headings, contenu, ref code, URL officielle, IDCC, autorité 1-6)
[ingest-legal-source]
   ↓ crée 1 row dans `legal_sources` (métadonnées source)
   ↓ découpe le texte via smart-chunk.ts (chunks de ~800 tokens, garde headings)
   ↓ écrit les chunks dans `legal_chunks_staging` (job_id)
   ↓ embedding text-embedding-3-small (1536d) via Lovable AI Gateway
   ↓ écrit `embedding` (vector) dans staging
   ↓ trace dans `ingestion_jobs` (status: pending → running → completed/failed)
   ↓ erreurs détaillées → `ingestion_errors`
[promote_ingestion_job(job_id)] (RPC SECURITY DEFINER)
   ↓ DELETE legal_chunks WHERE source_id = X
   ↓ INSERT legal_chunks SELECT * FROM staging
   ↓ DELETE staging WHERE job_id = X
   ↓ UPDATE ingestion_jobs SET status='completed'
```

### 4.3 Format de stockage final

**Table `legal_sources`** (1 row par texte juridique) :
- `title`, `source_type` (`code`, `convention`, `jurisprudence`, `modele`), `idcc`, `reference_code` (ex. « L1234-5 »), `official_url`, `authority_level` (1=Constitution → 6=doctrine), `is_active`, `last_synced_at`, `metadata` jsonb.

**Table `legal_chunks`** (N rows par source, 1 par segment) :
- `source_id`, `chunk_index`, `heading`, `content` (texte brut français), `embedding` vector(1536), `fts` tsvector (généré), `metadata`.

**Index** : ivfflat/hnsw sur `embedding`, GIN sur `fts`.

### 4.4 Lecture (RAG) — comment l'agent l'utilise

```
Question utilisateur
   ↓ embedQuery (text-embedding-3-small)
   ↓ RPC hybrid_search(query_embedding, query_text, idcc_filter, match_count=6)
       • vector search : top-K cosine
       • FTS search : websearch_to_tsquery('french', …)
       • fusion RRF (k=60)
       • multiplicateur d'autorité (×1.5 si Constitution, ×0.85 si doctrine)
   ↓ filtrage minScore + top 6
   ↓ injection dans le prompt système avec [source:N]
   ↓ refus si 0 source → message « pas de source officielle »
```

Helper centralisé : `src/server/_shared/legal-rag.server.ts`. **Toute génération doit passer par lui** (Core rule respectée).

Cache d'embedding : `embedding_cache` (clé = hash du texte) → évite de re-payer Lovable AI Gateway.

### 4.5 Veille juridique

```
[legal-watch-cron] (pg_cron, à activer)
   ↓ détecte changements (diff legal_article_versions)
   ↓ insère dans `legal_updates`
   ↓ si impact métier → `legal_alerts` (severity)
   ↓ trigger fanout_legal_alert_to_notifications → `notifications` user-by-user
   ↓ digest quotidien/hebdo via /api/public/hooks/digest
```

État actuel : 0 alerte, 0 update — cron probablement pas planifié dans `pg_cron`.

## 5. DÉCISIONS RECOMMANDÉES

### 5.1 À supprimer (code mort confirmé)
- `src/server/agent-validations.functions.ts`
- `src/server/chat.functions.ts`
- `src/components/app/MessageFeedback.tsx`
- `src/components/chat/SourcesPanel.tsx`
- `supabase/functions/legal-chat/`

### 5.2 À fusionner / clarifier UX
- **`/scan`** : fusionner avec l'upload Hero du dashboard. La page peut rester comme « scan multi-pages avancé », mais ajouter un CTA depuis dossier.
- **`/links`** : soit l'intégrer comme onglet du dossier (« Suggestions IA »), soit la cacher tant que le pipeline ne génère pas de suggestions.
- **`/analyses`** : ajouter un lien depuis chaque ligne dossier (colonne « voir analyse »).

### 5.3 À ajouter (logique manquante)
1. **`logTimelineEvent`** systématique dans `analysis.functions.ts`, `documents.functions.ts`, `generation.functions.ts` (manquements détectés).
2. **Bouton « Lancer l'ingestion »** dans `/admin/legal-sources` qui appelle `ingest-legal-source` pour chaque IDCC actif (priorité : sans cela le RAG est aveugle).
3. **Activation `pg_cron`** pour `legal-watch-cron` (1×/jour).
4. **Onglet « Activité » sur `/dossiers/$id`** branché sur `case_timeline_events` (déjà existant `Dossier360Tabs.tsx`, mais à vérifier).

### 5.4 Sécurité
- `REVOKE EXECUTE … FROM PUBLIC` sur les 22 fonctions `SECURITY DEFINER` warned (script à générer).
- Activer Leaked Password Protection.
- Déplacer `pgvector` hors `public`.

### 5.5 UX dossier client (réponse à ta question)
- Le dossier **est consultable** : `/dossiers/$id` rend `Dossier360Tabs.tsx` (1409+ lignes) avec onglets : Vue, Documents, Échéances, Risques, Tâches, Activité, Collab, Workflows liés.
- **Manque** : pas encore de **portail client externe** (le client voit son dossier sans login JurisAI). Pas de table `client_portal_sessions`. À ajouter si besoin (lien magique signé).

### 5.6 Upload de document (réponse)
- Hero dashboard : drag-drop → `runOcrDocument` (server fn) → edge `ocr-document` → texte + `document_analyses` + `entity_mentions` + `extracted_fields`.
- Ajout d'un **nouveau modèle de document** dans la BD : table `document_templates` (champs `body` HTML avec `{{variables}}`, `prefill_sources` jsonb, `is_public`, `tenant_id`). UI : `/templates` (CRUD basique présent).
- Ajout d'une **nouvelle procédure** : table `workflow_definitions` (JSON DSL des étapes). UI : `/workflows` (CRUD), édition fine sur `/workflows/$id`.

## 6. SCORE GLOBAL

| Domaine | État |
|---|---|
| Architecture multi-tenant | ✅ propre |
| Server fns vs edge fns | ✅ Core rule respectée à 95% |
| RAG | ⚠️ pipeline OK mais BD vide → refus systématique |
| Code mort | ⚠️ ~5 fichiers à supprimer |
| Sécurité Postgres | ⚠️ 22 GRANT à corriger |
| Timeline / traçabilité | ❌ sous-utilisée (1 event total) |
| Veille juridique | ❌ cron inactif |
| Portail client | ❌ inexistant |
