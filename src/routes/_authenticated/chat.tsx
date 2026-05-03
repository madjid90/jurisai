import { createFileRoute, redirect } from "@tanstack/react-router";

// Route conservée pour compatibilité — redirige vers la home (agent en background)
export const Route = createFileRoute("/_authenticated/chat")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
