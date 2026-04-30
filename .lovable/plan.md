# Roadmap JurisAI — 5 étapes

## État actuel (avril 2026)
- ✅ Phase 1 (CRM, auth, multi-tenant, onboarding)
- ✅ Phase 2 (RAG juridique, ingestion Légifrance/JudiLibre/KALI/BOFiP/CDTN/CNIL, hybrid search, citations)
- ✅ Veille programmée + alertes
- ✅ 4 nouvelles tables métier : `case_timeline_events`, `identified_risks`, `validation_requests`, `reminders` (avril 2026)

---

## Étape 1 — Stabilisation ✅ (avril 2026)

- [x] `getTenantId` centralisé dans `src/server/_shared/tenant.server.ts` (6 fichiers migrés, signature uniforme)
- [x] `logTimelineEvent` centralisé + branché sur `createDossier`, `updateDossier(status)`, `analyzeDocument` (autres événements branchés à la création de leurs server functions)
- [x] Audit RLS : 100% des tables ont RLS activée, aucune policy laxiste, conventions documentées dans mem://architecture/multi-tenant
- [x] Warnings linter : 13 → 2 (pgvector in public = faux positif accepté, Leaked Password Protection = action user dans dashboard)

## Étape 2 — Verticale RH (priorité #1)

- [ ] Compléter les workflows dynamiques (embauche, rupture, sanction, congés, AT)
- [ ] Templates HR riches avec validation des variables et détection clauses illégales
- [ ] Pipeline de détection de risques RH → insertion automatique dans `identified_risks`
- [ ] Échéances réglementaires auto (préavis, DPAE, visite médicale) → insertion dans `dossier_deadlines`
- [ ] UI : panneau "Risques" et "Timeline" sur la page dossier

## Étape 3 — Verticale Commerciale

- [ ] Analyse CGV/contrats : extension de `document_analyses` avec détection clauses abusives
- [ ] Générateur CGV/CGU sur mesure (templates paramétriques)
- [ ] Suivi contrats clients (échéances, renouvellements, indexations) via `reminders`
- [ ] Workflow recouvrement amiable (mise en demeure, relances graduées)

## Étape 4 — Verticale Corporate / RGPD

- [ ] AG : convocations, ordres du jour, PV (templates + workflow validation)
- [ ] Décisions associé unique
- [ ] Registre des traitements RGPD (CRUD + export CNIL)
- [ ] DPIA, registre violations, exercice des droits (workflows dédiés)

## Étape 5 — Reporting & gouvernance

- [ ] Dashboard multi-profil (lecture du `profile_kind` profil → routing auto)
- [ ] Reporting consolidé (volume dossiers, risques ouverts, validations en attente, échéances)
- [ ] Export PDF/Excel pour CA
- [ ] Métriques RAG (déjà partiellement là via `rag_eval_runs`) → vue consolidée admin

---

## Ce qu'on NE fait PAS dans cette roadmap (reporté)
- Refonte design globale (à programmer après Étape 2)
- Signature électronique intégrée (Étape 6+)
- App mobile (hors scope)
