# 🎯 JurisAI — PLAN D'ACTION MAÎTRE

> **Objectif** : Transformer JurisAI en outil juridique d'excellence
> **Critères de succès** : Code propre, parcours parfait, RAG optimal, IA précise, data structurée
> **Méthode** : Approche industrielle, mesurable, sans compromis

---

## 📋 SOMMAIRE EXÉCUTIF

```
ÉTAT ACTUEL                    78/100  ████████████████░░░░
ÉTAT CIBLE (production excellence)  95/100  ███████████████████░

GAP À COMBLER : 17 points sur 7 axes majeurs

EFFORT TOTAL ESTIMÉ : ~6 sprints (livrable progressif)
PRIORITÉ ABSOLUE : Performance RAG + Sécurité + Parcours utilisateur
```

### Score actuel par axe (basé sur l'audit)

```
SÉCURITÉ          ████████████░░░░░  6/10
PERFORMANCE       ████████░░░░░░░░░  4/10  ← critique
PARCOURS CLIENT   ████████████░░░░░  6/10
PARCOURS ADMIN    ████████░░░░░░░░░  4/10  ← critique
FEATURES          ██████████░░░░░░░  5,4/10
QUALITÉ IA/RAG    ██████████████░░░  7/10
EDGE FUNCTIONS    ██████████░░░░░░░  5/10
─────────────────────────────────────────
GLOBAL            ██████████████░░░  5,3/10
```

---

## 📑 TABLE DES MATIÈRES

1. [Vision et principes directeurs](#1-vision-et-principes-directeurs)
2. [Architecture cible](#2-architecture-cible)
3. [SPRINT 0 — Stabilisation critique](#sprint-0--stabilisation-critique)
4. [SPRINT 1 — RAG d'excellence](#sprint-1--rag-dexcellence)
5. [SPRINT 2 — Parcours client parfait](#sprint-2--parcours-client-parfait)
6. [SPRINT 3 — Admin et opérations](#sprint-3--admin-et-opérations)
7. [SPRINT 4 — Data et ingestion industrielle](#sprint-4--data-et-ingestion-industrielle)
8. [SPRINT 5 — Qualité et observabilité](#sprint-5--qualité-et-observabilité)
9. [SPRINT 6 — Polish et excellence](#sprint-6--polish-et-excellence)
10. [Spécifications techniques détaillées](#10-spécifications-techniques-détaillées)
11. [Quality gates et critères de succès](#11-quality-gates-et-critères-de-succès)
12. [Annexes techniques](#12-annexes-techniques)

---

## 1. VISION ET PRINCIPES DIRECTEURS

### Vision produit

> **JurisAI doit devenir l'assistant juridique IA de référence pour les professionnels du droit du travail français, avec une précision, une fiabilité et une expérience utilisateur qui justifient un abonnement premium et créent une dépendance positive (l'utilisateur ne peut plus s'en passer).**

### Les 5 principes non-négociables

```
1. ZÉRO HALLUCINATION
   └─ Toute affirmation juridique = source officielle citée
   └─ Si pas de source : refus explicite + suggestion alternative
   └─ Score de confiance affiché à chaque réponse

2. SOURCES TRAÇABLES
   └─ Chaque citation cliquable → source originale
   └─ Date d'effet visible
   └─ Version actuelle vs version à la date demandée

3. INTÉGRATION MÉTIER PROFONDE
   └─ S'intègre dans le quotidien du professionnel
   └─ Pas un outil de plus, mais l'outil central
   └─ Workflow naturel, raccourcis, exports, partage

4. DATA QUALITY ABSOLUE
   └─ Sources nettoyées, structurées, datées
   └─ Versioning des textes (loi modifiée = nouvelle version)
   └─ Métadonnées riches (chambre, formation, IDCC, thème)
   └─ Pas de doublons, pas d'orphelins

5. PERFORMANCE PERÇUE
   └─ Première réponse < 1.5s
   └─ Réponse complète < 6s pour 90% des questions
   └─ Pas de spinners — skeletons et streaming partout
```

### Principes d'ingénierie

```
✅ TYPE-SAFE END-TO-END
   └─ TypeScript strict
   └─ Zod sur toutes les inputs externes
   └─ Pas de `any`, pas de `as unknown as`
   └─ Types Supabase regen après chaque migration

✅ TESTABLE
   └─ Logique métier découplée de l'infrastructure
   └─ Tests d'intégration sur server functions critiques
   └─ Tests E2E sur parcours principaux
   └─ Set d'évaluation RAG (50 Q/A référence)

✅ OBSERVABLE
   └─ Logs structurés JSON avec correlation_id
   └─ Métriques techniques (latence, erreurs, coûts)
   └─ Métriques produit (activations, retentions, NPS)
   └─ Alertes sur dégradation qualité

✅ SÉCURISÉ PAR DESIGN
   └─ RLS partout, jamais by-pass sauf nécessité absolue
   └─ JWT vérifié sur 100% des edge functions
   └─ Rate limiting sur toutes les actions utilisateur
   └─ Validation Zod sur 100% des inputs externes
   └─ Audit logs sur actions sensibles
```

---

## 2. ARCHITECTURE CIBLE

### Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND                             │
│  React 19 + TanStack Start + Tailwind v4 + shadcn/ui        │
│  ├─ Public routes : landing, signup, login, legal           │
│  ├─ Auth routes : dashboard, chat, documents, dossiers...   │
│  └─ Admin routes : connectors, sources, tenants, dashboard  │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    SERVER FUNCTIONS                          │
│  TanStack Server Functions (Cloudflare Workers)              │
│  ├─ Auth middleware sur toutes les sensibles                │
│  ├─ Validation Zod systématique                             │
│  └─ Service role pour appels admin uniquement               │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
┌──────────────┐  ┌──────────┐  ┌──────────┐
│  SUPABASE    │  │  EDGE    │  │ EXTERNAL │
│              │  │ FUNCTIONS│  │   APIs   │
│ ├─ Postgres  │  │          │  │          │
│ ├─ pgvector  │  │ ├─ Chat  │  │ ├─ PISTE │
│ ├─ Auth      │  │ ├─ Embed │  │ ├─ Lov.  │
│ ├─ Storage   │  │ ├─ Ingest│  │ ├─ Stripe│
│ └─ pg_cron   │  │ └─ Cron  │  │ └─ ...   │
└──────────────┘  └──────────┘  └──────────┘
```

### Stack consolidé

```
FRONTEND
├─ React 19
├─ TanStack Start v1 (SSR + file-based routing)
├─ Tailwind v4 (design tokens)
├─ shadcn/ui (composants accessibles)
├─ TanStack Query v5 (state management)
├─ Zod v4 (validation)
└─ TipTap v3 (éditeur documents)

BACKEND
├─ Supabase (Postgres 15 + pgvector + pg_cron)
├─ Edge Functions Deno
├─ Server Functions TanStack
└─ Cloudflare Workers (déploiement)

INTELLIGENCE
├─ Lovable AI Gateway
│  ├─ openai/text-embedding-3-small (1536d) - embeddings
│  ├─ google/gemini-3-flash-preview - chat (rapide)
│  ├─ google/gemini-3-pro - chat (qualité)
│  └─ cohere/rerank-multilingual-v3 - reranking (à ajouter)
└─ Mistral OCR (à ajouter pour PDFs scannés)

DATA SOURCES
├─ Légifrance API (PISTE OAuth) - codes + lois
├─ Judilibre API (PISTE KeyId) - jurisprudence
├─ KALI (GitHub SocialGouv) - conventions collectives
└─ CDTN (GitHub SocialGouv) - modèles courriers

OBSERVABILITÉ (à ajouter)
├─ Logs structurés Cloudflare
├─ Sentry (erreurs frontend + edge)
├─ PostHog (analytics produit)
└─ Stripe (revenus, billing)
```

---

## SPRINT 0 — STABILISATION CRITIQUE

> **Objectif** : Combler les 5 bloquants production identifiés dans l'audit
> **Durée estimée** : 2-3 jours
> **Score attendu après** : 78 → 85

### S0.1 — Audit sécurité Edge Functions (P0 SÉCURITÉ)

**Problème identifié :**
```
verify_jwt = false sur TOUTES les edge functions
└─ Chaque fonction DOIT vérifier l'auth manuellement
└─ Risque : seed-demo, seed-legal, connector-* exposés sans auth
└─ N'importe qui peut peupler/wipe la BD ou trigger ingestion abusive
```

**Actions à effectuer :**

```
ÉTAPE 1 — Créer un helper d'auth réutilisable
─────────────────────────────────────────────────
Fichier : supabase/functions/_shared/auth.ts

export async function requireUser(req: Request): Promise<{
  userId: string;
  user: User;
  supabaseUser: SupabaseClient;
}> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AuthError("Missing or invalid authorization", 401);
  }
  // ... validation JWT + récupération user
}

export async function requireSuperAdmin(req: Request): Promise<{
  userId: string;
}> {
  const { userId, supabaseUser } = await requireUser(req);
  const { data: isAdmin } = await supabaseUser.rpc("is_super_admin", {
    user_id_to_check: userId,
  });
  if (!isAdmin) {
    throw new AuthError("Super admin required", 403);
  }
  return { userId };
}

ÉTAPE 2 — Appliquer requireSuperAdmin sur fonctions sensibles
─────────────────────────────────────────────────
Fichiers à modifier :
├─ seed-demo/index.ts        → requireSuperAdmin
├─ seed-legal/index.ts       → requireSuperAdmin
├─ ingest-legal-source/      → requireSuperAdmin
├─ connector-legifrance/     → requireSuperAdmin
├─ connector-judilibre/      → requireSuperAdmin
├─ connector-kali/           → requireSuperAdmin
└─ connector-cdtn-modeles/   → requireSuperAdmin

ÉTAPE 3 — legal-chat reste en requireUser (déjà OK)

ÉTAPE 4 — Test de chaque fonction avec curl
─────────────────────────────────────────────────
# Sans auth → doit retourner 401
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/seed-demo

# Avec auth user normal → doit retourner 403
curl -X POST -H "Authorization: Bearer USER_JWT" ...

# Avec auth super_admin → doit fonctionner
curl -X POST -H "Authorization: Bearer SUPER_ADMIN_JWT" ...
```

**Critère de succès :**
- ✅ 100% des edge functions sensibles vérifient l'auth
- ✅ Test négatif : aucune fonction ne s'exécute sans bon JWT
- ✅ Tableau de bord : statut auth par fonction documenté

---

### S0.2 — Index HNSW + GIN sur legal_chunks (P0 PERFORMANCE)

**Problème identifié :**
```
Sans index HNSW :
└─ Recherche vectorielle = scan séquentiel
└─ À 100k chunks → ~5 secondes par recherche
└─ À 5M chunks (cible) → timeout systématique
```

**Migration SQL à créer :**

```sql
-- supabase/migrations/<timestamp>_add_hnsw_indexes.sql

-- ─── Index vectoriel HNSW sur legal_chunks ─────────────────
-- m=16 : nombre de connexions par node (16 = bon équilibre)
-- ef_construction=64 : qualité de construction (plus haut = meilleur recall)
CREATE INDEX IF NOT EXISTS idx_legal_chunks_embedding_hnsw
  ON public.legal_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ─── Index Full-Text Search français ───────────────────────
CREATE INDEX IF NOT EXISTS idx_legal_chunks_fts
  ON public.legal_chunks
  USING GIN (fts);

-- ─── Index sur metadata JSONB pour filtrage rapide ─────────
CREATE INDEX IF NOT EXISTS idx_legal_chunks_metadata
  ON public.legal_chunks
  USING GIN (metadata);

-- ─── Index sur source_id pour jointures ────────────────────
CREATE INDEX IF NOT EXISTS idx_legal_chunks_source_id
  ON public.legal_chunks (source_id);

-- ─── Index composite pour filtrage IDCC ────────────────────
CREATE INDEX IF NOT EXISTS idx_legal_sources_idcc_active
  ON public.legal_sources (idcc, is_active)
  WHERE is_active = TRUE;

-- ─── Index sur date pour recherche chronologique ───────────
CREATE INDEX IF NOT EXISTS idx_legal_sources_legal_date
  ON public.legal_sources (legal_date DESC NULLS LAST);

-- ─── Statistiques pour le query planner ────────────────────
ANALYZE public.legal_chunks;
ANALYZE public.legal_sources;
```

**Test de performance avant/après :**

```sql
-- Test query (à mesurer avant/après)
EXPLAIN ANALYZE
SELECT * FROM hybrid_search(
  query_embedding := '[0.1, 0.2, ...]'::vector,
  query_text := 'préavis cadre 5 ans',
  match_count := 8
);

-- AVANT index : Execution time: ~5000ms
-- APRÈS index : Execution time: ~50ms (100x amélioration)
```

**Critère de succès :**
- ✅ Indexes créés sans erreur
- ✅ EXPLAIN ANALYZE montre "Index Scan" (pas "Seq Scan")
- ✅ hybrid_search < 100ms sur 100k chunks
- ✅ hybrid_search < 500ms sur 5M chunks

---

### S0.3 — Rate Limiting sur legal-chat (P0 SÉCURITÉ + COÛTS)

**Problème identifié :**
```
Aucune limite de requêtes/minute
└─ Un user peut envoyer 1000 questions en 1 minute
└─ Coûts IA non maîtrisés
└─ DoS du service
```

**Solution proposée :**

```sql
-- supabase/migrations/<timestamp>_rate_limits.sql

-- ─── Table rate_limits (par user, par window) ──────────────
CREATE TABLE IF NOT EXISTS public.rate_limits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,                    -- 'legal-chat', 'analyze-doc', etc.
  window_start timestamptz not null,         -- début de la fenêtre (minute)
  request_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint, window_start)
);

CREATE INDEX idx_rate_limits_lookup
  ON public.rate_limits (user_id, endpoint, window_start DESC);

-- Auto-cleanup des anciennes lignes
CREATE OR REPLACE FUNCTION public.cleanup_rate_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM rate_limits
  WHERE window_start < now() - interval '1 hour';
END $$;

-- ─── Function : check_and_increment_rate_limit ─────────────
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id uuid,
  p_endpoint text,
  p_max_per_minute integer DEFAULT 10
)
RETURNS TABLE (
  allowed boolean,
  current_count integer,
  retry_after_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window timestamptz := date_trunc('minute', now());
  v_count integer;
BEGIN
  -- Lock + increment atomique
  INSERT INTO rate_limits (user_id, endpoint, window_start, request_count)
  VALUES (p_user_id, p_endpoint, v_window, 1)
  ON CONFLICT (user_id, endpoint, window_start)
  DO UPDATE SET request_count = rate_limits.request_count + 1
  RETURNING request_count INTO v_count;

  IF v_count > p_max_per_minute THEN
    RETURN QUERY SELECT
      false,
      v_count,
      EXTRACT(EPOCH FROM (v_window + interval '1 minute' - now()))::integer;
  ELSE
    RETURN QUERY SELECT true, v_count, 0;
  END IF;
END $$;

-- RLS
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own rate limits" ON rate_limits
  FOR SELECT USING (user_id = auth.uid());
```

**Intégration dans legal-chat :**

```typescript
// Au début de la fonction, après auth
const { data: rateCheck } = await supabaseAdmin.rpc("check_rate_limit", {
  p_user_id: userId,
  p_endpoint: "legal-chat",
  p_max_per_minute: 10,
});

if (!rateCheck?.[0]?.allowed) {
  return new Response(
    JSON.stringify({
      error: "Rate limit exceeded",
      retry_after_seconds: rateCheck[0].retry_after_seconds,
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Retry-After": rateCheck[0].retry_after_seconds.toString(),
      },
    }
  );
}
```

**Quotas recommandés par endpoint :**
```
legal-chat              : 10 req/min/user
analyze-document        : 5 req/min/user
generate-document       : 5 req/min/user
ingest-legal-source     : 100 req/min/user (super_admin)
connector-*             : 10 req/min/user (super_admin)
```

**Critère de succès :**
- ✅ 11ème requête en moins d'1 minute → 429 Too Many Requests
- ✅ Header Retry-After présent
- ✅ Frontend gère le 429 avec toast + countdown

---

### S0.4 — Politique RGPD : DELETE messages CASCADE (P0 LEGAL)

**Problème identifié :**
```
Aucune policy DELETE sur messages
└─ Si user demande effacement → impossible
└─ Non-conformité RGPD article 17
```

**Migration SQL :**

```sql
-- supabase/migrations/<timestamp>_rgpd_delete_policies.sql

-- ─── Cascade DELETE sur conversations → messages ───────────
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_conversation_id_fkey;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_conversation_id_fkey
  FOREIGN KEY (conversation_id)
  REFERENCES public.conversations(id)
  ON DELETE CASCADE;

-- ─── Cascade DELETE sur messages → chat_citations ──────────
ALTER TABLE public.chat_citations
  DROP CONSTRAINT IF EXISTS chat_citations_message_id_fkey;

ALTER TABLE public.chat_citations
  ADD CONSTRAINT chat_citations_message_id_fkey
  FOREIGN KEY (message_id)
  REFERENCES public.messages(id)
  ON DELETE CASCADE;

-- ─── Policy DELETE conversations (user owner) ──────────────
CREATE POLICY "Users can delete own conversations" ON public.conversations
  FOR DELETE USING (user_id = auth.uid());

-- ─── Policy DELETE conversations (admin tenant) ────────────
CREATE POLICY "Admins can delete tenant conversations" ON public.conversations
  FOR DELETE USING (
    is_member_of_tenant(tenant_id) AND has_role(tenant_id, 'admin')
  );

-- ─── Function : delete_user_account (RGPD purge) ───────────
CREATE OR REPLACE FUNCTION public.delete_user_account(
  p_user_id uuid,
  p_export_first boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_export jsonb;
BEGIN
  -- Vérifier que c'est bien l'utilisateur lui-même ou super_admin
  IF auth.uid() != p_user_id AND NOT is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Export optionnel avant suppression
  IF p_export_first THEN
    SELECT jsonb_build_object(
      'profile', (SELECT row_to_json(p) FROM profiles p WHERE id = p_user_id),
      'conversations', (
        SELECT jsonb_agg(row_to_json(c))
        FROM conversations c
        WHERE user_id = p_user_id
      ),
      'messages', (
        SELECT jsonb_agg(row_to_json(m))
        FROM messages m
        JOIN conversations c ON m.conversation_id = c.id
        WHERE c.user_id = p_user_id
      ),
      'documents', (
        SELECT jsonb_agg(row_to_json(d))
        FROM documents d
        WHERE created_by = p_user_id
      )
    ) INTO v_export;
  END IF;

  -- Suppression cascade (auth.users → profiles via trigger ou cascade)
  DELETE FROM auth.users WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'export', v_export,
    'deleted_at', now()
  );
END $$;
```

**Edge function : `delete-account` :**

```
supabase/functions/delete-account/index.ts
└─ Auth user
└─ Confirme l'identité (re-saisie email)
└─ Appelle delete_user_account(p_export_first=true)
└─ Retourne le JSON d'export
└─ User peut télécharger l'archive
└─ Compte supprimé
└─ Email confirmation
```

**UI : ajouter dans `/settings`**

```tsx
// src/routes/_authenticated/settings.tsx

<Card variant="destructive">
  <CardHeader>
    <CardTitle>Zone dangereuse</CardTitle>
  </CardHeader>
  <CardContent>
    <Button
      variant="destructive"
      onClick={() => openDeleteAccountDialog()}
    >
      Supprimer définitivement mon compte (RGPD)
    </Button>
    <p className="text-sm text-muted-foreground mt-2">
      Vos données seront exportées puis supprimées définitivement.
      Cette action est irréversible.
    </p>
  </CardContent>
</Card>
```

**Critère de succès :**
- ✅ User peut supprimer son compte depuis /settings
- ✅ Export JSON téléchargé avant suppression
- ✅ Toutes les données purgées (conversations, messages, documents)
- ✅ Compte auth.users supprimé
- ✅ Email confirmation envoyé

---

### S0.5 — Configuration Credentials PISTE (P0 DATA)

**Problème identifié :**
```
Connecteurs Légifrance + Judilibre prêts mais inactifs
└─ LEGIFRANCE_OAUTH_ID manquant
└─ LEGIFRANCE_OAUTH_SECRET manquant
└─ JUDILIBRE_KEY_ID manquant
```

**Procédure utilisateur :**

```
ÉTAPE 1 — Créer compte PISTE
─────────────────────────────
URL : https://piste.gouv.fr/registration
Délai : 5 minutes
Validation : email automatique

ÉTAPE 2 — Créer application Sandbox
─────────────────────────────
Dashboard PISTE → Mes applications → Nouvelle
Type : SANDBOX (créée automatiquement)

ÉTAPE 3 — Souscrire APIs
─────────────────────────────
Dans application Sandbox :
├─ Modifier l'application
├─ Sélectionner les API :
│   ├─ ✅ Légifrance API v2.4.2
│   └─ ✅ Cour de cassation Judilibre v1.0.0
├─ Accepter les CGU des deux APIs
└─ Sauvegarder

ÉTAPE 4 — Récupérer credentials
─────────────────────────────
Dans application → API souscrites → Identifiants OAuth
├─ LEGIFRANCE_OAUTH_ID (Client ID)
├─ LEGIFRANCE_OAUTH_SECRET (Client Secret)
└─ JUDILIBRE_KEY_ID (KeyId séparé)

ÉTAPE 5 — Stocker dans Supabase Vault
─────────────────────────────
Supabase Dashboard → Edge Functions → Secrets
Ajouter :
├─ LEGIFRANCE_OAUTH_ID = <valeur>
├─ LEGIFRANCE_OAUTH_SECRET = <valeur>
├─ JUDILIBRE_KEY_ID = <valeur>
└─ PISTE_SANDBOX = "1" (pour utiliser sandbox)
```

**Test de validation :**

```bash
# Test 1 : OAuth Légifrance
curl -X POST https://sandbox-oauth.piste.gouv.fr/api/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=$LEGIFRANCE_OAUTH_ID" \
  -d "client_secret=$LEGIFRANCE_OAUTH_SECRET" \
  -d "scope=openid"

# Doit retourner : {"access_token":"...","expires_in":3600,...}

# Test 2 : Ping Légifrance
TOKEN="<token de l'étape 1>"
curl -H "Authorization: Bearer $TOKEN" \
  https://sandbox-api.piste.gouv.fr/dila/legifrance/lf-engine-app/list/ping

# Doit retourner : "pong"

# Test 3 : Ping Judilibre
curl -H "KeyId: $JUDILIBRE_KEY_ID" \
  https://sandbox-api.piste.gouv.fr/cassation/judilibre/v1.0/healthcheck

# Doit retourner : {"status":"ok"}
```

**Test depuis l'app :**

```
Aller sur /admin/connectors
└─ Cliquer "Tester Légifrance" (dry_run=true)
└─ Doit afficher : "X articles trouvés dans Code du travail"
└─ Aucune erreur 401/403
```

**Critère de succès :**
- ✅ 3 secrets configurés dans Supabase Vault
- ✅ Test OAuth retourne un access_token valide
- ✅ Test /ping retourne "pong"
- ✅ Connector dry_run réussi depuis l'admin

---

### Récap Sprint 0

```
EFFORT     : 2-3 jours
SCORE GAIN : +7 points (78 → 85)

LIVRABLES :
✅ Toutes les edge functions auth-vérifiées
✅ Index HNSW + GIN créés
✅ Rate limiting actif
✅ Conformité RGPD (delete account)
✅ Credentials PISTE configurés
✅ Premier test ingestion réussi (dry_run)
```

---

## SPRINT 1 — RAG D'EXCELLENCE

> **Objectif** : Transformer un RAG fonctionnel en RAG de référence
> **Durée estimée** : 4-5 jours
> **Score attendu après** : 85 → 90 (axe IA : 7 → 9)

### S1.1 — Chunking sémantique avancé

**Problème identifié :**
```
Chunking actuel = naïf (split par 3200 chars)
└─ Pour le code juridique, casse le sens
└─ Article L1234-1 peut être coupé en 2 chunks
└─ Référence légale perdue
```

**Solution proposée :**

```typescript
// supabase/functions/_shared/chunking.ts (nouveau)

interface ChunkingStrategy {
  type: "code" | "jurisprudence" | "convention" | "doctrine" | "generic";
  splitter: (text: string, metadata: any) => Chunk[];
}

const STRATEGIES: Record<string, ChunkingStrategy> = {
  // Pour les codes (Travail, Civil, etc.)
  code: {
    type: "code",
    splitter: (text, metadata) => {
      // Découpage par article : "Article L1234-1", "Article R1234-1", etc.
      const articleRegex = /^(Article\s+[LRD]?\d+(?:-\d+)*)/gm;
      const articles = text.split(articleRegex).filter(Boolean);

      const chunks: Chunk[] = [];
      let currentArticle = "";

      for (let i = 0; i < articles.length; i++) {
        if (articles[i].match(articleRegex)) {
          currentArticle = articles[i].trim();
        } else {
          const content = articles[i].trim();
          if (currentArticle && content) {
            chunks.push({
              heading: currentArticle,
              content: content.slice(0, 4000), // Cap pour gros articles
              metadata: {
                ...metadata,
                article_number: currentArticle,
                chunk_strategy: "code",
              },
            });

            // Si > 4000 chars, créer chunks supplémentaires avec overlap
            if (content.length > 4000) {
              const remaining = content.slice(3800); // overlap 200 chars
              chunks.push({
                heading: `${currentArticle} (suite)`,
                content: remaining.slice(0, 4000),
                metadata: { ...metadata, article_number: currentArticle, part: 2 },
              });
            }
          }
        }
      }

      return chunks;
    },
  },

  // Pour la jurisprudence (décisions)
  jurisprudence: {
    type: "jurisprudence",
    splitter: (text, metadata) => {
      // Sections classiques d'un arrêt
      const sections = [
        /Vu (?:l['e]|les?)\s+(?:article|articles?)/i, // Visa
        /Attendu que/i,                                // Motifs
        /Par ces motifs/i,                             // Dispositif
      ];

      // Découpe par sections
      // Garde le contexte (chambre, formation, date)
      // Préserve les citations d'articles
      // ... logique avancée
      return chunks;
    },
  },

  convention: {
    type: "convention",
    splitter: (text, metadata) => {
      // Découpage par titre/article de la convention
      // Préserve l'IDCC dans chaque chunk
      // ... logique
      return chunks;
    },
  },
};

export function smartChunk(
  text: string,
  sourceType: string,
  metadata: Record<string, any>
): Chunk[] {
  const strategy = STRATEGIES[sourceType] ?? STRATEGIES.generic;
  return strategy.splitter(text, metadata);
}
```

**Avantages mesurables :**
- Précision RAG : +15-20%
- Pas d'article coupé arbitrairement
- Chunks plus petits = plus précis
- Métadonnées riches pour filtrage

---

### S1.2 — Re-ranker (cross-encoder)

**Problème identifié :**
```
hybrid_search retourne 8 chunks via RRF brut
└─ Top 8 pas forcément les meilleurs
└─ Bruit dans le contexte LLM
└─ Risque hallucinations augmenté
```

**Solution proposée :**

```typescript
// supabase/functions/_shared/reranker.ts

const RERANK_URL = "https://ai.gateway.lovable.dev/v1/rerank";
const RERANK_MODEL = "cohere/rerank-multilingual-v3";

export async function rerank(
  apiKey: string,
  query: string,
  documents: Array<{ id: string; content: string }>,
  topN: number = 4
): Promise<Array<{ id: string; content: string; relevance_score: number }>> {
  const res = await fetch(RERANK_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: RERANK_MODEL,
      query,
      documents: documents.map((d) => d.content),
      top_n: topN,
      return_documents: false,
    }),
  });

  if (!res.ok) {
    // Fallback : retourne les documents sans rerank
    console.error("Rerank failed, falling back to original order");
    return documents.slice(0, topN).map((d) => ({
      ...d,
      relevance_score: 0,
    }));
  }

  const json = await res.json();
  // Cohere retourne [{index, relevance_score}, ...]
  return json.results.map((r: any) => ({
    ...documents[r.index],
    relevance_score: r.relevance_score,
  }));
}
```

**Pipeline RAG mis à jour :**

```
USER question
  ↓
1. Embed query (1536d)                   ~150ms
2. hybrid_search → top 20 chunks         ~50ms
3. Rerank → top 4 chunks pertinents      ~200ms
4. Filter by relevance_score > 0.5       ~5ms
5. Build prompt with 4 best chunks       ~10ms
6. Stream LLM                            ~1500ms première tok
─────────────────────────────────────────
Total avant streaming : ~415ms
```

**Avantages mesurables :**
- Précision RAG : +20-25%
- Moins de chunks = prompt plus court = LLM plus précis
- Score de relevance utilisable pour "je ne sais pas"

---

### S1.3 — Garde-fous IA (anti-hallucinations)

**Problème identifié :**
```
Même avec sources, Gemini peut générer du texte sans citation
└─ Pas de détection automatique
└─ Pas de signal "réponse non sourcée"
```

**Solutions à implémenter :**

#### 1. Confidence threshold (refus si pas de sources pertinentes)

```typescript
// Dans legal-chat, après rerank
const MIN_RELEVANCE = 0.5;
const goodChunks = rerankedChunks.filter(
  (c) => c.relevance_score >= MIN_RELEVANCE
);

if (goodChunks.length === 0) {
  // Réponse "je ne sais pas" forcée
  const response = `⚠️ **Aucune source officielle pertinente trouvée**

Votre question porte sur un sujet pour lequel je n'ai pas de réponse fiable
dans mes sources actuelles (Code du travail, jurisprudence Cour de cassation,
conventions collectives).

**Suggestions :**
- Reformulez votre question avec des termes plus précis
- Consultez un avocat spécialisé en droit du travail
- Si votre question concerne un cas urgent, contactez l'inspection du travail
- Vérifiez votre convention collective directement

Je peux vous aider sur d'autres questions juridiques.`;

  // Stream cette réponse + insert message + skip LLM call
  return streamFallback(response);
}
```

#### 2. Détection post-réponse de paragraphes non sourcés

```typescript
// Après le streaming complet
function annotateUnsourced(content: string): {
  annotated: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  const lines = content.split("\n");
  const annotated = lines.map((line, i) => {
    // Ignorer titres, listes vides
    if (line.startsWith("#") || line.startsWith("-") || line.trim().length < 50) {
      return line;
    }

    // Vérifier présence d'au moins une citation [source:N]
    const hasCitation = /\[source:\d+\]/.test(line);
    if (!hasCitation && /\b(article|loi|décret|convention)\b/i.test(line)) {
      warnings.push(`Ligne ${i + 1}: affirmation juridique sans citation`);
      return `${line}  ⚠️ *non sourcé*`;
    }

    return line;
  });

  return {
    annotated: annotated.join("\n"),
    warnings,
  };
}
```

#### 3. Sanitization anti-prompt injection

```typescript
// Dans legal-chat, avant utilisation du content user
function sanitizeUserMessage(content: string): string {
  // Truncate à une longueur max
  let safe = content.slice(0, 4000);

  // Remove common prompt injection patterns
  const patterns = [
    /ignore (previous|above|all) instructions?/gi,
    /you are now/gi,
    /system prompt:/gi,
    /\[system\]/gi,
    /\[admin\]/gi,
    /<\|.*?\|>/g, // Tokens spéciaux LLM
  ];

  for (const p of patterns) {
    if (p.test(safe)) {
      console.warn("Prompt injection attempt detected", { content });
      // Ne pas bloquer, mais flagger pour audit
    }
  }

  return safe;
}
```

#### 4. Score de confiance affiché à l'utilisateur

```typescript
// Calcul de confiance basé sur scores rerank
function calculateConfidence(
  chunks: Array<{ relevance_score: number }>
): number {
  if (chunks.length === 0) return 0;
  const avgScore = chunks.reduce((s, c) => s + c.relevance_score, 0) / chunks.length;
  const topScore = chunks[0]?.relevance_score ?? 0;

  // Confiance pondérée
  return Math.round((avgScore * 0.4 + topScore * 0.6) * 100);
}

// Dans le SSE stream
const confidence = calculateConfidence(goodChunks);
controller.enqueue(
  `event: confidence\ndata: ${JSON.stringify({ score: confidence })}\n\n`
);
```

**UI : afficher confidence indicator**

```tsx
// src/components/chat/ConfidenceIndicator.tsx (nouveau)

export function ConfidenceIndicator({ score }: { score: number }) {
  const variant = score >= 80 ? "success" : score >= 60 ? "warning" : "danger";
  const label = score >= 80 ? "Élevée" : score >= 60 ? "Modérée" : "Faible";

  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full ${
            variant === "success" ? "bg-green-500"
            : variant === "warning" ? "bg-amber-500"
            : "bg-red-500"
          }`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-muted-foreground">
        Confiance {label} ({score}%)
      </span>
    </div>
  );
}
```

---

### S1.4 — Cache d'embeddings (économie + perf)

**Problème identifié :**
```
Même question posée 2x → re-embed (150ms + coût)
└─ Coût annuel inutile : ~50€ pour 100k questions répétées
└─ Latence de 150ms évitable
```

**Solution :**

```sql
-- Migration : cache_embeddings
CREATE TABLE IF NOT EXISTS public.embeddings_cache (
  id uuid primary key default gen_random_uuid(),
  query_hash text not null unique,           -- SHA-256 de la query normalisée
  query_text text not null,                  -- Pour debug
  embedding vector(1536) not null,
  hit_count integer not null default 1,
  created_at timestamptz not null default now(),
  last_hit_at timestamptz not null default now()
);

CREATE INDEX idx_embeddings_cache_hash ON embeddings_cache(query_hash);
CREATE INDEX idx_embeddings_cache_lru ON embeddings_cache(last_hit_at DESC);

-- Cleanup auto : garde max 50k entrées (LRU)
CREATE OR REPLACE FUNCTION public.cleanup_embeddings_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM embeddings_cache
  WHERE id IN (
    SELECT id FROM embeddings_cache
    ORDER BY last_hit_at ASC
    OFFSET 50000
  );
END $$;

-- Cron mensuel
SELECT cron.schedule(
  'cleanup-embeddings-cache',
  '0 4 1 * *',
  'SELECT public.cleanup_embeddings_cache();'
);
```

**Helper :**

```typescript
// supabase/functions/_shared/embeddings.ts

import { createHash } from "node:crypto";

function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\w\sàâäéèêëïîôöùûüÿç-]/g, "");
}

function hashQuery(query: string): string {
  const normalized = normalizeQuery(query);
  return createHash("sha256").update(normalized).digest("hex");
}

export async function embedQueryWithCache(
  apiKey: string,
  supabaseAdmin: SupabaseClient,
  query: string
): Promise<number[]> {
  const hash = hashQuery(query);

  // 1. Check cache
  const { data: cached } = await supabaseAdmin
    .from("embeddings_cache")
    .select("embedding, id")
    .eq("query_hash", hash)
    .single();

  if (cached?.embedding) {
    // Update hit_count + last_hit_at (async, fire-and-forget)
    supabaseAdmin
      .from("embeddings_cache")
      .update({
        hit_count: supabaseAdmin.sql`hit_count + 1`,
        last_hit_at: new Date().toISOString(),
      })
      .eq("id", cached.id)
      .then(() => {});

    return cached.embedding as number[];
  }

  // 2. Cache miss → embed + insert
  const [embedding] = await embedTexts(apiKey, [query]);

  // Insert async (fire-and-forget, on conflict do nothing)
  supabaseAdmin
    .from("embeddings_cache")
    .insert({ query_hash: hash, query_text: query, embedding })
    .then(() => {});

  return embedding;
}
```

**Économies attendues :**
- Hit rate cible : 30-40% (questions répétées)
- Économie embeddings : ~30€/an pour 100k questions
- Latence économisée : 50ms par hit

---

### S1.5 — Timeout + Retry + Fallback modèle LLM

**Problème identifié :**
```
Pas de timeout → si gateway hang, blocage 150s
Pas de retry → erreur transitoire = échec
Pas de fallback → si gemini-3-flash KO, rien
```

**Solution :**

```typescript
// supabase/functions/_shared/llm.ts (nouveau)

const PRIMARY_MODEL = "google/gemini-3-flash-preview";
const FALLBACK_MODEL = "google/gemini-3-pro-preview";
const TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;

export async function streamChat(opts: {
  apiKey: string;
  messages: Array<{ role: string; content: string }>;
  systemPrompt: string;
  onToken: (token: string) => void;
  onError?: (err: Error) => void;
}): Promise<{ model: string; tokens: number }> {
  const models = [PRIMARY_MODEL, FALLBACK_MODEL];

  for (const model of models) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await streamChatAttempt({
          model,
          ...opts,
          timeoutMs: TIMEOUT_MS,
        });
        return { model, tokens: result.tokens };
      } catch (err) {
        const isTransient =
          err instanceof TimeoutError ||
          (err as any).status === 429 ||
          (err as any).status === 500 ||
          (err as any).status === 503;

        if (!isTransient || attempt === MAX_RETRIES - 1) {
          // Pass to next model
          break;
        }

        // Exponential backoff
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }

  throw new Error("All LLM attempts failed");
}

async function streamChatAttempt(opts: {
  model: string;
  apiKey: string;
  messages: Array<{ role: string; content: string }>;
  systemPrompt: string;
  onToken: (token: string) => void;
  timeoutMs: number;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          { role: "system", content: opts.systemPrompt },
          ...opts.messages,
        ],
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = new Error(`LLM ${opts.model} error ${res.status}`);
      (err as any).status = res.status;
      throw err;
    }

    // Parse SSE stream
    let totalTokens = 0;
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const json = JSON.parse(data);
            const token = json.choices?.[0]?.delta?.content;
            if (token) {
              opts.onToken(token);
              totalTokens++;
            }
          } catch {}
        }
      }
    }

    return { tokens: totalTokens };
  } finally {
    clearTimeout(timeout);
  }
}
```

**Avantages :**
- ✅ Timeout 60s strict (pas de blocage edge function)
- ✅ Retry 2x avec backoff exponentiel
- ✅ Fallback automatique vers Gemini Pro si Flash KO
- ✅ Logs détaillés pour debugging

---

### Récap Sprint 1

```
EFFORT     : 4-5 jours
SCORE GAIN : +5 points (85 → 90)

LIVRABLES :
✅ Chunking sémantique par type de source
✅ Re-ranker Cohere (8→4 chunks pertinents)
✅ Garde-fous anti-hallucination
✅ Score de confiance affiché
✅ Cache d'embeddings (économies + perf)
✅ Timeout + retry + fallback LLM

MÉTRIQUES CIBLES :
├─ Précision RAG : 65% → 85%
├─ Hallucinations détectées : <5% des réponses
├─ Latence p95 : 6s → 4s
└─ Hit rate cache : 30%+
```

---

## SPRINT 2 — PARCOURS CLIENT PARFAIT

> **Objectif** : Lever toutes les frictions du parcours utilisateur
> **Durée estimée** : 5-7 jours
> **Score attendu après** : 90 → 92 (axe parcours : 6 → 9)

### S2.1 — Onboarding wizard avec autocomplete IDCC

**Problème actuel :**
```
IDCC saisie libre
└─ User tape "1486" vs "01486" → casse filtre RAG
└─ Pas de validation
└─ Pas d'aide
```

**Solution :**

```tsx
// src/components/onboarding/IdccCombobox.tsx (nouveau)

import { Combobox } from "@/components/ui/combobox";
import { useQuery } from "@tanstack/react-query";

export function IdccCombobox({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (idcc: string, name: string) => void;
}) {
  const { data: ccs } = useQuery({
    queryKey: ["conventions_collectives_active"],
    queryFn: async () => {
      const { data } = await supabase
        .from("conventions_collectives")
        .select("idcc, name, effectif")
        .eq("status", "active")
        .order("effectif", { ascending: false, nullsFirst: false });
      return data;
    },
  });

  return (
    <Combobox
      value={value}
      onSelect={(item) => onChange(item.idcc, item.name)}
      placeholder="Recherchez votre convention collective..."
      searchPlaceholder="Tapez 'syntec', '1486', 'hôtels'..."
      items={ccs ?? []}
      renderItem={(cc) => (
        <div className="flex items-center justify-between w-full">
          <div>
            <div className="font-medium">{cc.name}</div>
            <div className="text-xs text-muted-foreground">
              IDCC {cc.idcc} · {cc.effectif?.toLocaleString()} salariés
            </div>
          </div>
        </div>
      )}
      searchFn={(query, item) => {
        const q = query.toLowerCase();
        return (
          item.name.toLowerCase().includes(q) ||
          item.idcc.includes(q) ||
          item.short_name?.toLowerCase().includes(q)
        );
      }}
      emptyText="Aucune convention trouvée. Skip si vous ne savez pas."
    />
  );
}
```

**Wizard onboarding amélioré :**

```
ÉTAPE 1 — Bienvenue (5 sec)
├─ Animation logo
├─ "Bienvenue Madjid 👋"
└─ "On va personnaliser JurisAI pour vous"

ÉTAPE 2 — Votre profil (30 sec)
├─ Nom complet (pré-rempli depuis email)
├─ Poste : combobox (DRH, Comptable, DAF, Dirigeant, RH freelance, Avocat)
└─ Téléphone optionnel

ÉTAPE 3 — Votre entreprise (1 min)
├─ Nom entreprise
├─ SIRET (optionnel mais validé si saisi via API INPI)
├─ Taille (1-10, 10-50, 50-200, 200+)
└─ Secteur d'activité (NAF, autocomplete)

ÉTAPE 4 — Votre convention collective (30 sec)
├─ IdccCombobox autocomplete
├─ Bouton "Skip - je ne sais pas"
└─ "On pourra l'ajouter plus tard"

ÉTAPE 5 — Inviter votre équipe (optionnel)
├─ Champ email × 3 (optionnel)
└─ Bouton "Skip"

ÉTAPE 6 — Premier exemple
├─ "Posons votre première question :"
├─ 3 exemples cliquables (RH, Paie, Contrats)
└─ Redirige vers /chat avec question pré-remplie
```

---

### S2.2 — Quota visible permanent dans AppShell

**Problème actuel :**
```
User ne sait pas combien de questions restantes
└─ Surprise désagréable au quota dépassé
└─ Pas d'incitation à upgrader
```

**Solution UI :**

```tsx
// src/components/app/QuotaBadge.tsx (nouveau)

export function QuotaBadge() {
  const { data: tenant } = useQuery({
    queryKey: ["current_tenant"],
    queryFn: fetchCurrentTenant,
    refetchInterval: 30_000, // Refresh toutes les 30s
  });

  if (!tenant) return null;

  const used = tenant.questions_used;
  const limit = tenant.quota_questions;
  const percent = (used / limit) * 100;
  const variant = percent >= 90 ? "danger" : percent >= 70 ? "warning" : "default";

  const daysUntilReset = Math.ceil(
    (new Date(tenant.quota_reset_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );

  return (
    <div className="px-3 py-2 rounded-lg bg-muted/50">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-muted-foreground">
          Questions ce mois
        </span>
        <span className={cn("text-xs font-semibold", {
          "text-red-600": variant === "danger",
          "text-amber-600": variant === "warning",
        })}>
          {used} / {limit}
        </span>
      </div>
      <Progress value={percent} className="h-1" variant={variant} />
      <div className="flex items-center justify-between mt-1">
        <span className="text-xs text-muted-foreground">
          Reset dans {daysUntilReset}j
        </span>
        {percent >= 70 && (
          <Link to="/settings/billing" className="text-xs text-primary hover:underline">
            Upgrader →
          </Link>
        )}
      </div>
    </div>
  );
}

// Intégration dans AppShell
<aside className="w-[244px] border-r flex flex-col">
  <Logo />
  <Nav />
  <div className="mt-auto p-3 space-y-3">
    <QuotaBadge />
    <UserMenu />
  </div>
</aside>
```

---

### S2.3 — Mobile responsive complet

**Problème actuel :**
```
AppShell : sidebar 244px sans breakpoint
└─ Cassé en <768px
└─ Mobile inutilisable
```

**Solution :**

```tsx
// src/components/app/AppShell.tsx (refonte)

import { useMediaQuery } from "@/hooks/use-mobile";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

export function AppShell({ children }: { children: React.ReactNode }) {
  const isMobile = useMediaQuery("(max-width: 1024px)");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (isMobile) {
    return (
      <div className="min-h-screen flex flex-col">
        {/* Mobile topbar */}
        <header className="h-14 border-b flex items-center justify-between px-4 sticky top-0 bg-background z-50">
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[280px] p-0">
              <SidebarContent onNavigate={() => setSidebarOpen(false)} />
            </SheetContent>
          </Sheet>

          <Logo size="sm" />

          <UserMenuCompact />
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    );
  }

  // Desktop layout (existant amélioré)
  return (
    <div className="min-h-screen flex">
      <aside className="w-[244px] border-r flex flex-col h-screen sticky top-0">
        <SidebarContent />
      </aside>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
```

**Breakpoints à respecter :**
```
Mobile  : < 768px   → drawer sidebar, 1 colonne
Tablet  : 768-1024  → drawer sidebar, layout adapté
Desktop : > 1024px  → sidebar fixe 244px
```

**Pages à adapter :**
- ✅ `/dashboard` : grilles 1 col mobile, 2-3 col desktop
- ✅ `/chat` : sidebar conversations en drawer mobile
- ✅ `/documents` : liste + détail en stack mobile
- ✅ `/dossiers` : tableau scroll horizontal mobile
- ✅ `/settings` : tabs verticaux mobile, horizontaux desktop

---

### S2.4 — Recherche globale Cmd+K

**Solution :**

```tsx
// src/components/app/CommandPalette.tsx (nouveau)

import { Command, CommandDialog, CommandInput, CommandList } from "@/components/ui/command";
import { useNavigate } from "@tanstack/react-router";

const SHORTCUTS = [
  { id: "new-chat", label: "Nouvelle conversation", icon: MessageCircle, shortcut: "⌘N", action: "/chat?new=1" },
  { id: "new-document", label: "Nouveau document", icon: FileText, shortcut: "⌘D", action: "/documents/new" },
  { id: "analyze", label: "Analyser un fichier", icon: ScanText, shortcut: "⌘A", action: "/analyses" },
  { id: "team", label: "Inviter un membre", icon: UserPlus, action: "/team" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  // Open with Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Rechercher actions, conversations, documents..." />
      <CommandList>
        <CommandGroup heading="Actions rapides">
          {SHORTCUTS.map((s) => (
            <CommandItem
              key={s.id}
              onSelect={() => {
                navigate({ to: s.action });
                setOpen(false);
              }}
            >
              <s.icon className="mr-2 size-4" />
              <span>{s.label}</span>
              {s.shortcut && (
                <CommandShortcut>{s.shortcut}</CommandShortcut>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        <RecentConversationsGroup query={query} onSelect={...} />
        <RecentDocumentsGroup query={query} onSelect={...} />
        <SettingsGroup query={query} onSelect={...} />
      </CommandList>
    </CommandDialog>
  );
}
```

---

### S2.5 — Feedback IA (👍/👎)

**Migration SQL :**

```sql
CREATE TABLE IF NOT EXISTS public.message_feedback (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating text not null check (rating in ('positive', 'negative')),
  reason text check (reason in (
    'inaccurate', 'outdated', 'incomplete', 'not_helpful',
    'great_answer', 'precise_sources', 'well_structured'
  )),
  comment text,
  created_at timestamptz not null default now(),
  unique (message_id, user_id)
);

ALTER TABLE message_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own feedback" ON message_feedback
  FOR ALL USING (user_id = auth.uid());
```

**UI :**

```tsx
// src/components/chat/MessageFeedback.tsx

export function MessageFeedback({ messageId }: { messageId: string }) {
  const [rating, setRating] = useState<"positive" | "negative" | null>(null);
  const [showReason, setShowReason] = useState(false);

  const submitFeedback = useMutation({
    mutationFn: async ({ rating, reason, comment }: any) => {
      await supabase.from("message_feedback").upsert({
        message_id: messageId,
        rating,
        reason,
        comment,
      });
    },
  });

  return (
    <div className="flex items-center gap-1 mt-2">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => {
          setRating("positive");
          submitFeedback.mutate({ rating: "positive" });
        }}
      >
        <ThumbsUp className={cn("size-4", rating === "positive" && "fill-green-500")} />
      </Button>

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => {
          setRating("negative");
          setShowReason(true);
        }}
      >
        <ThumbsDown className={cn("size-4", rating === "negative" && "fill-red-500")} />
      </Button>

      {showReason && rating === "negative" && (
        <FeedbackReasonDialog
          onSubmit={(reason, comment) => {
            submitFeedback.mutate({ rating: "negative", reason, comment });
            setShowReason(false);
          }}
        />
      )}

      <Button variant="ghost" size="icon-sm">
        <Copy className="size-4" />
      </Button>

      <Button variant="ghost" size="icon-sm">
        <RefreshCw className="size-4" /> {/* Régénérer */}
      </Button>
    </div>
  );
}
```

---

### S2.6 — Page suppression compte (RGPD UI)

```tsx
// src/routes/_authenticated/settings.tsx (ajout section)

<Card variant="destructive" className="mt-8">
  <CardHeader>
    <CardTitle className="text-destructive">Zone de danger</CardTitle>
    <CardDescription>
      Actions irréversibles concernant votre compte
    </CardDescription>
  </CardHeader>

  <CardContent className="space-y-4">
    <div>
      <h3 className="font-medium">Exporter mes données (RGPD)</h3>
      <p className="text-sm text-muted-foreground mb-2">
        Téléchargez toutes vos données personnelles au format JSON.
      </p>
      <Button variant="outline" onClick={exportMyData}>
        <Download className="mr-2 size-4" />
        Télécharger mes données
      </Button>
    </div>

    <Separator />

    <div>
      <h3 className="font-medium">Supprimer mon compte</h3>
      <p className="text-sm text-muted-foreground mb-2">
        Toutes vos données seront exportées puis supprimées définitivement.
        Cette action est <strong>irréversible</strong>.
      </p>
      <DeleteAccountDialog>
        <Button variant="destructive">
          <Trash2 className="mr-2 size-4" />
          Supprimer définitivement mon compte
        </Button>
      </DeleteAccountDialog>
    </div>
  </CardContent>
</Card>
```

---

### S2.7 — Email branding (confirmation, invitation, reset)

**Templates Supabase à customiser :**

```html
<!-- Email confirmation -->
<!DOCTYPE html>
<html>
<head>
  <style>
    .container { max-width: 560px; margin: 0 auto; font-family: 'Inter', sans-serif; }
    .header { background: #0F172A; padding: 32px; text-align: center; }
    .logo { color: white; font-size: 24px; font-weight: 700; }
    .content { padding: 32px; }
    .button {
      display: inline-block;
      background: #6366F1;
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 500;
    }
    .footer { padding: 16px 32px; color: #64748B; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">JurisAI</div>
    </div>

    <div class="content">
      <h1>Confirmez votre adresse email</h1>
      <p>Bonjour,</p>
      <p>Vous venez de créer votre compte JurisAI. Cliquez sur le bouton ci-dessous pour confirmer votre adresse email :</p>
      <p style="text-align: center; margin: 32px 0;">
        <a href="{{ .ConfirmationURL }}" class="button">Confirmer mon email</a>
      </p>
      <p style="color: #64748B; font-size: 14px;">
        Ou copiez ce lien : {{ .ConfirmationURL }}
      </p>
    </div>

    <div class="footer">
      <p>JurisAI · Assistant juridique IA pour les pros</p>
      <p>Vous recevez cet email car une inscription a été effectuée avec votre adresse.</p>
    </div>
  </div>
</body>
</html>
```

À configurer dans Supabase Dashboard → Authentication → Email Templates.

---

### Récap Sprint 2

```
EFFORT     : 5-7 jours
SCORE GAIN : +2 points (90 → 92)

LIVRABLES :
✅ Onboarding wizard avec autocomplete IDCC
✅ Quota visible permanent
✅ Mobile responsive 100%
✅ Cmd+K command palette
✅ Feedback 👍/👎 sur réponses
✅ Suppression compte RGPD UI
✅ Emails brandés JurisAI
```

---

## SPRINT 3 — ADMIN ET OPÉRATIONS

> **Objectif** : Outils complets pour piloter la plateforme
> **Durée estimée** : 4-5 jours
> **Score attendu après** : 92 → 94 (axe admin : 4 → 9)

### S3.1 — Dashboard super_admin

**Page `/admin/dashboard` :**

```tsx
// src/routes/_authenticated/admin/dashboard.tsx

export function AdminDashboard() {
  const { data: stats } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: fetchAdminStats,
    refetchInterval: 60_000,
  });

  return (
    <div className="container py-8 space-y-6">
      <h1 className="text-3xl font-bold">Dashboard Plateforme</h1>

      {/* KPIs principaux */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard
          title="Tenants actifs"
          value={stats?.tenants_total}
          delta={stats?.tenants_delta_30d}
          icon={Building}
        />
        <KpiCard
          title="Utilisateurs"
          value={stats?.users_total}
          delta={stats?.users_delta_30d}
          icon={Users}
        />
        <KpiCard
          title="Questions / 30j"
          value={stats?.questions_30d}
          delta={stats?.questions_delta_30d}
          icon={MessageCircle}
        />
        <KpiCard
          title="Coût IA / mois"
          value={`${stats?.ai_cost_30d}€`}
          delta={stats?.ai_cost_delta}
          icon={DollarSign}
        />
      </div>

      {/* Graphes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Questions par jour (30j)</CardTitle>
          </CardHeader>
          <CardContent>
            <LineChart data={stats?.questions_per_day} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top tenants par usage</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart data={stats?.top_tenants} />
          </CardContent>
        </Card>
      </div>

      {/* Santé technique */}
      <Card>
        <CardHeader>
          <CardTitle>Santé technique</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Légifrance" value={stats?.legifrance_status} variant="success" />
            <Stat label="Judilibre" value={stats?.judilibre_status} variant="success" />
            <Stat label="LLM Gateway" value={stats?.llm_status} variant="success" />
            <Stat label="Embeddings" value={stats?.embeddings_status} variant="success" />
          </div>
        </CardContent>
      </Card>

      {/* Alertes */}
      <Card>
        <CardHeader>
          <CardTitle>Alertes récentes</CardTitle>
        </CardHeader>
        <CardContent>
          <AlertsList />
        </CardContent>
      </Card>
    </div>
  );
}
```

**Server function :**

```typescript
// src/server/admin-dashboard.functions.ts

export const fetchAdminStats = createServerFn()
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.user.id);

    const supabaseAdmin = getServiceRoleClient();

    const [
      tenantsTotal,
      usersTotal,
      questionsLast30,
      aiCost,
      questionsPerDay,
      topTenants,
    ] = await Promise.all([
      supabaseAdmin.from("tenants").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
      // ... requêtes
    ]);

    return {
      tenants_total: tenantsTotal.count,
      users_total: usersTotal.count,
      // ...
    };
  });
```

---

### S3.2 — Gestion des tenants

**Page `/admin/tenants` :**

```
Fonctionnalités :
├─ Liste de tous les tenants (paginated)
├─ Filtres : plan, statut, IDCC, taille
├─ Recherche par nom/SIRET
├─ Actions :
│   ├─ Voir détail (membres, usage, conversations)
│   ├─ Changer plan (starter/pro/business)
│   ├─ Modifier quota
│   ├─ Suspendre / Réactiver
│   └─ Purger (RGPD - confirmation forte)
└─ Export CSV
```

---

### S3.3 — Gestion des utilisateurs globaux

**Page `/admin/users` :**

```
Fonctionnalités :
├─ Liste de tous les users (paginated)
├─ Filtres : tenant, rôle, dernière activité
├─ Recherche par email
├─ Actions :
│   ├─ Voir détail (tenant, conversations, usage)
│   ├─ Attribuer/retirer super_admin
│   ├─ Forcer logout
│   └─ Supprimer compte (RGPD)
└─ Bouton "Inviter un super_admin"
```

---

### S3.4 — Cron resync automatique

**Configuration pg_cron :**

```sql
-- supabase/migrations/<timestamp>_cron_jobs.sql

-- Activer extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ─── Resync KALI hebdomadaire (lundi 02:00) ────────────────
SELECT cron.schedule(
  'resync-kali-weekly',
  '0 2 * * 1',
  $$
    SELECT net.http_post(
      url := 'https://YOUR_PROJECT.supabase.co/functions/v1/connector-kali',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.cron_token'),
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('mode', 'incremental')
    );
  $$
);

-- ─── Resync Légifrance quotidien (02:30) ────────────────────
SELECT cron.schedule(
  'resync-legifrance-daily',
  '30 2 * * *',
  $$
    SELECT net.http_post(
      url := 'https://YOUR_PROJECT.supabase.co/functions/v1/connector-legifrance',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.cron_token'),
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('mode', 'incremental')
    );
  $$
);

-- ─── Resync Judilibre quotidien (03:00) ─────────────────────
SELECT cron.schedule(
  'resync-judilibre-daily',
  '0 3 * * *',
  $$
    SELECT net.http_post(
      url := 'https://YOUR_PROJECT.supabase.co/functions/v1/connector-judilibre',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.cron_token'),
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('mode', 'incremental')
    );
  $$
);

-- ─── Reset quotas mensuel (1er à 00:00) ─────────────────────
SELECT cron.schedule(
  'reset-quotas-monthly',
  '0 0 1 * *',
  $$
    UPDATE tenants
    SET questions_used = 0,
        quota_reset_at = now() + interval '30 days'
    WHERE quota_reset_at <= now();
  $$
);

-- ─── Cleanup rate_limits (toutes les heures) ────────────────
SELECT cron.schedule(
  'cleanup-rate-limits',
  '0 * * * *',
  'SELECT public.cleanup_rate_limits();'
);

-- ─── Évaluation RAG hebdomadaire (dimanche 04:00) ───────────
SELECT cron.schedule(
  'rag-quality-check-weekly',
  '0 4 * * 0',
  $$
    SELECT net.http_post(
      url := 'https://YOUR_PROJECT.supabase.co/functions/v1/evaluate-rag',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.cron_token')
      ),
      body := jsonb_build_object('sample_size', 50)
    );
  $$
);
```

**Modes incrémentaux à implémenter dans connecteurs :**

```typescript
// connector-legifrance/index.ts (ajout mode incremental)

if (body.mode === "incremental") {
  // Récupérer date de dernière sync
  const { data: lastSync } = await db
    .from("ingestion_jobs")
    .select("started_at")
    .eq("source", "legifrance")
    .eq("status", "completed")
    .order("started_at", { ascending: false })
    .limit(1)
    .single();

  const since = lastSync?.started_at ?? new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Recherche Légifrance avec filtre dateModification > since
  // Récupère uniquement les articles modifiés
  // ... ingestion delta
}
```

---

### Récap Sprint 3

```
EFFORT     : 4-5 jours
SCORE GAIN : +2 points (92 → 94)

LIVRABLES :
✅ Dashboard super_admin avec KPIs
✅ Gestion tenants complète
✅ Gestion users globaux
✅ Cron resync auto (KALI, Légifrance, Judilibre)
✅ Reset quotas auto
✅ Évaluation RAG auto hebdo
```

---

## SPRINT 4 — DATA ET INGESTION INDUSTRIELLE

> **Objectif** : Corpus juridique propre, structuré, complet
> **Durée estimée** : 7-10 jours (dépend du volume ingéré)
> **Score attendu après** : 94 → 95

### S4.1 — Plan d'ingestion priorisé

**Phase A — Fondations Code du travail (1-2 jours)**

```
JOUR 1 — Code du travail complet
├─ Dry run pour estimer volume (~3000 articles)
├─ Ingestion par batch de 100 articles
├─ Vérification chunking par article (regex)
├─ Validation embeddings (1536d)
└─ Test RAG sur 50 questions RH référence

JOUR 2 — Code de la sécurité sociale
├─ Ingestion (~2500 articles)
├─ Vérification RAG sur questions paie
└─ Validation IDCC filtering

VALIDATION
├─ legal_sources : 5500+ rows
├─ legal_chunks : 8000+ chunks (sur-découpage articles longs)
├─ Précision RAG : >70% sur 50 questions
└─ Latence hybrid_search : <100ms
```

**Phase B — Conventions collectives top 50 (1 jour)**

```
Via SocialGouv/kali-data (GitHub clone)
├─ Top 50 IDCC priorisés :
│   1486 Syntec, 1979 HCR, 3248 Métallurgie unifiée,
│   1090 Services automobile, 0573 Commerces de gros,
│   ... (38 autres)
├─ Format JSON structuré (pas API → plus rapide)
├─ Métadonnées : idcc, brochure, effectif, status
└─ Insertion en batch (~25 000 chunks total)
```

**Phase C — Jurisprudence ciblée 5 ans (2-3 jours)**

```
Via Judilibre API
├─ Filtres : chamber=soc + comm, date_start=2020-01-01
├─ Volume estimé : 80 000 décisions
├─ Stratégie : top 5000 décisions Bulletin (publiées)
│   + 3000 décisions citées par d'autres
├─ Chunking par section (Vu / Attendu / Par ces motifs)
└─ Métadonnées riches : chambre, formation, solution, themes
```

**Phase D — Doctrine BOFIP (2 jours)**

```
Via scraping respectueux (rate limit 1 req/2s)
├─ Sitemap BOFIP → liste de ~25 000 BOI
├─ Téléchargement PDF par BOI
├─ Extraction texte + structure
├─ Chunking par paragraphe
└─ Insertion (~50 000 chunks)
```

**Phase E — Modèles SocialGouv (1 jour)**

```
Via SocialGouv/cdtn-admin
├─ ~50 modèles de courriers RH
├─ Variables détectées automatiquement
├─ Insertion templates_public
└─ Disponibles dans /documents/templates
```

---

### S4.2 — Quality controls sur ingestion

**Validation à chaque étape :**

```typescript
// _shared/ingest-quality.ts (nouveau)

export async function validateIngestion(
  db: SupabaseClient,
  jobId: string
): Promise<ValidationReport> {
  // 1. Pas de doublons (content_hash)
  const { data: dupes } = await db.rpc("find_duplicate_chunks");

  // 2. Embeddings tous présents (pas de NULL)
  const { count: missingEmb } = await db
    .from("legal_chunks")
    .select("id", { count: "exact", head: true })
    .is("embedding", null);

  // 3. Métadonnées requises présentes
  const { count: missingRef } = await db
    .from("legal_sources")
    .select("id", { count: "exact", head: true })
    .is("reference_code", null)
    .eq("source_type", "code_article");

  // 4. URLs officielles valides
  const { data: brokenUrls } = await db.rpc("check_broken_urls", { limit: 100 });

  // 5. Test RAG quality (top 10 queries)
  const ragQuality = await runRagQualityTest(db);

  return {
    duplicates: dupes?.length ?? 0,
    missing_embeddings: missingEmb ?? 0,
    missing_references: missingRef ?? 0,
    broken_urls: brokenUrls?.length ?? 0,
    rag_precision: ragQuality.precision,
    rag_recall: ragQuality.recall,
    status: allChecksPass ? "passed" : "failed",
  };
}
```

**Cron quotidien de validation :**

```sql
SELECT cron.schedule(
  'data-quality-check-daily',
  '0 5 * * *',
  $$
    INSERT INTO ingestion_quality_reports (status, metrics)
    SELECT * FROM run_data_quality_check();
  $$
);
```

---

### S4.3 — Set d'évaluation RAG (50 Q/A référence)

**Création du benchmark :**

```sql
CREATE TABLE IF NOT EXISTS public.rag_eval_questions (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  expected_sources jsonb not null,         -- [{type, reference}]
  expected_keywords text[] not null,
  category text not null,                  -- 'rh', 'paie', 'fiscal', etc.
  difficulty text not null,                -- 'easy', 'medium', 'hard'
  validated_by text,
  created_at timestamptz default now()
);

CREATE TABLE IF NOT EXISTS public.rag_eval_runs (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz default now(),
  precision_at_5 numeric,
  recall_at_5 numeric,
  mrr numeric,
  details jsonb,
  rag_version text                         -- pour tracking améliorations
);
```

**50 questions référence à créer (par juriste) :**

```
RH (15 questions)
├─ Préavis cadre 5 ans ancienneté
├─ Indemnité licenciement faute grave
├─ Période d'essai forfait jours
├─ Rupture conventionnelle inaptitude
├─ Congés payés et arrêt maladie
├─ Travail dimanche commerce détail
├─ ... (10 autres)

PAIE (10 questions)
├─ Cotisations PPV 2026
├─ Heures sup et exonération
├─ Tickets restaurant : plafond
├─ Indemnité kilométrique
├─ ... (6 autres)

FISCAL (10 questions)
├─ TVS 2026 PME
├─ TVA déductible repas
├─ Provision pour risque
├─ ... (7 autres)

CONTRATS (10 questions)
├─ Clause non-concurrence cadre
├─ CGV vs CGU
├─ Bail commercial 3-6-9
├─ ... (7 autres)

RGPD (5 questions)
├─ DPO obligatoire ?
├─ Registre traitements
├─ ... (3 autres)
```

**Edge function `evaluate-rag` :**

```typescript
// supabase/functions/evaluate-rag/index.ts

Deno.serve(async (req) => {
  await requireSuperAdmin(req);

  const { sample_size = 50 } = await req.json().catch(() => ({}));

  // Récupère les questions
  const { data: questions } = await db
    .from("rag_eval_questions")
    .select("*")
    .limit(sample_size);

  let totalPrecision = 0;
  let totalRecall = 0;
  let totalMRR = 0;
  const details: any[] = [];

  for (const q of questions) {
    // Run RAG
    const embedding = await embedQuery(q.question);
    const chunks = await db.rpc("hybrid_search", {
      query_embedding: embedding,
      query_text: q.question,
      match_count: 5,
    });

    // Compare to expected
    const retrieved = chunks.data?.map((c) => c.reference_code);
    const expected = q.expected_sources.map((s) => s.reference);

    const correct = retrieved.filter((r) => expected.includes(r));
    const precision = correct.length / retrieved.length;
    const recall = correct.length / expected.length;

    // MRR : 1 / rank du premier correct
    const firstCorrectIdx = retrieved.findIndex((r) => expected.includes(r));
    const mrr = firstCorrectIdx >= 0 ? 1 / (firstCorrectIdx + 1) : 0;

    totalPrecision += precision;
    totalRecall += recall;
    totalMRR += mrr;

    details.push({ question: q.question, precision, recall, mrr });
  }

  const avgPrecision = totalPrecision / questions.length;
  const avgRecall = totalRecall / questions.length;
  const avgMRR = totalMRR / questions.length;

  // Insert dans rag_eval_runs
  await db.from("rag_eval_runs").insert({
    precision_at_5: avgPrecision,
    recall_at_5: avgRecall,
    mrr: avgMRR,
    details,
    rag_version: "v1.5", // À versionner
  });

  // Alerte si dégradation > 5%
  const lastRun = await db
    .from("rag_eval_runs")
    .select("precision_at_5")
    .order("run_at", { ascending: false })
    .limit(2);

  if (lastRun.data && lastRun.data.length === 2) {
    const delta = avgPrecision - lastRun.data[1].precision_at_5;
    if (delta < -0.05) {
      await sendAlertEmail({
        subject: "⚠️ RAG quality regression detected",
        body: `Precision dropped by ${(delta * 100).toFixed(1)}%`,
      });
    }
  }

  return new Response(JSON.stringify({
    precision: avgPrecision,
    recall: avgRecall,
    mrr: avgMRR,
  }));
});
```

---

### Récap Sprint 4

```
EFFORT     : 7-10 jours
SCORE GAIN : +1 point (94 → 95)

LIVRABLES :
✅ Code du travail complet ingéré
✅ Code SS complet ingéré
✅ Top 50 conventions collectives
✅ Jurisprudence 5 ans (Cass. soc + comm)
✅ BOFIP doctrine fiscale
✅ Modèles courriers SocialGouv
✅ Set d'évaluation 50 Q/A
✅ Évaluation auto hebdo

VOLUMES ATTEINTS :
├─ legal_sources : ~80 000 rows
├─ legal_chunks : ~280 000 chunks
└─ Stockage : ~6 GB (sur 8 GB Supabase Pro)
```

---

## SPRINT 5 — QUALITÉ ET OBSERVABILITÉ

> **Objectif** : Mesurer, monitorer, améliorer en continu
> **Durée estimée** : 3-4 jours

### S5.1 — Logs structurés JSON

```typescript
// _shared/logger.ts (nouveau)

export interface LogContext {
  correlation_id: string;
  user_id?: string;
  tenant_id?: string;
  function_name: string;
  duration_ms?: number;
  [key: string]: any;
}

export class Logger {
  constructor(private context: Partial<LogContext>) {}

  info(message: string, extra?: Record<string, any>) {
    console.log(JSON.stringify({
      level: "info",
      message,
      timestamp: new Date().toISOString(),
      ...this.context,
      ...extra,
    }));
  }

  error(message: string, error?: Error, extra?: Record<string, any>) {
    console.error(JSON.stringify({
      level: "error",
      message,
      timestamp: new Date().toISOString(),
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : undefined,
      ...this.context,
      ...extra,
    }));
  }

  metric(name: string, value: number, tags?: Record<string, string>) {
    console.log(JSON.stringify({
      level: "metric",
      metric_name: name,
      metric_value: value,
      tags,
      timestamp: new Date().toISOString(),
      ...this.context,
    }));
  }
}

// Usage dans edge functions
const logger = new Logger({
  correlation_id: crypto.randomUUID(),
  function_name: "legal-chat",
});

logger.info("Request received", { method: req.method });
const start = Date.now();
// ... process
logger.metric("latency_ms", Date.now() - start, { step: "rag_search" });
```

### S5.2 — Sentry pour erreurs

```typescript
// src/integrations/sentry.ts (nouveau)

import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  tracesSampleRate: 0.1,
  beforeSend(event) {
    // Filtrer les erreurs sensibles
    if (event.user?.email) {
      event.user.email = event.user.email.replace(/(.{2}).*(@.*)/, "$1***$2");
    }
    return event;
  },
});

// Wrap routes avec ErrorBoundary
<Sentry.ErrorBoundary fallback={<ErrorFallback />}>
  {children}
</Sentry.ErrorBoundary>
```

### S5.3 — PostHog pour analytics produit

```typescript
// src/integrations/posthog.ts

import posthog from "posthog-js";

posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
  api_host: "https://eu.posthog.com",
  capture_pageview: true,
  capture_pageleave: true,
});

// Events critiques à tracker
export const events = {
  trial_started: () => posthog.capture("trial_started"),
  first_question_asked: () => posthog.capture("first_question_asked"),
  document_generated: (type: string) => posthog.capture("document_generated", { type }),
  upgraded_plan: (from: string, to: string) => posthog.capture("upgraded_plan", { from, to }),
  invited_team_member: () => posthog.capture("invited_team_member"),
  feedback_given: (rating: string) => posthog.capture("feedback_given", { rating }),
};
```

### S5.4 — Tests d'intégration critiques

```typescript
// src/server/__tests__/legal-chat.test.ts

import { test, expect } from "vitest";

test("legal-chat refuses without auth", async () => {
  const res = await fetch("/api/legal-chat", { method: "POST" });
  expect(res.status).toBe(401);
});

test("legal-chat respects quota", async () => {
  // Setup user with quota=0
  // ...
  const res = await callLegalChat(token, "Question test?");
  expect(res.status).toBe(429);
  expect(await res.json()).toMatchObject({ error: /quota/ });
});

test("hybrid_search returns relevant chunks", async () => {
  const result = await db.rpc("hybrid_search", {
    query_embedding: testEmbedding,
    query_text: "préavis cadre",
    match_count: 5,
  });

  expect(result.data).toHaveLength(5);
  expect(result.data[0].score).toBeGreaterThan(0.5);
});
```

---

### Récap Sprint 5

```
EFFORT     : 3-4 jours
SCORE GAIN : Consolidation (peu visible mais critique long terme)

LIVRABLES :
✅ Logs structurés JSON
✅ Sentry erreurs frontend + edge
✅ PostHog analytics produit
✅ Tests d'intégration critiques
✅ Dashboard métriques complet
```

---

## SPRINT 6 — POLISH ET EXCELLENCE

> **Objectif** : Détails qui font la différence
> **Durée estimée** : 3-5 jours

### S6.1 — Veille juridique (vraie feature)

```
Page /veille (nouvelle route)
├─ Liste des évolutions législatives récentes
├─ Filtrage par IDCC du tenant
├─ Notifications email hebdomadaires
├─ Détection automatique :
│   ├─ Nouveaux articles publiés au JO
│   ├─ Conventions collectives modifiées
│   └─ Jurisprudences importantes (Bulletin)
└─ Préférences notifications dans /settings
```

### S6.2 — Export PDF conversations

```
Bouton "Exporter en PDF" sur chaque conversation
├─ Génération côté client avec jsPDF (déjà installé)
├─ Mise en page brandée JurisAI
├─ Inclut citations cliquables
└─ Métadonnées (date, IDCC, user)
```

### S6.3 — Templates premium

```
Ajout de 50 templates premium (validés juriste)
├─ Contrats RH avancés (CDI cadre, CDD usage, etc.)
├─ Procédures (licenciement éco, transaction, etc.)
├─ Documents commerciaux (CGV, NDA, etc.)
└─ Documents sociétés (statuts SAS, pacte associés, etc.)
```

### S6.4 — Stripe + Billing

```
Intégration Stripe complète
├─ Plans : Starter (29€), Pro (79€), Business (199€), Cabinet (499€)
├─ Page /settings/billing avec Stripe Customer Portal
├─ Webhook pour synchronisation status
└─ Email transactionnel via Resend
```

---

## 10. SPÉCIFICATIONS TECHNIQUES DÉTAILLÉES

### 10.1 Standards de code

```typescript
// ✅ BON
import { z } from "zod";

const inputSchema = z.object({
  conversationId: z.string().uuid(),
  message: z.string().min(1).max(4000),
});

export const sendMessage = createServerFn()
  .middleware([requireSupabaseAuth])
  .validator(inputSchema.parse)
  .handler(async ({ data, context }) => {
    // ...
  });

// ❌ MAUVAIS
export const sendMessage = createServerFn()
  .validator((input) => input as any)  // Pas de validation
  .handler(async ({ data }) => {
    // data: any
  });
```

### 10.2 Conventions naming

```
FICHIERS
├─ kebab-case pour fichiers : legal-chat.ts
├─ PascalCase pour composants : LegalChat.tsx
├─ camelCase pour fonctions : sendMessage()
└─ SCREAMING_SNAKE pour constantes : MAX_TOKENS

ROUTES
├─ /chat (singular)
├─ /documents (plural pour collections)
└─ /admin/* pour back-office

EDGE FUNCTIONS
├─ legal-chat (kebab-case)
├─ connector-legifrance
└─ ingest-legal-source

DATABASE
├─ tables : snake_case plural (legal_sources)
├─ colonnes : snake_case (created_at)
└─ functions : snake_case (hybrid_search)
```

### 10.3 Variables d'environnement

```bash
# Supabase (managés)
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY

# Lovable AI Gateway
LOVABLE_API_KEY

# PISTE (à ajouter)
LEGIFRANCE_OAUTH_ID
LEGIFRANCE_OAUTH_SECRET
JUDILIBRE_KEY_ID
PISTE_SANDBOX=1                  # 1 pour sandbox, sinon prod

# Cron (à ajouter)
CRON_TOKEN                       # JWT super_admin pour cron pg_cron

# Observability (à ajouter)
VITE_SENTRY_DSN
VITE_POSTHOG_KEY
SENTRY_AUTH_TOKEN

# Stripe (à ajouter)
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
VITE_STRIPE_PUBLISHABLE_KEY

# Resend
RESEND_API_KEY
```

---

## 11. QUALITY GATES ET CRITÈRES DE SUCCÈS

### Pour passer en production

```
SÉCURITÉ ☑
├─ ☐ Toutes edge functions vérifient auth
├─ ☐ Rate limiting actif
├─ ☐ RLS audit complet
├─ ☐ Secrets jamais en client
├─ ☐ HTTPS obligatoire
├─ ☐ CGU/CGV/RGPD validés par avocat
└─ ☐ Audit pen-test léger OK

PERFORMANCE ☑
├─ ☐ Index pgvector créés
├─ ☐ hybrid_search < 100ms p95
├─ ☐ legal-chat first token < 2s
├─ ☐ Lighthouse > 90 sur landing
└─ ☐ Tests charge OK (100 users simultanés)

QUALITÉ IA ☑
├─ ☐ Précision RAG > 70% sur 50 Q/A
├─ ☐ Hallucinations détectées < 5%
├─ ☐ Sources citées dans 95% réponses
├─ ☐ Feedback 👍 > 70% sur 100 premiers
└─ ☐ Évaluation hebdo configurée

DATA ☑
├─ ☐ Code du travail complet
├─ ☐ Top 50 IDCC ingérés
├─ ☐ Jurisprudence 5 ans (soc + comm)
├─ ☐ Cron resync auto actif
└─ ☐ Quality checks quotidiens

UX ☑
├─ ☐ Mobile responsive 100%
├─ ☐ Quota visible permanent
├─ ☐ Onboarding wizard fluide
├─ ☐ Cmd+K fonctionnel
├─ ☐ Feedback IA présent
└─ ☐ Emails brandés

ADMIN ☑
├─ ☐ Dashboard super_admin
├─ ☐ Gestion tenants
├─ ☐ Gestion users
├─ ☐ Logs in-app
└─ ☐ Purge RGPD
```

### Métriques cibles à 6 mois post-lancement

```
PRODUIT
├─ Activation rate     > 60%
├─ WAU/Total Users     > 40%
├─ Retention M1→M2     > 70%
├─ Churn mensuel       < 5%
├─ NPS                 > 40
└─ Sean Ellis test     > 40%

TECHNIQUE
├─ Uptime              > 99.5%
├─ Latence p95         < 4s
├─ Erreur rate         < 0.5%
└─ Coût/user/mois      < 5€

BUSINESS
├─ MRR                 > 5 000€
├─ CAC                 < 200€
├─ LTV/CAC             > 3:1
├─ Payback             < 12 mois
└─ Conversion trial    > 15%
```

---

## 12. ANNEXES TECHNIQUES

### Annexe A — Endpoints Légifrance prioritaires

```
INGESTION
├─ POST /list/code              → Liste des codes
├─ POST /consult/code           → Structure d'un code
├─ POST /consult/getArticle     → Contenu article
├─ POST /consult/kaliCont       → Convention collective
├─ POST /consult/kaliArticle    → Article CC
└─ POST /search                 → Recherche full-text

INCREMENTAL
├─ POST /search avec filter dateModification > X
└─ Récupère uniquement les modifs depuis X
```

### Annexe B — Endpoints Judilibre prioritaires

```
INGESTION
├─ GET /search                  → Recherche décisions
├─ GET /decision/{id}           → Décision complète
└─ GET /export                  → Export bulk (1000/page)

FILTRES UTILES
├─ chamber=soc,comm             → Sociale + Commerciale
├─ publication=b                → Bulletin uniquement
├─ date_start=2020-01-01        → 5 ans
└─ formation=FS-P,FS-B,FS-D     → Formations importantes
```

### Annexe C — Système de versioning des sources

```sql
-- Quand un article est modifié, garder l'historique
CREATE TABLE legal_source_versions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references legal_sources(id),
  version_date date not null,
  content_hash text not null,
  content text not null,
  archived_at timestamptz default now()
);

-- Trigger : avant UPDATE sur legal_sources, archive l'ancienne version
CREATE FUNCTION archive_source_version() RETURNS trigger AS $$
BEGIN
  IF NEW.content_hash IS DISTINCT FROM OLD.content_hash THEN
    INSERT INTO legal_source_versions (
      source_id, version_date, content_hash, content
    ) VALUES (
      OLD.id, OLD.legal_date, OLD.content_hash, OLD.content
    );
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
```

### Annexe D — Coûts mensuels estimés

```
INFRASTRUCTURE (par mois)
├─ Supabase Pro                  25€
├─ Cloudflare Workers (free)     0€
├─ Domaine + SSL                 2€
└─ Sous-total                    27€

IA (variable selon usage)
├─ 1000 questions/mois           ~15€
├─ 10000 questions/mois          ~150€
├─ 100000 questions/mois         ~1500€
└─ Embeddings ingestion          ~50€ one-shot

OUTILS
├─ Sentry (free tier)            0€
├─ PostHog (free tier)           0€
├─ Resend                        20€
├─ Stripe (% du revenu)          3.5%
└─ Sous-total                    20€

TOTAL FIXE                       ~70€/mois
TOTAL avec 1000 users            ~600€/mois
TOTAL avec 10000 users           ~5000€/mois
```

---

## 🎯 SYNTHÈSE EXÉCUTIVE FINALE

### Trajectoire score qualité

```
ACTUEL              SPRINT 0    SPRINT 1    SPRINT 2    SPRINT 3    SPRINT 6
  78        →         85    →     90    →     92    →     94    →     97

EXCELLENT          PRODUCTION   QUALITÉ     PARCOURS    ADMIN OK   EXCELLENCE
                   READY        IA          PARFAIT
```

### Ordre d'exécution recommandé

```
✅ PRIORITÉ ABSOLUE (faire en premier)
1. Sprint 0 — Stabilisation critique         [3 jours]
   └─ Sécurité, performance, RGPD, PISTE

2. Sprint 1 — RAG d'excellence               [5 jours]
   └─ Re-ranker, garde-fous, cache

3. Sprint 4.A — Ingestion fondamentale       [3 jours]
   └─ Code du travail + Top 20 IDCC

4. Sprint 2 — Parcours client                [5 jours]
   └─ UX, mobile, feedback, onboarding

🔄 BOUCLE D'ITÉRATION
5. BETA PRIVÉE 5-10 testeurs                 [2 semaines]
6. Sprint 5 — Observabilité                  [4 jours]
7. Itérations basées sur feedback

🚀 LANCEMENT
8. Sprint 3 — Admin (avant scale)           [4 jours]
9. Sprint 6 — Polish + Stripe                [5 jours]
10. SOFT LAUNCH PAYANT                        [continu]

📈 SCALE
11. Sprint 4.B — Extension data              [continu]
12. Sprint 6 — Veille, exports, templates    [continu]
```

### Ce qui rendra JurisAI parfait

```
1. RIEN N'EST APPROXIMATIF
   └─ Chaque réponse cite ses sources
   └─ Chaque source est vérifiable
   └─ Score de confiance affiché
   └─ "Je ne sais pas" assumé

2. INTÉGRATION MÉTIER PROFONDE
   └─ Onboarding personnalisé par métier
   └─ Convention collective active
   └─ Workflow naturel
   └─ Exports multi-formats

3. PERFORMANCE PERÇUE
   └─ Premier token < 2s
   └─ Streaming fluide
   └─ Skeletons partout
   └─ Pas de spinners

4. CONFIANCE PROFESSIONNELLE
   └─ Design premium
   └─ Sources officielles uniquement
   └─ Disclaimer clair
   └─ Validation avocat possible

5. AMÉLIORATION CONTINUE
   └─ Évaluation RAG hebdo
   └─ Feedback utilisateur loopé
   └─ Dataset d'évaluation versionné
   └─ Pas de régression possible
```

---

**Plan d'action maître JurisAI**
**Document de référence pour atteindre l'excellence produit**
