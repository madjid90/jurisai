# Roadmap JurisAI — 8 priorités produit

> **JurisAI N'est PAS un outil RH.** C'est un assistant juridique transverse (RH + commercial + sociétés + RGPD + fiscalité + réglementation métier + contrats + contentieux + administratif).
>
> Logique appliquée partout : **Comprendre → Sourcer → Proposer → Préparer → Valider → Exécuter → Archiver → Suivre → Alerter.**

## État actuel (avril 2026)
- ✅ Fondations multi-tenant (CRM, auth, onboarding)
- ✅ RAG juridique (Légifrance/JudiLibre/KALI/BOFiP/CDTN/CNIL, hybrid search, citations, veille programmée)
- ✅ Agent v1 (proxy edge function `legal-agent` — sortie texte simple, pas encore structurée)
- ✅ Étape stabilisation : `getTenantId` centralisé, helper `logTimelineEvent`, RLS auditée 100%, warnings linter 13→2
- ✅ Tables : `case_timeline_events`, `identified_risks`, `validation_requests`, `reminders`

---

## Priorité 1 — Agent central (cœur produit)

**Objectif** : transformer l'agent en routeur d'intentions structuré.

- [ ] **Schéma de sortie agent** : `{intent, domain, topic, confidence, requires_rag, requires_document_upload, requires_form, suggested_actions[], missing_information[]}` (cf. spec §3.4)
- [ ] **Détecteur d'intentions** (11 intentions) et **détecteur de domaines** (9 domaines) — prompt + validateur Zod
- [ ] **Routeur d'outils** (table `agent_tool_runs`) : RAG, OCR, génération doc, workflow, dossier, rappel, notification, rapport
- [ ] **Mémoire dossier** : injection automatique du contexte du dossier actif dans le prompt
- [ ] **Garde-fous** : actions sensibles → création auto d'une `validation_requests` ; jamais d'exécution autonome
- [ ] **Migrer `legal-agent` edge function vers `createServerFn`** (Core rule)

## Priorité 2 — Dossiers + historique métier

- [ ] Vue dossier complète : Résumé / Statut / Risques / Documents / Workflows / Échéances / Historique / Notifications / Sources / Actions recommandées
- [ ] Filtres timeline (Tout / Questions / Documents / Analyses / Risques / Workflows / Échéances / Notifications / Validations / Rapports / Exports)
- [ ] Étendre `dossiers.case_type` aux 10 types (rh_salarie, contrat_commercial, litige_client, fournisseur, societe, rgpd_conformite, facture_impayee, veille_juridique, procedure_interne, site_operationnel)
- [ ] Statuts dossier complets (nouveau, en_analyse, action_requise, en_attente_validation, en_cours, a_surveiller, termine, archive)
- [ ] Nourrir la timeline systématiquement (déjà branchée sur création/changement statut/analyse — étendre à risk/validation/deadline/workflow/reminder)

## Priorité 3 — Génération documentaire

- [ ] **Catalogue de documents** structuré (champ `requires_upload`, `upload_optional`, `requires_form`, `requires_rag`, `requires_validation`, `output_formats`, `archive_to_case`, `can_create_reminder`, `fields[]`)
- [ ] **Formulaires dynamiques** générés depuis la config (text/textarea/date/number/select/multi_select/boolean/file/user/client/case)
- [ ] **3 scénarios de génération** : sans dépôt / avec dépôt obligatoire / dépôt optionnel
- [ ] **Pré-remplissage automatique** depuis : doc déposé, OCR, dossier, client, salarié, contrat, historique, réponse IA, workflow en cours
- [ ] **Écran de validation** avant génération finale (données extraites, manquantes, incertaines, risques, sources, aperçu)
- [ ] Tables : `document_generation_sessions`, `generated_documents`, `extracted_fields`
- [ ] Catalogue prioritaire : couvrir les 4 verticales (RH, commercial, sociétés, RGPD) + opérationnel terrain

## Priorité 4 — Analyse documentaire

- [ ] **Étendre `document_analyses`** avec extraction structurée des contrats : parties, objet, dates (signature/effet/fin), durée, renouvellement, préavis, montants, obligations, pénalités, résiliation, juridiction
- [ ] **Détection de 13 risques contractuels** (renouvellement auto, préavis oublié, pénalités excessives, clauses défavorables…) → insertion auto dans `identified_risks`
- [ ] **Détection de dates importantes** → insertion auto dans `dossier_deadlines`
- [ ] **Rapport d'analyse** structuré (résumé, points importants, risques, clauses sensibles, dates, actions recommandées)
- [ ] OCR pour documents scannés (étend `ocr-document` edge function existante)

## Priorité 5 — Notifications + veille actionnable ✅ (livré)

- [x] `notification_preferences` exposée via `getNotificationPreferences` / `updateNotificationPreferences` (canaux, fréquence, domaines suivis, kinds)
- [x] File `email_queue` alimentée par helper `notifyUser()` (mode realtime; digest cron à venir)
- [x] `listLegalUpdates` (filtre domaine/urgence) + actions par tenant (`createLegalUpdateAction`, `updateLegalUpdateActionStatus`)
- [x] UI `/veille` à 2 onglets : Mises à jour réglementaires (RGPD/social/commercial/fiscal/sociétés/contentieux) + Alertes système
- [x] Panneau "Notifications" dans Réglages
- [x] Cloche header migrée vers `notifications.functions`
- [ ] Cron digest quotidien/hebdo (à brancher comme edge function planifiée)


## Priorité 6 — Workflows métier ✅ (socle livré)

- [x] **Structure workflow étendue** dans `steps` JSONB : `required_data`, `documents_to_generate`, `legal_refs`, `risks[]`, `validation_required`, `reminder_days`, `delay_days`, `next_step_key`
- [x] **`validateWorkflowStep()`** dans `src/server/workflow-validation.functions.ts` → `{ok, blockers[], warnings[], missing_fields[], recommended_next_step}`
- [x] Pré-validation auto sur `/workflows/$id` (panneau bloquants/warnings + bouton bloqué si non-OK)
- [x] Seed transverse 11 workflows publics (RH 3, commercial 3, sociétés 2, RGPD 3)
- [ ] À étendre progressivement : RH (+13), commercial (+6), sociétés (+6), RGPD (+5)

## Priorité 7 — Multi-profils

- [ ] Étendre l'enum `app_role` aux 12 profils (operationnel_terrain, manager, rh, comptable, daf, dirigeant, juriste, avocat_partenaire, cabinet_comptable_admin, collaborateur_cabinet, admin_tenant, super_admin)
- [ ] Table `permissions` granulaires + matrice par rôle
- [ ] Table `sites` (réseau multi-sites)
- [ ] Table `employees` (distinct des `users` — pour les RH terrain)
- [ ] Routing UI conditionnel par profil (terrain = vue simplifiée, dirigeant = vue complète, super_admin = modules techniques)
- [ ] Cacher modules techniques (RAG quality, Data quality, Sources, Connecteurs, Monitoring, Audit) aux non-admins

## Priorité 8 — Qualité production

- [ ] Évaluation RAG continue (étendre `rag_eval_runs` avec retrieval_accuracy, citation_coverage, answer_correctness, source_authority_score, refusal_quality, user_feedback_score)
- [ ] Dashboard data quality (nb sources, actives, obsolètes, chunks valides/sans embedding, erreurs ingestion, qualité moyenne)
- [ ] Rate limiting généralisé sur server functions sensibles
- [ ] Monitoring d'erreurs (Sentry-like) sur server functions
- [ ] Activer Leaked Password Protection dans dashboard Supabase Auth ⚠️ ACTION USER
- [ ] Tests E2E sur les parcours critiques (Q→réponse, dépôt→analyse, génération→validation)

---

## Hors roadmap (reporté volontairement)
- Refonte design globale (à programmer après Priorités 1-3)
- Signature électronique intégrée
- App mobile native
- Intégrations externes (Slack/Teams) au-delà de ce qui existe
