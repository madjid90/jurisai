# AUDIT PRODUCTION V6 — JurisAI
## Audit complet pré-production (hors Stripe/Email)
### Date : 14 mai 2026

---

## SCORE GLOBAL : 72/100 (pas prêt pour production)

| Domaine | Score | Blockers |
|---------|-------|----------|
| Base de données / RLS | 55/100 | 🔴 6 tables sans RLS, 4 tables hors migrations |
| Sécurité serveur | 65/100 | 🔴 Rate limit manquant sur pipeline async |
| Agent 360 pipeline | 60/100 | 🔴 Pas de lock concurrence, post-checks absents |
| RAG / Recherche | 70/100 | 🟡 Pas de seuil minimum, pas de synonymes |
| Frontend / UI | 75/100 | 🔴 Mentions légales incomplètes, pas de CGV |
| Code quality | 78/100 | 🟡 130 `as any`, logging inconsistant |

---

## 🔴 BLOCKERS PRODUCTION (17 issues critiques)

### A. Base de données (6 issues)

**A1. 6 tables calculateur SANS RLS** ⭐ CRITIQUE
- `reference_values`, `macron_scale`, `indemnity_formulas`, `convention_indemnity_scales`, `prescription_periods`, `bareme_update_log`
- Impact : n'importe qui avec la clé anon peut lire/écrire/supprimer les barèmes légaux
- Fichier : `supabase/migrations/20260514100000_indemnity_calculator_tables.sql`

**A2. 4 tables core absentes des migrations** ⭐ CRITIQUE
- `profiles`, `tenants`, `user_roles`, `invitations` — créées via Dashboard, pas de version control
- Impact : impossible de reproduire la DB depuis les migrations seules

**A3. `has_role()` function absente des migrations** ⭐ CRITIQUE
- Utilisée par 120+ politiques RLS mais jamais définie dans les migrations
- Impact : fresh deploy = toutes les RLS cassées

**A4. `match_workflow_definitions` RPC manquant** 🟡 MOYEN
- Appelé dans `workflow-generator-core.server.ts` mais jamais créé
- Impact : crash runtime lors de la génération de workflows

**A5. Types Supabase non régénérés** 🟡 MOYEN
- 7 nouvelles tables absentes de `types.ts`
- Impact : zéro type safety sur le module calculateur

**A6. `source_type` CHECK constraint obsolète** 🟡 MOYEN
- Constraint autorise 8 types mais 30+ types existent dans `authority_level` mapping
- Impact : insertion de nouvelles sources peut échouer silencieusement

### B. Sécurité serveur (4 issues)

**B1. Aucun rate limit sur le pipeline async agent** ⭐ CRITIQUE
- `createAgentRun`, `processAgentRun`, `executeAgentRun` — 0 rate limit
- Impact : un utilisateur peut épuiser le quota IA en boucle
- Fichier : `src/server/agent-runs.functions.ts`

**B2. Aucun rate limit sur OCR et workflow generator** 🟡 MOYEN
- `runOcrDocument`, `generateWorkflow` — appels LLM sans limite
- Fichiers : `src/server/ocr.functions.ts`, `src/server/workflow-generator.functions.ts`

**B3. Queries sans `.limit()` — memory bomb** 🟡 MOYEN
- `listClients` : `select("*")` sans limit — tenant avec 10k clients = crash
- `listChildRuns` : charge tous les runs enfants avec blobs JSONB
- `listAllTenants` : 500 tenants sans admin role gate
- Fichier : `src/server/crm.functions.ts`

**B4. Erreurs Supabase brutes transmises au client** 🟡 MOYEN
- `crm.functions.ts`, `collaboration.functions.ts`, `dossier360.functions.ts` : zéro try/catch
- Impact : noms de tables/colonnes leakés dans les erreurs

### C. Agent pipeline (4 issues)

**C1. `executeAgentRun` sans lock de concurrence** ⭐ CRITIQUE
- SELECT status=ready → proceed, mais pas de lock atomique
- Impact : double exécution LLM, documents dupliqués, workflows dupliqués
- Fix : `UPDATE agent_runs SET status='executing' WHERE id=$1 AND status='ready' RETURNING *`
- Fichier : `src/server/agent-runs.functions.ts`, lignes 720-738

**C2. Post-response pipeline jamais appelé en async** ⭐ CRITIQUE
- `runPostResponsePipeline()` appelé uniquement dans le legacy pipeline
- Impact : business rules, détection d'infos manquantes, enrichissement mémoire — tout sauté
- Fichier : `src/server/agent-runs.functions.ts`, manquant après ligne 887

**C3. Watchdog sans compteur de retry** 🟡 MOYEN
- `recoverStuckRuns` remet en `pending` sans limite
- Impact : un run qui crash en boucle = boucle infinie
- Fichier : `src/server/agent-runs.functions.ts`, lignes 659-680

**C4. Pas de timeout sur le fetch LLM** 🟡 MOYEN
- `llmFetch` appelé sans AbortController dans `executeAgentRun`
- Impact : hang indéfini si le gateway IA ne répond pas
- Fichier : `src/server/_shared/agent-loop.server.ts`

### D. RAG / Recherche (3 issues)

**D1. Aucun seuil minimum de pertinence** ⭐ CRITIQUE
- `minScore` default à 0 partout — résultats non pertinents injectés dans le contexte LLM
- Impact : réponses juridiques basées sur des sources non pertinentes = dangereux
- Fix : minScore ~0.005 pour les scores RRF
- Fichier : `src/server/_shared/legal-rag.server.ts`

**D2. Pas d'expansion de requêtes ni de synonymes** 🟡 HAUT
- `multi-query-rag.server.ts` EXISTE mais n'est PAS branché sur `searchLaw` ni `legal-chat`
- "licenciement" ne matchera pas "rupture du contrat de travail"
- Impact : qualité de recherche dégradée

**D3. Dual implémentation embedding (Node vs Deno)** 🟡 MOYEN
- Serveur : 3 retries avec backoff. Edge function : 0 retry
- Impact : RAG vide si embedding échoue côté edge function

### E. Frontend / Légal (3 issues)

**E1. Mentions légales avec données placeholder** ⭐ CRITIQUE
- Siège social, SIRET, RCS, capital = "à compléter"
- Impact : violation Article 6 LCEN — amende DGCCRF
- Fichier : `src/routes/mentions-legales.tsx`

**E2. Pas de page CGV** ⭐ CRITIQUE
- CGU existe mais CGV obligatoires pour un SaaS payant en France
- Impact : violation légale, pas de cadre contractuel

**E3. CGU non cliquables sur la page signup** 🟡 HAUT
- Texte "vous acceptez nos CGU" mais pas de lien <Link> vers /cgu
- Fichier : `src/routes/signup.tsx`, ligne 100

---

## 🟡 ISSUES MOYENNES (14 issues)

### Frontend
- F1. 10 routes sans `<title>` meta (agent, notifications, pages admin)
- F2. Message d'erreur global en anglais ("Something went wrong")
- F3. Pas de menu mobile sur le header public (nav hidden md:flex)
- F4. Pas d'error boundary par route (erreur = écran global)
- F5. Cookie banner sans bouton "Refuser" (guidelines CNIL)

### Code qualité
- Q1. `captureServerError` utilisé dans 2/25 fichiers seulement
- Q2. 130 casts `as any` sur les requêtes Supabase — zéro type safety DB
- Q3. Pas de logging structuré (console.error brut sans userId/tenantId)
- Q4. Pas de validation env vars au démarrage (erreurs au runtime seulement)
- Q5. `LOVABLE_API_KEY ?? ""` — proceed silencieusement avec clé vide

### Agent
- AG1. Réponse vide sauvée comme "executed" sans contenu
- AG2. Pas de limite de taille du contexte conversation (overflow possible)
- AG3. `archiveAgentRun` peut archiver un run en cours d'exécution
- AG4. Mémoires expirées toujours rappelées (`expires_at` jamais vérifié)

### RAG
- R1. Cache embeddings sans TTL/éviction (croît indéfiniment)
- R2. Pas de monitoring des chunks sans embedding (trous silencieux)
- R3. Modèle chat hardcodé dans edge function (ignore tenant.chat_model)

---

## ⚪ ISSUES MINEURES (8 issues)

- Chat page `h-[calc(100vh-7rem)]` fragile sur certains viewports
- Skip-to-content cible le wrapper et pas le main
- Page veille avec types `any` extensifs
- Trust score formula saturée (toujours haut quand chunks existent)
- History summary peut échouer silencieusement
- Hard truncation embedding 30k chars sans warning
- Promise.race timeout ne cancel pas le tool call
- Fuzzy matching trop strict pour questions à 1 mot

---

## 📋 PLAN DE FIX — Ordre de priorité

### Sprint 1 : Blockers sécurité + DB (2-3 jours)
```
□ A1 — Ajouter RLS sur 6 tables calculateur
□ A2 — Migration pour profiles, tenants, user_roles, invitations
□ A3 — Migration pour has_role() function
□ B1 — Rate limit sur createAgentRun, processAgentRun, executeAgentRun
□ C1 — Lock atomique sur executeAgentRun
□ D1 — minScore > 0 sur hybrid_search
```

### Sprint 2 : Blockers légaux + agent (2-3 jours)
```
□ E1 — Compléter mentions légales (données réelles)
□ E2 — Créer page CGV
□ E3 — Lien cliquable CGU sur signup
□ C2 — Appeler runPostResponsePipeline dans executeAgentRun
□ B3 — Ajouter .limit() sur toutes les queries sans limite
□ B4 — Wraper try/catch sur crm, collaboration, dossier360
```

### Sprint 3 : Qualité RAG + robustesse (3-4 jours)
```
□ D2 — Brancher multi-query-rag sur searchLaw et legal-chat
□ C3 — Compteur retry sur watchdog (max 3)
□ C4 — AbortController timeout sur LLM fetch (60s)
□ AG1 — Rejeter les réponses vides (ne pas marquer executed)
□ A4 — Créer migration match_workflow_definitions
□ A5 — Régénérer types Supabase
```

### Sprint 4 : Polish (2-3 jours)
```
□ F1-F5 — Titres meta, erreur FR, menu mobile, error boundaries, cookie refuser
□ Q1-Q4 — captureServerError partout, logging structuré, env validation
□ R1-R3 — Cache TTL, monitoring embeddings, chat_model tenant
□ AG2-AG4 — Limite contexte, archive guard, memory expiry
```

---

## Estimation totale : 10-13 jours de travail

Après ces 4 sprints, le score passerait de **72/100 → 90+/100** et l'app serait production-ready (hors Stripe/Email).
