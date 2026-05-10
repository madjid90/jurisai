## Contexte

L'audit fait 14 semaines (Phase 1-3, ~200 tâches). Beaucoup est déjà fait dans les sessions précédentes (CRON_SECRET, verify_jwt, DOMPurify, rate-limit fail-closed, isolation tenant docs, deleteComment vérif, fillTemplate centralisé, ocr URL non hardcodée, partitionnement usage_logs, idempotence workflow, validation concurrente, NotificationBell realtime…).

Ce plan exécute **tout ce qui reste**, regroupé en **lots cohérents** dans l'ordre exact de l'audit (Phase 1 → 2 → 3). Chaque lot = une livraison testable.

---

## LOT 1 — Reste de la Sécurité bloquante (Phase 1 / Sem. 1)

- **BUG-A2** (`agent-tools.server.ts` L296) : ne pas auto-créer le document si action sensible et qu'aucun admin n'existe → bloquer + créer demande de validation visible.
- **BUG-A3** (`agent-actions.functions.ts` `validate_action`) : exiger `has_role(admin|manager)` avant exécution.
- **S16** : rate-limit sur `sendInvitation`, `deleteMyAccount`, `createApiKey`.
- **S20** : CORS — répondre 403 si origin inconnue (au lieu de fallback permissif).
- **S22** : unifier `requireAdmin` (un seul helper dans `_shared/`).
- **S14** : hasher le secret webhook `tenant_webhooks` (migration + reissue endpoint).
- **BUG-A12** : `AbortController` 60s sur tous les appels LLM agent.

## LOT 2 — Code propre & types (Phase 1 / Sem. 2)

- Régénérer `database.types.ts` (commande `supabase gen types`) + script `gen:types` dans `package.json`.
- Pointer `client.server.ts` vers `database.types.ts` à jour, **éliminer les `as any/never`** restants par batch (server functions critiques d'abord : agent, workflows, dossier360, generation, documents).
- **BUG-G2** : injection PostgREST `generation.functions.ts` L63 (échapper / valider).
- **BUG-G3** : déplacer rate-limit dans le try/catch.
- **BUG-A9** : filtrer clés dangereuses (`__proto__`, `constructor`, `prototype`) avant merge draft.
- **S24** : échapper `_` et `%` dans toutes les queries ILIKE (helper `escapeIlike`).
- **S23** : validation SIRET (Luhn) dans onboarding + settings.
- `JSON.parse` LLM wrappés en try/catch + Zod (`classifyIntent`, `multi-query-rag`, `agent-runs` L482, `workflow-generator` L240).
- Supprimer `console.debug`, bouton Mail désactivé, lignes mortes.
- Year hardcodé → `new Date().getFullYear()` (`rag-prompts.ts`).

## LOT 3 — CI/CD + tests fondation (Phase 1 / Sem. 3)

- `.github/workflows/ci.yml` : typecheck + lint + vitest.
- Scripts `package.json` : `typecheck`, `lint`, `test`, `test:coverage`, `gen:types`.
- Supprimer `package-lock.json` (Bun seul).
- Tests Vitest : `api-auth.server.ts`, `rate-limit.server.ts`, `auth-middleware`, isolation tenant, `validate_action` rôles, injection prompt (20 payloads), `sensitive-actions`.

## LOT 4 — Agent fiable (Phase 2 / Sem. 4)

- **BUG-A4** : lock atomique `UPDATE ... WHERE status='pending' RETURNING *` sur agent_runs.
- **BUG-A7** : `Promise.all` sur tool calls indépendants.
- **BUG-A10** : batch insert deadlines (1 INSERT au lieu de N).
- Polling `agent_runs` (4s/2.5s) → Supabase Realtime `postgres_changes`.
- SSE streaming réponse agent + tokens en flux dans `ResultPanel`.
- `react-markdown` dans ResultPanel + citations cliquables `[source:N]` + copy-to-clipboard.
- Feedback 👍/👎 → table `message_feedback`.
- Retry exponentiel 429/502/503 + séparer modèle classify (light) du modèle answer (frontier).

## LOT 5 — RAG puissant (Phase 2 / Sem. 5)

- **R1** evaluate-rag : créer conversation temporaire avant scoring.
- **R2** : remplacer Gemini Flash Preview par modèle stable (config tenant).
- **R3** : sanitize message côté legal-chat L317 (pas seulement le query embedding).
- **R4** : `hit_count = hit_count + 1` (RPC) au lieu d'écrasement.
- **R7** : score sémantique × 0.9.
- **R12** : troncature embedding 30 000 chars.
- **R10** : mutex token PISTE (déjà partiellement fait — vérifier).
- **R14/R15** : negative lookbehind dates + cleanup staging si promote échoue.
- Table `legal_reference_index` + vérification post-réponse des citations.
- Fenêtre glissante conversation > 10 messages (résumé).
- 50 `rag_eval_cases` gold standard + dashboard admin scores.

## LOT 6 — Workflows nickels (Phase 2 / Sem. 6)

- **W1** : filtrer `status != 'draft_ai'` dans `listWorkflowDefinitions`.
- **W2** : unifier statuts (`active` ≡ `in_progress` → choisir un canon + migration).
- **W4** : unifier liste rôles admin partout.
- **W5** : Zod sur draft workflow.
- **W6** : RPC transactionnelle `executeStep`.
- **W7** : timezone tenant.
- **W8** : seuils validation configurables par tenant (table `tenant_settings`).
- **W9** : `Promise.allSettled` validations.
- **W10** : ConfirmDialog avant cancel.
- **DynamicFormStep** : composant générique (text/textarea/select/date/bool/file/user/client) + persistance `workflow_step_runs.data` + préremplissage contexte dossier.
- Conditions `if field=value then skip/goto`.

## LOT 7 — Architecture agentique (Phase 2 / Sem. 7)

- Refacto : `agent-loop.server.ts`, `agent-tool-router.server.ts`, interface `AgentTool` typée Zod input/output.
- Table `agent_memory(tenant_id, dossier_id, key, value)` + UI gestion mémoires.
- Migrer 13 règles `business-rules.ts` → table `business_rules` + UI admin + IDCC + versioning.
- Pipeline post-réponse : vérif citations vs `legal_reference_index`, vérif délais vs `legal-delays`, vérif montants → score pondéré → disclaimer si < seuil → log dans `agent_tool_runs`.

## LOT 8 — Tests Phase 2 (Sem. 8)

- Tests agent end-to-end (classify→tools→RAG→answer→actions), chaque outil avec mock, 9 types d'actions, machine à états, formulaires dynamiques, pipeline vérif.
- Tests workflow : génération + runtime + conditions + sensitive + seuils.
- Tests RAG : pipeline complet + multi-query + ingestion + vérification citations.
- Playwright E2E : Login→Question→Sources, Dossier→Upload→Analyse, Workflow start→complete, Onboarding.

## LOT 9 — Frontend nickel (Phase 3 / Sem. 9-10)

- `lazyRouteComponent` sur toutes les routes.
- ErrorBoundary global dans `__root.tsx`.
- `React.memo`/`useMemo` sur sous-vues Dossier360.
- Export DOCX (`docx`) + PDF (`jspdf`).
- ⌘K mobile.
- A11y : `aria-expanded`, `aria-live`, focus-trap (FormSlideOver), skip-to-content.
- Fix memory leak `URL.createObjectURL` (`agent.tsx`).
- Hook `useFileUpload`.

## LOT 10 — Base de données propre (Phase 3 / Sem. 11)

- Tous les index manquants (PARTIE 6 audit).
- Unifier `dossier_deadlines` + `contract_deadlines`.
- Table `rgpd_requests` + compléter purge RGPD (9 tables manquantes — S13).
- Table `dossier_members` (permissions niveau dossier).
- Partitionner `messages` (mensuel) — `usage_logs` déjà fait.
- Pagination cursor sur API v1.
- Fix N+1 (`contract-deadlines`, `document-pipeline`).
- Vues SQL pour agrégats usage.

## LOT 11 — Scalabilité (Phase 3 / Sem. 12)

- Supavisor pooling, circuit breaker LLM + fallback provider, cache Redis chunks/sessions, worker email cron 1min, transactions Postgres composées, `Promise.allSettled` partout où fragile.

## LOT 12 — Collaboration & features avancées (Phase 3 / Sem. 13-14)

- TipTap éditeur principal, commentaires inline + @mentions, versions docs + diff, templates variables dossier, calendrier audiences/deadlines, OpenAPI doc, webhooks sortants tenant, k6 charge 500 users, couverture tests > 60%.

---

## Détails techniques transverses

- **Migrations** : un fichier par lot, RLS systématique, `REVOKE EXECUTE FROM PUBLIC; GRANT EXECUTE TO service_role` sur chaque nouvelle SECURITY DEFINER, jamais de CHECK pour validation temporelle (triggers).
- **Multi-tenant** : tout passe par `getTenantId(userId)` + RLS `is_member_of_tenant` (memory Core).
- **Timeline** : tout événement nouveau passe par `logTimelineEvent`.
- **Types** : interdit d'éditer `types.ts` directement — toujours via régénération.
- **Lots livrables** : à la fin de chaque lot, build + tests passent, notification courte au user, on attend "go" pour le lot suivant **sauf** si tu me dis maintenant "enchaîne tout sans pause".

---

## Cadence proposée

Je te propose d'enchaîner **lot par lot** (1 → 12), avec un message court à la fin de chaque lot listant ce qui a bougé. Tu interviens uniquement si tu veux changer la priorité.

Démarre-t-on **par le LOT 1** (sécurité bloquante restante) ?
