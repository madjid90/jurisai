# Phase 2 — Base de données juridique (RAG) — Ce qu'il reste

## État actuel
- ✅ Phase 1 (CRM, auth, multi-tenant, onboarding) terminée
- ✅ Chat IA basique branché sur Lovable AI Gateway (réponses **génériques**, sans sources réelles)
- ❌ Aucune base juridique en BDD → l'IA "invente" potentiellement les références
- ❌ Pas d'import de sources (Code du travail, JO, URSSAF, conventions)
- ❌ Pas d'admin pour gérer les sources

## Ce qu'on construit dans cette phase

### 1. Schéma BDD juridique (migration Supabase)
- `legal_sources` : métadonnées d'une source (titre, type, URL, IDCC, version, date)
- `legal_chunks` : segments de texte + embedding `vector(1536)` + recherche full-text
- `ingestion_jobs` : suivi des imports (statut, erreurs, nb chunks)
- `chat_citations` : lien message ↔ chunks utilisés (traçabilité)
- Fonction SQL `hybrid_search(query_embedding, query_text, idcc_filter, limit)` → fusion vectoriel + BM25 (RRF)
- Activer extension `pgvector`
- RLS : lecture publique authentifiée sur `legal_sources` / `legal_chunks` ; écriture réservée `super_admin`

### 2. Rôle plateforme `super_admin`
- Ajout valeur `super_admin` à l'enum `app_role`
- Helper `is_super_admin(user_id)` (SECURITY DEFINER)
- Marquer `demo@jurisai.test` comme super_admin (à confirmer ou changer d'email)

### 3. Edge function `ingest-legal-source`
- Input : URL ou texte brut + métadonnées
- Pipeline : fetch → nettoyage HTML → chunking (~800 tokens, overlap 100) → embedding via Lovable AI Gateway (`text-embedding-3-small`) → insertion `legal_chunks`
- Suivi dans `ingestion_jobs`

### 4. Seed initial (~30 articles)
- Articles clés du Code du travail (L1221, L1234, L3121, L3141, L1232 à L1237, etc.)
- Script `db/phase2_seed_legal.sql` ou edge function dédiée

### 5. Refonte de `legal-chat` → mode RAG
- Embedder la question utilisateur
- Appeler `hybrid_search` (top 8 chunks, filtré par IDCC du tenant si défini)
- Injecter les chunks dans le system prompt comme **contexte autoritatif**
- Forcer le LLM à citer `[source:N]` → résolu en vraies références côté UI
- Persister les chunks utilisés dans `chat_citations`

### 6. UI — Panneau "Sources" dans le chat
- Sous chaque réponse IA : liste des sources utilisées (titre + lien officiel + extrait)
- Badge "Réponse sourcée" vs "Réponse générale"

### 7. Back-office `/admin/legal-sources` (super_admin only)
- Liste des sources avec filtres (type, IDCC, date)
- Bouton "Importer une URL" (Légifrance, JO, URSSAF…)
- Suivi des `ingestion_jobs` en temps réel
- Stats : nb chunks, dernière mise à jour, top sources citées
- Route `/admin` protégée par garde `requireSuperAdmin`

## Ce qu'on NE fait PAS dans cette phase (reporté)
- Import RSS automatique (JO, URSSAF) → Phase 2.5 si besoin
- Veille juridique programmée (cron hebdo)
- Comparaison de versions d'articles
- Phase 3 (analyse de documents avancée, génération de contrats, signature) → après

## Détails techniques

**Stack** : Supabase (pgvector + tsvector), Lovable AI Gateway pour embeddings + LLM, TanStack Start pour l'admin UI.

**Fichiers créés/modifiés** :
- `supabase/migrations/<timestamp>_phase2_rag.sql` — schéma + RLS + `hybrid_search`
- `supabase/functions/ingest-legal-source/index.ts` — pipeline d'ingestion
- `supabase/functions/legal-chat/index.ts` — refonte RAG
- `supabase/functions/seed-legal/index.ts` — seed initial du Code du travail
- `src/server/admin.functions.ts` — server fns admin (list/create/delete sources)
- `src/routes/_authenticated/admin/legal-sources.tsx` — UI back-office
- `src/lib/auth/requireSuperAdmin.ts` — garde de route
- `src/components/chat/SourcesPanel.tsx` — affichage des citations

**Coût estimé** : embedding ~30 articles × 4 chunks ≈ 120 embeddings (négligeable). Chaque question utilisateur = 1 embedding + 1 LLM call.

## Questions avant de coder
1. **Email super_admin** : on garde `demo@jurisai.test` ou tu m'en donnes un autre ?
2. **Périmètre du seed initial** : Code du travail uniquement (~30 articles) ou on ajoute aussi quelques articles URSSAF / RGPD RH ?
3. **Conventions collectives** : on prévoit le filtrage par IDCC dès cette phase (recommandé) ou on simplifie pour l'instant ?
