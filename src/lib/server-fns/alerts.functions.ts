import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ─── List alerts visible to current user (with dismissal flag) ──────────────

export const listAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    const tenantId = (profile as { tenant_id: string | null } | null)?.tenant_id;

    // Tenant subscription preferences (severity_min + idcc_filters)
    let minSeverity: "info" | "warning" | "critical" = "info";
    let idccFilters: string[] = [];
    if (tenantId) {
      const { data: sub } = await supabaseAdmin
        .from("tenant_alert_subscriptions")
        .select("severity_min, idcc_filters")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      const s = sub as { severity_min: string; idcc_filters: string[] } | null;
      if (s) {
        minSeverity = s.severity_min as typeof minSeverity;
        idccFilters = s.idcc_filters ?? [];
      }
    }

    const sevRank = { info: 0, warning: 1, critical: 2 } as const;

    let q = supabaseAdmin
      .from("legal_alerts")
      .select("id, title, summary, severity, change_type, idcc, source_type, official_url, legal_date, created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    const { data: alerts } = await q;
    const all = (alerts ?? []) as Array<{
      id: string;
      title: string;
      summary: string | null;
      severity: "info" | "warning" | "critical";
      change_type: string;
      idcc: string | null;
      source_type: string | null;
      official_url: string | null;
      legal_date: string | null;
      created_at: string;
    }>;

    // Filter by severity_min + idcc filters (idcc null = always shown)
    const filtered = all.filter((a) => {
      if (sevRank[a.severity] < sevRank[minSeverity]) return false;
      if (idccFilters.length > 0 && a.idcc && !idccFilters.includes(a.idcc)) return false;
      return true;
    });

    // Dismissal flags
    const ids = filtered.map((a) => a.id);
    let dismissed = new Set<string>();
    if (ids.length > 0) {
      const { data: dis } = await supabaseAdmin
        .from("alert_dismissals")
        .select("alert_id")
        .eq("user_id", userId)
        .in("alert_id", ids);
      dismissed = new Set(((dis ?? []) as Array<{ alert_id: string }>).map((d) => d.alert_id));
    }

    return filtered.map((a) => ({ ...a, dismissed: dismissed.has(a.id) }));
  });

// ─── Dismiss an alert (mark as read) ────────────────────────────────────────

export const dismissAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ alertId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const { error } = await supabaseAdmin
      .from("alert_dismissals")
      .upsert({ user_id: userId, alert_id: data.alertId }, { onConflict: "user_id,alert_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Get/update tenant subscription preferences ─────────────────────────────

export const getAlertSubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    const tenantId = (profile as { tenant_id: string | null } | null)?.tenant_id;
    if (!tenantId) return null;
    const { data } = await supabaseAdmin
      .from("tenant_alert_subscriptions")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    return data ?? { tenant_id: tenantId, email_enabled: true, frequency: "daily", idcc_filters: [], severity_min: "info" };
  });

export const updateAlertSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        email_enabled: z.boolean(),
        frequency: z.enum(["realtime", "daily", "weekly"]),
        idcc_filters: z.array(z.string()).max(20),
        severity_min: z.enum(["info", "warning", "critical"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    const tenantId = (profile as { tenant_id: string | null } | null)?.tenant_id;
    if (!tenantId) throw new Error("No tenant");

    // Verify admin
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("tenant_id", tenantId)
      .eq("role", "admin");
    if (!roles || roles.length === 0) throw new Error("Forbidden — admin only");

    const { error } = await supabaseAdmin
      .from("tenant_alert_subscriptions")
      .upsert({ tenant_id: tenantId, ...data }, { onConflict: "tenant_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
