// runHomeAgentIntake — point d'entrée unique de la home AI.
// Standardise l'appel agent depuis le dashboard ou l'inline /dossiers/*.
// Délègue à runLegalAgent en injectant le contexte (document upload, source).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { runLegalAgent, type AgentRunOutput } from "./agent.functions";

const inputSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  source: z.enum(["dashboard", "dossier", "document", "other"]).default("dashboard"),
  dossier_id: z.string().uuid().optional(),
  document_id: z.string().uuid().optional(),
  extracted_context: z.string().max(8000).optional(),
});

export type HomeAgentIntakeInput = z.infer<typeof inputSchema>;

export const runHomeAgentIntake = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => inputSchema.parse(i))
  .handler(async ({ data, context }): Promise<AgentRunOutput> => {
    // Construit un message enrichi avec le contexte extrait (Lot C : document upload pipeline)
    let message = data.message;
    if (data.extracted_context) {
      message += `\n\nContexte extrait :\n${data.extracted_context}`;
    }
    if (data.document_id) {
      message += `\n\n[Document joint : ${data.document_id}]`;
    }
    // Délègue à l'agent canonique (RAG, outils, validations sensibles).
    return runLegalAgent({
      data: { message, dossier_id: data.dossier_id },
      // @ts-expect-error context déjà résolu par middleware
      context,
    } as never);
  });
