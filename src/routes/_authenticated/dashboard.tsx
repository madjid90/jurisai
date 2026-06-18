// Sprint U2 (18/06) — /dashboard redirige vers /chat.
//
// La home par défaut devient l'agent, comme Harvey/Claude.
// Plus de tableau de bord avec KPI/widgets — clutter visuel.
// Toutes les anciennes redirections (login, signup, onboarding, etc.)
// continuent de fonctionner : elles atterrissent automatiquement sur /chat.

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/dashboard")({
  beforeLoad: () => {
    throw redirect({ to: "/chat" });
  },
});
