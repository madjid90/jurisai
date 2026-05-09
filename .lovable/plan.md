
# Refonte JurisAI — partie principale (hors home)

Spec reçue : transformer l'app "modules" en assistant orienté actions. Voici le plan d'exécution, par lots livrables et testables. Je n'attaque PAS la home/dashboard (déjà refondu récemment).

## État actuel — déjà conforme
- Sidebar collapsable (`AppShell.tsx`), persistée en localStorage : OK.
- `/scan`, `/analyses`, `/links`, `/templates`, `/workflows` déjà déplacés en section Admin/Outils : OK.
- Helpers `getTenantId` + `logTimelineEvent` + RAG `[source:N]` en place.

## Lot 1 — Sidebar client finale (rapide)
- Renommer "Mes dossiers" → "Dossiers", "Mes documents" → "Documents".
- Ajouter "Notifications" comme entrée principale (route `/notifications` à créer, liste pleine page de `notifications`).
- Vérifier que les rôles non-admin ne voient AUCUNE route Outils/Admin.

## Lot 2 — ResultPanel central (cœur UX)
Nouveau composant `src/components/agent/ResultPanel.tsx` :
```
<ResultPanel>
  <Summary />            // texte agent + citations [source:N]
  <SuggestedActions />   // boutons → executeSuggestedAction()
  <ValidationActions />  // "Compléter / Valider" → ouvre slide-panel au clic
  <LinkedDocuments />    // documents rapprochés
  <TimelinePreview />    // 3 derniers events du dossier lié
</ResultPanel>
```
- Branché dans `/agent` (remplace l'affichage actuel des messages assistant).
- Plus de popup auto : panneau slide droit `<FormSlideOver>` ouvert uniquement au clic.

## Lot 3 — Intent router + executeSuggestedAction
- Server fn `src/server/agent-intent.functions.ts` :
  - `detectIntent({message, attachments})` → `question | procedure | document | dossier | generation | analysis | follow_up`
  - Reuse `agent-intent-actions.server.ts` existant, mais expose un point d'entrée unique consommé par `/agent`.
- Server fn `executeSuggestedAction({type, payload})` couvrant :
  `open_dossier, create_dossier, link_document, start_workflow, generate_document, create_reminder, validate_action, assign_task, send_notification`.
- Suppression de `onRelaunch(label)` dans le front.

## Lot 4 — openForm centralisé
- Hook `useFormSlideOver()` + composant `<FormSlideOver type data />`.
- Types : `procedure_validation | edit_extracted_data | create_dossier | missing_information | workflow_confirmation`.
- Slide panel droit, sauvegarde draft auto en localStorage par `(type,id)`.

## Lot 5 — Pipeline document `processUploadedDocument()`
Server fn orchestrateur unique enchaînant :
1. `runOcrDocument()` (existant `ocr.functions.ts`)
2. Extraction entités (réutiliser `analysis.functions.ts`)
3. Analyse risques/échéances
4. `findRelatedContext()` (nouveau — vector search sur `dossier_context_index`)
5. Création `document_links` + `entity_mentions`
6. Création rappels/échéances + `logTimelineEvent`
7. Retour structuré → `ResultPanel`

## Lot 6 — Dossier 360 & Page Document
- `/dossiers/$id` : vérifier les 9 sections (timeline, documents, analyses, rappels, risques, tâches, validations, historique, veille liée). Compléter celles manquantes via onglets dans `Dossier360Tabs.tsx`.
- `/documents/$id` : vérifier sections (résumé, données extraites, risques, échéances, rappels, docs liés, actions). Compléter si besoin.

## Lot 7 — Notifications & background tasks
- Page `/notifications` (liste + filtres + clic → `navigate(target)`).
- Table `background_jobs` (déjà existante ?) — sinon migration : `id, type, status, payload, result, error, created_at`.
- Worker via cron edge function `process-background-jobs` (OCR, embeddings, veille, PDF).

## Lot 8 — agentState global + observabilité
- Store Zustand `useAgentState` : `idle | thinking | processing | waiting_validation | completed | error`.
- Logs : insérer dans `agent_runs` (existe) à chaque transition + erreurs dans `server_errors`.

## Code mort à supprimer (audit V2)
- `src/server/chat.functions.ts`, `src/server/agent-validations.functions.ts`
- `src/components/app/MessageFeedback.tsx`
- Edge function `legal-chat`

## Ordre d'exécution proposé
1. **Lot 1** (sidebar finale) — 1 itération
2. **Lot 2 + Lot 4** (ResultPanel + FormSlideOver) — squelette UI
3. **Lot 3** (intent + executeSuggestedAction) — branche le ResultPanel
4. **Lot 5** (pipeline document)
5. **Lot 6** (Dossier 360 / Doc 360 — vérif + compléments)
6. **Lot 7 + 8** (notifs, background, agentState, observabilité)
7. Nettoyage code mort

## Questions avant de lancer
1. **Périmètre tour 1** : je commence par Lots 1+2+4 (sidebar + ResultPanel + slide-over vide branché sur `/agent`) ? Ou tu veux que j'attaque directement Lot 5 (pipeline document) qui a plus d'impact métier ?
2. **Notifications** : route `/notifications` dédiée OK, ou on garde uniquement la cloche dans le header ?
3. **Background jobs** : on accepte une nouvelle table + cron edge function (seul cas autorisé d'edge selon mémoire), ou on diffère et on reste en synchrone pour le moment ?
