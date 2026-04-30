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

## Priorité 1 — Agent central ✅ (livré)

**Objectif** : transformer l'agent en routeur d'intentions structuré.

- [x] **Schéma de sortie agent** structuré (`intent`, `domain`, `topic`, `confidence`, `requires_rag/upload/form/validation`, `suggested_actions[]`, `missing_information[]`, `refused`, `refusal_reason`)
- [x] **Détecteur d'intentions** (11 intentions) + **détecteur de domaines** (9 domaines) via classification IA JSON stricte
- [x] **Tables `agent_runs` + `agent_tool_runs`** : trace exhaustive (input, classification, outils, sensibilité, durée, succès)
- [x] **Mémoire dossier** : injection auto du `dossier_id` dans le préambule + outil `dossier_context`
- [x] **Garde-fous** : `SENSITIVE_DOC_TYPES` (licenciement, MED, transaction, contentieux, dépôt) → `validation_requests` créée auto + jamais d'exécution autonome
- [x] **`legal-agent` edge function migrée vers `createServerFn`** — edge function supprimée
- [x] **UI `/agent`** : intent/domain/topic, flags structurels, refus motivés, actions suggérées, infos manquantes, trace outils, sources

## Priorité 2 — Dossiers + historique métier (en cours)

- [x] Vue dossier 360° avec onglets Timeline / Risques / Validations / Rappels / Agent
- [x] **Panneau "Actions recommandées"** en tête de Dossier360Tabs (risques élevés + validations en attente + rappels < 24h)
- [x] **Filtres timeline** par catégorie (Tout / Questions / Documents / Analyses / Risques / Workflows / Échéances / Validations / Rappels / Rapports / Exports)
- [x] **Statuts dossier complets** (8 statuts métier : nouveau, en_analyse, action_requise, en_attente_validation, en_cours, a_surveiller, termine, archive) + rétro-compat des 3 anciens (open/in_progress/closed)
- [x] **Types de dossier transverses** (10 nouveaux : rh_salarie, contrat_commercial, litige_client, fournisseur, societe, rgpd_conformite, facture_impayee, veille_juridique, procedure_interne, site_operationnel) + rétro-compat
- [x] Constantes partagées `src/lib/dossiers/case-meta.ts` utilisées par `/dossiers` (liste + création) et `/dossiers/$id` (détail + édition)
- [ ] Onglets supplémentaires Documents générés / Workflows en cours dans Dossier360Tabs
- [ ] Vue dossier "Sources" (liste agrégée des sources juridiques citées dans le dossier)
- [ ] Étendre la timeline aux événements documents/workflows/exports (déjà branchés sur risk/validation/deadline/reminder/agent)

## Priorité 3 — Génération documentaire ✅ (socle livré)

- [x] **Catalogue de documents** structuré (champs config : `requires_upload`, `upload_optional`, `requires_form`, `requires_rag`, `requires_validation`, `archive_to_case`, `can_create_reminder`, `reminder_days_default`, `output_formats`, `prefill_sources`, `guidance`, `validation_threshold`)
- [x] **Formulaires dynamiques** typés depuis la config (text/textarea/date/number/select/multi_select/boolean/file/user/client/case + hint + placeholder)
- [x] **3 scénarios de génération** : sans dépôt / avec dépôt obligatoire / dépôt optionnel (sélecteur scénario quand `upload_optional`)
- [x] **Pré-remplissage automatique** depuis dossier, client lié, OCR (extracted_fields), avec tracking par champ (`prefill_metadata`) + détection des valeurs incertaines (confidence < 0.7)
- [x] **Étape Sources juridiques** (RAG hybrid) optionnelle — déclenchée si `requires_rag` ; sources stockées dans `legal_sources_used` puis copiées sur `generated_documents.legal_sources`
- [x] **Écran de validation enrichi** avant génération : valeurs collectées, sources rattachées, format de sortie, rappel post-génération, polish IA
- [x] **Validation hiérarchique** automatique selon `validation_threshold` + `risk_level` (helper `shouldRequestValidation`)
- [x] **Archivage automatique au dossier** + log timeline (`document.generated` / `document.generated_pending_validation` avec `legal_sources_count`)
- [x] **Rappel de suivi auto** créé après génération si `reminder_after_days` (lié à `generated_documents.reminder_id`)
- [x] Tables : `document_templates` étendu, `document_generation_sessions` (+`prefill_metadata`,`uncertain_fields`,`legal_sources_used`,`detected_risks`,`reminder_after_days`), `generated_documents` (+`legal_sources`,`reminder_id`)
- [ ] Catalogue prioritaire : seed des 4 verticales avec config riche (à compléter incrémentalement)

## Priorité 4 — Analyse documentaire ✅ (socle livré)

- [x] **Extraction structurée des contrats** : `contract_data` JSONB (parties, objet, dates signature/effet/fin, durée, renouvellement, préavis, montants, conditions de paiement, pénalités, résiliation, juridiction, loi applicable, confidentialité, non-concurrence)
- [x] **Catalogue 13 risques contractuels typés** (`src/lib/analysis/contract-risks.ts`) : auto_renewal, missed_notice_period, excessive_penalties, unbalanced_clauses, missing_termination, missing_jurisdiction, rgpd_non_compliance, missing_confidentiality, indefinite_duration, unilateral_modification, exclusivity_too_broad, non_compete_invalid, late_payment_no_clause — IA renvoie un `risk_key` normalisé
- [x] **Détection de dates importantes** (`detected_dates`) typées (signature/effective/trial_end/renewal/notice/end/payment/deadline) → insertion auto dans `dossier_deadlines` avec `source=analysis`, `source_analysis_id`, `deadline_type` (importance ≥ medium)
- [x] **Rapport d'analyse enrichi** UI `/analyses/$id` : section "Données contractuelles" (parties, dates clés, durée, montants, juridiction, non-concurrence) + section "Échéances détectées" avec badges d'importance
- [x] Tables : `document_analyses` (+`contract_data`,`detected_dates`), `dossier_deadlines` (+`source`,`source_analysis_id`,`deadline_type`)
- [x] Timeline enrichie : `analysis.completed` log inclut `deadlines_count` + `contract_data_present`
- [ ] OCR documents scannés (étend `ocr-document` edge function existante)

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

## Priorité 8 — Qualité production ✅ (socle livré)

- [x] **Évaluation RAG continue étendue** — `rag_eval_runs` enrichie de 6 métriques (`retrieval_accuracy`, `citation_coverage`, `answer_correctness`, `source_authority_score`, `refusal_quality`, `user_feedback_score`) + agrégat `getRagEvalAggregate` exposé dans `/admin/rag-quality`
- [x] **Dashboard Data Quality enrichi** — fonction SECURITY DEFINER `get_data_quality_snapshot` (sources actives/obsolètes, chunks valides/sans embedding, orphelins, ingestion_failed_24h, autorité moyenne) + section "Instantané base juridique" dans `/admin/data-quality`
- [x] **Rate limiting généralisé** — helper `enforceRateLimit(userId, endpoint, maxPerMinute)` basé sur RPC `check_rate_limit` ; branché sur `agent.runLegalAgent` (déjà existant), `analysis.analyzeDocument`, `generation.finalize`, `exports.dossierPdf`
- [x] **Monitoring d'erreurs** — table `server_function_errors` (RLS super_admin lecture seule, écriture via SECURITY DEFINER `log_server_error` réservée à service_role) + helpers `captureServerError` / `withErrorMonitoring` + page `/admin/server-errors` (top fonctions en échec, filtres sévérité/période, stack traces)
- [ ] Activer Leaked Password Protection dans dashboard Supabase Auth ⚠️ ACTION USER
- [ ] Tests E2E sur les parcours critiques (Q→réponse, dépôt→analyse, génération→validation)

---

## Hors roadmap (reporté volontairement)
- Refonte design globale (à programmer après Priorités 1-3)
- Signature électronique intégrée
- App mobile native
- Intégrations externes (Slack/Teams) au-delà de ce qui existe

---

## ✅ Avancement P5 / P6 / P7 (sprint en cours)

### P5 — Cron Digest (livré)
- [x] Hook `POST /api/public/hooks/digest` (auth via apikey anon)
- [x] Sélection users selon `notification_preferences.digest_frequency` (`daily`/`weekly`)
- [x] Agrégation notifications non lues (24h ou 7j) → email HTML + texte → `email_queue`
- [x] Trace dans `digest_runs` (queued / skipped / failed)
- [x] pg_cron : `jurisai-digest-daily` (7h UTC) + `jurisai-digest-weekly` (lundi 7h UTC)

### P6 — Catalogue workflows (étendu)
- [x] +30 workflows transverses (RH, commercial, sociétés, admin/fiscal)
- [ ] UI "catalogue par domaine" sur `/workflows` (filtres groupes)

### P7 — Multi-profils (livré côté core)
- [x] Catalogue centralisé `src/lib/roles/catalog.ts` (13 rôles, groupes, icônes, tons sémantiques)
- [x] Page `/team` refactorée : sélecteur multi-rôles avec groupes (Standard / Métier / Cabinet)
- [x] Hiérarchie `pickHighestRole()` pour résoudre rôle principal en cas de cumul
- [x] Validation serveur élargie (`invitations.functions.ts` accepte les 12 rôles assignables)
- [ ] Sidebar conditionnelle via `useAccess` (à brancher sur les permissions)
- [ ] Vues simplifiées par profil (terrain / dirigeant / super_admin)
