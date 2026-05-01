import { createFileRoute, redirect } from "@tanstack/react-router";

// Route conservée pour compatibilité — redirige vers le nouvel Assistant juridique
export const Route = createFileRoute("/_authenticated/chat")({
  beforeLoad: () => {
    throw redirect({ to: "/agent" });
  },
});
