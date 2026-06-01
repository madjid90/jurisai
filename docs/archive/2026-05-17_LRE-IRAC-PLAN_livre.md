# JurisAI — Legal Reasoning Engine (LRE) v1 — Plan d'exécution

> **Date** : 17 mai 2026
> **Objectif** : faire raisonner l'IA comme un juriste français (syllogisme/IRAC) plutôt que comme un wrapper RAG
> **Contrat** : zéro contenu juridique inventé, tout vient du RAG live ou des sources officielles déjà en base

---

## 1. Pourquoi cette refonte

### Le RAG actuel n'est pas du raisonnement juridique

```
Question → embedding → hybrid_search (24 chunks) → MMR (8 chunks) → LLM → réponse
```

C'est de la similarité sémantique avec un peu de diversité. Un juriste ne procède **jamais** comme ça.

### Méthode du juriste (syllogisme / IRAC)

```
Question
   ↓
1. QUALIFIER : c'est quel problème de droit, à quels faits, sous quelle loi applicable ?
   ↓
2. CHERCHER : par niveau normatif — loi d'abord, convention, jurisprudence
   ↓
3. RAISONNER : confronter les faits à la règle (subsomption)
   ↓
4. VÉRIFIER : la conclusion respecte-t-elle la hiérarchie, le principe de faveur, la loi
   en vigueur à la date des faits, et les citations sont-elles authentiques ?
   ↓
5. RÉPONDRE : structuré, sourcé verbatim, avec confidence
```

C'est ce qu'on va coder.

---

## 2. Architecture proposée — IRAC 3-pass

### Vue d'ensemble

| Pass | Quoi | Comment | Temps | Coût |
|---|---|---|---|---|
| **1. Qualification** | extraction structurée du problème | 1 appel gpt-4o-mini, JSON Zod-validé | ~500 ms | ~0,001 € |
| **2. Retrieval stratifié + filtre temporel** | recherche 3 lanes (loi/convention/JP) avec filtre date | algorithmique pur (SQL parallèle) — pas de LLM | ~200 ms | 0 € |
| **3. Syllogisme** | majeure/mineure/conclusion + citations verbatim | 1 appel gpt-4o, JSON forcé IRAC | ~4 s | ~0,02 € |
| **4. Vérifications** | exact-match citations, garde-fous algorithmiques | TypeScript déterministe — pas de LLM | ~50 ms | 0 € |
| **Total** | | **2 LLM calls** | **~5 s** | **~0,025 €** |

### Comparaison

| Stack | LLM calls | Latence | Coût/run |
|---|---|---|---|
| RAG actuel | 1 | ~10 s | ~0,01 € |
| **LRE IRAC (proposé)** | **2** | **~5 s** | **~0,025 €** |
| LRE 8-phases adversarial (rejeté) | 7 | ~35 s | ~0,08 € |

LRE est **plus rapide** que le RAG actuel parce que la stratification supprime le coût de re-ranking MMR et le LLM est mieux structuré.

### Mode `_deep` optionnel (opt-in pour cas complexes)

Si `Pass 1` retourne `complexity=high`, l'agent peut router vers `legal_analysis_deep` qui ajoute :
- **Re-recherche ciblée** sur les articles pivots non trouvés en Pass 2
- **Pass de réflexion** : le LLM relit sa propre réponse et liste 3 contre-arguments
- **Pass de synthèse** : intègre les contre-arguments si fondés

Total mode deep : 4 LLM calls, ~15 s, ~0,06 €. À activer uniquement sur cas hard.

---

## 3. Garanties anti-invention

### Ce qu'on ne fera PAS

- ❌ **Aucun cas d'eval inventé** depuis le training data du LLM
- ❌ **Aucune règle juridique hardcodée** dans un prompt
- ❌ **Aucune jurisprudence inventée** — uniquement ce qui est dans `legal_chunks`
- ❌ **Aucune valeur numérique** (SMIC, PSS, Macron…) dans le code — toujours via `reference_values` versionnée
- ❌ **Aucune citation forgée** — le Pass 4 vérifie par exact-match

### Ce qu'on fera

- ✅ Toute affirmation juridique du Pass 3 doit inclure `citation_verbatim` (extrait exact d'une source retrievée)
- ✅ Le Pass 4 fait `source.content.includes(citation_verbatim)` — **string match déterministe**, pas de cosine flou
- ✅ Si citation non vérifiée → confidence dégradée à `faible`, user voit un disclaimer
- ✅ Garde-fous algorithmiques (TypeScript pur) : déterministes, testables unitairement
- ✅ Eval cases : enrichissement des 50 existants validés par toi via UI admin (pas d'invention)

### Test de non-régression

À chaque eval run, on mesure :
- **citation_health** = % de citations validées par exact-match (cible ≥ 90 %)
- **refusal_rate** = % de questions où l'agent refuse correctement faute de source (sanity check)
- **temporal_violation_rate** = % de cas où une source `legal_date > date_faits` a été citée (cible 0)

Si une métrique régresse → alerte admin, on roll back.

---

## 4. Détail technique des 4 passes

### Pass 1 — Qualification (gpt-4o-mini, JSON Zod)

**Input** : question utilisateur + IDCC tenant (si configuré).

**Output validé Zod** :

```typescript
type LegalQualification = {
  issue: string;                          // question de droit reformulée
  branche: "social" | "commercial" | "civil" | "rgpd" | "fiscal"
         | "contentieux" | "societes" | "administratif" | "penal_des_affaires"
         | "immobilier" | "famille" | "international_prive";
  sous_domaine: string;                   // ex: "licenciement_disciplinaire"
  parties: ("employeur" | "salarie" | "client_pro" | "client_part"
          | "fournisseur" | "associe" | "tiers" | "administration")[];
  faits_materiels: string[];              // structuré
  date_faits: string | null;              // ISO date si extraite
  idcc_hypothesis: string | null;         // ex: "1486"
  sous_questions_rag: string[];           // 1-3 sous-questions pour le RAG
  articles_pivots: string[];              // si le LLM en connaît déjà
  urgence: "aucune" | "delai_court" | "delai_legal_strict";
  complexity: "low" | "medium" | "high";  // déclencheur mode deep
  missing_info: string[];                 // si question incomplète
  refuse: boolean;                        // si question hors-droit
  refuse_reason: string | null;
};
```

**System prompt** : 100 % méthodologique, zéro fait juridique. Le LLM doit qualifier, pas répondre.

**Si `refuse=true`** → on s'arrête, on retourne au user sans appeler Pass 2/3.

### Pass 2 — Retrieval stratifié + filtre temporel (SQL pur)

**Algorithme** :

```typescript
const lanes = await Promise.all(
  qualification.sous_questions_rag.flatMap((q) => [
    hybridSearchTyped(q, { types: LEGISLATION_TYPES,  limit: 4, date_at: qualification.date_faits }),
    qualification.idcc_hypothesis
      ? hybridSearchTyped(q, { types: CONVENTION_TYPES, limit: 3, idcc: qualification.idcc_hypothesis, date_at: qualification.date_faits })
      : Promise.resolve([]),
    hybridSearchTyped(q, { types: JURISPRUDENCE_TYPES, limit: 3, date_at: qualification.date_faits }),
  ])
);

const sources = dedupe(flatten(lanes)).slice(0, 10);
```

**Nouveau RPC `hybrid_search_typed`** :

```sql
CREATE FUNCTION hybrid_search_typed(
  query_embedding vector,
  query_text text,
  match_count int,
  source_types text[] DEFAULT NULL,
  idcc_filter text DEFAULT NULL,
  date_at date DEFAULT NULL,    -- filtre temporel (legal_date <= date_at)
  rrf_k int DEFAULT 60
) RETURNS TABLE (...)
```

Spécialisation de `hybrid_search` existante avec un `WHERE s.source_type = ANY(source_types)` et `(date_at IS NULL OR s.legal_date <= date_at)`.

**Pas d'appel LLM dans cette pass.** Vitesse maximale, déterministe.

### Pass 3 — Syllogisme (gpt-4o, JSON IRAC forcé)

**Input** : qualification (Pass 1) + sources stratifiées (Pass 2).

**Output forcé** :

```typescript
type Syllogisme = {
  majeure: {
    regle: string;                       // "le salarié doit être convoqué à un entretien préalable"
    citation_verbatim: string;           // extrait EXACT de la source
    source_id: number;                   // [source:1]
    niveau_normatif: "constitution" | "ue" | "loi" | "convention" | "jurisprudence";
  };
  mineure: {
    faits_qualifies: string;             // "L'employeur a notifié le licenciement sans convocation préalable"
  };
  conclusion: {
    application: string;                 // "Le licenciement est irrégulier"
    principe_faveur: {
      applicable: boolean;
      niveau_retenu: "legal" | "conventionnel";
      justification: string;
    } | null;
    exceptions: {
      regle: string;
      citation_verbatim: string;
      source_id: number;
    }[];
  };
  confidence_self: "haute" | "moyenne" | "faible";  // auto-eval LLM
  markdown_user: string;                              // réponse formatée pour user
};
```

**System prompt strict** :
- "Tu raisonnes en syllogisme juridique français"
- "Toute affirmation doit inclure `citation_verbatim` (extrait EXACT de la source numérotée)"
- "Si une source ne supporte pas une règle, ne l'invente PAS, mets `confidence_self=faible` et explique dans `markdown_user`"
- "Respecte la hiérarchie : citation `loi` avant `convention` avant `jurisprudence`"
- "Si branche=social et convention + légal divergent, évalue `principe_faveur`"

### Pass 4 — Vérifications algorithmiques (TypeScript pur)

```typescript
function verify(syllogisme: Syllogisme, sources: LegalSource[]): {
  citation_health: number;                // % citations validées
  invalid_citations: { source_id: number; reason: string }[];
  temporal_violations: { source_id: number; legal_date: string; date_faits: string }[];
  hierarchy_warnings: string[];           // ex: "JP citée sans loi"
  faveur_injected: boolean;
  final_confidence: "haute" | "moyenne" | "faible";
} {
  // 1. Pour chaque citation_verbatim → exact-match dans source.content
  // 2. Pour chaque source → vérifier legal_date <= qualification.date_faits
  // 3. Si branche=social + conv & légal divergent + principe_faveur=null → ajouter
  // 4. Si JP citée sans loi → warning
  // 5. Confidence final = MIN(confidence_self, citation_health-based)
}
```

**Tout est déterministe.** Si une citation hallucine, on le voit. Si la loi est postérieure aux faits, on le voit. Pas de magie LLM.

---

## 5. Schéma DB (3 tables nouvelles)

### 5.1 `legal_normative_hierarchy` (référentiel statique)

10 niveaux universels du droit français. Pas inventés — issus de la doctrine constitutionnelle (Kelsen + art. 55 Constitution + Conseil d'État).

```sql
CREATE TABLE legal_normative_hierarchy (
  level int PRIMARY KEY,
  norm_type text NOT NULL,
  display_name text NOT NULL,
  description text,
  source_authority text,   -- "Constitution art. 55", "TUE art. 288", etc.
  beats_levels int[] NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
```

Seed (10 lignes) :

| level | norm_type | display_name | source_authority |
|---|---|---|---|
| 1 | bloc_constitutionnel | Bloc de constitutionnalité | Constitution 1958, DDHC 1789, préambule 1946 |
| 2 | droit_ue_primaire | Traités UE | TUE, TFUE, CJUE Costa c/ ENEL 1964 |
| 3 | droit_ue_derive | Règlements et directives UE | TFUE art. 288 |
| 4 | conv_internationales | Conventions internationales ratifiées | Constitution art. 55 |
| 5 | loi_organique | Lois organiques | Constitution art. 46 |
| 6 | loi | Lois ordinaires | Parlement (art. 34) |
| 7 | reglement | Décrets et arrêtés | Constitution art. 37 |
| 8 | convention_collective | Conventions et accords collectifs | C. trav. L.2251-1 (principe de faveur) |
| 9 | contrat | Contrat individuel | Code civil art. 1103 |
| 10 | jurisprudence | Jurisprudence | Autorité d'interprétation (pas source au sens strict) |

### 5.2 `legal_reasoning_traces` (audit append-only)

```sql
CREATE TABLE legal_reasoning_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  agent_run_id uuid REFERENCES agent_runs(id),
  user_id uuid NOT NULL,
  question text NOT NULL,
  qualification jsonb NOT NULL,        -- Pass 1
  retrieved_sources jsonb NOT NULL,    -- Pass 2 (avec 3 lanes)
  syllogisme jsonb NOT NULL,           -- Pass 3 (IRAC)
  checks jsonb NOT NULL,               -- Pass 4
  final_confidence text NOT NULL CHECK (final_confidence IN ('haute','moyenne','faible')),
  citation_health real NOT NULL,       -- 0.0 à 1.0
  mode text NOT NULL CHECK (mode IN ('standard','deep')),
  total_llm_calls int NOT NULL,
  total_latency_ms int NOT NULL,
  total_tokens int,
  refused boolean NOT NULL DEFAULT false,
  refusal_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lrt_tenant ON legal_reasoning_traces(tenant_id, created_at DESC);
CREATE INDEX idx_lrt_run ON legal_reasoning_traces(agent_run_id);
CREATE INDEX idx_lrt_confidence ON legal_reasoning_traces(final_confidence, created_at DESC);

ALTER TABLE legal_reasoning_traces ENABLE ROW LEVEL SECURITY;

CREATE POLICY lrt_tenant_read ON legal_reasoning_traces FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM user_roles WHERE user_id = auth.uid()));
-- Pas de policy UPDATE/DELETE pour authenticated → append-only
```

### 5.3 Extension de `rag_eval_cases` (enrichissement, pas remplacement)

```sql
ALTER TABLE rag_eval_cases
  ADD COLUMN expected_qualification jsonb,    -- branche/sous_domaine/parties/date_faits attendus
  ADD COLUMN expected_idcc text,
  ADD COLUMN expected_articles_pivots text[],
  ADD COLUMN expected_majeure jsonb,          -- règle attendue + niveau_normatif
  ADD COLUMN expected_principe_faveur boolean DEFAULT false,
  ADD COLUMN verified_enrichment boolean DEFAULT false,
  ADD COLUMN verified_by uuid,
  ADD COLUMN verified_at timestamptz;
```

**Workflow** :
1. Script qui propose `expected_*` pour les 50 cas (basé sur les `expected_sources` déjà validés)
2. UI admin `/admin/eval-cases` : tu valides cas par cas
3. Seuls les cas `verified_enrichment=true` comptent dans les métriques d'eval avancées

---

## 6. Plan d'exécution en 4 vagues

### Vague 1 — Foundation (1 commit)

- Migration `legal_normative_hierarchy` + seed 10 niveaux
- Migration `legal_reasoning_traces` + RLS
- Migration `hybrid_search_typed` RPC
- Migration `rag_eval_cases` extension (colonnes expected_*)
- `src/server/_shared/lre-schemas.server.ts` (Zod schemas des 4 passes)

**Livrable** : DB prête, types prêts. Aucun comportement utilisateur encore.

### Vague 2 — Passes 1 + 2 (qualification + retrieval)

- `src/server/_shared/lre-qualify.server.ts` (Pass 1)
- `src/server/_shared/lre-retrieve.server.ts` (Pass 2)
- Tests unitaires sur 3 questions cibles
- Logs structurés (pas d'observabilité externe encore)

**Livrable** : pipeline d'amont fonctionnel et testable en isolation.

### Vague 3 — Passes 3 + 4 (syllogisme + vérifs)

- `src/server/_shared/lre-syllogize.server.ts` (Pass 3 — prompt IRAC strict + JSON forcé)
- `src/server/_shared/lre-verify.server.ts` (Pass 4 — 4 garde-fous algo)
- `src/server/_shared/legal-reasoner.server.ts` (orchestrateur des 4 passes + persistence trace)
- Tests unitaires sur les garde-fous (faveur, temporel, hiérarchie, citation match)

**Livrable** : LRE end-to-end utilisable côté serveur. Pas encore exposé à l'agent.

### Vague 4 — Intégration agent + UI + Eval

- `runLegalAnalysis` server fn (entry point + persist trace + retry)
- Entrée `legal_analysis` dans `AGENT_TOOLS` + router
- Mode `_deep` optionnel : `legal_analysis_deep` (re-recherche + reflexion)
- Page admin `/admin/reasoning-traces` (liste + détail trace + replay)
- Enrichissement automatique proposé sur les 50 `rag_eval_cases` (avec validation admin)
- Mise à jour `evaluate-rag` pour gérer les métriques par phase

**Livrable** : production-ready. Agent utilise LRE pour toute question juridique.

---

## 7. Tests et qualité

### Tests unitaires (Vitest)

- `lre-verify.server.test.ts` :
  - exact-match citation OK
  - exact-match citation KO (hallucination détectée)
  - filtre temporel : source `legal_date > date_faits` rejetée
  - principe de faveur : injection automatique si oublié
  - hiérarchie : warning si JP sans loi

- `lre-qualify.server.test.ts` :
  - parsing Zod OK
  - `refuse=true` pour question non-juridique
  - `missing_info` non vide pour question incomplète

### Test d'intégration

- 3 questions cibles bout-en-bout :
  1. *"Quelle indemnité pour un licenciement Syntec 8 ans ?"* (cas idcc + chiffrage)
  2. *"Mon fournisseur facture sans n° TVA, que faire ?"* (cas commercial)
  3. *"Peut-on collecter l'IP des visiteurs sans bandeau ?"* (cas RGPD)

Chaque test vérifie :
- citation_health ≥ 0.8
- final_confidence ∈ {haute, moyenne}
- aucun temporal_violation
- markdown_user non vide

### Tests Eval (utilise les 50 cas enrichis)

- Métrique `qualification_accuracy` : % de cas où `branche` et `sous_domaine` correspondent à `expected_qualification`
- Métrique `idcc_accuracy` : % de cas où `idcc_hypothesis` correspond à `expected_idcc`
- Métrique `articles_pivots_recall` : % d'`expected_articles_pivots` retrouvés dans le syllogisme
- Métrique `citation_health` : moyenne sur tous les runs eval
- Métrique `principe_faveur_correctness` : sur les cas social, % de bonne décision

---

## 8. Sécurité et conformité

- **RLS** : tenant isolation sur `legal_reasoning_traces`
- **Append-only** : pas d'UPDATE/DELETE possible pour l'utilisateur (même schéma que `calculation_history`)
- **Disclaimer** : tout `markdown_user` inclut en footer : *"Cette analyse est informative et ne constitue pas un conseil juridique substitutif à un avocat."*
- **Confidence faible** : disclaimer renforcé en tête : *"Sources insuffisantes pour une analyse fiable"*
- **Audit RGPD** : la trace contient la question utilisateur → respecter la durée de conservation (à brancher avec retention policy tenant)

---

## 9. Métriques de succès (mesurables après Vague 4)

| Métrique | Aujourd'hui (RAG basique) | Cible LRE v1 | Mesure |
|---|---|---|---|
| Citation accuracy (exact-match) | non mesurée | **≥ 90 %** | Pass 4 |
| Hiérarchie respectée (loi avant JP) | mélangé MMR | **100 %** | Pass 4 |
| Loi en vigueur à la date des faits | jamais filtré | **100 %** si date_faits fourni | Pass 4 |
| Principe de faveur appliqué | jamais | **toujours en social** | Pass 4 |
| IDCC inféré correctement | manuel | **≥ 80 %** | Eval set enrichi |
| Refusal rate (questions hors-droit) | inconnu | **100 %** | Pass 1 |
| Hallucination détectée (cit. inventée) | invisible | **100 %** détectées + flag confidence | Pass 4 |
| Latence p95 | ~10-15 s | **~6-8 s** | Trace |
| Coût par run | ~0,01 € | **~0,025 €** | Trace |

---

## 10. Ce qui reste hors scope LRE v1

- Pas de **multi-hop retrieval** (Pass 2 reste single-shot)
- Pas de **cross-validation** entre runs (pas de self-consistency voting)
- Pas de **knowledge graph** articles ↔ exceptions ↔ JP interprétative
- Pas de **fine-tuning** modèle dédié droit français
- Pas de **traduction** EU→FR (corpus FR uniquement pour v1)
- Pas d'**export PDF** de la trace d'analyse (à voir en v2)

Tous reportés à LRE v2 si besoin métier confirmé.

---

## 11. Confirmation requise avant démarrage

- ✅ Architecture IRAC 3-pass + mode `_deep` opt-in
- ✅ Hiérarchie normative 10 niveaux (Kelsen + droit positif français)
- ✅ Zéro contenu juridique inventé, tout vient du RAG ou des sources officielles
- ✅ Enrichissement des 50 `rag_eval_cases` existants (pas d'invention de cas)
- ✅ Tests unitaires + 3 tests d'intégration cibles
- ✅ Migration en 4 vagues (4 commits propres)

**Si tu valides, je démarre la Vague 1 immédiatement.**
