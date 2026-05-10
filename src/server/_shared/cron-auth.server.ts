// Vérifie qu'une requête cron porte le secret partagé `CRON_SECRET`.
// Compare en temps constant via timingSafeEqual.
// Header attendu : `x-cron-secret: <CRON_SECRET>` (ou `Authorization: Bearer <CRON_SECRET>`).
//
// Top 41-50 / sécurité P0 : suppression du fallback anon key.
// CRON_SECRET est désormais OBLIGATOIRE — toute requête cron sans secret est rejetée.

import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function verifyCronAuth(request: Request): { ok: true } | { ok: false; response: Response } {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron-auth] CRON_SECRET manquant — toutes les requêtes cron sont rejetées");
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "cron_secret_not_configured" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  const provided =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  if (provided && safeEqual(provided, secret)) return { ok: true };

  return {
    ok: false,
    response: new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }),
  };
}
