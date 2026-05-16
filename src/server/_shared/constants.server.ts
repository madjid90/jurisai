// Constantes partagées côté serveur.
// Centralise les valeurs dupliquées dans 8+ fichiers.

/** Point d'entrée unique vers le gateway IA.
 *  - En dev/Lovable : https://ai.gateway.lovable.dev/v1 (proxy)
 *  - En production : https://api.openai.com/v1 (direct OpenAI)
 *  Configurable via OPENAI_BASE_URL ou fallback sur le gateway Lovable.
 */
export const AI_GATEWAY =
  process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

/** Clé API pour le LLM. Cherche OPENAI_API_KEY en priorité, fallback sur LOVABLE_API_KEY. */
export const LLM_API_KEY =
  process.env.OPENAI_API_KEY || process.env.LOVABLE_API_KEY || "";

/** Températures recommandées par usage (audit prompt #2.1). */
export const LLM_TEMPERATURES = {
  classification: 0.1,
  analysis: 0.2,
  chat: 0.3,
  polish: 0.3,
  consensus: 0.3,
  workflow: 0.4,
  expansion: 0.7,
} as const;

/** Limites de tokens par usage pour éviter les réponses excessives. */
export const LLM_MAX_TOKENS = {
  classification: 800,
  chat: 4096,
  analysis: 4096,
  workflow: 6000,
  expansion: 1200,
  consensus: 2000,
} as const;
