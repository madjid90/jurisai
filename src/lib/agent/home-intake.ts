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
 * Applique la décision de routage de l'Agent 360 en redirigeant vers la bonne
 * page métier (dossier, analyse, ou vue agent dédiée).
 */
export function applyRouting(
  routing: AgentRouting | undefined,
  navigate: ReturnType<typeof useNavigate>,
  fallbackRunId: string,
): void {
  if (!routing) {
    void navigate({ to: "/agent", search: { run: fallbackRunId } as never });
    return;
  }
  switch (routing.target) {
    case "dossier":
      void navigate({
        to: "/dossiers/$id",
        params: { id: routing.dossier_id },
      });
      return;
    case "analysis":
      void navigate({
        to: "/analyses/$id",
        params: { id: routing.analysis_id },
      });
      return;
    case "agent":
      void navigate({
        to: "/agent",
        search: { run: fallbackRunId, mode: routing.mode } as never,
      });
      return;
    case "dossier_selection":
      void navigate({
        to: "/agent",
        search: { run: fallbackRunId, mode: "dossier_selection" } as never,
      });
      return;
  }
}
