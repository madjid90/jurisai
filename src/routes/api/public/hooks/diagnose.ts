// Endpoint de diagnostic : dit la vérité sur la configuration Supabase côté serveur.
// Utile pour comprendre si supabaseAdmin a un VRAI service_role JWT ou une anon key.
//
// Auth : x-cron-secret (pas de session user requise, pour pouvoir l'appeler depuis curl).
// Sécurité : ne révèle JAMAIS la clé complète, juste le rôle décodé + premiers/derniers chars.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyCronAuth } from "@/server/_shared/cron-auth.server";

function decodeJwtRole(token: string | undefined): { role?: string; iss?: string; preview?: string } | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return { preview: token.slice(0, 12) + "..." + token.slice(-6) };
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
    return {
      role: payload.role,
      iss: payload.iss,
      preview: token.slice(0, 12) + "..." + token.slice(-6),
    };
  } catch {
    return { preview: token.slice(0, 12) + "..." + token.slice(-6) };
  }
}

export const Route = createFileRoute("/api/public/hooks/diagnose")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = verifyCronAuth(request);
        if (!auth.ok) return auth.response;

        // 1. Décode les JWTs des env vars (sans les exposer)
        const envInfo = {
          SUPABASE_URL: process.env.SUPABASE_URL ?? null,
          VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? null,
          SUPABASE_SERVICE_ROLE_KEY: decodeJwtRole(process.env.SUPABASE_SERVICE_ROLE_KEY),
          JURISAI_SUPABASE_SERVICE_ROLE_KEY: decodeJwtRole(process.env.JURISAI_SUPABASE_SERVICE_ROLE_KEY),
          SUPABASE_PUBLISHABLE_KEY: decodeJwtRole(process.env.SUPABASE_PUBLISHABLE_KEY),
          OPENAI_API_KEY_present: !!process.env.OPENAI_API_KEY,
          LOVABLE_API_KEY_present: !!process.env.LOVABLE_API_KEY,
          NODE_ENV: process.env.NODE_ENV ?? "unknown",
        };

        // 2. Test : supabaseAdmin peut-il bypass RLS ?
        // On essaie de SELECT sur profiles SANS filtre user → si bypass marche, on a TOUTES les rows
        let canBypassRls = false;
        let profilesCount: number | string = "?";
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sb = supabaseAdmin as any;
          const { count, error } = await sb.from("profiles").select("*", { count: "exact", head: true });
          if (!error) {
            profilesCount = count ?? 0;
            canBypassRls = (count ?? 0) > 0; // si on voit des rows sans session user, on bypass
          }
        } catch (e) {
          profilesCount = e instanceof Error ? e.message : "error";
        }

        // 3. Test : appel RPC SECURITY DEFINER
        let canCallRpc = false;
        let rpcError: string | null = null;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sb = supabaseAdmin as any;
          const { data, error } = await sb.rpc("get_user_tenant_id", {
            _user_id: "00000000-0000-0000-0000-000000000000",
          });
          if (!error) {
            canCallRpc = true;
            void data;
          } else {
            rpcError = error.message;
          }
        } catch (e) {
          rpcError = e instanceof Error ? e.message : "error";
        }

        // 4. Verdict
        const serviceRoleKey =
          envInfo.JURISAI_SUPABASE_SERVICE_ROLE_KEY ?? envInfo.SUPABASE_SERVICE_ROLE_KEY;
        const isRealServiceRole = serviceRoleKey?.role === "service_role";

        const verdict = isRealServiceRole && canBypassRls
          ? "✅ TOUT VA BIEN — service_role correct, supabaseAdmin bypass RLS"
          : !isRealServiceRole && serviceRoleKey?.role === "anon"
            ? "🚨 BUG INFRA — SUPABASE_SERVICE_ROLE_KEY est en réalité une ANON KEY. supabaseAdmin ne peut PAS bypass RLS. Les RPCs SECURITY DEFINER sont nécessaires."
            : !isRealServiceRole
              ? "⚠️ INCONNU — la key n'est ni service_role ni anon, format inattendu"
              : "⚠️ BIZARRE — service_role détecté mais bypass RLS ne marche pas (RLS policy bug ?)";

        return new Response(JSON.stringify({
          verdict,
          isRealServiceRole,
          canBypassRls,
          profilesCount,
          canCallRpc,
          rpcError,
          envInfo,
          recommendation: isRealServiceRole
            ? "Les RPCs SECURITY DEFINER (insert_agent_run, lock_agent_run, start_procedure_full, etc.) sont REDONDANTES. Le code peut utiliser supabaseAdmin.from().insert() directement. À nettoyer en V2."
            : "Continuer à utiliser les RPCs SECURITY DEFINER pour toutes les opérations RLS-bloquées. C'est le bon pattern dans ton cas.",
        }, null, 2), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
