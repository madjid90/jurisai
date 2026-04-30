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

## Priorité 5 — Notifications + veille actionnable

- [ ] Table `notification_preferences` (emails on/off, app on/off, fréquence résumé, types veille, domaines, sites/clients suivis)
- [ ] Table `email_queue` + worker d'envoi (résumés hebdo/mensuels)
- [ ] Table `legal_updates` (titre, domaine, résumé, source, dates publication/effet, qui concerné, impact, urgence, actions, docs/workflows impactés)
- [ ] Table `legal_update_actions` (boutons d'action : créer tâche/rappel, MAJ modèle, note interne, notifier, lancer audit, archiver)
- [ ] Évolution `notifications` : 10 types (`document_a_valider`, `echeance_proche`, `risque_detecte`…)
- [ ] 10 types de rappels (renouvellement, préavis, fin essai, entretien, délai réponse, relance facture, fin validité, MAJ régl., échéance RGPD, oblig. déclarative)

## Priorité 6 — Workflows métier

- [ ] **Structure workflow étendue** : déclencheurs, étapes, données nécessaires, docs générables, sources juridiques, rappels possibles, validation requise, risques, sorties
- [ ] **Fonction `validateWorkflowStep()`** retournant `{ok, warnings[], blockers[], missing_fields[], recommended_next_step}`
- [ ] Workflows RH (16) — absence, retards, avertissement, entretien, mise à pied, licenciement (faute simple/grave), rupture essai, rupture conv, AT, inaptitude, congés, heures sup, modif contrat, abandon poste, affichages
- [ ] Workflows commerciaux (9) — relance, mise en demeure, analyse/rupture fournisseur, vérif CGV, litige, retard livraison, clause risquée, négociation
- [ ] Workflows sociétés (8) — PV AG, décision associé unique, gérant, cession parts, comptes, statuts, convocation, registre
- [ ] Workflows RGPD (8) — registre simplifié, demande accès, vidéosurveillance, badgeuse, conservation, politique, charte, audit

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
