// Redirect : /mes-demandes → /chat (l'historique est désormais la sidebar de /chat).
import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

const Search = z.object({ run: z.string().uuid().optional() });

export const Route = createFileRoute("/_authenticated/mes-demandes")({
  validateSearch: (s) => Search.parse(s),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/chat",
      search: search.run ? { run: search.run } : {},
    });
  },
});
