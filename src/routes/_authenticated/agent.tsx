// Redirect : /agent → /chat (route unifiée). Préserve le run focus si fourni.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

const AgentSearch = z.object({
  run: z.string().uuid().optional(),
  mode: z.enum(["chat", "document", "procedure", "dossier_selection"]).optional(),
});

export const Route = createFileRoute("/_authenticated/agent")({
  validateSearch: (s) => AgentSearch.parse(s),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/chat",
      search: {
        ...(search.run ? { run: search.run } : {}),
        ...(search.mode ? { mode: search.mode } : {}),
      },
    });
  },
});
