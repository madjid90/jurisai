-- Vague 1 LRE — Foundation : 3 nouvelles tables + 1 nouveau RPC + extensions eval.
-- Déjà appliqué via Supabase MCP — référence Git.

-- 1. legal_normative_hierarchy : seed 10 niveaux Kelsen + droit français
-- (Constitution → Traités UE → ... → Convention collective → Contrat → Jurisprudence)
-- Voir migration appliquée : legal_normative_hierarchy_seed

-- 2. legal_reasoning_traces : audit trail append-only des analyses LRE
-- RLS tenant isolation + RLS append-only (pas d'UPDATE/DELETE pour users)
-- Voir migration appliquée : legal_reasoning_traces

-- 3. hybrid_search_typed : variante de hybrid_search avec
--    - source_types[] (filtre par catégorie : legislation/convention/jurisprudence)
--    - date_at (filtre temporel INCLUSIF des NULL — corrige F1 audit V4)
--    - Hérite du précalcul tsquery (Vague 0)
-- Voir migration appliquée : hybrid_search_typed_lre

-- 4. rag_eval_cases extension : colonnes expected_qualification, expected_majeure, etc.
-- Pour mesurer chaque phase LRE individuellement dans l'éval V2
-- Voir migration appliquée : rag_eval_cases_lre_expected
