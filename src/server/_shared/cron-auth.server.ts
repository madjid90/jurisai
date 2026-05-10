// Vérifie qu'une requête cron porte le secret partagé `CRON_SECRET`.
// Compare en temps constant via timingSafeEqual.
// Header attendu : `x-cron-secret: <CRON_SECRET>` (ou `Authorization: Bearer <CRON_SECRET>`).
//
// Fallback dégradé : si `CRON_SECRET` n'est pas configuré, on accepte encore
// l'anon key historique pour ne pas casser les crons existants — un warning
// est loggé. À retirer une fois tous les jobs pg_cron migrés sur le secret.

import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function verifyCronAuth(request: Request): { ok: true } | { ok: false; response: Response } {
  const secret = process.env.CRON_SECRET;
  const provided =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  if (secret) {
    if (provided && safeEqual(provided, secret)) return { ok: true };
  } else {
    // Fallback temporaire : anon key (à supprimer)
    const anon =
      process.env.SUPABASE_PUBLISHABLE_KEY ??
      process.env.SUPABASE_ANON_KEY ??
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const apikey = request.headers.get("apikey") ?? "";
    if (anon && apikey && safeEqual(apikey, anon)) {
      console.warn("[cron-auth] fallback anon key — configure CRON_SECRET");
      return { ok: true };
    }
  }

  return {
    ok: false,
    response: new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }),
  };
}
