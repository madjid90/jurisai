// Constantes partagées côté serveur.
// Centralise les valeurs dupliquées dans 8+ fichiers.

/** Point d'entrée unique vers le gateway IA (Lovable). */
export const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1";

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
