# 🔍 Audit ciblé — Parcours Client, Admin, Features, IA & Edge Functions

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
