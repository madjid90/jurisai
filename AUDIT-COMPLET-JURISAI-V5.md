# AUDIT COMPLET JURISAI V5 — VISION 360°
> Date : 14 mai 2026 | Score global : **83/100** (vs 79/100 en V4)

---

## TABLE DES MATIÈRES
1. [Cartographie complète du site](#1-cartographie)
2. [Parcours client end-to-end](#2-parcours-client)
3. [Architecture technique](#3-architecture)
4. [Agent 360 & IA](#4-agent-ia)
5. [RAG & Sources juridiques](#5-rag)
6. [Sécurité & Production-readiness](#6-securite)
7. [UI/UX & Design](#7-ui-ux)
8. [Gap analysis Harvey AI](#8-harvey)
9. [Incohérences détectées](#9-incoherences)
10. [Plan d'action prioritaire](#10-plan-action)

---

## 1. CARTOGRAPHIE COMPLÈTE DU SITE <a id="1-cartographie"></a>

### Pages publiques (10)
| Route | Page | État |
|-------|------|------|
| `/` | Landing page (Hero, Features, Use Cases, Pricing, CTA) | ✅ Complète |
| `/login` | Connexion | ✅ Complète |
| `/signup` | Création de compte | ✅ Complète |
| `/forgot-password` | Mot de passe oublié | ✅ Complète |
| `/reset-password` | Nouveau mot de passe | ✅ Complète |
| `/accept-invitation` | Rejoindre une équipe (token) | ✅ Complète |
| `/onboarding` | Wizard 4 étapes | ✅ Complète |
| `/cgu` | Conditions générales | ✅ Complète |
| `/confidentialite` | Politique de confidentialité | ✅ Complète |
| `/mentions-legales` | Mentions légales | ⚠️ **Placeholders** (SIRET, RCS, adresse = "à compléter") |

### Pages authentifiées — Utilisateur (20)
| Route | Page | Fonction | État |
|-------|------|----------|------|
| `/dashboard` | Accueil | Hub central : chat, dossiers récents, échéances, alertes | ✅ Complète |
| `/agent` | Assistant IA | Pipeline async : formulaire → exécution → résultat | ✅ Complète |
| `/chat` | Chat juridique | Chat RAG streamé avec citations | ✅ Complète |
| `/mes-demandes` | Mes demandes | Liste des agent_runs avec filtres | ✅ Complète |
| `/mes-demandes/$id` | Détail demande | Vue détaillée d'une run | ✅ Complète |
| `/dossiers` | Dossiers | 3 onglets : Dossiers / Clients / Échéances | ✅ Complète |
| `/dossiers/$id` | Détail dossier | Vue 360° avec 9 onglets + timeline | ✅ Complète |
| `/documents` | Documents | Templates + docs générés + bibliothèque publique | ✅ Complète |
| `/documents/$id` | Éditeur | Tiptap rich text + export PDF/Word | ✅ Complète |
| `/analyses` | Analyses | Upload + OCR + historique analyses | ✅ Complète |
| `/analyses/$id` | Détail analyse | Résumé, risques, clauses, entités | ✅ Complète |
| `/templates` | Modèles juridiques | Bibliothèque de templates par domaine | ✅ Complète |
| `/workflows` | Procédures | Définitions + instances actives | ✅ Complète |
| `/workflows/$id` | Détail workflow | Suivi étape par étape | ✅ Complète |
| `/scan` | OCR & Scan | Upload + traitement vision IA | ✅ Complète |
| `/links` | Liaisons documents | Suggestions auto document↔dossier | ✅ Complète |
| `/veille` | Veille juridique | Alertes réglementaires + système | ✅ Complète |
| `/notifications` | Notifications | Inbox in-app avec filtres | ✅ Complète |
| `/team` | Équipe | Invitations, rôles, gestion membres | ✅ Complète |
| `/settings` | Paramètres | Profil, organisation, notifs, RGPD, intégrations | ✅ Complète |
| `/upgrade` | Passer au Pro | Comparaison 3 plans | ✅ Complète |

### Pages admin (9)
| Route | Page | État |
|-------|------|------|
| `/admin/connectors` | Connecteurs données | ✅ |
| `/admin/legal-sources` | Sources juridiques | ✅ |
| `/admin/tenants` | Multi-tenant (super admin) | ✅ |
| `/admin/usage` | Analytics usage | ✅ |
| `/admin/workflow-generator` | Générateur workflows IA | ✅ |
| `/admin/data-quality` | Qualité données | ✅ |
| `/admin/rag-quality` | Évaluation RAG | ✅ |
| `/admin/server-errors` | Erreurs serveur | ✅ |
| `/admin/audit` | Journal d'audit | ✅ |

### API publique (5 endpoints)
| Endpoint | Méthode | Usage |
|----------|---------|-------|
| `/api/public/v1/me` | GET | Profil utilisateur |
| `/api/public/v1/clients` | GET | Liste clients CRM |
| `/api/public/v1/dossiers` | GET | Liste dossiers |
| `/api/public/v1/deadlines` | GET/POST | Échéances |
| `/api/public/calendar/$token` | GET | Export calendrier |

### Hooks/Crons (5)
| Hook | Fonction |
|------|----------|
| `email-worker` | Envoi emails async |
| `contract-deadlines` | Détection échéances contrats |
| `dispatch-reminders` | Distribution rappels |
| `digest` | Digest quotidien/hebdo |
| `orchestrator-tick` | Orchestrateur tâches fond |

**Total : ~50 routes, 31 server functions, 19 edge functions, 76 tables, 199 policies RLS**

---

## 2. PARCOURS CLIENT END-TO-END <a id="2-parcours-client"></a>

### Flux inscription → première valeur
```
Signup (/signup)
  ↓ Email + mot de passe + nom
  ↓ Email de confirmation (Supabase)
Login (/login)
  ↓ Vérification onboarding
Onboarding (/onboarding) — 4 étapes
  ├── Étape 0 : Type de profil (dirigeant, RH, juriste, expert-comptable, manager)
  ├── Étape 1 : Infos personnelles (nom, poste, téléphone)
  ├── Étape 2 : Entreprise (raison sociale, SIRET, secteur)
  └── Étape 3 : Convention collective (IDCC)
  ↓ Crée : tenant + profil + rôle admin
Dashboard (/dashboard)
  ↓ Chat central + suggestions rapides
  ↓ "Posez votre première question"
```

### Flux quotidien type
```
Dashboard → Question dans le chat central
  ↓ Routage automatique :
  ├── Question juridique → /chat (RAG sourcé + streaming)
  ├── Procédure → /agent (formulaire → workflow → documents)
  ├── Analyse document → /analyses (OCR + extraction risques)
  └── Gestion dossier → /dossiers/$id (vue 360°)

Dossier 360° (9 onglets) :
  Timeline | Risques | Documents | Validations | Rappels |
  Liaisons | Workflows | Sources | Agent IA
```

### Flux équipe
```
Admin → /team → Inviter (email + rôle)
  ↓ Email avec lien /accept-invitation?token=xxx
  ↓ Invité crée un compte ou se connecte
  ↓ Rejoint le tenant avec le rôle assigné
```

### Flux admin
```
/admin/connectors → Voir/lancer l'ingestion des sources légales
/admin/workflow-generator → Générer des procédures IA → valider/rejeter
/admin/usage → Suivi quotas et consommation
/admin/audit → Journal complet des actions
```

---

## 3. ARCHITECTURE TECHNIQUE <a id="3-architecture"></a>

### Stack
| Couche | Technologie |
|--------|------------|
| Frontend | React 19 + TanStack Router + Tailwind CSS + shadcn/ui |
| Backend | TanStack Start (server functions) + Supabase Edge Functions |
| Base de données | PostgreSQL (Supabase) + pgvector + pg_trgm |
| Auth | Supabase Auth (JWT) + RLS multi-tenant |
| IA | Gemini 2.5 Pro/Flash via Lovable AI Gateway |
| Embeddings | OpenAI text-embedding-3-small (1536 dims) |
| Déploiement | Cloudflare (via Lovable) |
| Stockage | Supabase Storage (dossier-files, documents) |

### Points forts architecture
- ✅ **Multi-tenancy robuste** : getTenantId() centralisé + 199 policies RLS
- ✅ **76 tables** normalisées avec audit trail
- ✅ **31 server functions** avec middleware auth systématique
- ✅ **12 connecteurs** de sources juridiques officielles
- ✅ **Circuit breaker** sur les appels LLM
- ✅ **Rate limiting** par RPC PostgreSQL
- ✅ **Quotas** par plan (starter/pro/enterprise)

### Points faibles architecture
- ⚠️ **Pas de Stripe** : paiement par contact email uniquement
- ⚠️ **Pas de CI/CD** visible (tests existent mais pas de pipeline)
- ⚠️ **Types Supabase** non regénérés (30+ casts `as any`)
- ⚠️ **Logging serveur** : server_function_errors existe mais insertion pas systématique

---

## 4. AGENT 360 & IA <a id="4-agent-ia"></a>

### Deux pipelines (corrigé dans cette session)

| Pipeline | Fichier | Outils | Usage |
|----------|---------|--------|-------|
| **Agent Loop** (complet) | agent.functions.ts → runAgentLoop | 16 outils (search_law, start_workflow, generate_workflow, etc.) | Appel direct LLM avec tool calls |
| **Agent Async** (formulaires) | agent-runs.functions.ts | Classification + formulaire + exécution | UI principale (/agent, /mes-demandes) |

### Outils agent disponibles (16)
| Outil | Fonction | Connecté |
|-------|----------|----------|
| search_law | RAG juridique | ✅ |
| dossier_context | Contexte dossier 360° | ✅ |
| identify_risk | Enregistrer un risque | ✅ |
| propose_document | Initier génération document | ✅ |
| request_validation | Demande validation hiérarchique | ✅ |
| schedule_reminder | Programmer rappel | ✅ |
| create_task | Créer tâche dans dossier | ✅ |
| update_task | MAJ tâche existante | ✅ |
| create_deadline | Créer échéance | ✅ |
| search_dossier | Recherche dossiers | ✅ |
| create_dossier | Créer nouveau dossier | ✅ |
| start_workflow | Démarrer procédure existante | ✅ (corrigé V5) |
| generate_workflow | Générer procédure IA | ✅ (corrigé V5) |
| run_workflow_step | Exécuter étape workflow | ✅ |
| analyze_document | Analyser document (risques, type) | ✅ |
| generate_report | Rapport markdown dossier | ✅ |

### Workflow generator
- **Moteur** : Gemini 2.5 Pro + RAG sources légales
- **Validation** : 3 couches (références légales, logique, complétude)
- **Score seuil** : ≥70% legal_refs, ≥70% logic, ≥80% safety → auto-validé
- **Seed data** : 6 workflows pré-validés (licenciement faute grave, inaptitude, sanction progressive, etc.)
- **Détection doublons** : Embedding sémantique (cosine ≥0.85)
- **Pipeline async→workflow** : ✅ Connecté (fix de cette session)

### Correctifs apportés (sessions V4-V5)
- ✅ RAG avant classification (l'agent connaît les délais légaux)
- ✅ IDCC chargé depuis le tenant (ne demande plus la convention)
- ✅ Questions intelligentes (faits seulement, pas de dates légales)
- ✅ Réponses de formulaire prises en compte (filtrage par tokens)
- ✅ `requires_form` ne bloque plus quand toutes les infos sont collectées
- ✅ Workflows connectés au pipeline async

---

## 5. RAG & SOURCES JURIDIQUES <a id="5-rag"></a>

### Sources ingérées (~97 000 articles)
| Source | Connecteur | Authority | Couverture |
|--------|-----------|-----------|------------|
| Legifrance (16 codes) | connector-legifrance-full | 95-100 | Code du travail, Code civil, CGI, etc. |
| Jurisprudence | connector-judilibre-full | 85-94 | Cour de cassation, cours d'appel |
| Conventions collectives | connector-kali-full | 85-94 | IDCC filtrable |
| BOFIP (fiscal) | connector-bofip-full | 70-84 | Doctrine fiscale |
| CNIL (RGPD) | connector-cnil-full | 70-84 | Données personnelles |
| JADE (admin) | connector-jade-full | 70-84 | Droit administratif |
| CDTN (fiches/modèles) | connector-cdtn-* (3) | 30-69 | Fiches pratiques, modèles |
| ACCO (accords) | connector-acco-full | 50-69 | Accords d'entreprise |

### Algorithme de recherche (hybrid_search)
```
1. Recherche vectorielle (cosine similarity) → Top 32
2. Recherche BM25 (full-text français) → Top 32
3. Reciprocal Rank Fusion (λ=0.7 vecteur / 0.3 FTS)
4. Boost par authority_level (×1.5 pour législation, ×0.8 pour modèles)
5. Filtrage IDCC (convention du tenant)
6. MMR re-ranking (diversité) → Top 8
```

### Gardes anti-hallucination
| Garde | Implémentation | Seuil |
|-------|---------------|-------|
| Pas de source = refus | Mode strict (défaut) | 0 sources → refus motivé |
| Couverture citations | validateAnswerCitations() | Warning si < 70% |
| Vérification références | verifyReferences() | Warning si < 60% vérifiées |
| Circuit breaker LLM | llm-breaker.server.ts | 4 échecs consécutifs → cooldown 30s |
| Rate limit | check_rate_limit RPC | 5-10/min selon endpoint |
| Quotas mensuels | increment_questions_used | Par plan (20/illimité) |
| Cache embeddings | SHA-256 query hash | Évite re-embedding identiques |

### 3 modes RAG (par tenant)
| Mode | Comportement |
|------|-------------|
| **strict** (défaut) | Refus si aucune source. Citations obligatoires. |
| **assisted** | Réponse générale si pas de source, avec warning |
| **brouillon** | Exploration libre, sources optionnelles |

---

## 6. SÉCURITÉ & PRODUCTION-READINESS <a id="6-securite"></a>

### Score sécurité : 88/100

| Domaine | Score | Détail |
|---------|-------|--------|
| Auth & sessions | 95 | JWT Supabase + middleware systématique |
| Multi-tenancy | 95 | getTenantId() + 199 RLS policies |
| Prompt injection | 90 | sanitizePromptInput + PROMPT_INJECTION_GUARD + patterns FR |
| Rate limiting | 85 | RPC PostgreSQL, fail-closed sur generateDocument |
| Input validation | 90 | 211 validators Zod |
| Secrets | 90 | Aucun secret hardcodé, .env correcte |
| Audit trail | 75 | Timeline forte, audit_logs insertion pas systématique |
| Error handling | 70 | Présent mais inconsistant |
| RGPD | 90 | Export données + suppression compte + cookie banner |

### Correctifs sécurité appliqués (V4-V5)
- ✅ 8 patterns injection français
- ✅ sanitizePromptInput sur classifyIntent, analyzeDocumentTool, generateDocument
- ✅ Sanitize history[] dans legal-chat
- ✅ Fix crash base64 dans ocr-document (chunked encoding)
- ✅ Timeout 60s sur OCR vision
- ✅ Rate-limit generateDocument (10/min, fail-closed)
- ✅ DOMPurify vérifié sur toutes les sorties HTML IA

### Reste à faire
- ❌ **Mentions légales** : SIRET, RCS, adresse = placeholders
- ❌ **Stripe/paiement** : aucune intégration (email only)
- ❌ **Types Supabase** : 30+ casts `as any` (risque runtime)
- ❌ **Error logging** : server_function_errors pas systématiquement alimentée
- ❌ **CI/CD** : pas de pipeline visible

---

## 7. UI/UX & DESIGN <a id="7-ui-ux"></a>

### Score UI/UX : 85/100

| Aspect | Score | Détail |
|--------|-------|--------|
| Design system | 90 | shadcn/ui (34 composants), Tailwind, consistant |
| Responsive | 85 | Mobile drawer + desktop sidebar, 69+ classes responsive |
| Dark mode | 90 | 40+ fichiers avec variantes dark: |
| Accessibilité | 80 | ARIA labels, focus rings, sémantique HTML, skip link |
| Empty states | 95 | Composant dédié, tous les cas couverts |
| Loading states | 85 | Skeletons, spinners, état busy |
| Navigation | 90 | Sidebar permissive par rôle, 8 items primaires, Cmd+K search |
| Agent views | 90 | 7 vues spécialisées (LegalAnswer, Analysis, Document, Workflow...) |
| Dossier 360° | 95 | 9 onglets, timeline, risques, documents, workflows |
| Onboarding | 85 | 4 étapes claires, auto-complétion IDCC |

### Points forts UX
- Hub central (dashboard) avec chat + actions rapides
- Routage intelligent : la question détermine la destination
- Vue 360° dossier avec 9 dimensions
- Export PDF/Word natif
- Drag & drop pour upload documents
- Recherche globale Cmd+K

### Points faibles UX
- ⚠️ **Pas de FAQ/aide** : uniquement lien mailto
- ⚠️ **Pas de tour guidé** après onboarding
- ⚠️ **Pricing sans paiement** : le CTA "Pro" envoie un email
- ⚠️ **Pas de portail client** : les clients des cabinets n'ont pas d'accès

---

## 8. GAP ANALYSIS vs HARVEY AI <a id="8-harvey"></a>

### Ce que Harvey fait que JurisAI fait aussi ✅
| Capacité | JurisAI | Notes |
|----------|---------|-------|
| Chat juridique sourcé | ✅ | RAG hybrid search + citations |
| Analyse de documents | ✅ | OCR + extraction risques/clauses |
| Génération de documents | ✅ | Templates + IA + prefill |
| Multi-tenant B2B | ✅ | Isolation complète |
| Rôles et permissions | ✅ | 12 rôles, matrice permissions |
| Audit trail | ✅ | Timeline + audit_logs |
| Workflows/procédures | ✅ | Générateur IA + runtime |

### Ce que Harvey fait que JurisAI ne fait PAS ENCORE ❌

| Capacité Harvey | État JurisAI | Priorité | Effort |
|----------------|-------------|----------|--------|
| **Clause-by-clause contract review** | Analyse globale seulement, pas clause par clause | 🔴 Critique | 2-3 sem |
| **Contract comparison** (diff 2 versions) | ❌ Absent | 🔴 Critique | 2 sem |
| **Contract redlining** (suggestions inline) | ❌ Absent | 🟡 Haute | 3 sem |
| **Real-time collaboration** (multi-user editing) | Basique (DossierCollab) | 🟡 Haute | 2 sem |
| **Email integration** (inbox → auto-classement) | Email queue existe mais pas d'inbox | 🟡 Haute | 2 sem |
| **Billing/Stripe** | ❌ Email only | 🔴 Critique | 1 sem |
| **SSO/SAML** | ❌ Mentionné Enterprise mais pas implémenté | 🟡 Haute | 1 sem |
| **API publique documentée** | Endpoints existent, pas de doc | 🟡 Haute | 3 jours |
| **Knowledge base par entreprise** | agent_memory existe mais basique | 🟡 Haute | 2 sem |
| **Fine-tuning par client** | ❌ Absent | 🟢 Future | 4+ sem |
| **Multi-langue** | Français uniquement (OK pour cible FR) | 🟢 Future | — |
| **Client portal** (accès externe pour clients du cabinet) | ❌ Absent | 🟡 Haute | 3 sem |
| **Playground/sandbox** pour tester prompts | ❌ Absent | 🟢 Future | 1 sem |

### Avantages JurisAI vs Harvey
| Avantage JurisAI | Détail |
|-------------------|--------|
| 🇫🇷 **Droit français natif** | 97k+ sources FR, IDCC, Legifrance, conventions |
| 📋 **Workflows juridiques IA** | Génération automatique de procédures complètes |
| 🔒 **Validation hiérarchique** | Actions sensibles bloquées → approbation admin |
| 📊 **Dossier 360°** | 9 dimensions par affaire (timeline, risques, docs, workflows...) |
| 💰 **Prix accessible** | 49€/user/mois vs Harvey (>500$/user/mois estimé) |
| 🏢 **Multi-profil** | Dirigeant, RH, juriste, expert-comptable, avocat partenaire |

---

## 9. INCOHÉRENCES DÉTECTÉES <a id="9-incoherences"></a>

### Incohérences critiques 🔴

| # | Incohérence | Impact | Fichiers |
|---|-------------|--------|----------|
| 1 | **Mentions légales incomplètes** : SIRET, RCS, adresse = "à compléter" | Non-conformité légale FR | mentions-legales.tsx |
| 2 | **Pricing sans paiement** : affiche 3 plans mais CTA = mailto | Pas de conversion self-serve | upgrade.tsx |
| 3 | **2 pipelines agent non unifiés** : runLegalAgent (loop) vs processAgentRun (async) font des choses différentes | Expérience incohérente selon le point d'entrée | agent.functions.ts vs agent-runs.functions.ts |

### Incohérences moyennes 🟡

| # | Incohérence | Impact | Fichiers |
|---|-------------|--------|----------|
| 4 | **Titre meta manquant** sur /notifications et /veille | SEO/accessibilité | notifications.tsx, veille.tsx |
| 5 | **Types TS non regénérés** : 30+ `as any` / `as never` casts | Risque erreurs runtime | Tout le backend |
| 6 | **Chat (/chat) vs Agent (/agent)** : 2 interfaces IA distinctes, confusion utilisateur | UX confuse : "Où poser ma question ?" | chat.tsx vs agent.tsx |
| 7 | **Dashboard chat + Agent chat + Chat page** : 3 points d'entrée pour parler à l'IA | Fragmentation de l'expérience | dashboard.tsx, agent.tsx, chat.tsx |
| 8 | **server_function_errors** table existe mais pas d'insertion automatique | Pas de monitoring des erreurs serveur | Toutes les .functions.ts |
| 9 | **Répertoire components/chat/ vide** | Dead code / travail inachevé | components/chat/ |

### Incohérences mineures 🟢

| # | Incohérence | Impact |
|---|-------------|--------|
| 10 | routeTree.gen.ts a des erreurs TS (routes mal typées) | Build warnings |
| 11 | Quelques boutons sans aria-label en sidebar collapsed | Accessibilité |
| 12 | Border opacity varie (border-border/40 vs /60) | Consistance visuelle |

---

## 10. PLAN D'ACTION PRIORITAIRE <a id="10-plan-action"></a>

### Phase 0 — Blockers production (1-2 jours)
| # | Action | Effort | Impact |
|---|--------|--------|--------|
| P0.1 | Compléter mentions légales (SIRET, RCS, adresse) | 30 min | Conformité légale |
| P0.2 | Regénérer types Supabase (`supabase gen types`) | 1h | Éliminer 30+ casts unsafe |
| P0.3 | Ajouter middleware auto-logging erreurs serveur | 2h | Monitoring production |
| P0.4 | Ajouter title meta sur /notifications et /veille | 15 min | SEO |

### Phase 1 — Intégration paiement (1 semaine)
| # | Action | Effort | Impact |
|---|--------|--------|--------|
| P1.1 | Intégrer Stripe Checkout (3 plans) | 3 jours | Conversion self-serve |
| P1.2 | Webhook Stripe → MAJ plan tenant | 1 jour | Automatisation |
| P1.3 | Page billing avec historique factures | 1 jour | Transparence |
| P1.4 | Enforcement quotas par plan réel | 1 jour | Monétisation |

### Phase 2 — Unifier l'expérience IA (1-2 semaines)
| # | Action | Effort | Impact |
|---|--------|--------|--------|
| P2.1 | **Fusionner chat + agent** : un seul point d'entrée intelligent qui route automatiquement | 3 jours | UX simplifiée |
| P2.2 | Dashboard = seul point d'entrée chat (supprimer /chat séparé ou le lier) | 1 jour | Clarté |
| P2.3 | Afficher le workflow dans le résultat agent (bouton "Exécuter étape suivante") | 2 jours | Agent→Workflow visible |
| P2.4 | Agent auto-exécute les étapes non-sensibles du workflow | 2 jours | Agent proactif |

### Phase 3 — Fonctionnalités Harvey manquantes (3-4 semaines)
| # | Action | Effort | Impact |
|---|--------|--------|--------|
| P3.1 | **Analyse clause par clause** : décomposer un contrat en clauses + risque par clause | 2 sem | Feature killer |
| P3.2 | **Comparaison de contrats** : diff visuel entre 2 versions | 1 sem | High value |
| P3.3 | **Documentation API** : Swagger/OpenAPI pour /api/public/v1/* | 3 jours | Enterprise |
| P3.4 | **FAQ / Centre d'aide** : base de connaissances intégrée | 3 jours | Onboarding |

### Phase 4 — Enterprise & Scale (4+ semaines)
| # | Action | Effort | Impact |
|---|--------|--------|--------|
| P4.1 | SSO/SAML (plan Enterprise) | 1 sem | Enterprise |
| P4.2 | Portail client (accès externe pour clients du cabinet) | 3 sem | Market fit cabinets |
| P4.3 | Knowledge base par entreprise (mémoire enrichie) | 2 sem | Personnalisation |
| P4.4 | Contract redlining (suggestions inline dans l'éditeur) | 3 sem | Feature premium |
| P4.5 | Pipeline CI/CD (tests + deploy auto) | 1 sem | Qualité |

---

## SCORING DÉTAILLÉ

| Domaine | Score V4 | Score V5 | Delta | Justification |
|---------|----------|----------|-------|---------------|
| Architecture | 85 | 87 | +2 | Workflow connecté au pipeline async |
| Sécurité | 78 | 88 | +10 | 7 fixes injection + rate-limit + timeout |
| Agent IA | 65 | 82 | +17 | Smart questions + form answers + workflow |
| RAG | 82 | 84 | +2 | Authority scale fixée |
| UI/UX | 80 | 85 | +5 | Audit confirmé : responsive, dark mode, a11y |
| Data | 85 | 85 | = | Stable, 76 tables, RLS solide |
| Production-ready | 70 | 75 | +5 | Reste : Stripe, mentions légales, CI/CD |
| **GLOBAL** | **79** | **83** | **+4** | |

### Pour atteindre 90+
1. Stripe intégré (+3)
2. Mentions légales complètes (+1)
3. Pipeline IA unifié (+2)
4. Types Supabase regénérés (+1)
5. Error logging systématique (+1)
6. Analyse clause par clause (+2)

---

## VERDICT

**JurisAI est un produit fonctionnel et complet à 83%.** L'architecture est solide, le RAG est sophistiqué, les workflows IA sont uniques sur le marché français. Les fixes de cette session (agent smart, form answers, workflow connection, sécurité) ont comblé les gaps les plus critiques.

**Pour le lancement production, 3 blockers restent :**
1. 📋 Mentions légales (30 min)
2. 💳 Stripe (1 semaine)
3. 🔄 Unifier chat/agent (3 jours)

**Le positionnement est clair :** Harvey AI français, accessible (49€/mois vs 500$+), spécialisé droit français avec 97k+ sources officielles, workflows IA génératifs, et validation hiérarchique — des features qu'Harvey n'a pas dans le contexte FR.
