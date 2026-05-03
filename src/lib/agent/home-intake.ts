// Helper client : enrichit le message utilisateur avec contexte (document, dossier)
// avant l'appel à l'agent canonique runLegalAgent.

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
