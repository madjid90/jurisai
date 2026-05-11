# Routage métier Agent 360

Objectif : l'agent comprend l'intention puis ouvre directement la bonne page métier au lieu de toujours retomber sur `/agent`.

## Carte des intentions → routes

| Intention | Destination |
|---|---|
| `search_dossier` (1 résultat fiable, score ≥ 0.8) | `/dossiers/:id` |
| `search_dossier` (plusieurs ou aucun) | `/agent?run=...` (sélection / création) |
| `analyze_document` (upload) | `/analyses/:id` |
| `legal_question` (RAG simple) | `/agent?run=...` (vue focus existante) |
| `generate_document` | `/agent?run=...&mode=document` |
| `launch_procedure` | `/agent?run=...&mode=procedure` |

## 1. Backend — décision de routage côté serveur

Étendre `runLegalAgent` (`src/server/agent.functions.ts`) pour calculer un `routing` à partir de la classification + de la trace, et le renvoyer dans `AgentRunOutput`.

```ts
type AgentRouting =
  | { target: "dossier"; route: string; dossier_id: string }
  | { target: "dossier_selection"; candidates: Array<{ id: string; title: string; score: number }> }
  | { target: "dossier_create"; suggested_title: string }
  | { target: "analysis"; route: string; analysis_id: string }
  | { target: "agent"; mode: "document" | "procedure" | "chat" };
```

Règles :
- Si `intent === "search_dossier"` : appeler `searchDossier` directement (avant la boucle LLM si possible) ; si 1 résultat avec score ≥ 0.8 → `target: "dossier"`. Sinon `dossier_selection` ou `dossier_create`.
- Si la trace contient un `analyze_document` réussi avec un `analysis_id` → `target: "analysis"`.
- Si `intent === "generate_document"` ou `"launch_procedure"` → `target: "agent"` avec mode correspondant.
- Sinon `target: "agent"` mode `chat`.

Persister `routing` sur la ligne `agent_runs` (colonne JSON `routing`) — migration nécessaire.

## 2. Frontend — consommer la décision

### `src/lib/agent/home-intake.ts`
Ajouter `applyRouting(routing, navigate)` : effectue le redirect TanStack approprié (`/dossiers/$id`, `/analyses/$id`, `/agent?run=...&mode=...`).

### `src/routes/_authenticated/dashboard.tsx` (ligne 117)
Remplacer le `navigate({ to: "/agent", search: { run } })` systématique par :
```ts
const created = await create({ data: { message: text, attachments } });
applyRouting(created.routing, navigate, created.id);
```

### `src/routes/_authenticated/agent.tsx`
- Quand `mode=document` ou `mode=procedure` est dans le search param : afficher l'UI focus déjà en place avec le panneau d'action correspondant (pré-sélection d'un wizard / d'une procédure).
- Cas `dossier_selection` : afficher la carte multi-choix décrite dans la spec (§ 2 cas 2) + bouton « Créer un nouveau dossier ».

## 3. Ce qu'on NE touche PAS

- Pas de nouvelle page `/chat` séparée pour cette itération — le mode chat reste sur `/agent?run=...` (existant et stable).
- Pas de refonte de la page `/analyses/:id` ni de `/dossiers/:id` — elles existent déjà avec le contenu attendu (résumé, risques, échéances, actions).
- Pas de changement aux 15 tools existants.

## 4. Détails techniques

- Migration SQL : `ALTER TABLE agent_runs ADD COLUMN routing jsonb;`
- `AgentRunOutput` étendu avec `routing: AgentRouting`.
- `searchDossier` retourne déjà un score — l'utiliser tel quel.
- `analyze_document` doit retourner `analysis_id` dans son `ToolOutcome.result` pour que la boucle puisse le récupérer (vérifier `agent-tools.server.ts` ligne ~675 et ajuster si besoin).
- Préserver le comportement actuel quand `routing` est absent (fallback `/agent?run=...`).

## Checklist

- [ ] Migration `agent_runs.routing`
- [ ] `runLegalAgent` calcule et persiste `routing`
- [ ] `AgentRunOutput.routing` typé
- [ ] `applyRouting()` helper client
- [ ] Dashboard utilise `applyRouting`
- [ ] Page `/agent` gère `mode=document|procedure` et `dossier_selection`
- [ ] Test manuel des 5 intentions
