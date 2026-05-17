// Helper client : enrichit le message utilisateur avec contexte (document, dossier)
// avant l'appel à l'agent canonique runLegalAgent, puis applique la décision
// de routage produite par `decideRouting()` côté serveur.

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

// Routage métier renvoyé par createAgentRun (mirror du type côté serveur).
export type AgentRouting =
  | { target: "dossier"; route: string; dossier_id: string; title?: string }
  | {
      target: "dossier_selection";
      candidates: Array<{ id: string; title: string; category: string | null }>;
      route: string;
    }
  | { target: "analysis"; route: string; analysis_id: string }
  | { target: "agent"; route: string; mode: "document" | "procedure" | "chat" }
  | { target: "chat"; route: string; run_id: string }
  | { target: "requests"; route: string; run_id: string };

/**
 * Applique la décision de routage de l'Agent 360 (cf. spec § 7
 * `resolveAgentDestination`). Chaque intent ouvre la page la plus utile à
 * l'utilisateur — l'outil interne reste invisible.
 *
 *  - dossier              → /dossiers/:id
 *  - dossier_selection    → /agent?mode=dossier_selection (choix inline)
 *  - analysis             → /analyses/:id
 *  - agent (doc/procedure)→ /agent?mode=document|procedure
 *  - chat                 → /chat (Assistant juridique sourcé)
 *  - requests / fallback  → /mes-demandes (boîte de réception)
 */
// Audit fix : utilitaire pour valider qu'un id ressemble bien à un UUID avant navigate
// (sinon "/dossiers/undefined" ou "/dossiers/null" → 404 silencieux).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(id: unknown): id is string {
  return typeof id === "string" && UUID_RE.test(id);
}

export function applyRouting(
  routing: AgentRouting | undefined,
  navigate: ReturnType<typeof useNavigate>,
  fallbackRunId: string,
): void {
  // Audit fix : fallback systématique sur /chat si routing absent OU id invalide.
  // Avant : navigate vers "/dossiers/undefined" ou "/analyses/null" → 404 page introuvable.
  const safeFallback = () =>
    navigate({ to: "/chat", search: { run: fallbackRunId } as never });

  if (!routing) {
    void safeFallback();
    return;
  }

  switch (routing.target) {
    case "dossier":
      if (!isValidUuid(routing.dossier_id)) {
        console.warn("[routing] dossier_id invalide, fallback /chat:", routing.dossier_id);
        void safeFallback();
        return;
      }
      void navigate({ to: "/dossiers/$id", params: { id: routing.dossier_id } });
      return;

    case "analysis":
      if (!isValidUuid(routing.analysis_id)) {
        console.warn("[routing] analysis_id invalide, fallback /chat:", routing.analysis_id);
        void safeFallback();
        return;
      }
      void navigate({
        to: "/analyses/$id" as never,
        params: { id: routing.analysis_id } as never,
      });
      return;

    case "chat":
    case "requests":
      void navigate({
        to: "/chat",
        search: { run: isValidUuid(routing.run_id) ? routing.run_id : fallbackRunId } as never,
      });
      return;

    case "agent":
      void navigate({
        to: "/chat",
        search: { run: fallbackRunId, mode: routing.mode } as never,
      });
      return;

    case "dossier_selection":
      void navigate({
        to: "/chat",
        search: { run: fallbackRunId, mode: "dossier_selection" } as never,
      });
      return;

    default:
      void safeFallback();
      return;
  }
}
