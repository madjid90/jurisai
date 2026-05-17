# JurisAI — Contexte projet permanent

> **Lis ce fichier EN PREMIER à chaque nouvelle session.** Il contient tout ce qu'il faut savoir pour reprendre le travail sans qu'on te ré-explique. Mets-le à jour quand un point change.

---

## 1. Vision produit

**JurisAI = le service juridique et RH interne que les PME n'ont pas les moyens de s'offrir.**

### Cibles client
- PME / PMI (5 à 250 salariés)
- DRH, dirigeants, experts-comptables (multi-clients)
- Cabinets d'avocats juniors (assistance documentaire)

### Positionnement
- **Pas** un moteur de recherche juridique (Doctrine, Lexbase, Dalloz)
- **Pas** une marketplace d'avocats (Captain Contrat, GoLegal)
- **OUI** un **assistant agentique** qui raisonne, agit, et trace
- Forces uniques : RAG hybride, agent avec 18 outils, calculateur d'indemnités multi-motif, workflows générés par LLM, syllogisme IRAC en construction (LRE)

### Promesse
- Réponse juridique sourcée en < 10s
- Calculs paie/indemnités à jour automatiquement (CDTN, INSEE, Legifrance, BOSS, BOFIP)
- Validation hiérarchique pour actions sensibles (licenciement, mise en demeure…)
- Audit trail immuable

---

## 2. Stack technique

| Couche | Techno | Notes |
|---|---|---|
| Front | React 18 + TanStack Router + TanStack Start | Routes file-based dans `src/routes/` |
| Backend | Server functions TanStack (Node, pas edge) | `src/server/*.functions.ts` |
| DB | Supabase Postgres 17 + pgvector | Projet : `yuvysjsyumxpekzvlzsx` |
| Edge functions | Supabase Functions (Deno) | Pour connecteurs RAG, ingestion, eval |
| Déploiement | Cloudflare Workers via Lovable Cloud | `wrangler.jsonc` |
| Auth | Supabase Auth (JWT JWKS) | `requireSupabaseAuth` middleware |
| LLM | OpenAI direct OU Lovable Gateway | Configurable via `OPENAI_BASE_URL` |
| Tests | Vitest | 77 tests dans `src/server/_shared/__tests__/` |
| Style | Tailwind v4 + shadcn/ui + lucide-react | Tokens custom CSS (`--shadow-glow`, `glass-panel`, `mesh-bg`) |

### Conventions code
- **Commentaires en français** dans le code
- **`*.server.ts`** = strictement server-only, jamais importé côté client
- **`*.functions.ts`** = server functions exposées au client via TanStack
- **`as any` à éviter** mais toléré sur les jsonb fields (chantier de fond, 123 occurrences au 17/05/2026)
- **Fail-closed** sur rate limit + auth + sanitize (ne JAMAIS fail-open silently)
- **Append-only** pour les tables audit (`calculation_history`, `legal_reasoning_traces`, `agent_post_checks`)
- **RLS partout** + `is_member_of_tenant(auth.uid(), tenant_id)` pour multi-tenant
- **`SET search_path TO 'public'`** sur toute function SECURITY DEFINER
- **Commit après chaque bloc** : 1 commit = 1 problème résolu, jamais de mega-commits
- **Pas d'emojis dans le code** sauf si user en demande explicitement

---

## 3. Architecture Agent

### Pipeline unifié (depuis fusion UI du 16/05)
- `/chat` = seule entrée IA (style ChatGPT/Claude)
- `/dashboard` = read-only KPI + dossiers + échéances
- `/agent` `/mes-demandes` → redirect vers `/chat`

### 18 outils agent (`src/server/_shared/agent-tools-config.server.ts`)
1. `search_law` (RAG hybride sources juridiques)
2. `dossier_context`
3. `identify_risk`
4. `propose_document`
5. `request_validation`
6. `schedule_reminder`
7. `create_task` / `update_task`
8. `create_deadline`
9. `search_dossier` / `create_dossier`
10. `start_workflow` / `run_workflow_step` / `generate_workflow`
11. `analyze_document`
12. `generate_report`
13. `compare_contracts` (LLM diff sémantique)
14. `calculate_indemnity` (rupture multi-motif + principe de faveur)

Routés dans `src/server/_shared/agent-tool-router.server.ts`.
Loop agentique : `src/server/_shared/agent-loop.server.ts` (6 rounds max, parallèle).

### Intent actions (10)
`redaction_document`, `lancer_procedure`, `analyse_document`, `analyse_contrat`, `recherche_dossier`, `gestion_dossier`, `chiffrage`, `reclamation`, `suivi_echeance`, `conformite`.

Routés dans `src/server/_shared/agent-intent-actions.server.ts`.

### Post-response pipeline (garde-fous algorithmiques)
1. Détection règle métier sensible (`pickBusinessRule`)
2. Vérification missing_information
3. **Création AUTO `validation_requests` si sensible** (fix audit du 17/05 — avant 0 row malgré 14 runs)
4. `rememberMemory` (last_topic par dossier)
5. `logTimelineEvent`

---

## 4. RAG juridique

### Corpus (`legal_chunks` : 189 816 chunks, 100% embeddés)
| Type | Volume | Couverture |
|---|---|---|
| jurisprudence | 91 115 | excellente |
| convention_article | 64 915 | 50 conventions / 470 IDCC FR (~11%) |
| doctrine_fiscale | 18 610 | BOFIP |
| code_article | 9 513 | 17 codes |
| accord_entreprise | 4 639 | API ACCO |
| fiche_service_public | 585 | |
| fiche_ministere_travail | 339 | |
| modele_courrier | 100 | |

### Lacunes connues (à combler)
- **RGPD** : 9 chunks (CNIL jamais ingéré)
- **Sociétés (SAS/SARL)** : 12 chunks (pas de Code de commerce complet)
- **Pénal** : 165
- **Commercial** : 242

### Pipeline retrieval
- `hybrid_search` RPC plpgsql (RRF + boost authority_level + tsquery précalculé)
- `hybrid_search_typed` (nouveau LRE) avec `source_types[]` + `date_at` (filtre temporel inclusif NULL)
- MMR rerank (`legal-rag.server.ts`, λ=0.7, pénalité de type)
- Multi-query expansion opt-in (`multi-query-rag.server.ts`)
- Perf : **155 ms en cache chaud**, 1-5s en cache froid (HNSW index)

### Connecteurs (`supabase/functions/connector-*`)
- `legifrance-full` : 17 codes (PISTE OAuth)
- `judilibre-full` : Cour de cassation
- `kali-full` : conventions collectives
- `acco-full` : accords entreprise (date dans PDF, non parsée)
- `bofip-full` : doctrine fiscale
- `cdtn-fiches` / `cdtn-modeles` : ministère travail
- `cnil-full`, `jade-full`, `dole-full`, `cdtn-contributions-full` : **jamais lancés** (à déclencher via `/admin/connectors`)

---

## 5. Sources externes (auto-update barèmes)

| Source | API | Couvre |
|---|---|---|
| **CDTN** | `api.code.travail.gouv.fr` (JSON, no-auth) | SMIC, indemnité légale |
| **INSEE BDM** | `api.insee.fr` (SDMX) | ICC, IRL, ILAT, ILC, ICHT-TS |
| **Legifrance** | `api.piste.gouv.fr` (OAuth) | PSS, aide apprenti, JORF décrets |
| **BOSS** | `boss.gouv.fr` (HTML scrape + LLM extract) | Coef T Fillon, forfait social, LODEOM |
| **BOFIP/CGI** | via Legifrance `/consult/getArticle` | IS 25%/15%, TVA 20/10/5,5/2,1% |

### Orchestration
- Cron mensuel `jurisai-baremes-monthly` (1er du mois 04:00 UTC)
- Hook : `/api/public/hooks/baremes-orchestrator`
- 5 connecteurs lancés en parallèle (Promise.all)
- Propositions → `bareme_update_log` avec `verified=false`
- Admin valide via `/admin/baremes` → `updateReferenceValue`

---

## 6. Crons actifs (10 jobs pg_cron)

| Job | Schedule | Hook |
|---|---|---|
| `jurisai-digest-daily` | 07:00 | digest |
| `jurisai-digest-weekly` | Lun 07:00 | digest |
| `jurisai-orchestrator-tick` | */10 min | orchestrator-tick |
| `dispatch-reminders-every-10min` | */10 min | dispatch-reminders |
| `contract-deadlines-daily` | 06:00 | contract-deadlines |
| `jurisai-legal-watch-daily` | 06:05 | legal-watch |
| `jurisai-agent-recovery-tick` | */5 min | agent-recovery-tick |
| `jurisai-baremes-monthly` | 1er du mois 04:00 | baremes-orchestrator |
| `jurisai-gdpr-retention-purge` | Dim 03:00 | gdpr-retention-purge |

Auth cron : `x-cron-secret` header, vérifié par `verifyCronAuth`.

---

## 7. Accès en place (ce que je peux faire)

### MCP / API
- **Supabase MCP** (`yuvysjsyumxpekzvlzsx`) : SELECT, INSERT, migrations, edge functions deploy, get_advisors, list_tables, etc.
- **GitHub** : repo `madjid90/jurisai` branch `main`, je commit + push après chaque bloc
- **Lovable Cloud Secrets** : 7 clés stockées server-side (OPENAI_API_KEY, LOVABLE_API_KEY, SUPABASE_SERVICE_ROLE_KEY, JURISAI_SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, LEGIFRANCE_OAUTH_ID, LEGIFRANCE_OAUTH_SECRET, PISTE_API_KEY)

### Code
- Lecture/écriture sur tout le repo `/Users/souci/Desktop/juriste ai /jurisai`
- Tests Vitest (77 tests passent)
- TS check (`npx tsc --noEmit --skipLibCheck`)

### ⚠️ Ce que je NE peux PAS faire
- Pas d'accès direct au **dashboard Lovable Cloud** (env vars exactes, autre projet Supabase, etc.)
- Pas d'accès au **terminal du user** (je code, le user déploie via Lovable preview)
- Pas de **clé Stripe / Yousign** (intégrations volontairement reportées)

---

## 8. État actuel (au 17/05/2026)

### Livré
- ✅ **Sprint 1** : Fusion UI + comparateur contrats + démo landing + onboarding tour + veille active (commit `4b90b98`)
- ✅ **Audit 6 critiques résolus** : SMIC/PSS 2026, Macron TPE, RLS calculation_history, hybrid_search ×167, watchdog, circuit breaker (commit `75f3f72`)
- ✅ **Auto-update barèmes 5 connecteurs** : CDTN, INSEE, Legifrance, BOFIP, BOSS (commit `921026e`)
- ✅ **LRE Vague 0 prep** : 100% legal_date, UI eval-cases, hybrid_search tsquery (commit `a785e12`)
- ✅ **LRE Vague 1 Foundation** : `legal_normative_hierarchy` + `legal_reasoning_traces` + `hybrid_search_typed` + Zod schemas + Sentry + 77 tests + érosion `as any` 175→123 (commit `4b90b98`)
- ✅ **6 bugs critiques d'auth** : onboarding crash, admin cache, déconnexions, JWT regex, fetchProfile, signup→/onboarding (commits `5baff60` + `555a5ff` + `5d76619` + `7941bb5`)
- ✅ **getTenantId V2 RPC SECURITY DEFINER** : bypass RLS quand SUPABASE_SERVICE_ROLE_KEY = anon key sur Lovable (commit `b8f7b35`)
- ✅ **RPCs SECURITY DEFINER bypass RLS** : `insert_agent_run`, `lock_agent_run` + GRANT authenticated sur RPCs critiques. Rate-limit fail-OPEN au lieu de fail-CLOSED. (commits `3a3aec6`, `4a28672`, `811e034`)
- ✅ **DEFAULT_CHAT_MODEL = gpt-4o-mini** + tenant.chat_model forcé (avant google/gemini-2.5-flash → 400 OpenAI direct) (commit `0bac91e`)
- ✅ **404 /_authenticated/chat** : ajout `to: "/chat"` explicite dans 4 navigate() (commit `f175c9a`)
- ✅ **Chat fonctionnel end-to-end** : pipeline complet marche (createAgentRun → process → execute → réponse affichée)

### Notes par dimension (au 17/05)
| Dimension | Score |
|---|---|
| DB | 9/10 |
| Sécurité | 8,5/10 |
| Agent 360 | 8/10 |
| RAG | 7,5/10 |
| UX | 7/10 |
| TypeScript | 7/10 |
| Tests | 7/10 |
| **Moyenne** | **~7,8/10** |

### En cours
- ⏳ **LRE Vague 2** : Pass 1 qualification + Pass 2 retrieval stratifié
- ⏳ **LRE Vague 3** : Pass 3 syllogisme + Pass 4 vérifications (3 niveaux exact/normalized/fuzzy)
- ⏳ **LRE Vague 4** : intégration agent + script enrich-eval-cases + UI traces

### Reporté
- ⏸ **Stripe** (volonté user)
- ⏸ **Yousign + export DOCX** (volonté user)
- ⏸ **Split `chat.tsx` (1972 lignes)** : session dédiée (risque de régression élevé, tests d'intégration à écrire avant)
- ⏸ **Refactor 123 `as any` restants** : par cas, jsonb fields → typer manuellement
- ⏸ **Refonte UI design system** : tokens spacings/radius/colors unifiés
- ⏸ **`react-hook-form` + zod côté client** : actuellement tout hand-rolled

---

## 9. Règles d'or à respecter

### Pour le LRE (Legal Reasoning Engine)
1. **JAMAIS hardcoder de règle juridique** dans un prompt — tout vient du RAG live
2. **Citation `verbatim`** obligatoire dans Pass 3 — Pass 4 fait exact-match déterministe
3. **Filtre temporel inclusif des NULL** — sinon on ampute 60% du corpus
4. **Citation 3 niveaux** : exact / normalized / fuzzy (pas que strict `includes()`)
5. **Hiérarchie normative** : loi avant convention avant jurisprudence (toujours)
6. **Principe de faveur** : algo automatique si branche=social + conv ≠ légal
7. **Aucun cas d'eval inventé** — enrichissement validé par user dans `/admin/eval-cases`

### Pour les fixes
1. **Demande confirmation** avant gros refactor (>5 fichiers ou file >500 lignes)
2. **Commit après chaque bloc** logique, push immédiat
3. **TS check + tests** avant chaque commit
4. **Migration Supabase appliquée via MCP** + référence Git dans `supabase/migrations/`
5. **Pas de `console.warn` silencieux** — utiliser `logErr` helper
6. **Pas de `signOut()` automatique** sur erreur transitoire (cause #1 de churn)

### Pour la sécu
1. **Toujours `requireSupabaseAuth`** sur server fn
2. **Toujours `enforceRateLimit`** sur fn coûteuse LLM
3. **Toujours `sanitizePromptInput`** sur user input → prompt LLM
4. **`verifyCronAuth`** sur tous les hooks `/api/public/hooks/*`
5. **Garde-fou algorithmique > LLM-as-judge** (déterministe, testable)

---

## 10. Faux positifs à éviter (choses déjà essayées qui marchent pas)

| Tentative | Raison de l'échec | Alternative |
|---|---|---|
| LRE 8-phases adversarial (thèse/antithèse/arbitre) | Coût ×3, latence ×6, hallucination des objections | IRAC 3-pass + citation verbatim |
| Cosine similarity pour citation grounding | Faux positifs sur paraphrases | Exact-match 3 niveaux (exact/normalized/fuzzy) |
| Sweep agressif `(supabaseAdmin as any)` → `supabaseAdmin` | 32 erreurs TS sur jsonb fields | Refactor par fichier, par cas |
| `supabaseAdmin.auth.admin.updateUserById` pour user_metadata | "User not allowed" si SERVICE_ROLE = anon key | Colonne dédiée dans `profiles` |
| `signOut()` automatique sur `!profile` | Cause #1 des déconnexions intempestives | Loader + 3 retries fetchProfile |
| Regex `/exp/` pour détecter JWT expired | Matche "expect", "experiment" → faux positifs | Patterns stricts (`jwt expired`, `"exp" claim`...) |
| SELECT direct dans `getTenantId` côté server | RLS bloque silencieusement quand SERVICE_ROLE = anon | RPC `get_user_tenant_id` SECURITY DEFINER en premier |
| `navigate({ search: ... })` sans `to:` explicite | TanStack utilise `from:` comme path → `/_authenticated/chat?run=...` → 404 | Toujours fournir `to: "/chat"` explicite |
| `DEFAULT_CHAT_MODEL = "google/gemini-2.5-flash"` | Format Lovable Gateway only — OpenAI direct renvoie 400 invalid_model | `gpt-4o-mini` qui marche partout |
| Rate-limit fail-CLOSED (throw si RPC indisponible) | Bloque TOUT le produit dès que check_rate_limit fail | Fail-OPEN avec log warn |

## 13. Pattern critique : Lovable Cloud + Supabase RLS

**Constat majeur de la session du 17/05** : `SUPABASE_SERVICE_ROLE_KEY` sur Lovable Cloud peut être en réalité une `anon` key (impossible à modifier pour certains projets). Conséquence : `supabaseAdmin` n'a pas le pouvoir de bypass RLS.

**Pattern de fix recommandé pour CHAQUE opération bloquée par RLS** :
1. Créer une RPC `public.<operation>_secdef(...)` en `SECURITY DEFINER + SET search_path TO 'public'`
2. Garde-fou SQL : vérifier `user_roles` ou `auth.uid()` avant l'opération
3. `GRANT EXECUTE ... TO authenticated, service_role`
4. Modifier le code TS pour appeler la RPC via `supabaseAdmin.rpc()` au lieu de `.from().insert()/.update()`

**Fichier consolidé** : `docs/MIGRATIONS-CRITIQUES.sql` contient toutes les RPCs et peut être exécuté sur un autre projet Supabase si Lovable utilise une instance différente.

**Liste des RPCs créées à cette date** (15/05/2026) :
- `get_user_tenant_id(uuid)` → bypass RLS profiles
- `insert_agent_run(uuid, uuid, text, ...)` → bypass RLS agent_runs INSERT
- `lock_agent_run(uuid, uuid, uuid)` → bypass RLS agent_runs UPDATE+SELECT atomique
- Si nouvelle table → créer RPC équivalente, **ne pas chercher à faire un refactor user-scoped massif** (trop risqué)

---

## 11. Workflow attendu pour les nouvelles sessions

1. **Au démarrage** : je lis `CLAUDE.md` → qui pointe vers ce fichier → je suis à jour
2. **Si gros chantier proposé** : je propose un plan avant de coder
3. **Si nouveau bug** : je vérifie d'abord (SQL via MCP, grep code) avant de fixer
4. **Si refactor** : je demande confirmation, j'écris des tests avant si possible
5. **Après chaque bloc** : commit + push + update du CONTEXT.md si appris quelque chose

---

## 12. Liens utiles

- **Repo** : https://github.com/madjid90/jurisai
- **Supabase** : projet `yuvysjsyumxpekzvlzsx` (région eu-central-1)
- **Plan LRE détaillé** : [`docs/LRE-IRAC-PLAN.md`](./LRE-IRAC-PLAN.md)
- **Audit V3 trouvailles** : voir commits du 17/05 (`audit-360`)

---

*Dernière mise à jour : 17/05/2026 — fin de la session "fix bugs auth + LRE Vague 1".*
*Mettre à jour les sections §8 et §10 à chaque session significative.*
