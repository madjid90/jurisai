// Agrégateur pour le Dashboard hybride contextuel.
// Tout est tenant-scopé via getTenantId. Données read-only.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTenantId } from "@/server/_shared/tenant.server";

export type ContractDeadlineItem = {
  id: string;
  label: string;
  due_date: string;
  category: string | null;
  dossier_id: string | null;
  dossier_title: string | null;
  dossier_category: string | null;
};

export type DashboardSummary = {
  tenant: {
    id: string;
    name: string | null;
    plan: string | null;
    quota_questions: number;
    questions_used: number;
  } | null;
  to_treat_today: Array<{
    id: string;
    kind: "reminder" | "validation";
    title: string;
    due_at: string | null;
    dossier_id: string | null;
    severity?: string | null;
  }>;
  recent_dossiers: Array<{
    id: string;
    title: string;
    category: string | null;
    status: string | null;
    risk_level: string | null;
    updated_at: string;
  }>;
  pending_validations: Array<{
    id: string;
    subject_type: string;
    status: string;
    dossier_id: string | null;
    created_at: string;
    comment: string | null;
  }>;
  legal_alerts: Array<{
    id: string;
    title: string;
    severity: string | null;
    legal_date: string | null;
    source_type: string | null;
    official_url: string | null;
  }>;
  recent_agent_runs: Array<{
    id: string;
    message: string;
    intent: string | null;
    domain: string | null;
    created_at: string;
    refused: boolean;
    dossier_id: string | null;
  }>;
  contract_deadlines: {
    juridique: ContractDeadlineItem[];
    fournisseur: ContractDeadlineItem[];
  };
  counters: {
    open_dossiers: number;
    pending_validations: number;
    active_reminders: number;
    unread_alerts: number;
    pending_links: number;
  };
};

export const getDashboardSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardSummary> => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);
    const sb = supabaseAdmin as any;

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const todayEndIso = todayEnd.toISOString();
    const idccDate = new Date();
    idccDate.setDate(idccDate.getDate() - 30);
    const since30 = idccDate.toISOString();

    const [
      tenantRes,
      remindersRes,
      validationsRes,
      dossiersRes,
      alertsRes,
      runsRes,
      openDossiersCount,
      pendingValidationsCount,
      activeRemindersCount,
      alertsCount,
      pendingLinksCount,
      tenantIdcc,
      contractDeadlinesRes,
    ] = await Promise.all([
      sb
        .from("tenants")
        .select("id, name, plan, quota_questions, questions_used")
        .eq("id", tenantId)
        .maybeSingle(),
      sb
        .from("reminders")
        .select("id, title, remind_at, dossier_id")
        .eq("tenant_id", tenantId)
        .is("dismissed_at", null)
        .lte("remind_at", todayEndIso)
        .order("remind_at", { ascending: true })
        .limit(20),
      sb
        .from("validation_requests")
        .select("id, subject_type, status, dossier_id, created_at, comment")
        .eq("tenant_id", tenantId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(10),
      sb
        .from("dossiers")
        .select("id, title, category, status, risk_level, updated_at")
        .eq("tenant_id", tenantId)
        .order("updated_at", { ascending: false })
        .limit(8),
      sb
        .from("legal_alerts")
        .select("id, title, severity, legal_date, source_type, official_url, idcc")
        .order("created_at", { ascending: false })
        .gte("created_at", since30)
        .limit(20),
      sb
        .from("agent_runs")
        .select("id, message, intent, domain, created_at, refused, dossier_id")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(5),
      sb
        .from("dossiers")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .neq("status", "closed"),
      sb
        .from("validation_requests")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("status", "pending"),
      sb
        .from("reminders")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .is("dismissed_at", null),
      sb.from("legal_alerts").select("id", { count: "exact", head: true }).gte("created_at", since30),
      sb
        .from("document_links")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("status", "pending"),
      sb.from("tenants").select("idcc").eq("id", tenantId).maybeSingle(),
      sb
        .from("contract_deadlines")
        .select("id, label, due_date, category, dossier_id, dossiers:dossier_id(title, category)")
        .eq("tenant_id", tenantId)
        .is("done_at", null)
        .gte("due_date", new Date().toISOString().slice(0, 10))
        .order("due_date", { ascending: true })
        .limit(50),
    ]);

    const idcc = (tenantIdcc.data as { idcc: string | null } | null)?.idcc ?? null;
    const filteredAlerts = ((alertsRes.data ?? []) as Array<{
      id: string;
      title: string;
      severity: string | null;
      legal_date: string | null;
      source_type: string | null;
      official_url: string | null;
      idcc: string | null;
    }>)
      .filter((a) => !a.idcc || !idcc || a.idcc === idcc)
      .slice(0, 8);

    const reminders = (remindersRes.data ?? []) as Array<{
      id: string;
      title: string;
      remind_at: string;
      dossier_id: string | null;
    }>;
    const validations = (validationsRes.data ?? []) as Array<{
      id: string;
      subject_type: string;
      status: string;
      dossier_id: string | null;
      created_at: string;
      comment: string | null;
    }>;

    const toTreatToday: DashboardSummary["to_treat_today"] = [
      ...reminders.map((r) => ({
        id: r.id,
        kind: "reminder" as const,
        title: r.title,
        due_at: r.remind_at,
        dossier_id: r.dossier_id,
      })),
      ...validations.slice(0, 5).map((v) => ({
        id: v.id,
        kind: "validation" as const,
        title: v.comment ?? `Validation ${v.subject_type}`,
        due_at: v.created_at,
        dossier_id: v.dossier_id,
      })),
    ].slice(0, 12);

    const JURIDIQUE_CATS = new Set([
      "rh",
      "contentieux",
      "societes",
      "rgpd",
      "fiscal",
      "reglementaire",
      "administratif",
    ]);
    const rawDeadlines = (contractDeadlinesRes.data ?? []) as Array<{
      id: string;
      label: string;
      due_date: string;
      category: string | null;
      dossier_id: string | null;
      dossiers: { title: string | null; category: string | null } | null;
    }>;
    const deadlineItems: ContractDeadlineItem[] = rawDeadlines.map((r) => ({
      id: r.id,
      label: r.label,
      due_date: r.due_date,
      category: r.category,
      dossier_id: r.dossier_id,
      dossier_title: r.dossiers?.title ?? null,
      dossier_category: r.dossiers?.category ?? null,
    }));
    const juridique: ContractDeadlineItem[] = [];
    const fournisseur: ContractDeadlineItem[] = [];
    for (const d of deadlineItems) {
      const isJuridique = d.dossier_category != null && JURIDIQUE_CATS.has(d.dossier_category);
      const isFournisseur = d.category === "paiement" || d.category === "fournisseur";
      if (isFournisseur && !isJuridique) fournisseur.push(d);
      else if (isJuridique) juridique.push(d);
      else fournisseur.push(d);
    }

    return {
      tenant: tenantRes.data ?? null,
      to_treat_today: toTreatToday,
      recent_dossiers: (dossiersRes.data ?? []) as DashboardSummary["recent_dossiers"],
      pending_validations: validations,
      legal_alerts: filteredAlerts.map(({ idcc: _i, ...rest }) => rest),
      recent_agent_runs: (runsRes.data ?? []) as DashboardSummary["recent_agent_runs"],
      contract_deadlines: {
        juridique: juridique.slice(0, 8),
        fournisseur: fournisseur.slice(0, 8),
      },
      counters: {
        open_dossiers: openDossiersCount.count ?? 0,
        pending_validations: pendingValidationsCount.count ?? 0,
        active_reminders: activeRemindersCount.count ?? 0,
        unread_alerts: alertsCount.count ?? 0,
        pending_links: pendingLinksCount.count ?? 0,
      },
    };
  });