// Redirect : /mes-demandes/:id → /chat?run=:id (vue unifiée).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/mes-demandes/$id")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/chat",
      search: { run: params.id },
    });
  },
});
