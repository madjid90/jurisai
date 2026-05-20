// Endpoint de diagnostic SERVICE_ROLE_KEY accessible sans auth utilisateur,
// gardé par CRON_SECRET. Permet de vérifier la clé en production sans devoir
// se connecter en tant qu'admin.
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronAuth } from "@/server/_shared/cron-auth.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type JwtInspect = {
  present: boolean;
  length: number;
  prefix: string;
  suffix: string;
  header?: { alg?: string; typ?: string };
  payload?: {
    role?: string;
    ref?: string;
    iss?: string;
    iat?: number;
    exp?: number;
    iat_iso?: string;
    exp_iso?: string;
  };
  decode_error?: string;
};

function inspectJwt(raw: string | undefined): JwtInspect {
  if (!raw) return { present: false, length: 0, prefix: "", suffix: "" };
  const base: JwtInspect = {
    present: true,
    length: raw.length,
    prefix: raw.slice(0, 6),
    suffix: raw.slice(-4),
  };
  try {
    const parts = raw.split(".");
    if (parts.length !== 3) return { ...base, decode_error: `not a JWT (parts=${parts.length})` };
    const dec = (s: string) => {
      const pad = s.length % 4 === 0 ? s : s + "=".repeat(4 - (s.length % 4));
      const norm = pad.replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(
        new TextDecoder().decode(Uint8Array.from(atob(norm), (c) => c.charCodeAt(0))),
      );
    };
    const header = dec(parts[0]);
    const payload = dec(parts[1]);
    return {
      ...base,
      header: { alg: header.alg, typ: header.typ },
      payload: {
        role: payload.role,
        ref: payload.ref,
        iss: payload.iss,
        iat: payload.iat,
        exp: payload.exp,
        iat_iso: payload.iat ? new Date(payload.iat * 1000).toISOString() : undefined,
        exp_iso: payload.exp ? new Date(payload.exp * 1000).toISOString() : undefined,
      },
    };
  } catch (e) {
    return { ...base, decode_error: (e as Error).message };
  }
}

export const Route = createFileRoute("/api/public/hooks/diagnose")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = verifyCronAuth(request);
        if (!auth.ok) return auth.response;

        const standard = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const jurisai = process.env.JURISAI_SUPABASE_SERVICE_ROLE_KEY;

        const standardInspect = inspectJwt(standard);
        const jurisaiInspect = inspectJwt(jurisai);

        const usedSource =
          jurisai && jurisai.length > 100
            ? "JURISAI_SUPABASE_SERVICE_ROLE_KEY"
            : standard && standard.length > 100
              ? "SUPABASE_SERVICE_ROLE_KEY"
              : jurisai
                ? "JURISAI_SUPABASE_SERVICE_ROLE_KEY (invalid)"
                : standard
                  ? "SUPABASE_SERVICE_ROLE_KEY (invalid)"
                  : "NONE";

        const expectedRef = "yuvysjsyumxpekzvlzsx";

        let ping: { ok: boolean; error?: string; count?: number | null } = { ok: false };
        try {
          const { count, error } = await supabaseAdmin
            .from("profiles")
            .select("id", { count: "exact", head: true });
          ping = error ? { ok: false, error: error.message } : { ok: true, count: count ?? null };
        } catch (e) {
          ping = { ok: false, error: (e as Error).message };
        }

        const used = usedSource.startsWith("JURISAI") ? jurisaiInspect : standardInspect;
        const verdict =
          ping.ok &&
          used.payload?.role === "service_role" &&
          used.payload?.ref === expectedRef
            ? "OK"
            : "PROBLEM";

        return Response.json({
          verdict,
          used_source: usedSource,
          expected_ref: expectedRef,
          supabase_url: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
          keys: {
            SUPABASE_SERVICE_ROLE_KEY: standardInspect,
            JURISAI_SUPABASE_SERVICE_ROLE_KEY: jurisaiInspect,
          },
          connectivity_ping: ping,
        });
      },
    },
  },
});
