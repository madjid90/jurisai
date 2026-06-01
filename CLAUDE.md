# JurisAI — Onboarding Claude

> **Tu reprends une session sur JurisAI ? Lis CES 3 FICHIERS dans l'ordre :**
> 1. **`docs/CONTEXT.md`** — état du projet + vision + faux positifs à éviter
> 2. **`docs/ARCHITECTURE-AGENT-360-RAG-FIRST.md`** — spec architecture vivante (LRE → Procedure → Workflow → Document Builders)
> 3. **`supabase/migrations/README.md`** — drift connu + procédure migrations

---

## 📁 Mémoire projet (à lire avant toute action)

| Fichier | Contenu | Quand le lire |
|---|---|---|
| **`docs/CONTEXT.md`** | Vision, stack, accès, état actuel, sprints livrés, faux positifs | **Toujours en premier** |
| **`docs/ARCHITECTURE-AGENT-360-RAG-FIRST.md`** | Architecture Agent 360 RAG-first (sprints J1-J5 livrés), pipeline détaillé, anti-patterns | Si on touche LRE / Procedure / Workflow / Document Builders |
| **`supabase/migrations/README.md`** | Migrations versionnées + drift documenté | Si on touche au schéma DB |
| `docs/archive/` | Historique (audits traités, plans livrés, refs legacy) | Uniquement pour comprendre le passé |

## ⚙️ Workflow standard

1. **Lis** `docs/CONTEXT.md` en entier
2. **Vérifie** `git log --oneline -20` pour les derniers commits
3. **Vérifie** Supabase via MCP si besoin de données live (`yuvysjsyumxpekzvlzsx`)
4. **Demande confirmation** avant tout gros chantier (>5 fichiers ou >500 lignes)
5. **Commit + push** après chaque bloc logique
6. **Mets à jour** `docs/CONTEXT.md` §8 (état actuel) et §10 (faux positifs) à la fin de la session

## 🛡️ Règles d'or non négociables

- **Code en français** dans les commentaires
- **JAMAIS hardcoder de règle juridique** dans un prompt — tout vient du RAG
- **JAMAIS `signOut()` automatique** sur erreur transitoire (cause #1 churn)
- **JAMAIS de cas d'eval inventés** — toujours validés par le user
- **Citation `verbatim`** obligatoire dans LRE Pass 3 — Pass 4 fait exact-match 3 niveaux
- **`as any` toléré** sur jsonb fields, à éroder progressivement
- **Append-only** : `calculation_history`, `legal_reasoning_traces`, `agent_post_checks`
- **RLS partout** + `is_member_of_tenant(auth.uid(), tenant_id)`
- **Migrations DB** : créer fichier `supabase/migrations/YYYYMMDDHHMMSS_*.sql` AVANT d'appliquer via MCP (éviter le drift documenté dans audit V6 P2)

## 🔑 Accès en place

- **Supabase MCP** : projet `yuvysjsyumxpekzvlzsx` (RW)
- **GitHub** : repo `madjid90/jurisai` branch `main`
- **Lovable Cloud Secrets** : OPENAI/SERVICE_ROLE/PISTE/CRON déjà configurés
- **Pattern Lovable** : `SUPABASE_SERVICE_ROLE_KEY` peut être en réalité une anon key → toujours utiliser RPC SECURITY DEFINER pour bypass RLS (cf CONTEXT §13)

---

*Maintenu par le user (souci) et Claude. Si quelque chose change, mets à jour `docs/CONTEXT.md`.*
