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

---

## Annexe C — Warnings Supabase Linter (snapshot)

14 warnings détectés (non bloquants mais à traiter en Sprint 1) :

- **1× Extension in Public** — `pgvector` installé dans `public` schema. À déplacer vers schema dédié ou ignorer (pratique standard).
- **12× SECURITY DEFINER callable** — fonctions exposées via PostgREST (anon ou authenticated). Revoir `EXECUTE` privileges :
  - `REVOKE EXECUTE ... FROM anon, authenticated` sur les fonctions internes (`handle_new_user`, `set_updated_at`).
  - Garder accessible : `has_role`, `is_member_of_tenant`, `is_super_admin`, `current_tenant_id`, `increment_questions_used`, `hybrid_search` (utilisées dans RLS et RPC).
- **1× autre** — voir dashboard Supabase Linter.

**Action Sprint 1** :
```sql
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM anon, authenticated;
-- garder le reste accessible
```


---

# 📋 PARTIE II — Audit ciblé Parcours, Features, IA, Edge Functions

> Date : 2026-04-27 · Complément de `AUDIT.md` · Focus opérationnel.

---

## 1. 👤 Parcours CLIENT (utilisateur final)

### 1.1 Étapes du parcours

| # | Étape | Route | État | Bloquants |
|---|---|---|---|---|
| 1 | Découverte | `/` (landing) | ✅ | — |
| 2 | Inscription | `/signup` | ✅ | Pas de captcha → bot risk |
| 3 | Confirmation email | (Supabase) | ✅ | Template email par défaut Supabase (non brandé) |
| 4 | Login | `/login` | ✅ | Pas de "Remember me", pas de SSO |
| 5 | Onboarding | `/onboarding` | ✅ | IDCC saisie libre → risque typo (devrait être autocomplete sur `conventions_collectives`) |
| 6 | Dashboard | `/dashboard` | ✅ | KPIs statiques, pas de "questions restantes" visible |
| 7 | Poser une question | `/chat` | ✅ | Voir 4. |
| 8 | Générer un document | `/documents` → `/documents/$id` | ✅ | Pas de prévisualisation PDF avant export |
| 9 | Analyser un fichier | `/analyses` | ✅ | Limite taille fichier non documentée côté UI |
| 10 | Gérer un dossier RH | `/dossiers` | ✅ | Pas de timeline/historique des actions |
| 11 | Inviter un collègue | `/team` | ✅ | Email d'invitation envoyé ? **À vérifier** |
| 12 | Paramètres | `/settings` | ✅ | Pas de "supprimer mon compte" (RGPD) |
| 13 | Logout | (header) | ✅ | — |

### 1.2 🔴 Blocages parcours client
1. **Pas de feedback quota** dans l'AppShell (le user ne sait pas combien de questions il lui reste avant de cliquer "Envoyer").
2. **Onboarding IDCC libre** → un user qui tape "1486" vs "01486" casse le filtre RAG. **Action** : combobox alimenté par `conventions_collectives`.
3. **Pas de "supprimer mon compte"** → non conforme RGPD (`rgpd.functions.ts` existe mais non câblé dans `/settings`).
4. **Mobile cassé** (<768px) — sidebar prend tout l'écran.
5. **Confirmation email Supabase non brandée** — branding JurisAI absent du mail.

### 1.3 🟡 Améliorations UX
- Toast "Question 47/100 — il vous reste 53 questions ce mois" après chaque chat.
- Onboarding en 3 étapes wizard (entreprise → IDCC → équipe) avec progression.
- Tour guidé première connexion (Shepherd.js ou équivalent).
- Empty states avec illustrations + CTA (ex: "Aucun dossier — créez le premier").

---

## 2. 🛠️ Parcours ADMIN

### 2.1 Rôles et capacités

| Rôle | Routes accessibles | Manquements |
|---|---|---|
| `user` | dashboard, chat, documents, analyses, dossiers, settings (lecture) | — |
| `manager` | + invitations team, création templates | Pas de vue "performance équipe" |
| `admin` (tenant) | + gestion membres, plan, quota, suspension users | **Pas d'écran "Plan & Facturation"** |
| `super_admin` | `/admin/connectors`, `/admin/legal-sources` | Voir 2.3 |

### 2.2 Parcours admin tenant
1. Login → `/dashboard` ✅
2. `/team` → inviter, changer rôle ✅
3. `/settings` → modifier tenant (nom, IDCC, secteur) ✅
4. ❌ **Manque** : voir consommation détaillée par user (`usage_logs` n'a pas de page dédiée).
5. ❌ **Manque** : exporter conversations (RGPD / archivage).
6. ❌ **Manque** : page "Plan" (changer starter→pro→enterprise, voir prochain renouvellement).

### 2.3 Parcours super_admin
| Action | Implémenté | Lien |
|---|---|---|
| Déclencher ingestion KALI | ✅ | `/admin/connectors` |
| Déclencher Légifrance | ✅ (UI) | ⚠️ KO sans creds PISTE |
| Déclencher Judilibre | ✅ (UI) | ⚠️ KO sans creds PISTE |
| Voir jobs en cours / erreurs | ✅ | `/admin/connectors` |
| Gérer sources légales (CRUD) | ✅ | `/admin/legal-sources` |
| Import URL manuelle | ✅ | `/admin/legal-sources` |
| **Lister tous les tenants** | ❌ | — |
| **Suspendre un tenant** | ❌ | — |
| **Lister tous les users** | ❌ | — |
| **Attribuer super_admin** | ❌ | requête SQL manuelle |
| **Voir KPI globaux** (MRR, questions/jour, coût IA) | ❌ | — |
| **Cron resync auto** | ❌ | manuel uniquement |
| **Logs edge functions in-app** | ❌ | dashboard Supabase externe |
| **Purge RGPD tenant** | ❌ | — |

### 2.4 🔴 Manquements critiques admin
1. **Aucune page `/admin/dashboard`** — un super_admin ne peut pas piloter la plateforme.
2. **Aucune page `/admin/tenants`** — impossible de gérer les clients depuis l'app.
3. **Premier super_admin** = créé manuellement via SQL (à documenter dans README).
4. **Pas de bouton "purge RGPD"** sur `/admin/tenants/$id`.

---

## 3. ⚙️ Audit FEATURES

### 3.1 Matrice de complétude

| Feature | UI | Backend | RAG | Tests | Note |
|---|---|---|---|---|---|
| Auth (signup/login/reset) | ✅ | ✅ | — | ❌ | 8/10 |
| Onboarding tenant | ✅ | ✅ | — | ❌ | 7/10 (IDCC libre) |
| Chat IA RAG | ✅ | ✅ | ✅ | ❌ | 8/10 |
| Citations cliquables | ✅ | ✅ | ✅ | ❌ | 9/10 |
| Génération documents | ✅ | ✅ | — | ❌ | 7/10 (pas de PDF preview) |
| Templates publics | ✅ | ✅ | — | ❌ | 7/10 |
| Analyse fichiers | ✅ | ✅ | partiel | ❌ | 6/10 (pas de PDF/DOCX parsing avancé) |
| CRM Dossiers | ✅ | ✅ | — | ❌ | 7/10 |
| Deadlines | ✅ | ✅ | — | ❌ | 7/10 (pas de notifications) |
| Clients | ✅ | ✅ | — | ❌ | 7/10 |
| Team / invitations | ✅ | ✅ | — | ❌ | 6/10 (envoi email à vérifier) |
| Quotas | ✅ partiel | ✅ | — | ❌ | 7/10 (pas affiché en sidebar) |
| Veille juridique | ❌ | ❌ | — | ❌ | 0/10 |
| Notifications | ❌ | ❌ | — | ❌ | 0/10 |
| Recherche globale Ctrl+K | ❌ | — | — | ❌ | 0/10 |
| Feedback IA 👍👎 | ❌ | ❌ | — | ❌ | 0/10 |
| Export PDF conversations | ❌ | ❌ | — | ❌ | 0/10 |
| Multi-tenant côté UI | ❌ | partiel | — | ❌ | 3/10 |
| Billing / Stripe | ❌ | ❌ | — | ❌ | 0/10 |

**Score global features** : 5.4/10 (MVP fonctionnel mais manques critiques pour scale).

### 3.2 Features fantômes (badges "bientôt" ou liens morts)
- `/veille` → sidebar mentionne "Veille juridique" mais aucune route.
- Cloche notifications (header) → inactive.
- Bouton "Exporter" sur conversation → absent.

---

## 4. 🤖 Audit IA & RAG (détail technique)

### 4.1 Pipeline `legal-chat` (330 lignes)

```
[CLIENT]
  ↓ POST /functions/v1/legal-chat { conversationId, content, tenantId }
[EDGE]
  1. Auth check (JWT)              ✅
  2. Quota check (RPC atomique)    ✅
  3. Embed query (1536d)           ✅ ~150ms
  4. hybrid_search(idcc, k=8)      ✅ ~50ms (sans HNSW : ~5s à l'échelle ⚠️)
  5. Build system prompt + chunks  ✅
  6. Stream Gemini-3-flash         ✅ SSE
  7. Parse [source:N] → citations  ✅
  8. Insert chat_citations         ✅ (service_role)
  9. Insert message + usage_logs   ✅
```

### 4.2 ✅ Forces IA
- Streaming SSE bien implémenté (UX fluide).
- Prompt système strict avec obligation `[source:N]`.
- Filtre IDCC tenant-aware.
- Quota préventif (économie tokens si dépassé).

### 4.3 🔴 Faiblesses IA
1. **Pas de timeout** sur appel Gemini → si la gateway hang, l'edge function bloque jusqu'à 150s.
2. **Pas de retry** sur erreur transitoire (429/500 gateway).
3. **Pas de fallback modèle** (si gemini-3-flash KO → rien).
4. **Pas de garde sur context length** — si 8 chunks × 3200 chars + historique = >32k tokens → erreur silencieuse.
5. **Historique conversation tronqué arbitrairement** (à vérifier dans le code : limite N derniers messages).
6. **Pas de sanitization** du content user → injection prompt possible (ex: "Ignore previous instructions...").
7. **Embeddings pas cachés** — même question = re-embed (~150ms + coût).
8. **Pas de re-ranker** après hybrid_search.
9. **Pas de logging détaillé** (latence par étape, taille chunks, tokens IN/OUT) pour optimisation.

### 4.4 🟡 Quality gates manquants
- Pas de set d'éval (50 Q/A référence) → impossible de mesurer régression.
- Pas de score de confiance affiché (ex: "réponse certaine 85%").
- Pas de signal "je ne sais pas" forcé quand chunks pas pertinents (score < seuil).

---

## 5. 🔌 Audit EDGE FUNCTIONS (8 fonctions)

### 5.1 Inventaire

| Function | LOC | verify_jwt | Auth manuelle | Rate limit | État |
|---|---|---|---|---|---|
| `legal-chat` | 330 | ❌ | ✅ | ❌ | ✅ Fonctionnel |
| `ingest-legal-source` | 225 | ❌ | ⚠️ à vérifier | ❌ | ✅ |
| `connector-kali` | 161 | ❌ | ⚠️ | ❌ | ✅ |
| `connector-cdtn-modeles` | 139 | ❌ | ⚠️ | ❌ | ✅ |
| `connector-legifrance` | 180 | ❌ | ⚠️ | ❌ | ⚠️ Sans creds PISTE |
| `connector-judilibre` | 208 | ❌ | ⚠️ | ❌ | ⚠️ Sans creds PISTE |
| `seed-demo` | 215 | ❌ | ⚠️ | ❌ | ⚠️ Dangereux si exposé |
| `seed-legal` | 408 | ❌ | ⚠️ | ❌ | ⚠️ Dangereux si exposé |

### 5.2 🚨 Risques sécurité edge functions

**`verify_jwt = false` partout** → chaque fonction DOIT vérifier l'auth manuellement avant tout side-effect. À auditer ligne par ligne :

1. **`seed-demo` / `seed-legal`** — si pas de check `super_admin`, n'importe qui peut peupler / wipe la BD via curl. **CRITIQUE**.
2. **Connecteurs (`connector-*`)** — appelables par n'importe qui sans auth si l'auth n'est pas vérifiée → trigger d'ingestion abusive (coût IA explose).
3. **`ingest-legal-source`** — accepte URL + texte. Sans auth super_admin → injection de contenu dans le corpus RAG (poisoning).

### 5.3 🟡 Qualité code edge functions

| Pattern | Implémenté | Recommandation |
|---|---|---|
| CORS headers | ✅ | OK pour usage actuel |
| Error handling try/catch | ✅ | OK |
| Logging structuré | ⚠️ console.log basique | → JSON structuré avec correlation_id |
| Idempotence | ✅ (upsert) | OK |
| Backoff sur HTTP externes | ❌ | Ajouter pour Légifrance/Judilibre |
| Validation Zod inputs | ❌ | À ajouter partout |
| Limits de taille payload | ❌ | Limiter à ~1MB |

### 5.4 Missing edge functions
- `delete-tenant` (RGPD purge cascade).
- `export-conversations` (RGPD portabilité).
- `cron-resync` (appelée par scheduler externe).
- `send-invitation-email` (vérifier si existe ou si Supabase Auth s'en charge).

---

## 6. 📊 Tableau de bord PRIORISÉ (par impact × effort)

### 🔥 P0 — Bloquants prod (Sprint 1)

| # | Action | Impact | Effort | Owner |
|---|---|---|---|---|
| 1 | Audit `verify_jwt` + check super_admin sur **toutes** les edge functions | 🔴 SEC | 2h | dev |
| 2 | Index HNSW + GIN sur `legal_chunks` | 🔴 PERF | 30min | DBA |
| 3 | Configurer creds PISTE (Légifrance + Judilibre) | 🔴 DATA | user | user |
| 4 | Rate limiting `/legal-chat` (10 req/min/user) | 🔴 SEC | 2h | dev |
| 5 | Politique DELETE messages CASCADE (RGPD) | 🔴 LEGAL | 1h | dev |
| 6 | Timeout + retry sur appel Gemini | 🔴 STAB | 1h | dev |
| 7 | Onboarding IDCC en combobox (autocomplete) | 🟠 UX | 2h | dev |

### ⚡ P1 — Différenciants (Sprint 2)

| # | Action | Impact | Effort |
|---|---|---|---|
| 1 | `/admin/dashboard` super_admin (KPI tenants/usage/coût) | 🟠 OPS | 1j |
| 2 | `/admin/tenants` (gestion clients) | 🟠 OPS | 1j |
| 3 | Quota visible dans AppShell (badge "47/100") | 🟠 UX | 2h |
| 4 | Feedback 👍/👎 + table `message_feedback` | 🟡 IA | 4h |
| 5 | Re-ranker chunks (cohere via gateway) | 🟡 IA | 4h |
| 6 | Sidebar drawer mobile | 🟡 UX | 4h |
| 7 | Suppression compte RGPD (`/settings`) | 🟠 LEGAL | 3h |
| 8 | Email invitation brandé | 🟡 UX | 2h |

### 💎 P2 — Scale (Sprint 3)

| # | Action |
|---|---|
| 1 | Cron resync auto (KALI hebdo, Légifrance quotidien) |
| 2 | Veille juridique (alerte évolutions corpus) |
| 3 | Recherche globale Ctrl+K |
| 4 | Export PDF conversations |
| 5 | Billing Stripe + plans |
| 6 | Set d'évaluation IA + CI |

---

## 7. ✅ Checklist "Go Production"

- [ ] Toutes les edge functions vérifient l'auth (super_admin pour seed/connector/ingest)
- [ ] Index pgvector créés (HNSW + GIN)
- [ ] Rate limit /legal-chat actif
- [ ] Timeout Gemini < 60s + retry x2
- [ ] Politique DELETE messages opérationnelle
- [ ] Bouton "Supprimer mon compte" RGPD dans /settings
- [ ] Creds PISTE configurés
- [ ] Premier super_admin créé (procédure documentée)
- [ ] Mobile responsive testé
- [ ] Email confirmation/invitation brandé JurisAI
- [ ] Linter Supabase à 0 warning critique
- [ ] Audit pen-test léger (OWASP top 10)

---

## 8. 🎯 Verdict synthétique

| Axe | Note | Commentaire |
|---|---|---|
| **Parcours client** | 6/10 | Fonctionnel mais friction (quota invisible, IDCC libre, mobile cassé) |
| **Parcours admin** | 4/10 | Connectors + sources OK, mais 0 gestion tenants/users |
| **Features** | 5.4/10 | MVP livrable, manques scale (notif, veille, billing) |
| **IA / RAG** | 7/10 | Pipeline solide, manque re-ranker + cache + garde-fous |
| **Edge functions** | 5/10 | Code propre mais sécurité auth à durcir absolument |
| **Sécurité** | 6/10 | RLS excellente, mais edge functions exposées |
| **Performance** | 4/10 | KO sans index pgvector à l'échelle |

**Verdict** : Excellente base architecturale. **5 actions P0** à exécuter pour atteindre un MVP livrable production. Une fois faites → score moyen attendu **7.5/10**.
