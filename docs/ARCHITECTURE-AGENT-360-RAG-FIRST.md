# Architecture Agent 360 JurisAI — Design RAG-first pur

> **Document de spécification — 2026-05-24**
> Synthèse de la session de cadrage suite à l'audit du plan
> `plan_mise_en_place_agent360_procedure_workflow_document_builder.md`
>
> **Principe fondateur :** aucune règle juridique n'est codée ou seedée nulle part. Tout vient de la data juridique existante dans la base (190 k chunks RAG). Le LLM est uniquement un constructeur sous contraintes mécaniques.

---

## 1. Vision produit

**JurisAI = Agent 360 juridique** capable, à partir d'une demande PME, de :

1. Construire dynamiquement une **procédure juridique** sourcée
2. Générer le **workflow métier** exécutable
3. Produire les **documents juridiques** conformes
4. Imposer les **délais légaux** réels
5. Bloquer les **actions sensibles** jusqu'à validation humaine
6. Archiver tout dans le **Dossier 360**

Le RAG n'est pas le produit. Le RAG est l'unique source de vérité juridique du système.

---

## 2. Principe non négociable

> **Le LLM construit TOUT depuis la data juridique existante dans la base, et rien d'autre.**

Concrètement :

- ❌ **Aucune règle juridique** hardcodée dans le code
- ❌ **Aucun délai légal** seedé en dur
- ❌ **Aucune procédure** pré-écrite dans une table
- ❌ **Aucune mention obligatoire** dans un fichier `.ts`
- ✅ **Tout** vient de `legal_sources` + `legal_chunks` (103 k sources, 190 k chunks)
- ✅ Le **LLM lit le RAG**, construit la procédure, génère les documents
- ✅ Un **Verifier mécanique** valide que chaque output pointe une source réelle

Si une règle juridique change demain (réforme, nouvel arrêté…), il suffit que le RAG soit mis à jour. Aucune ligne de code à toucher.

---

## 3. Flux concret — Exemple "Licenciement personnel"

```
1. USER
   "Procédure de licenciement pour Jean Dupont, motif faute simple"
              ↓
2. AGENT — Classification
   {
     intent: "lancer_procedure",
     domain: "rh",
     topic: "licenciement_personnel",
     branche_droit: "droit_social"
   }
              ↓
3. RAG STRATIFIÉ (massif, sur la data existante)
   • code_article matchant "licenciement" → L1232-1, L1232-2, L1232-4,
     L1232-6, L1234-1, L1234-19...
   • convention_article si IDCC connu du tenant
   • fiche_ministere_travail / fiche_service_public
   • jurisprudence en complément (pas en remplacement)
   → 30-50 sources réelles, triées par rang d'autorité
              ↓
4. LLM CONSTRUIT depuis ces sources
   Output JSON Zod-validé :
   {
     "procedure_slug": "licenciement_personnel",
     "steps": [
       {
         "title": "Convocation à l'entretien préalable",
         "legal_ref": "Code du travail, art. L1232-2",
         "source_id": "<uuid réel dans legal_sources>",
         "verbatim": "L'employeur, ou son représentant, qui envisage de licencier...",
         "delay_days_before": 5,
         "delay_source": "L1232-2"
       },
       {
         "title": "Tenue de l'entretien préalable",
         "legal_ref": "L1232-4",
         "source_id": "<uuid>",
         "verbatim": "Au cours de l'entretien, l'employeur indique les motifs..."
       },
       {
         "title": "Notification du licenciement",
         "legal_ref": "L1232-6",
         "delay_days_after": 2,
         "delay_source": "L1232-6"
       }
     ],
     "documents": [
       {
         "type": "convocation_entretien",
         "template_slug": "convocation-entretien-prealable",
         "required_mentions": [
           {
             "mention": "possibilité d'assistance",
             "legal_ref": "L1232-4",
             "verbatim_extrait": "Le salarié peut se faire assister..."
           }
         ]
       },
       {
         "type": "lettre_licenciement",
         "template_slug": "lettre-licenciement-motif-personnel"
       }
     ],
     "deadlines": [
       {
         "label": "Entretien préalable",
         "from_step": 1,
         "days": 5,
         "source": "L1232-2"
       }
     ]
   }
              ↓
5. VERIFIER (mécanique, déterministe)
   ✓ Chaque source_id existe vraiment dans legal_sources
   ✓ Chaque verbatim correspond à du texte réel dans legal_chunks
     (exact-match 3 niveaux : exact / normalized / fuzzy)
   ✓ Chaque template_slug existe dans document_templates
   ✓ Chaque délai a une source légale citée
   ✗ Si UN seul item échoue : REJET, on relance le LLM avec retry,
     ou on signale au user "impossible de construire cette procédure
     avec les sources actuelles"
              ↓
6. PERSIST (cache audit)
   INSERT dans procedure_generation_rules
   → la prochaine fois la même procédure est demandée, on réutilise
   INSERT dans legal_reasoning_traces (audit append-only)
              ↓
7. WORKFLOW BUILDER
   convertit la procédure en workflow_instance + dossier_tasks
   (réutilise start_procedure_full RPC existante)
              ↓
8. DOCUMENT BUILDER
   remplit chaque template_slug avec les variables user + vérifie
   que chaque required_mention est bien dans le HTML final
              ↓
9. VALIDATION HUMAINE
   blockSensitiveActionUntilValidation()
   → "licenciement" = sensible → crée automatiquement
     une validation_request assignée au DRH
   → Le doc reste status="pending_validation" tant que pas approuvé
              ↓
10. DOSSIER 360
    Tout est dans le dossier : steps, documents, deadlines, sources,
    timeline, validations. Auditable bout-en-bout.
              ↓
11. RÉSULTAT DANS /chat
    Toast "Procédure démarrée" + lien dossier + actions disponibles
```

---

## 4. Rôle réel des 4 tables à créer

| Table | Contenu | Source du contenu | Seed initial |
|---|---|---|---|
| `legal_source_hierarchy` | Rang d'autorité des `source_type` qui existent dans `legal_sources` | Seed simple (méta) | 8 lignes — code_article=10, convention_article=20, accord_entreprise=30, fiche_ministere_travail=40, fiche_service_public=45, jurisprudence=60, doctrine_fiscale=15, modele_courrier=80 |
| `legal_doctrine_rules` | Règles **opérationnelles** pour le LLM (priorité, méthode, anti-hallucination) | Seed méta (zéro contenu juridique) | ~10 règles : "priorise Code > convention > JP", "vérifie IDCC du tenant", "refuse si aucune source RAG", "principe de faveur en droit social", etc. |
| `procedure_generation_rules` | **CACHE** des procédures déjà construites par le LLM depuis le RAG | Rempli automatiquement par le LLM | **VIDE au départ** |
| `document_generation_rules` | **CACHE** des grilles de validation par type de doc | Rempli automatiquement par le LLM | **VIDE au départ** |

**Clé du design :** les 2 dernières tables sont des **caches alimentés par le LLM**, pas des seeds de règles.

- 1ère fois qu'un user demande "licenciement" → cache miss → LLM construit → on persiste
- 2e fois qu'un user demande "licenciement" → cache hit → on réutilise (instant + cohérent)
- Si la data RAG change (nouvelle réforme) → invalidation du cache → reconstruction au prochain appel

---

## 5. Garanties du design

| Garantie | Mécanisme |
|---|---|
| Zéro règle juridique hardcodée | Aucun seed de droit, aucune constante TS avec délais ou mentions |
| Toute affirmation = source RAG vérifiée | Verifier mécanique exact-match 3 niveaux |
| Refus d'hallucination | Si Verifier échoue : retry LLM ou refus utilisateur explicite |
| Audit trail complet | `legal_reasoning_traces` (append-only) + `procedure_generation_rules` (cache versionné) |
| Performance | Cache 2e appel = instantané (pas de retrieve + LLM) |
| Adaptabilité | Mise à jour du RAG (nouvelle convention, nouvel arrêté) → automatique |
| Auditabilité avocat | Un avocat peut tracer chaque source_id → chunk réel + verbatim |
| Cohérence inter-sessions | Cache garantit que 2 PME différentes reçoivent la même procédure pour la même demande |

---

## 6. Fonctions à développer

### Bloc Legal Reasoning Engine
```text
runLegalReasoning()
qualifyLegalIssue()
retrieveStratifiedSources()
applyNormativeHierarchy()
buildLegalSyllogism()
verifyCitations()
persistReasoningTrace()
```

### Bloc Procedure Builder
```text
buildLegalProcedure()
verifyProcedureGrounding()
```

### Bloc Workflow Builder
```text
buildWorkflowFromProcedure()
verifyWorkflowSteps()
linkWorkflowToSources()
linkWorkflowToDossier()
```

### Bloc Document Builder
```text
buildDocumentsFromProcedure()
verifyDocumentGrounding()
generateDocumentDraft()
generatePdfDocx()  ← déjà livré : exportGeneratedDocument
```

### Bloc Validation
```text
blockSensitiveActionUntilValidation()
```

---

## 7. Plan de sprint (5-8 jours)

### J1 — Fondations DB (3-4 h)
- Migration `legal_source_hierarchy` + seed 8 lignes
- Migration `legal_doctrine_rules` + seed ~10 règles méta
- Migration `procedure_generation_rules` (vide)
- Migration `document_generation_rules` (vide)
- Versionner les 4 migrations dans `supabase/migrations/`

### J2 — Legal Reasoning Engine (1 jour)
- `qualifyLegalIssue()` — extraction structurée intent + branche + sous-domaine
- `retrieveStratifiedSources()` — RAG hybrid_search_typed avec filtres par source_type
- `applyNormativeHierarchy()` — tri par rang d'autorité
- `buildLegalSyllogism()` — majeure / mineure / conclusion
- `verifyCitations()` — exact-match 3 niveaux entre output LLM et chunks RAG
- `persistReasoningTrace()` — INSERT dans legal_reasoning_traces
- `runLegalReasoning()` — orchestre les 6 ci-dessus
- Branchement dans `processAgentRun`

### J3 — Procedure Builder (1 jour)
- Schemas Zod stricts pour l'output procédure
- `buildLegalProcedure()` — prompt LLM + sources + Zod
- `verifyProcedureGrounding()` — vérifie chaque source_id, verbatim, template_slug
- Cache dans `procedure_generation_rules`
- Test E2E manuel : "absence injustifiée"

### J4 — Workflow Builder + Document Builder (1 jour)
- `buildWorkflowFromProcedure()` — convertit procédure structurée → workflow_instance
- `verifyWorkflowSteps()` — cohérence délais + sources
- `linkWorkflowToSources()` / `linkWorkflowToDossier()`
- `buildDocumentsFromProcedure()` — remplit chaque template avec mentions vérifiées
- `verifyDocumentGrounding()` — chaque required_mention présente dans HTML final

### J5 — Validation + branchement final (1 jour)
- `blockSensitiveActionUntilValidation()` — liste d'actions sensibles codée en dur
- Branchement systématique avant chaque output sensible
- Tests E2E sur les 4 scénarios prioritaires

### J6 — Tests E2E + monitoring (1 jour)
- Test 1 : Absence injustifiée → procédure + 3 documents + validation
- Test 2 : Licenciement personnel → workflow + entretien + lettre
- Test 3 : Rupture conventionnelle → convention + délai rétractation + homologation
- Test 4 : Contrat fournisseur → analyse + risques + dossier
- Page admin `/admin/lre-traces` pour visualiser les traces

### J7-J8 — Stabilisation + docs (1-2 jours)
- Documentation utilisateur
- Optimisation cache (TTL, invalidation)
- Index HNSW partiel par source_type (P3 audit V6)
- Tests Vitest sur Verifier

---

## 8. Tests de validation

### Test 1 — Absence injustifiée
**Demande :** "Je veux gérer une absence injustifiée d'un salarié."

**Attendu :**
- Qualification : droit_social, sous_domaine: gestion_absence
- Sources retrieved : L1132-1, L1331-1, articles convention si IDCC, fiche CDTN
- Procédure construite : étapes vérification → demande justification → relance → procédure disciplinaire si nécessaire
- Documents proposés : demande justification, convocation, compte-rendu, notification
- Validation humaine obligatoire avant tout courrier disciplinaire
- Rappels créés automatiquement

### Test 2 — Licenciement personnel
**Demande :** "Prépare une procédure de licenciement pour motif personnel."

**Attendu :**
- Sources : L1232-1 à L1232-6 (Code travail)
- Étapes : convocation → entretien → notification
- Délais : 5 jours min entre convocation et entretien, 2 jours min entre entretien et notification
- Documents : convocation entretien + lettre licenciement
- Validation humaine obligatoire

### Test 3 — Rupture conventionnelle
**Demande :** "Prépare une rupture conventionnelle."

**Attendu :**
- Sources : L1237-11 à L1237-16
- Étapes : entretien(s) → signature convention → délai rétractation 15j → homologation DREETS
- Documents : convention de rupture
- Validation humaine obligatoire

### Test 4 — Contrat fournisseur
**Demande :** "Analyse ce contrat fournisseur." (avec upload)

**Attendu :**
- OCR si scanné
- Analyse : risques détectés, dates importantes, clauses sensibles
- Dossier proposé
- Actions recommandées sourcées

---

## 9. Anti-patterns à éviter absolument

| Anti-pattern | Pourquoi c'est interdit |
|---|---|
| Seeder une règle juridique dans une table | Le droit change, le code ne suit jamais. RAG est la seule source de vérité. |
| Hardcoder un délai dans une constante TS | Idem. Le délai vient toujours de L1232-2 (par exemple). |
| Confier au LLM la décision "action sensible ou pas" | Le LLM peut oublier. Liste codée en dur dans `blockSensitiveActionUntilValidation`. |
| Output LLM en texte libre | Toujours Zod strict. |
| Citation cosine similarity | Faux positifs. Toujours exact-match 3 niveaux. |
| Skip du Verifier "parce que c'est lent" | Le Verifier est non-négociable. Sinon hallucination. |
| Tolérer une procédure construite sans source_id réel | REJET systématique. |

---

## 10. État d'avancement (24/05/2026)

| Élément | Statut |
|---|---|
| `legal_normative_hierarchy` (10 niveaux Kelsen) | ✅ Existe |
| `legal_reasoning_traces` (append-only) | ✅ Existe (vide) |
| `lre-schemas.server.ts` (Zod foundation) | ✅ Existe (233 lignes) |
| `legal_source_hierarchy` | ❌ À créer |
| `legal_doctrine_rules` | ❌ À créer |
| `procedure_generation_rules` | ❌ À créer |
| `document_generation_rules` | ❌ À créer |
| Toutes les 18 fonctions du plan | ❌ 0/18 implémentées |
| 18 outils agent existants | ✅ 14/14 testables OK SQL |
| RAG (103 k sources, 190 k chunks) | ✅ 100 % embeddés |
| 30 templates documents | ✅ Livrés |
| 48 workflows définitions | ✅ Existants |
| Page /validations + Realtime | ✅ Livrée hier |
| Watchdog (RPC SECURITY DEFINER) | ✅ Fixé hier |

**Alignement plan vs réalité : ~35 %.**
**Effort restant pour 100 % : 5-8 jours focus.**

---

## 11. Confirmation utilisateur (cadrage du 24/05)

L'utilisateur a confirmé ces 3 points avant lancement du sprint :

1. ✅ **Tables = cache + audit**, alimentées par le LLM depuis le RAG (pas de seed juridique)
2. ✅ **Verifier obligatoire** : si une source n'existe pas vraiment, on rejette (pas de tolérance)
3. ✅ **Seed minimal autorisé** :
   - `legal_source_hierarchy` : 8 lignes (juste les rangs des types existants)
   - `legal_doctrine_rules` : 10 règles méta-opérationnelles (zéro contenu juridique)

**Citation utilisateur :**
> "L'objectif c'est de mettre ça en place et comme le LLM a accès à la data juridique, il construit tout depuis cette data et de cela qu'on parle.
>
> Il cherche dans la BD tous ce qui concerne le licenciement par exemple, il crée la procédure depuis ça et génère les documents, étapes et délais à respecter pour cette procédure, les obligations légales en termes de document, des fichiers. Il utilise la BD juridique pour faire ça et rien d'autre."

---

## 12. Prompt système pour le LLM (extrait à intégrer)

```text
Tu es l'Agent 360 juridique de JurisAI.

Tu construis des procédures juridiques, des workflows métier et des
documents juridiques UNIQUEMENT à partir des sources juridiques officielles
fournies dans le contexte (RAG).

RÈGLES NON NÉGOCIABLES :
1. Tu ne cites JAMAIS une règle de droit qui n'est pas dans le RAG fourni.
2. Chaque étape de procédure DOIT pointer un source_id réel.
3. Chaque délai DOIT être sourcé par un article précis (ex: L1232-2).
4. Chaque mention obligatoire d'un document DOIT être justifiée par un verbatim.
5. Si une information manque dans le RAG, tu écris "à vérifier" — tu n'inventes pas.
6. Tu produis toujours du JSON structuré conforme au schema Zod fourni.
7. Pour toute action sensible (licenciement, sanction, rupture, transaction,
   contentieux, RGPD violation), tu marques requires_validation: true.
8. Si tu n'as aucune source pour répondre, tu refuses explicitement.

Tu n'es pas un avocat. Tu es un constructeur de procédures à partir de la
base juridique officielle. La responsabilité juridique reste à l'humain qui
valide.
```

---

*Document de spécification — version 1.0 — 2026-05-24*
*À mettre à jour à chaque jalon du sprint (J1 → J7)*
