# 🔍 Audit complet — JurisAI

> Date : 2026-04-27 · Périmètre : code, BD, IA, sécurité, parcours utilisateur/admin, manquements MVP.

---

## 1. Architecture générale

| Couche | Technologie | État |
|---|---|---|
| Front | React 19 + TanStack Start v1 + Tailwind v4 | ✅ |
| Routing | TanStack Router (file-based) | ✅ |
| Auth | Supabase Auth (email + magic link) | ✅ |
| BD | Postgres + pgvector (1536) + tsvector FR | ✅ |
| IA | Lovable AI Gateway (`google/gemini-3-flash-preview`, `openai/text-embedding-3-small`) | ✅ |
| RAG | `hybrid_search` (RRF vector + BM25) filtré IDCC | ✅ |
| Connecteurs | Edge functions Deno : KALI, CDTN, Légifrance, Judilibre | ✅ |
| Multi-tenant | RLS via `is_member_of_tenant` / `has_role(tenant)` | ✅ |

---

## 2. Audit base de données

### 2.1 Tables critiques

| Table | Rôle | RLS | Remarques |
|---|---|---|---|
| `tenants` | Espace client | ✅ | Quota mensuel, IDCC |
| `profiles` | Profil utilisateur | ✅ | 1 tenant par user (mono-tenant côté UI) |
| `user_roles` | Rôles séparés (admin/manager/user/super_admin) | ✅ | Architecture sécurisée (pas dans profiles) |
| `conversations` / `messages` | Chat IA | ✅ | Messages immutables (pas d'UPDATE/DELETE) |
| `chat_citations` | Liaison message ↔ chunk | ✅ INSERT manquante | ⚠️ voir 4.2 |
| `legal_sources` / `legal_chunks` | Corpus RAG | ✅ super_admin write | Index HNSW manquant ? voir 2.3 |
| `conventions_collectives` | Catalogue IDCC (KALI) | ✅ | |
| `templates_public` | Modèles courriers | ✅ | |
| `documents` / `document_templates` | Génération documents | ✅ | |
| `dossiers` / `dossier_deadlines` / `clients` | CRM RH | ✅ | |
| `document_analyses` | Analyses fichiers | ✅ | |
| `ingestion_jobs` / `ingestion_errors` | Monitoring connecteurs | ✅ super_admin | |

### 2.2 Forces
- **RLS partout** sur les tables sensibles (membership tenant + rôles).
- **Fonctions SECURITY DEFINER** correctement scopées avec `SET search_path = public` (`has_role`, `is_member_of_tenant`, `is_super_admin`, `current_tenant_id`, `increment_questions_used`, `hybrid_search`).
- **Quota atomique** via `increment_questions_used` (FOR UPDATE).
- **Hybrid search** combine cosine + BM25 français avec Reciprocal Rank Fusion.

### 2.3 ⚠️ Points à corriger

1. **Index manquants pour `legal_chunks`** — Vérifier la présence de :
   - `HNSW (embedding vector_cosine_ops)` pour le vector search
   - `GIN (fts)` pour le full-text français
   - Sans ces index, `hybrid_search` fait un scan séquentiel → KO sur ~5 GB de données.

2. **`chat_citations` n'a pas de policy INSERT** — l'edge function `legal-chat` insère via service_role (donc OK), mais aucune autre route ne pourra écrire. C'est intentionnel mais à documenter.

3. **`profiles.tenant_id` peut être NULL** pendant l'onboarding → la policy `Members can view tenant profiles` filtre correctement, mais vérifier qu'aucun écran ne crash si `tenant_id=null`.

4. **Cascade de suppression manuelle** — `legal_chunks` n'a pas de FK CASCADE vers `legal_sources` (ajouté à la main dans `deleteLegalSource`). À transformer en FK SQL.

5. **`document_templates.tenant_id` nullable** — les templates publics (`tenant_id IS NULL`) sont visibles via `is_public=true`. OK mais policy `Admins delete tenant templates` empêche la suppression des templates publics — souhaité.

---

## 3. Audit sécurité

### 3.1 ✅ Bonnes pratiques en place
- Service role key **jamais exposé côté client** (utilisé uniquement dans `client.server.ts` et edge functions).
- Toutes les server functions admin → `assertSuperAdmin(userId)` côté serveur.
- Auth middleware `requireSupabaseAuth` sur toutes les server functions sensibles.
- Pas de `process.env` secret dans le bundle client.

### 3.2 ⚠️ À vérifier / améliorer
- **`verify_jwt = false`** dans `supabase/config.toml` pour les edge functions — chaque function vérifie l'auth manuellement. **Vérifier pour CHAQUE function** que le check JWT est bien fait avant tout side-effect.
- **Connecteurs `connector-*`** — actuellement appelés via `supabaseAdmin.functions.invoke()` depuis une server function admin. Le JWT du user n'est pas propagé → la function doit faire son propre check super_admin (à confirmer dans chaque connector).
- **Rate limiting absent** sur `/legal-chat` (au-delà du quota mensuel). Un user peut spammer 100 questions en 1 minute. À ajouter : limite N req/min par user.
- **Validation Zod absente** dans la plupart des server functions (validators basiques `(input) => input`). Risque d'injection de payloads malformés. **Recommandé : Zod sur toutes les inputs externes**.
- **CORS `*`** sur edge functions — OK pour edge mais à restreindre si appelées par d'autres origines.

### 3.3 🚨 Critique
- **Aucune policy DELETE sur `messages`** — historique conversationnel non purgeable (requis par RGPD si user demande effacement). À ajouter via cascade `conversations.user_id`.
- **`usage_logs` non insérable** par les users — l'edge function utilise service_role, OK. Mais aucune policy `INSERT` documentée → à clarifier.

---

## 4. Audit IA / RAG

### 4.1 Pipeline actuel
```
User question
  → embed (text-embedding-3-small, 1536d)
  → hybrid_search(idcc_filter=tenant.idcc, match_count=8)
  → top-K chunks injectés dans system prompt avec [source:N]
  → google/gemini-3-flash-preview (streaming SSE)
  → parse [source:N] → insert chat_citations
  → log usage_logs
```

### 4.2 ✅ Points forts
- **Sources officielles obligatoires** (prompt système strict).
- **Filtrage IDCC** : si le tenant a `idcc=1486`, seules les conventions de cette branche + sources non-IDCC remontent.
- **Citations cliquables** via `SourcesPanel.tsx` avec excerpt + lien officiel.
- **Streaming SSE** avec prelude `event: sources` → UX fluide.
- **Quota géré** avant appel IA (économie si dépassé).

### 4.3 ⚠️ Améliorations
1. **Pas de re-ranker** — `hybrid_search` retourne RRF brut. Ajouter un cross-encoder (ex: `cohere-rerank-multilingual-v3` via gateway) pour passer de 8→4 chunks pertinents.
2. **Chunking naïf** (`embeddings.ts`) — split par paragraphes 3200 chars. Pour le code juridique, mieux vaut splitter par article (`Article L\d+`).
3. **Pas de cache d'embeddings** — si même question posée 2x, on re-embed. Ajouter cache Redis/PG sur hash de la question.
4. **Pas d'évaluation** — aucun set de Q/A de référence pour mesurer la précision RAG. À créer (ex: 50 questions juristes RH → réponses validées).
5. **Hallucinations résiduelles** — le prompt impose `[source:N]` mais Gemini peut générer du texte sans citation. Ajouter un post-traitement qui détecte les paragraphes sans citation et les annote `⚠️ non sourcé`.
6. **Modèle unique** — `gemini-3-flash` est rapide mais peu précis pour du droit complexe. Proposer `gemini-3-pro` pour les plans Pro/Enterprise.

---

## 5. Audit credentials & secrets

| Secret | Présent | Usage |
|---|---|---|
| `LOVABLE_API_KEY` | ✅ managé | AI Gateway (chat + embeddings) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` | ✅ | Edge functions + server |
| `LEGIFRANCE_OAUTH_ID` | ❌ **À ajouter** | Connecteur Légifrance (PISTE) |
| `LEGIFRANCE_OAUTH_SECRET` | ❌ **À ajouter** | Connecteur Légifrance (PISTE) |
| `JUDILIBRE_KEY_ID` | ❌ **À ajouter** | Connecteur Judilibre (PISTE) |
| `PISTE_SANDBOX` | optionnel | `=1` pour environnement test PISTE |

**Action requise** : utiliser le tool `add_secret` pour ces 3 valeurs lorsque l'utilisateur les fournit.

---

## 6. Audit parcours utilisateur

### 6.1 Onboarding (✅ implémenté)
- `/signup` → email/password → auto `handle_new_user()` trigger crée `profiles`
- `/onboarding` → choix tenant (entreprise + IDCC + secteur) → marque `onboarded=true`
- Redirect vers `/dashboard`

### 6.2 Pages principales (✅ implémentées)
- `/dashboard` — tableau de bord
- `/chat` — assistant IA RAG ✅
- `/documents` + `/documents/$id` — éditeur documents
- `/analyses` + `/analyses/$id` — analyses fichiers
- `/dossiers` + `/dossiers/$id` — dossiers RH
- `/team` — gestion équipe + invitations
- `/settings` — paramètres tenant

### 6.3 ⚠️ Manquements UX
1. **Pas de page Veille juridique** (badge "bientôt" dans la sidebar).
2. **Pas de notifications** (cloche présente dans la sidebar mais inactive).
3. **Pas de recherche globale** (Ctrl+K).
4. **Pas d'historique d'export** des documents générés.
5. **Mobile non testé** — l'AppShell utilise `flex` sans `lg:` breakpoint, sidebar prend 244px → cassé en <768px.
6. **Pas de feedback IA** (👍 / 👎 sur les réponses) → aucun signal pour améliorer le RAG.

---

## 7. Audit parcours admin

### 7.1 ✅ Implémenté
- `/admin/connectors` — déclenchement KALI, CDTN, Légifrance, Judilibre + monitoring jobs/erreurs
- `/admin/legal-sources` — CRUD sources légales + import URL manuelle ✅ (cette release)

### 7.2 ⚠️ Manquements admin
1. **Pas de dashboard super_admin** (KPI : nb tenants, nb questions, coût IA mensuel).
2. **Pas de gestion des tenants** (lister, suspendre, changer plan/quota).
3. **Pas de gestion des users globaux** (lister tous, attribuer super_admin).
4. **Pas de viewer de logs** edge functions intégré (lien externe Supabase OK mais pas dans l'app).
5. **Pas de scheduler cron** pour resync auto des sources (KALI hebdo, Légifrance quotidien).
6. **Pas de purge RGPD** (bouton "supprimer toutes les données du tenant X").

---

## 8. Audit fonctionnel — manquements MVP

### 8.1 🔴 Bloquants production
- [ ] **Index HNSW + GIN** sur `legal_chunks` (sinon search KO à l'échelle).
- [ ] **Credentials PISTE** à ajouter pour activer Légifrance + Judilibre.
- [ ] **Cron de resync** des sources (sinon corpus se périme).
- [ ] **Politique DELETE messages** pour conformité RGPD.
- [ ] **Rate limiting** sur `/legal-chat`.

### 8.2 🟡 Fortement recommandés
- [ ] Re-ranker pour améliorer pertinence RAG.
- [ ] Cache d'embeddings sur questions répétées.
- [ ] Feedback 👍/👎 sur réponses IA.
- [ ] Mobile responsive (sidebar drawer).
- [ ] Dashboard super_admin (KPI globaux).
- [ ] Validation Zod sur toutes les inputs.

### 8.3 🟢 Nice-to-have
- [ ] Veille juridique (alerte sur évolutions du corpus).
- [ ] Recherche globale Ctrl+K.
- [ ] Export PDF des conversations.
- [ ] Multi-tenant côté UI (un user dans plusieurs tenants).
- [ ] Webhooks (notifier un Slack quand quota dépassé).

---

## 9. Audit code

### 9.1 ✅ Forces
- Architecture par feature claire (`/server/*.functions.ts`, `/routes/_authenticated/*`).
- Design system cohérent (`src/styles.css` + tokens sémantiques).
- Composants shadcn/ui correctement utilisés.
- Auth middleware réutilisable (`requireSupabaseAuth`).

### 9.2 ⚠️ Dette technique
1. **Casts `as unknown as`** dans `connectors.functions.ts` et `legal-sources.functions.ts` — types Supabase pas regen après dernière migration. Action : `bunx supabase gen types typescript` puis remplacer les casts.
2. **`AppShell` dupliqué** dans chaque route → extraire un layout `_authenticated.tsx` qui wrappe avec AppShell.
3. **Pas de tests** (0 fichier `*.test.ts`). À minima : tests d'intégration des server functions critiques (chat, ingest, quota).
4. **Pas d'error boundary par route** — les erreurs server function affichent un toast mais pas de fallback UI.
5. **`router.tsx`** — vérifier que `QueryClient` est créé dans `getRouter` (pas en singleton) pour éviter les fuites SSR.

---

## 10. Plan d'action priorisé

### Sprint 1 — Stabilisation (P0)
1. Ajouter index HNSW + GIN sur `legal_chunks` (migration SQL).
2. Configurer credentials PISTE → activer connector-legifrance + connector-judilibre.
3. Lancer ingestion initiale : KALI top-50 IDCC + Code du travail (100 articles) + Cassation soc 5 ans.
4. Ajouter rate limiting /legal-chat (10 req/min/user).
5. Policy DELETE conversations CASCADE messages CASCADE citations.

### Sprint 2 — Qualité IA (P1)
1. Re-ranker (cohere-rerank ou cross-encoder local via gateway).
2. Chunking par article juridique (regex `Article L\d+-\d+`).
3. Feedback 👍/👎 + table `message_feedback`.
4. Set d'évaluation 50 Q/A → CI sur précision.

### Sprint 3 — Admin & ops (P2)
1. Dashboard super_admin (`/admin/dashboard`) — tenants, usage, coûts.
2. Cron resync hebdo via `supabase_cron` ou `/api/public/cron/resync`.
3. Page tenants admin (`/admin/tenants`) — suspension, quota.
4. Logs edge functions intégrés.

### Sprint 4 — UX (P3)
1. Sidebar drawer mobile.
2. Recherche globale Ctrl+K.
3. Veille juridique (alertes).
4. Export PDF conversations.

---

## Annexe A — Variables d'environnement

```
# Toujours présents
LOVABLE_API_KEY              # AI Gateway
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_PUBLISHABLE_KEY     # côté client via VITE_

# À ajouter pour PISTE
LEGIFRANCE_OAUTH_ID
LEGIFRANCE_OAUTH_SECRET
JUDILIBRE_KEY_ID
PISTE_SANDBOX=1              # optionnel (env test)
```

## Annexe B — URLs utiles

- PISTE registration : https://piste.gouv.fr/registration
- Légifrance API : https://piste.gouv.fr/api_catalog → Légifrance
- Judilibre API : https://piste.gouv.fr/api_catalog → Judilibre
- KALI dataset : https://github.com/SocialGouv/kali-data
- CDTN modèles : https://github.com/SocialGouv/cdtn-admin

---

**Verdict global** : Architecture solide, RAG fonctionnel, sécurité multi-tenant correcte. **Bloquants prod** = index pgvector + credentials PISTE + rate limit + RGPD delete. Une fois ces 4 points résolus, le MVP est livrable.
