import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ─── Quota of current tenant (questions used / quota) ───────────────────────

export const getTenantQuota = createServerFn({ method: "GET" })
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

    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("plan, quota_questions, questions_used, quota_reset_at, name")
      .eq("id", tenantId)
      .maybeSingle();

    if (!tenant) return null;
    const t = tenant as {
      plan: string;
      quota_questions: number;
      questions_used: number;
      quota_reset_at: string;
      name: string;
    };
    return {
      tenantId,
      name: t.name,
      plan: t.plan,
      used: t.questions_used,
      quota: t.quota_questions,
      resetAt: t.quota_reset_at,
      pct: t.quota_questions > 0 ? Math.min(100, Math.round((t.questions_used / t.quota_questions) * 100)) : 0,
    };
  });

// ─── Per-tenant usage dashboard (last 30d) ──────────────────────────────────

export const getTenantUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", userId)
      .maybeSingle();
    const tenantId = (profile as { tenant_id: string | null } | null)?.tenant_id;
    if (!tenantId) return { byDay: [], byUser: [], byAction: [], total: 0 };

    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

    const { data: logs } = await supabaseAdmin
      .from("usage_logs")
      .select("user_id, action, created_at")
      .eq("tenant_id", tenantId)
      .gte("created_at", since)
      .limit(5000);

    const rows = (logs ?? []) as Array<{ user_id: string; action: string; created_at: string }>;

    // By day
    const byDayMap = new Map<string, number>();
    for (const r of rows) {
      const d = r.created_at.slice(0, 10);
      byDayMap.set(d, (byDayMap.get(d) ?? 0) + 1);
    }
    const byDay = [...byDayMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    // By user
    const byUserMap = new Map<string, number>();
    for (const r of rows) byUserMap.set(r.user_id, (byUserMap.get(r.user_id) ?? 0) + 1);

    let userNames: Record<string, string> = {};
    const userIds = [...byUserMap.keys()];
    if (userIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      userNames = Object.fromEntries(
        ((profiles ?? []) as Array<{ id: string; full_name: string | null; email: string }>).map(
          (p) => [p.id, p.full_name ?? p.email],
        ),
      );
    }
    const byUser = [...byUserMap.entries()]
      .map(([id, count]) => ({ userId: id, name: userNames[id] ?? "—", count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // By action
    const byActionMap = new Map<string, number>();
    for (const r of rows) byActionMap.set(r.action, (byActionMap.get(r.action) ?? 0) + 1);
    const byAction = [...byActionMap.entries()].map(([action, count]) => ({ action, count }));

    return { byDay, byUser, byAction, total: rows.length };
  });

// ─── IDCC autocomplete ──────────────────────────────────────────────────────

export const searchIDCC = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ q: z.string().max(120) }).parse(input))
  .handler(async ({ data }) => {
    const q = data.q.trim();
    let query = supabaseAdmin
      .from("conventions_collectives")
      .select("idcc, title, short_title, brochure")
      .eq("is_active", true)
      .order("idcc")
      .limit(20);

    if (q.length > 0) {
      // Match on idcc OR title (ilike)
      query = query.or(`idcc.ilike.%${q}%,title.ilike.%${q}%,short_title.ilike.%${q}%`);
    }
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{
      idcc: string;
      title: string;
      short_title: string | null;
      brochure: string | null;
    }>;
  });

// ─── Super-admin: list all tenants with usage summary ───────────────────────

export const listAllTenants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };

    const { data: isAdmin } = await supabaseAdmin.rpc("is_super_admin", {
      _user_id: userId,
    });
    if (!isAdmin) throw new Error("Forbidden: super-admin only");

    const { data: tenants, error } = await supabaseAdmin
      .from("tenants")
      .select("id, name, slug, plan, quota_questions, questions_used, idcc, sector, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const list = (tenants ?? []) as Array<{
      id: string;
      name: string;
      slug: string;
      plan: string;
      quota_questions: number;
      questions_used: number;
      idcc: string | null;
      sector: string | null;
      created_at: string;
    }>;

    // Member counts
    const ids = list.map((t) => t.id);
    let memberCounts: Record<string, number> = {};
    if (ids.length > 0) {
      const { data: roles } = await supabaseAdmin
        .from("user_roles")
        .select("tenant_id")
        .in("tenant_id", ids);
      for (const r of (roles ?? []) as Array<{ tenant_id: string }>) {
        memberCounts[r.tenant_id] = (memberCounts[r.tenant_id] ?? 0) + 1;
      }
    }

    return list.map((t) => ({
      ...t,
      members: memberCounts[t.id] ?? 0,
      pct: t.quota_questions > 0 ? Math.round((t.questions_used / t.quota_questions) * 100) : 0,
    }));
  });
