// Helper client : enrichit le message utilisateur avec contexte (document, dossier)
// avant l'appel à l'agent canonique runLegalAgent.

import type { useNavigate } from "@tanstack/react-router";

export type HomeAgentIntakeOptions = {
  message: string;
  source?: "dashboard" | "dossier" | "document" | "other";
  dossier_id?: string;
  document_id?: string;
  extracted_context?: string;
};

export function buildIntakeMessage(opts: HomeAgentIntakeOptions): string {
  let msg = opts.message.trim();
  if (opts.extracted_context) {
    msg += `\n\nContexte extrait :\n${opts.extracted_context}`;
  }
  if (opts.document_id) {
    msg += `\n\n[Document joint : ${opts.document_id}]`;
  }
  return msg;
}

// Routage métier renvoyé par createAgentRun. L'Agent 360 décide où envoyer
// l'utilisateur après la classification de l'intention.
export type AgentRouting =
  | { target: "dossier"; route: string; dossier_id: string; title?: string }
  | {
      target: "dossier_selection";
      candidates: Array<{ id: string; title: string; category: string | null }>;
      route: string;
    }
  | { target: "analysis"; route: string; analysis_id: string }
  | { target: "agent"; route: string; mode: "document" | "procedure" | "chat" };

/**
 * Applique la décision de routage de l'Agent 360.
 *
 * RÈGLE PRODUIT (recadrage Agent 360 = expérience principale) :
 * - Par défaut, on RESTE inline dans /agent. Le résultat (réponse juridique,
 *   analyse de document, brouillon, procédure...) s'affiche dans l'assistant.
 * - On n'ouvre une page métier QUE si la demande explicite de l'utilisateur
 *   est de la voir : seul `target=dossier` (1 dossier fiable trouvé) déclenche
 *   une vraie navigation vers /dossiers/:id.
 * - Pour `analysis`, `agent` (document/procedure), `dossier_selection`, on
 *   reste sur /agent — l'utilisateur cliquera lui-même "Voir l'analyse",
 *   "Voir toute la procédure", etc. depuis le ResultPanel.
 */
export function applyRouting(
  routing: AgentRouting | undefined,
  navigate: ReturnType<typeof useNavigate>,
  fallbackRunId: string,
): void {
  // Cas unique d'auto-navigation : dossier explicitement demandé et trouvé.
  if (routing?.target === "dossier") {
    void navigate({
      to: "/dossiers/$id",
      params: { id: routing.dossier_id },
    });
    return;
  }

  // Tous les autres cas : on reste dans l'expérience Agent 360 inline.
  // On passe le `mode` éventuel (document / procedure / dossier_selection)
  // pour que /agent puisse afficher le panneau adapté SANS forcer un tunnel.
  const mode =
    routing?.target === "agent"
      ? routing.mode
      : routing?.target === "dossier_selection"
        ? "dossier_selection"
        : routing?.target === "analysis"
          ? "analysis"
          : undefined;

  void navigate({
    to: "/agent",
    search: (mode
      ? { run: fallbackRunId, mode }
      : { run: fallbackRunId }) as never,
  });
}
