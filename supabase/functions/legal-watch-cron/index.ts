// Edge Function: legal-watch-cron
// Scheduled job — scans recently created legal_sources and creates alerts.
// Idempotent: skips sources that already have an alert in the last 24h.
// Triggered by pg_cron (see migrations) — accepts only super-admin or service-role calls.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { logEvent } from "../_shared/rag.ts";

import { corsHeadersFor } from "../_shared/cors.ts";
Deno.serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Auth: only allow service-role (cron) OR super-admin
  const auth = req.headers.get("Authorization") ?? "";
  const isServiceRole = auth === `Bearer ${SERVICE_ROLE}`;
  if (!isServiceRole) {
    const token = auth.replace(/^Bearer\s+/i, "");
    const { data: u } = await admin.auth.getUser(token);
    if (!u?.user) return jsonErr("Unauthorized", 401, corsHeaders);
    const { data: isAdmin } = await admin.rpc("is_super_admin", { _user_id: u.user.id });
    if (!isAdmin) return jsonErr("Forbidden", 403, corsHeaders);
  }

  const t0 = Date.now();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  // Pull recent active sources
  const { data: sources, error: srcErr } = await admin
    .from("legal_sources")
    .select(
      "id, title, source_type, idcc, official_url, legal_date, reference_code, created_at, updated_at",
    )
    .eq("is_active", true)
    .or(`created_at.gte.${since},updated_at.gte.${since}`)
    .limit(500);

  if (srcErr) {
    console.error("legal-watch fetch error", srcErr);
    return jsonErr(srcErr.message, 500, corsHeaders);
  }

  let created = 0;
  let skipped = 0;

  for (const src of sources ?? []) {
    // Skip if alert already exists in the last 24h for this source
    const { data: existing } = await admin
      .from("legal_alerts")
      .select("id")
      .eq("source_id", src.id)
      .gte("created_at", since)
      .maybeSingle();

    if (existing) {
      skipped++;
      continue;
    }

    const isUpdate =
      src.updated_at &&
      src.created_at &&
      new Date(src.updated_at).getTime() - new Date(src.created_at).getTime() > 60_000;

    const severity =
      src.source_type === "loi" || src.source_type === "decret" ? "warning" : "info";

    const summary = isUpdate
      ? `Mise à jour de la source ${src.reference_code ?? src.source_type}.`
      : `Nouvelle source officielle ajoutée à la base de connaissances.`;

    const { error: insErr } = await admin.from("legal_alerts").insert({
      source_id: src.id,
      title: src.title.slice(0, 200),
      summary,
      severity,
      change_type: isUpdate ? "updated" : "new",
      idcc: src.idcc,
      source_type: src.source_type,
      official_url: src.official_url,
      legal_date: src.legal_date,
      metadata: { reference_code: src.reference_code },
    });

    if (insErr) {
      console.error("alert insert error", insErr);
    } else {
      created++;
    }
  }

  logEvent("legal_watch.run", {
    duration_ms: Date.now() - t0,
    sources_scanned: sources?.length ?? 0,
    alerts_created: created,
    alerts_skipped: skipped,
  });

  return new Response(
    JSON.stringify({ ok: true, created, skipped, scanned: sources?.length ?? 0 }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

function jsonErr(msg: string, status: number, hdrs: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...hdrs, "Content-Type": "application/json" },
  });
}
