# REFERENCE AGENT 360 — JurisAI
## Architecture agentique complete

**Date** : Mai 2026  
**Portee** : Agent 360, Generation documents, Analyse documents, Workflows, Dossier 360, Integrations  

---

## SOMMAIRE

1. [Vue d'ensemble — L'app est agentique](#1-vue-densemble)
2. [Agent 360 — State machine + boucle](#2-agent-360)
3. [Generation de documents par l'agent](#3-generation-de-documents)
4. [Analyse de documents](#4-analyse-de-documents)
5. [Systeme de workflows](#5-workflows)
6. [Dossier 360 — Vue unifiee](#6-dossier-360)
7. [Pipeline post-reponse](#7-pipeline-post-reponse)
8. [Integrations](#8-integrations)
9. [Patterns architecturaux](#9-patterns-architecturaux)
10. [Bugs et problemes identifies](#10-bugs)

---

## 1. VUE D'ENSEMBLE

JurisAI est fondamentalement **agentique**. L'agent IA ne se contente pas de repondre a des questions — il :
- **Analyse** des documents uploades (extraction clauses, risques, dates)
- **Genere** des documents juridiques (prefill, templates, AI polish)
- **Cree** des workflows procedures (generation IA + validation 3 couches)
- **Execute** ces workflows etape par etape (avec delais legaux FR)
- **Gere** des dossiers 360 (timeline, risques, taches, rappels)
- **Detecte** automatiquement les entites, deadlines, et contextes lies
- **Memorise** le contexte entre les sessions
- **Propose** des actions de suivi (9 types)
- **Valide** les actions sensibles via un catalogue de 247 entrees

### Architecture agentique complete
```
Question/demande utilisateur
         |
         v
  [classifyIntent] — domain + topic + confidence + missing_info
         |
         v
  [agent-loop] — 6 rounds max, 15 outils, execution parallele
         |
         v
  [reponse + tool traces]
         |
    ┌────┼────────────────────────────────┐
    v    v                                v
[post-response]              [intent-actions]
 ├ business rules             ├ suggest templates
 ├ missing info check         ├ generate draft docs
 ├ validation needed?         ├ extract deadlines
 └ save memory                └ fetch dossier timeline
         |
         v
  [suggested actions] — 9 types
   open_dossier, create_dossier, link_document,
   start_workflow, generate_document, create_reminder,
   validate_action, assign_task, send_notification
```

---

## 2. AGENT 360 — STATE MACHINE + BOUCLE

### 2 pipelines paralleles

**Pipeline A — State Machine** (`agent-runs.functions.ts`)  
Utilise par : `/agent`, `/dashboard`, `/mes-demandes`
```
createAgentRun ──→ [pending]
                      |
processAgentRun ──→ [running] ──→ classifyIntent + agent-loop
                      |
              ┌───────┼───────────────┐
              v       v               v
      [waiting_info] [waiting_validation] [ready]
              |       |               |
  answerAgentRun  validateAgentRun    |
     (retour a       (approved/       |
      process)        rejected)       |
              └───────┼───────────────┘
                      v
           executeAgentRun ──→ [executed]
                      |
           archiveAgentRun ──→ [archived]
                      |
                   [failed] (sur erreur)
```

**Pipeline B — Single Shot** (`agent.functions.ts` → `runLegalAgent`)  
Utilise par : `/chat`, `AgentDossierPanel`
```
runLegalAgent ──→ agent-loop direct ──→ reponse immediate
(pas de state machine, ecrit directement le resultat dans agent_runs)
```

### Boucle agent (agent-loop.server.ts)
- **Max rounds** : 6
- **Tool choice** : `auto` (le LLM decide quels outils appeler)
- **Execution** : parallele via `Promise.all()` (tous les tools d'un round)
- **Troncature** : resultats outils tronques a 8000 chars
- **Arret** : quand le LLM repond sans `tool_calls` OU max rounds atteint
- **Token budget** : non gere (messages array croit sans limite dans les 6 rounds)

### Les 15 outils — DETAIL IMPLEMENTATION

#### 1. `search_law` — Recherche RAG
```
Params LLM : { query: string }          Required: [query]
Handler   : searchLaw(query, ctx)
Pipeline  : embedText(query) → hybrid_search RPC(embedding, text, match_count=6, idcc)
Retour    : { sources: [{ n, title, reference, url, excerpt(700chars) }] }
Side effect: pousse chaque source dans ctx.sources (numerotation [source:N])
Si 0 results: { sources: [], warning: "Aucune source pertinente..." }
Si embed fail: retourne erreur avec kind/status/detail/attempts
Sensible  : Non
BUG       : 75% d'echec (18/24), match_count=6 trop faible, pas de MMR
```

#### 2. `dossier_context` — Contexte dossier 360
```
Params LLM : { dossier_id: string }     Required: [dossier_id]
Handler   : dossierContext(dossierId, ctx)
Pipeline  : 4 requetes paralleles (Promise.all)
  - dossier infos (title, status, category, risk_level)
  - case_timeline_events (15 derniers, desc)
  - dossier_tasks (ouvertes, max 20)
  - identified_risks (non resolus, max 20)
  - dossier_deadlines (10, par date asc)
Retour    : { dossier, timeline, open_tasks, open_risks, deadlines }
Securite  : filtre tenant_id
```

#### 3. `identify_risk` — Enregistrer un risque
```
Params LLM : { dossier_id, title, severity(enum), legal_basis?, description? }
Handler   : identifyRisk(args, ctx)
Pipeline  : check dossier existe + insert identified_risks + log timeline
Retour    : { risk: { id, title, severity } }
Securite  : filtre tenant_id, title tronque 200 chars
```

#### 4. `propose_document` — Lancer generation document
```
Params LLM : { dossier_id, doc_type, domain?, params? }
Handler   : proposeDocument(args, ctx)
Pipeline  : check dossier + insert document_generation_sessions (agent_proposed)
            Si doc_type in SENSITIVE_DOC_TYPES → appelle request_validation auto
            Log timeline event
SENSITIVE_DOC_TYPES : lettre_licenciement, rupture_conventionnelle, mise_en_demeure,
                      transaction, depot_legal, conclusions_contentieux, assignation
Retour    : { session, doc_type, sensitive, validation_request_id }
Sensible  : Conditionnel (7 types sensibles)
```

#### 5. `request_validation` — Demande validation humaine
```
Params LLM : { dossier_id, action_type, reason?, payload? }
Handler   : requestValidation(args, ctx)
Pipeline  : check dossier + find admin (pas le user courant → anti-auto-validation)
            + insert validation_requests + log timeline
Retour    : { validation: { id, subject_type, status } }
Securite  : exclut ctx.userId des assignations (neq user_id)
            Si aucun admin dispo → erreur explicite
Sensible  : Toujours
```

#### 6. `schedule_reminder` — Programmer un rappel
```
Params LLM : { dossier_id?, title, remind_at, channel?(in_app|email) }
Handler   : scheduleReminder(args, ctx)
Pipeline  : check dossier si fourni + insert reminders + log timeline si dossier
Retour    : { reminder: { id, title, remind_at } }
Note      : dossier_id optionnel (rappel perso possible)
```

#### 7. `create_task` — Creer une tache
```
Params LLM : { dossier_id, title, priority?(low|normal|high|urgent), due_date? }
Handler   : createTask(args, ctx)
Pipeline  : check dossier + insert dossier_tasks (status=todo) + log timeline
Retour    : { task: { id, title, priority, due_date } }
Securite  : priority validee contre enum, default "normal"
```

#### 8. `create_deadline` — Creer une echeance
```
Params LLM : { dossier_id, title, due_date }   Required: tous
Handler   : createDeadline(args, ctx)
Pipeline  : check dossier + insert dossier_deadlines + log timeline
Retour    : { deadline: { id, title, due_date } }
```

#### 9. `search_dossier` — Chercher un dossier
```
Params LLM : { query, limit? }          Required: [query]
Handler   : searchDossier(args, ctx)
Pipeline  : ILIKE sur title + description, scope tenant
Retour    : { dossiers: [{ id, title, status, category, risk_level, created_at }] }
Securite  : sanitize % et , seulement
BUG       : injection PostgREST possible (. () non filtres)
```

#### 10. `create_dossier` — Creer un dossier
```
Params LLM : { title, category?, description?, client_id?, risk_level?(enum) }
Handler   : createDossierTool(args, ctx)
Pipeline  : insert dossiers (status=open) + log timeline
Retour    : { dossier: { id, title, category, status, risk_level } }
Securite  : risk_level valide contre enum, default "low", title 200 chars
```

#### 11. `start_workflow` — Demarrer un workflow
```
Params LLM : { definition_id?, definition_slug?, title?, dossier_id?, client_id?, context? }
Handler   : startWorkflowTool(args, ctx)
Pipeline  : resoudre definition (par id ou slug, scope tenant ou global)
            + check dossier si fourni + insert workflow_instances + log timeline
Retour    : { instance: { id, title, status } }
Securite  : verifie tenant_id de la definition
Note      : PAS de check lifecycle_status ici (contrairement a agent-actions)
```

#### 12. `analyze_document` — Analyser un document
```
Params LLM : { document_id, dossier_id? }    Required: [document_id]
Handler   : analyzeDocumentTool(args, ctx)
Pipeline  : load document content (max 12000 chars)
            + appel LLM (Gemini Flash) pour JSON structure
            + si dossier_id: persist identified_risks (max 10, severity>=medium)
            + log timeline
Retour    : { document_id, title, summary, doc_type_guess, risks, missing_clauses, key_points, risks_persisted }
Prompt    : "Analyse juridique d'un document. Retourne JSON: summary, doc_type_guess, risks[], missing_clauses[], key_points[]"
```

#### 13. `generate_report` — Generer rapport dossier
```
Params LLM : { dossier_id, report_type? }    Required: [dossier_id]
Handler   : generateReportTool(args, ctx)
Pipeline  : 4 requetes paralleles (timeline 50, tasks, risks, deadlines)
            + generation markdown structure (pas de LLM, template code)
            + log timeline
Retour    : { dossier_id, report_type, markdown, stats }
Note      : rapport genere en code (pas d'appel LLM), sections: risques, taches, echeances, chronologie
```

#### 14. `generate_workflow` — Generer workflow par IA
```
Params LLM : { prompt, domain?, dossier_id? }    Required: [prompt]
Handler   : generateWorkflowTool({ prompt, category }, ctx)
BUG       : LLM envoie domain + dossier_id → handler attend category → silencieusement ignore
Pipeline  : appelle runGenerateWorkflow (validation 3 couches)
Retour    : { run_id, cache_hit, workflow_definition_id, auto_status, scores, sensitive_actions, error }
Sensible  : Conditionnel (si contains_sensitive=true)
```

#### 15. `run_workflow_step` — Executer etape workflow
```
Params LLM : { instance_id, step_index, notes? }   Required: [instance_id, step_index]
Handler   : runWorkflowStepTool(args, ctx)
Pipeline  : delegue a executeStep() dans workflow-runtime.server.ts
            (sensitive check, legal deadline, step_run, advance index)
Retour    : { instance_id, step_index, status, due_at, delay, blocked_for_validation,
              validation_request_id, workflow_completed, next_step }
Sensible  : Conditionnel (si etape detectee comme sensible)
```

### System prompt envoye au LLM
```
Tu es **JurisAI**, copilote juridique transverse pour cabinets et entreprises
(RH, commercial, societes, RGPD, fiscal, contentieux, administratif).

LOGIQUE OBLIGATOIRE : Comprendre → Sourcer → Proposer → Preparer → Valider
→ Executer → Archiver → Suivre → Alerter.

REGLES STRICTES :
1. Pour toute affirmation juridique : appelle search_law et cite via [source:N].
   Pas de source = refus motive.
2. Pour tout document a risque (licenciement, mise en demeure, transaction,
   contentieux, depot legal) : passe par request_validation, jamais d'execution directe.
3. Toute action significative sur un dossier doit produire une trace
   (les outils log_timeline automatiquement).
4. Si la demande est hors juridique, redirige poliment.
5. Reponds en francais, ton professionnel, structure claire.

Date courante : 2026.
```
+ PROMPT_INJECTION_GUARD (anti-injection)
+ memoryPreamble (souvenirs agent)

### Donnees en base
- **agent_runs** : 35 (dont 23 bloques en pending, 3 executed)
- **agent_tool_runs** : 27 (search_law=24 dont 18 echecs, create_dossier=1, search_dossier=1, start_workflow=1)
- **11 outils sur 15 jamais appeles**

---

## 3. GENERATION DE DOCUMENTS PAR L'AGENT

### Pipeline complet
```
Demande (utilisateur OU agent via propose_document)
         |
         v
[startGenerationSession]
  ├── Load template depuis document_templates (18 templates)
  ├── Scenario : no_upload | from_upload | from_dossier
  ├── Auto-prefill via prefillSession() :
  │     Sources : dossier, client, employee, contract, ocr, history, ai
  ├── Cree document_generation_sessions (status=in_progress)
  └── Log timeline event
         |
         v
[GenerationWizard UI] — 6 etapes
  scenario → collect → sources → review → generating → done
  + fetchTemplateLegalSources() (RAG pour sourcing juridique)
         |
         v
[finalizeGeneration]
  ├── fillTemplate() — remplace {{var}} tokens dans le corps HTML
  ├── AI polish optionnel (Gemini 2.5 Pro) :
  │     "Ameliore le style juridique en conservant structure + faits"
  ├── shouldRequestValidation() — check risk_level + config template
  ├── Insert generated_documents (status: draft | pending_validation)
  ├── Si pending_validation → cree validation_requests, assigne a admin
  ├── Optionnel : cree reminder
  └── Log timeline event
```

### Chemin agent (automatique)
```
Intent redaction_document detecte par classifyIntent
  → suggestTemplates() — matching lexical titre/topic vs 18 templates
  → generateDraftDocument() :
      ├── prefill depuis dossier/client/analyse
      ├── fillTemplate() avec variables connues
      └── Variables manquantes = "[a completer: key]"
  → Insert generated_documents (status=draft)
```

### Systeme de templates
- **18 templates** en base (document_templates)
- Corps HTML avec interpolation `{{nom_salarie}}`, `{{date_effet}}`, etc.
- Variables typees : `text | date | number | select | multi_select | textarea | boolean | file | user | client | case`
- Chaque variable : `required, placeholder, hint, prefill_from`
- Prefill sources : `dossier | client | employee | contract | ocr | history | ai`
- Config template : `requires_upload, requires_validation, risk_level, archive_to_case, can_create_reminder, output_formats`
- Risk levels : `low | medium | high | critical`

### Fonctions serveur
| Fonction | Fichier | Role |
|----------|---------|------|
| `startGenerationSession` | generation.functions.ts | Demarrer wizard |
| `getGenerationSession` | generation.functions.ts | Lire session |
| `updateGenerationSession` | generation.functions.ts | MAJ champs |
| `fetchTemplateLegalSources` | generation.functions.ts | RAG pour sourcing |
| `finalizeGeneration` | generation.functions.ts | Generer document final |
| `listGeneratedDocuments` | generation.functions.ts | Liste documents |
| `getGeneratedDocument` | generation.functions.ts | Lire document |
| `createDocument / updateDocument / deleteDocument` | documents.functions.ts | CRUD documents |
| `generateDocument` | documents.functions.ts | Generation legacy |
| `listDocumentTemplates / getDocumentTemplate` | templates.functions.ts | CRUD templates |

### Tables
`document_templates` (18), `document_generation_sessions` (10), `generated_documents` (1), `documents` (0), `validation_requests`, `reminders`

---

## 4. ANALYSE DE DOCUMENTS

### Pipeline complet
```
Upload PDF/DOCX (max 5MB)
         |
         v
[analyzeDocument] (analysis.functions.ts)
  ├── Decode base64 → bytes
  ├── Cree document_analyses (status=pending)
  ├── Extraction texte :
  │     PDF → extractPdf() via unpdf
  │     DOCX → extractDocx() via mammoth
  ├── Si texte < 50 chars → erreur (suggestion OCR)
  ├── Sanitize texte (prompt-sanitizer)
  ├── Appel Gemini 2.5 Pro → reponse JSON structuree
  ├── Parse AnalysisResult → sauvegarde
  ├── Persist extracted_fields rows (champs extraits avec confiance)
  ├── Si dossier lie :
  │     ├── Cree identified_risks (severity >= medium)
  │     ├── Cree dossier_deadlines (importance >= medium)
  │     └── Log timeline event
  ├── Log usage_logs
  └── Declenche processUploadedDocument()
         |
         v
[processUploadedDocument] (document-pipeline.server.ts)
  ├── 1. EXTRACTION ENTITES (regex)
  │     SIREN, SIRET, IBAN, email, telephone, dates, montants, ref dossier
  │     → Persist entity_mentions
  │
  ├── 2. LIAISON AUTOMATIQUE (3 signaux)
  │     ├── Semantique : embedText() → match_dossier_context RPC (cosine)
  │     ├── Entites fortes : SIREN/SIRET/IBAN/email partages
  │     └── Ref textuelle : "dossier 2024-X" → matching titre dossier
  │     Score >= 0.80 → auto-link (document_links confirmed)
  │     Score 0.50-0.80 → suggestion (document_links pending)
  │
  ├── 3. INDEXATION CONTEXTE
  │     Index summary dans dossier_context_index (avec embedding)
  │
  ├── 4. DETECTION DEADLINES
  │     Detect dates dans le texte → cree reminders (anticipation 7 jours)
  │
  └── 5. TIMELINE
        Log events pour tous les dossiers lies
```

### Ce que l'IA extrait d'un document
| Champ | Description |
|-------|-------------|
| **domain** | rh, commercial, societes, rgpd, fiscal, contentieux, administratif |
| **document_type** | CDI, CGV, PV AG, Mise en demeure, DPA RGPD, etc. |
| **summary** | 2-3 phrases de synthese |
| **extracted_fields** | Key-value avec scores de confiance (0-1) + page |
| **key_points** | Jusqu'a 8 points cles |
| **contract_data** | Parties, objet, dates, duree, renouvellement, preavis, montant, penalites, resiliation, juridiction, confidentialite, non-concurrence |
| **detected_dates** | Type (signature/effective/trial_end/renewal/notice/end/payment/deadline), importance, description |
| **risks** | Severite (low→critical), 13 categories typees, base legale, mitigation |
| **compliance** | ok / warning / issue par check |
| **recommendations** | 3-6 actions prioritisees |

### Chemin OCR (documents scannes)
```
Upload image/PDF scanne
  → runOcrDocument() → Edge Function ocr-document
  → Gemini 3 Flash Preview (modele vision)
  → Extraction texte + detection type document
  → Persist dans document_analyses
  → Declenche processUploadedDocument()
```

### Fonctions serveur
| Fonction | Role |
|----------|------|
| `analyzeDocument` | Analyse complete PDF/DOCX |
| `listAnalyses / getAnalysis` | Lecture |
| `validateExtractedField` | Validation humaine d'un champ extrait |
| `deleteAnalysis` | Suppression |
| `runOcrDocument` | OCR via edge function |

### Tables
`document_analyses`, `extracted_fields`, `entity_mentions`, `document_links`, `dossier_context_index`, `identified_risks`, `dossier_deadlines`, `reminders`

---

## 5. SYSTEME DE WORKFLOWS

### Pipeline de generation (IA + validation 3 couches)
```
Prompt ("licencier un salarie pour faute grave")
         |
         v
[generateWorkflow]
  ├── Cree workflow_generation_runs (status=running)
  ├── Embed prompt → match_workflow_definitions RPC (cosine)
  ├── Si similarity >= 0.85 → CACHE HIT (retourne definition existante)
  ├── Sinon :
  │     ├── Fetch tenant IDCC (convention collective)
  │     ├── Multi-query RAG (5 variantes + RRF k=60) + fallback
  │     ├── Appel Gemini 2.5 Pro avec system prompt 8 phases
  │     ├── Validation Zod du draft genere
  │     └── CONTROLE QUALITE 3 COUCHES :
  │
  │     ┌─────────────────────────────────────────────┐
  │     │ COUCHE 1 : RE-RAG PAR ETAPE                │
  │     │ Pour chaque step avec legal_refs →          │
  │     │ re-query RAG → confirme existence source    │
  │     │ Score = % steps confirmes                   │
  │     ├─────────────────────────────────────────────┤
  │     │ COUCHE 2 : CONSENSUS LLM (3 modeles)       │
  │     │ Flash + Pro + Flash-Lite en parallele       │
  │     │ Chacun evalue : score 0-100 + agrees bool   │
  │     │ Score = moyenne - penalite si desaccord >30 │
  │     ├─────────────────────────────────────────────┤
  │     │ COUCHE 3 : SECURITE                         │
  │     │ detectSensitiveActions() depuis catalogue   │
  │     │ (247 entrees en base)                       │
  │     │ Penalise actions critiques sans validation  │
  │     └─────────────────────────────────────────────┘
  │
  │     Ponderation finale :
  │       refs 25% + logic 25% + safety 20% + completeness 15% + docs 15%
  │
  │     Auto-decision :
  │       >= 85 (+ refs>=80, safety>=90, logic>=75) → ai_validated_auto
  │       >= 60 → pending_human_review
  │       < 60 → draft_ai
  │       TOUJOURS pending_human_review si sensitive.blocking
  │
  ├── Insert workflow_definitions (avec scores, embedding, lifecycle_status)
  ├── Persist 7 workflow_quality_checks
  └── Log workflow_audit_log
```

### Execution runtime (etape par etape)
```
[start_workflow] (via agent ou UI)
  ├── Check lifecycle_status de la definition
  ├── Si bloque → cree validation_request
  ├── Sinon → cree workflow_instances (status=in_progress, step_index=0)
         |
         v
[runWorkflowStep]
  ├── Load instance + definition
  ├── Verify step_index correspond
  ├── detectSensitiveActions() pour l'etape
  ├── Si sensible sans override :
  │     → validation_requests → step_run(pending) → BLOQUE
  ├── Sinon :
  │     ├── Compute delai legal (calendar/business/working days)
  │     ├── Timezone Paris (23:59:59 local)
  │     ├── step_run (status=done)
  │     ├── Advance step_index (UPDATE conditionnel anti-race)
  │     └── Si derniere etape → instance completed
  └── Log timeline + audit

[skipWorkflowStep]
  → Requiert reason (3-500 chars)
  → step_run(skipped) + advance

[validateWorkflowStep]
  → Check required_data, risks, validation_required
  → Verify user has WORKFLOW_VALIDATOR_ROLES
  → Return : ok, blockers[], warnings[], missing_fields[]
```

### Fonctions serveur
| Fonction | Role |
|----------|------|
| `generateWorkflow` | Generation IA + validation 3 couches |
| `setWorkflowLifecycleStatus` | Admin : human_validated / rejected |
| `loadWorkflowInstanceState` | Etat complet d'une instance |
| `runWorkflowStep` | Executer etape courante |
| `skipWorkflowStep` | Sauter etape avec raison |
| `validateWorkflowStep` | Valider avant execution |
| `computeDeadline` | Calcul delai legal FR |

### Tables
`workflow_definitions` (47), `workflow_instances` (9), `workflow_step_runs` (0), `workflow_generation_runs` (1), `workflow_quality_checks` (7), `workflow_audit_log` (2), `sensitive_actions_catalog` (247)

---

## 6. DOSSIER 360 — VUE UNIFIEE

### Concept
Vue 360 degres aggregeant TOUTES les donnees d'un dossier juridique en une seule requete.

### getDossier360() — 6 requetes paralleles
```
getDossier360(dossierId) →
  ├── case_timeline_events (derniers 100, desc)
  ├── identified_risks (tous, desc)
  ├── validation_requests (toutes, desc)
  ├── reminders (tous, asc par remind_at)
  ├── generated_documents (derniers 50, avec template info)
  └── workflow_instances (derniers 20, avec definition + steps)
  
  + Aggregation sources juridiques depuis timeline metadata + risk legal_basis
```

### Cycle de vie complet d'un dossier par l'agent
```
1. CREER     → create_dossier → dossier + timeline event
2. ANALYSER  → Upload → OCR/extraction → AI analyse → auto-link au dossier
3. RISQUES   → Analyse cree identified_risks automatiquement (severity medium+)
4. DELAIS    → Pipeline cree reminders + deadlines depuis dates detectees (7j anticipation)
5. DOCUMENTS → Agent suggest templates → prefill depuis contexte → generation
6. WORKFLOWS → Agent lance procedures validees → suivi etape par etape
7. TACHES    → assign_task cree taches avec notifications
8. COLLABORER → Commentaires + Slack + webhooks
9. TIMELINE  → CHAQUE action log un case_timeline_events
```

### Gestion des risques
```
createRisk(dossierId, title, severity, category, description, legalBasis, mitigation)
  → identified_risks + timeline event

updateRiskStatus(riskId, status: open | mitigating | resolved | accepted)
  → Timeline event
```

### Systeme de validation
```
requestValidation(dossierId, subjectType, subjectId, assignedTo, comment)
  → validation_requests + timeline + notifyUser (in-app + email)

decideValidation(validationId, decision: approved | rejected, comment)
  → Protection : concurrent decision check + anti-auto-validation
```

### Collaboration
```
addComment    → dossier_comments + notification + Slack + webhooks
createTask    → dossier_tasks + notification + Slack + webhooks
updateTask    → notification + webhooks
globalSearch  → ILIKE cross-dossiers, clients, documents
```

---

## 7. PIPELINE POST-REPONSE

### Apres chaque reponse de l'agent
```
Reponse agent terminee
         |
         v
[runPostResponsePipeline]
  ├── Si reponse refusee → skip (log "skipped")
  ├── pickBusinessRule(haystack) :
  │     Match topic + message + answer contre business_rules keywords (13 regles)
  │     Premier match gagne, fallback vers regle "generic"
  ├── Check required_fields du rule contre texte reponse
  ├── Determine si validation necessaire :
  │     rule.is_sensitive=true OU trace contient outil sensible sans validation
  ├── Persist agent_post_checks (8 rows en base)
  ├── rememberMemory() → sauvegarde last_topic dans agent_memory
  │     Scope=dossier, relevance=0.6
  └── Log timeline event (agent.post_check)
```

### Memoire agent
```
recallMemory(tenantId, userId?, dossierId?)
  → Filtre par scope : tenant (toujours) + user + dossier
  → Max 8 entrees, tri par relevance desc + updated_at desc
  → Format system prompt : "[scope] key : value"

rememberMemory(tenantId, key, value, scope, dossierId?, userId?)
  → Upsert sur (tenant_id, scope, key, dossier_id, user_id)
  → Supporte expiration (expires_at)
```

### Actions intent-based
```
runIntentActions() apres classification intent :

  analyse_document / analyse_contrat :
    → Extract deadlines depuis analyses → contract_deadlines
    → Fetch open risks → identified_risks

  redaction_document / lancer_procedure :
    → suggestTemplates() — matching lexical vs 18 templates
    → generateDraftDocument() — prefill + fillTemplate + insert

  recherche_dossier / gestion_dossier :
    → Return recent timeline events du dossier
```

### 9 actions suggerees
| Action | Effet |
|--------|-------|
| `open_dossier` | Retourne URL redirection |
| `create_dossier` | Cree dossier + timeline |
| `link_document` | Cree document_link confirme |
| `start_workflow` | Check lifecycle, bloque si sensible, sinon cree instance |
| `generate_document` | Cree session generation depuis template slug |
| `create_reminder` | Cree rappel + timeline |
| `validate_action` | Valide/rejette (anti-auto-validation) |
| `assign_task` | Cree tache + notification + timeline |
| `send_notification` | Cree notification |

### Catalogue actions sensibles
- **247 entrees** dans `sensitive_actions_catalog`
- Champs : action_key, action_label, domain, severity, requires_human_validation, requires_lawyer, keywords, legal_refs
- `detectSensitiveActions(steps)` : normalise + match keywords → detected[], contains_sensitive, max_severity, blocking
- Blocking = any critical OU requires_lawyer

---

## 8. INTEGRATIONS

### Slack
- `postSlackMessage()` via Lovable Connector Gateway
- `notifyTenantSlack()` — best-effort, check tenant_integrations config
- `dispatchWebhook()` — HMAC-SHA256 signe, persist webhook_deliveries

### Email (NON FONCTIONNEL)
- `enqueueEmail()` → email_outbox (status=pending)
- `processEmailBatch()` → sendEmail() **STUB** — throws `EMAIL_PROVIDER_NOT_CONFIGURED`
- Retry : backoff exponentiel (1min→6hr), max_attempts puis "dead"
- **TODO** : integration Resend

### Export
- `exportDossierPDF()` → jsPDF A4, couverture + corps + deadlines
- `exportDocument(format: pdf|docx)` → jsPDF ou docx library + Packer

### API Keys & Webhooks
- API Keys : prefix `jak_` + 24-byte random + SHA256 hash
- Webhooks : prefix `whsec_` + HMAC-SHA256 signature
- Events supportes : `dossier.created`, `dossier.updated`, `task.created`, `task.completed`, `comment.added`, `alert.published`
- Calendar : token UUID genere mais **pas de feed endpoint** implemente

---

## 9. PATTERNS ARCHITECTURAUX

1. **Pipeline 8 phases** : Comprendre → Sourcer → Proposer → Preparer → Valider → Executer → Archiver → Suivre
2. **Side effects non-bloquants** : echecs pipeline ne bloquent jamais l'operation principale
3. **Operations idempotentes** : idempotency_key sur workflow steps, purge avant re-insert entities
4. **UPDATE conditionnel** : protection race condition sur workflow advancement + validation decisions
5. **Validation 3 couches** : RE-RAG + consensus LLM 3 modeles + catalogue securite 247 entrees
6. **Audit trail complet** : 5 niveaux (timeline, workflow_audit_log, agent_post_checks, usage_logs, webhook_deliveries)
7. **Multi-tenant** : requireSupabaseAuth + getTenantId() sur 100% des fonctions
8. **Rate limiting** : enforceRateLimit(userId, endpoint, limit) sur actions couteuses
9. **Anti-injection** : sanitizePromptInput() + PROMPT_INJECTION_GUARD
10. **Anti-auto-validation** : impossible de valider ses propres actions sensibles

---

## 10. BUGS ET PROBLEMES IDENTIFIES

### Critiques
| # | Bug | Impact |
|---|-----|--------|
| B1 | `authority_level` echelle cassee (0-100 vs 1-6) | RAG ne boost aucune source |
| B2 | `search_law` echoue 75% du temps | Agent ne peut pas sourcer |
| B3 | 23/35 runs bloques en `pending` | 66% de taux d'echec |
| B4 | `executeAgentRun` sans sanitizePromptInput | Faille injection |
| B5 | `searchDossier` injection PostgREST | Faille securite |
| B6 | Document Polish sans PROMPT_INJECTION_GUARD | Faille injection |

### Hauts
| # | Bug | Impact |
|---|-----|--------|
| B7 | 2 systemes agents paralleles (state machine + single shot) | Donnees inconsistantes |
| B8 | `generate_workflow` parametres silencieusement ignores | domain + dossier_id perdus |
| B9 | RLS desactive sur 13 tables messages | Securite |
| B10 | Email sending entierement stub | Notifications email KO |

### Moyens
| # | Bug | Impact |
|---|-----|--------|
| B11 | Pas de watchdog runs `running` | Runs bloques si crash |
| B12 | Trace outils silencieusement perdue (catch noop) | Observabilite |
| B13 | Reponse vide si max rounds → sauvee comme "executed" | UX |
| B14 | Pas de validation Zod sur arguments outils | Robustesse |
| B15 | Pas de timeout par outil | Loop peut bloquer |
| B16 | OCR utilise modele preview en production | Fiabilite |
| B17 | Agent memory recallMemory fetch tout puis filtre en JS | Performance |
| B18 | suggestTemplates matching lexical seulement | Qualite suggestions |
| B19 | Pas de resume auto apres validation approuvee | Workflow bloque |
| B20 | Calendar token genere mais pas de feed endpoint | Feature incomplete |

---

*Document de reference agentique — Mai 2026*
*A utiliser conjointement avec ETAT-DES-LIEUX-COMPLET.md et AUDIT-COMPLET-JURISAI-V3.md*
