## Objectif

Éliminer les ~6 600 lignes dupliquées dans `src/lib/server-fns/` (et `src/lib/agent/`) en s'appuyant sur le pattern d'`importProtection` déjà corrigé dans `vite.config.ts` (`**/*.server.ts` au lieu de `**/server/**`). Les fichiers `*.functions.ts` peuvent vivre dans `src/server/` et être importés côté client sans déclencher l'import-protection.

## État constaté

- 28 fichiers dans `src/lib/server-fns/`
  - 24 sont des **doublons** d'un fichier homonyme dans `src/server/` (contenu identique ou ne différant que par un import `./_shared/...` → `@/server/_shared/...` et du formatage prettier)
  - 4 n'ont **pas d'équivalent** dans `src/server/` et doivent y être déplacés : `collaboration.functions.ts`, `notifications.functions.ts`, `tenant.functions.ts`, `workflow-runtime.functions.ts`
- 3 fichiers dans `src/lib/agent/` à remettre dans `src/server/` : `agent.functions.ts`, `agent-runs.functions.ts`, `agent-actions.functions.ts`
- ~53 fichiers (routes + composants + 1 lib) importent depuis `@/lib/server-fns/...` ou `@/lib/agent/agent*.functions`

## Étapes

### 1. Rapatrier les 4 fichiers uniques de `src/lib/server-fns/` vers `src/server/`
Déplacer (avec normalisation des imports `@/server/_shared/...` → `./_shared/...` pour rester cohérent avec la convention historique de `src/server/`) :
- `collaboration.functions.ts`
- `notifications.functions.ts`
- `tenant.functions.ts`
- `workflow-runtime.functions.ts`

### 2. Rapatrier les 3 fichiers agent de `src/lib/agent/` vers `src/server/`
Mêmes fichiers, mêmes normalisations d'imports `_shared` :
- `agent.functions.ts`
- `agent-runs.functions.ts`
- `agent-actions.functions.ts`

(Les fichiers non-functions de `src/lib/agent/` — `business-rules.ts`, `home-intake.ts` — restent en place car ce sont des modules client/isomorphes légitimes.)

### 3. Supprimer le dossier `src/lib/server-fns/` entier
Une fois les 4 fichiers uniques rapatriés, supprimer `src/lib/server-fns/` (les 24 autres sont strictement redondants avec `src/server/`).

### 4. Réécrire les imports dans les ~53 fichiers consommateurs
Remplacement global :
- `@/lib/server-fns/<name>` → `@/server/<name>`
- `@/lib/agent/agent.functions` → `@/server/agent.functions`
- `@/lib/agent/agent-runs.functions` → `@/server/agent-runs.functions`
- `@/lib/agent/agent-actions.functions` → `@/server/agent-actions.functions`

Réalisé via un `sed` scripté sur la liste des fichiers identifiés (routes, composants, hooks, `src/lib/agent/business-rules.ts`).

### 5. Vérifications
- `rg "@/lib/server-fns"` doit renvoyer 0 résultat
- `rg "@/lib/agent/agent(-runs|-actions)?\.functions"` doit renvoyer 0 résultat
- Build / preview : pas d'erreur `import-protection`, navigation `/chat`, `/dashboard`, `/agent` OK

## Détails techniques

- `vite.config.ts` est déjà correct (`files: ["**/*.server.ts", "**/*.server.tsx"]`) — pas de modification.
- Les `*.functions.ts` dans `src/server/` sont autorisés côté client : le bundler `createServerFn` remplace l'implémentation par un stub RPC.
- Les imports vers `@/server/_shared/*.server` restent strictement server-side (bloqués côté client par le pattern `**/*.server.ts`), ce qui garantit que les secrets et `supabaseAdmin` ne fuitent pas.
- Aucun changement comportemental attendu côté UI ni côté logique métier.

## Risques

- Si l'un des 24 fichiers "doublons" contient en réalité une divergence non triviale (au-delà du chemin d'import et du formatage), elle serait perdue. Mitigation : avant suppression, lancer un diff systématique entre `src/lib/server-fns/<f>` et `src/server/<f>` et signaler tout écart sémantique avant overwrite. Pour les 4 fichiers détectés "DIFFERS" qui ne sont en fait que du reformatage prettier (vérifié sur `dashboard.functions.ts`), conserver la version `src/server/` (canonique).
