## Objectif

Spécialiser le rendu des résultats agent par intent, via un composant central `ResultRenderer` réutilisé dans `/agent`, `/chat` et une nouvelle page `/mes-demandes/$id`. Aujourd'hui chaque page route correctement, mais le rendu reste générique (markdown + actions) — on perd la valeur métier.

## Principe

Une seule source de vérité de présentation : `<ResultRenderer run={agentRun} />` qui dispatch sur des sous-vues spécialisées selon `run.intent` / `run.routing.target`. Chaque page route consomme le même composant et n'ajoute que son chrome (titre, breadcrumb, sidebar dossier).

## Sous-vues spécialisées (composants dédiés)

| Composant | Intent ciblé | Contenu spécifique |
|---|---|---|
| `LegalAnswerView` | `question_juridique`, `recherche_jurisprudence` | Markdown réponse + citations `[source:N]` cliquables + `SourcesPanel` latéral |
| `DocumentDraftView` | `redaction_document` | Aperçu doc rédigé + chips "champs manquants" + boutons Compléter / Demander validation / Télécharger PDF |
| `WorkflowView` | `conformite`, `procedure` | `WorkflowStatusBanner` + `WorkflowStepInline` (étape courante) + récap étapes franchies |
| `DossierSelectionView` | `gestion_dossier` (n résultats) | Cartes multi-choix dossiers candidats avec score + CTA "Ouvrir" / "Créer nouveau" |
| `AnalysisView` | `analyse_document` | Résumé doc + risques (badges) + clauses manquantes + dates extraites + actions suggérées |
| `FollowUpView` | `suivi`, `autre`, fallback | Récap court de la run + statut + lien vers ressources créées |
| `RefusedView` | `refused === true` | Raison du refus + suggestions (préciser, joindre doc…) |

Toutes ces vues partagent un footer commun :
- bloc **suggested_actions** (chips contextuels) — déjà géré côté serveur
- bloc **validation_actions** (si `requires_validation`)
- bloc **timeline preview** (3 derniers events du dossier lié)
- bloc **dossier lié** (header avec lien vers `/dossiers/:id`)

Ces blocs partagés restent dans `ResultPanel` (déjà existant), qu'on transforme en **wrapper** : `ResultPanel` rend le chrome + slots, `ResultRenderer` injecte la sous-vue spécialisée dans le slot principal.

## Architecture fichiers

```text
src/components/agent/
  ResultRenderer.tsx          ← NOUVEAU : dispatch par intent
  ResultPanel.tsx             ← gardé : chrome partagé (dossier, actions, timeline, validation)
  views/
    LegalAnswerView.tsx       ← NOUVEAU
    DocumentDraftView.tsx     ← NOUVEAU
    WorkflowView.tsx          ← NOUVEAU (réutilise WorkflowStepInline + WorkflowStatusBanner)
    DossierSelectionView.tsx  ← NOUVEAU (extrait depuis agent.tsx)
    AnalysisView.tsx          ← NOUVEAU
    FollowUpView.tsx          ← NOUVEAU
    RefusedView.tsx           ← NOUVEAU
```

## Pages consommatrices

1. **`/agent`** — remplace le bloc résultat actuel par `<ResultRenderer run={...} />`.
2. **`/chat`** — au lieu d'une bulle markdown brute, wrappe la réponse dans `<ResultRenderer />` (la `LegalAnswerView` y sera quasi systématiquement choisie).
3. **`/mes-demandes/$id`** — NOUVELLE route : charge la run via `getAgentRun(id)`, rend `<ResultRenderer run={...} />`. Devient l'historique unifié : l'utilisateur peut rouvrir n'importe quelle demande passée et revoir le résultat correctement formaté.
4. **`/mes-demandes`** (liste) — chaque ligne devient cliquable vers `/mes-demandes/$id` (en plus du lien d'origine vers la page cible).

## Server function additionnelle

- `getAgentRun(runId)` dans `src/server/agent-runs.functions.ts` : retourne la run complète (message, intent, domain, answer, sources, suggested_actions, missing_information, refused, dossier_id, trace, created_at) — déjà ~présent à compléter au besoin.

## Routing inchangé

`resolveAgentDestination()` continue d'orienter vers la page cible (`/chat`, `/agent`, `/dossiers/:id`, `/analyses/:id`, `/mes-demandes`). Ce qui change : **toutes ces pages affichent désormais le même `ResultRenderer`** au lieu de rendus disparates. La cohérence visuelle est garantie ; les différences entre pages sont dans le chrome (titre, sidebar dossier 360°…), pas dans le rendu du résultat.

## Mémoire à mettre à jour

`mem://core/agent-360-experience-principale.md` : ajouter section "Rendu spécialisé par intent → ResultRenderer central. Chaque page route + monte ResultRenderer. Ne jamais dupliquer le rendu de réponse."

## Hors scope (pas dans ce lot)

- Pas de refonte du système d'actions (suggested_actions / validation_actions restent tels quels côté serveur).
- Pas de nouveaux outils agent ni nouvelle classification d'intent.
- Pas de design system change : tokens existants de `styles.css`.
- Streaming / temps réel non touché.

## Risques

- `LegalAnswerView` doit gérer le cas où `sources` est vide mais `requires_rag === true` → afficher le `RefusedView` à la place.
- `DocumentDraftView` dépend de la présence d'un `document_id` dans `run.trace` (outil `propose_document`) — fallback sur `FollowUpView` sinon.
- `/chat` actuellement bulles successives : on garde le format conversation, mais pour la dernière réponse assistant on substitue `ResultRenderer` (les anciennes bulles restent en markdown simple).
