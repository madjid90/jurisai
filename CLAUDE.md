# JurisAI — Onboarding Claude

> **Tu reprends une session sur JurisAI ? Lis IMMÉDIATEMENT [`docs/CONTEXT.md`](./docs/CONTEXT.md).**
>
> Ce fichier-ci est juste un pointeur. Le vrai contexte est dans `docs/CONTEXT.md`.

---

## Mémoire projet (à lire avant toute action)

| Fichier | Contenu | Quand le lire |
|---|---|---|
| **`docs/CONTEXT.md`** | Vision produit, stack, accès, état actuel, règles d'or, faux positifs à éviter | **Toujours en premier** |
| [`docs/LRE-IRAC-PLAN.md`](./docs/LRE-IRAC-PLAN.md) | Plan détaillé du Legal Reasoning Engine (couche de raisonnement juridique) | Si on touche au LRE / Pass 1-4 / syllogisme |

## Workflow

1. **Lis** `docs/CONTEXT.md` en entier
2. **Vérifie** `git log --oneline -20` pour voir les derniers commits
3. **Vérifie** Supabase via MCP si besoin de données live (`yuvysjsyumxpekzvlzsx`)
4. **Demande confirmation** avant tout gros chantier (>5 fichiers ou >500 lignes)
5. **Commit + push** après chaque bloc logique
6. **Mets à jour** `docs/CONTEXT.md` §8 (état actuel) et §10 (faux positifs) à la fin de la session

## Règles d'or condensées

- Code en **français** dans les commentaires
- **JAMAIS hardcoder de règle juridique** dans un prompt — tout vient du RAG
- **JAMAIS `signOut()` automatique** sur erreur transitoire
- **JAMAIS de cas d'eval inventés** — toujours validés par le user
- **Citation `verbatim`** obligatoire dans Pass 3 LRE — Pass 4 fait exact-match
- **`as any` toléré** sur jsonb fields, à éroder progressivement
- **Append-only** : `calculation_history`, `legal_reasoning_traces`, `agent_post_checks`
- **RLS partout** + `is_member_of_tenant(auth.uid(), tenant_id)`

## Accès en place

- **Supabase MCP** : projet `yuvysjsyumxpekzvlzsx`
- **GitHub** : repo `madjid90/jurisai` branch `main`
- **Lovable Cloud Secrets** : OPENAI/SERVICE_ROLE/PISTE/CRON déjà configurés

---

*Maintenu par le user (souci) et Claude. Si quelque chose change, mets à jour `docs/CONTEXT.md`.*
