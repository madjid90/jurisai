import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type ProfileRow = { tenant_id: string | null };

async function getTenantAndDossier(userId: string, dossierId: string) {
  const { data: profile } = await supabaseAdmin
    .from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
  const tenantId = (profile as ProfileRow | null)?.tenant_id;
  if (!tenantId) throw new Error("No tenant");
  const { data: dossier } = await supabaseAdmin
    .from("dossiers").select("id, tenant_id, title").eq("id", dossierId).maybeSingle();
  const d = dossier as { id: string; tenant_id: string; title: string } | null;
  if (!d || d.tenant_id !== tenantId) throw new Error("Dossier introuvable");
  return { tenantId, dossier: d };
}

// ─── COMMENTS ───────────────────────────────────────────────────────────────

export const listComments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ dossierId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const { tenantId } = await getTenantAndDossier(userId, data.dossierId);
    const { data: rows, error } = await supabaseAdmin
      .from("dossier_comments")
      .select("id, body, user_id, created_at, updated_at")
      .eq("dossier_id", data.dossierId)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as Array<{ id: string; body: string; user_id: string; created_at: string; updated_at: string }>;
    const ids = Array.from(new Set(list.map((r) => r.user_id)));
    const { data: profs } = ids.length
      ? await supabaseAdmin.from("profiles").select("id, full_name, email, avatar_url").in("id", ids)
      : { data: [] as Array<{ id: string; full_name: string | null; email: string; avatar_url: string | null }> };
    const map = new Map((profs ?? []).map((p: any) => [p.id, p]));
    return list.map((c) => ({ ...c, author: map.get(c.user_id) ?? null }));
  });

export const addComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ dossierId: z.string().uuid(), body: z.string().trim().min(1).max(5000) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const { tenantId, dossier } = await getTenantAndDossier(userId, data.dossierId);
    const { data: inserted, error } = await (supabaseAdmin as any)
      .from("dossier_comments")
      .insert({ dossier_id: data.dossierId, tenant_id: tenantId, user_id: userId, body: data.body })
      .select("id").single();
    if (error) throw new Error(error.message);

    // Notify other tenant members (best-effort)
    const { data: members } = await supabaseAdmin
      .from("user_roles").select("user_id").eq("tenant_id", tenantId);
    const recipients = ((members ?? []) as Array<{ user_id: string }>)
      .map((m) => m.user_id).filter((id) => id !== userId);
    await Promise.all(
      recipients.map((rid) =>
        (supabaseAdmin as any).rpc("create_notification", {
          _user_id: rid, _tenant_id: tenantId, _kind: "comment",
          _title: `Nouveau commentaire sur « ${dossier.title} »`,
          _body: data.body.slice(0, 160),
          _link: `/dossiers/${dossier.id}`,
          _metadata: { dossier_id: dossier.id, comment_id: inserted.id },
        }),
      ),
    );

    // Slack + webhook (best-effort, non-blocking)
    const { notifyTenantSlack, dispatchWebhook } = await import("@/server/slack.server");
    void notifyTenantSlack(supabaseAdmin, tenantId,
      `💬 Nouveau commentaire sur *${dossier.title}* : ${data.body.slice(0, 200)}`);
    void dispatchWebhook(supabaseAdmin, tenantId, "comment.added",
      { dossier_id: dossier.id, comment_id: inserted.id, body: data.body });
    return { id: inserted.id };
  });

export const deleteComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ commentId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const { data: profile } = await supabaseAdmin
      .from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
    const tenantId = (profile as ProfileRow | null)?.tenant_id;
    if (!tenantId) throw new Error("No tenant");
    const { data: existing } = await supabaseAdmin
      .from("dossier_comments")
      .select("user_id, tenant_id")
      .eq("id", data.commentId)
      .maybeSingle();
    const c = existing as { user_id: string; tenant_id: string } | null;
    if (!c) throw new Error("Commentaire introuvable");
    if (c.tenant_id !== tenantId) throw new Error("Accès refusé");
    // Auteur OU admin du tenant peuvent supprimer
    if (c.user_id !== userId) {
      const { data: roleRow } = await supabaseAdmin
        .from("user_roles").select("role")
        .eq("user_id", userId).eq("tenant_id", tenantId)
        .in("role", ["admin", "super_admin", "manager"]).maybeSingle();
      if (!roleRow) throw new Error("Seul l'auteur ou un admin peut supprimer ce commentaire");
    }
    const { error } = await supabaseAdmin.from("dossier_comments").delete().eq("id", data.commentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── TASKS ──────────────────────────────────────────────────────────────────

const taskStatus = z.enum(["todo", "in_progress", "done", "blocked"]);
const taskPriority = z.enum(["low", "normal", "high", "urgent"]);

export const listTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ dossierId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const { tenantId } = await getTenantAndDossier(userId, data.dossierId);
    const { data: rows, error } = await supabaseAdmin
      .from("dossier_tasks")
      .select("id, title, description, status, priority, due_date, assigned_to, created_by, created_at, completed_at")
      .eq("dossier_id", data.dossierId).eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as any[];
    const ids = Array.from(new Set(list.flatMap((r) => [r.assigned_to, r.created_by]).filter(Boolean)));
    const { data: profs } = ids.length
      ? await supabaseAdmin.from("profiles").select("id, full_name, email, avatar_url").in("id", ids)
      : { data: [] as any[] };
    const map = new Map((profs ?? []).map((p: any) => [p.id, p]));
    return list.map((t) => ({
      ...t,
      assignee: t.assigned_to ? map.get(t.assigned_to) ?? null : null,
      creator: map.get(t.created_by) ?? null,
    }));
  });

export const createTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      dossierId: z.string().uuid(),
      title: z.string().trim().min(1).max(200),
      description: z.string().max(5000).optional(),
      assignedTo: z.string().uuid().nullable().optional(),
      priority: taskPriority.default("normal"),
      dueDate: z.string().datetime().nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const { tenantId, dossier } = await getTenantAndDossier(userId, data.dossierId);
    const { data: inserted, error } = await (supabaseAdmin as any)
      .from("dossier_tasks")
      .insert({
        dossier_id: data.dossierId, tenant_id: tenantId, created_by: userId,
        assigned_to: data.assignedTo ?? null, title: data.title,
        description: data.description ?? null, priority: data.priority,
        due_date: data.dueDate ?? null,
      })
      .select("id").single();
    if (error) throw new Error(error.message);

    if (data.assignedTo && data.assignedTo !== userId) {
      await (supabaseAdmin as any).rpc("create_notification", {
        _user_id: data.assignedTo, _tenant_id: tenantId, _kind: "task_assigned",
        _title: `Tâche assignée : ${data.title}`,
        _body: `Dossier : ${dossier.title}`,
        _link: `/dossiers/${dossier.id}`,
        _metadata: { dossier_id: dossier.id, task_id: inserted.id },
      });
    }

    // Slack + webhook (best-effort)
    const { notifyTenantSlack, dispatchWebhook } = await import("@/server/slack.server");
    void notifyTenantSlack(supabaseAdmin, tenantId,
      `📝 Nouvelle tâche *${data.title}* sur *${dossier.title}* (priorité ${data.priority})`);
    void dispatchWebhook(supabaseAdmin, tenantId, "task.created",
      { dossier_id: dossier.id, task_id: inserted.id, title: data.title, priority: data.priority });

    return { id: inserted.id };
  });

export const updateTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      taskId: z.string().uuid(),
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(5000).nullable().optional(),
      status: taskStatus.optional(),
      priority: taskPriority.optional(),
      assignedTo: z.string().uuid().nullable().optional(),
      dueDate: z.string().datetime().nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data }) => {
    const patch: Record<string, unknown> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.description !== undefined) patch.description = data.description;
    if (data.status !== undefined) {
      patch.status = data.status;
      patch.completed_at = data.status === "done" ? new Date().toISOString() : null;
    }
    if (data.priority !== undefined) patch.priority = data.priority;
    if (data.assignedTo !== undefined) patch.assigned_to = data.assignedTo;
    if (data.dueDate !== undefined) patch.due_date = data.dueDate;

    const { error } = await (supabaseAdmin as any)
      .from("dossier_tasks").update(patch).eq("id", data.taskId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ taskId: z.string().uuid() }).parse(i))
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin.from("dossier_tasks").delete().eq("id", data.taskId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listTenantMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    const { data: profile } = await supabaseAdmin
      .from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
    const tenantId = (profile as ProfileRow | null)?.tenant_id;
    if (!tenantId) return [];
    const { data: roles } = await supabaseAdmin
      .from("user_roles").select("user_id, role").eq("tenant_id", tenantId);
    const ids = Array.from(new Set(((roles ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)));
    if (!ids.length) return [];
    const { data: profs } = await supabaseAdmin
      .from("profiles").select("id, full_name, email, avatar_url").in("id", ids);
    return (profs ?? []) as Array<{ id: string; full_name: string | null; email: string; avatar_url: string | null }>;
  });

// ─── NOTIFICATIONS : déplacées vers src/server/notifications.functions.ts ──

// ─── GLOBAL SEARCH ─────────────────────────────────────────────────────────

export const globalSearch = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ q: z.string().trim().min(1).max(120) }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const { data: profile } = await supabaseAdmin
      .from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
    const tenantId = (profile as ProfileRow | null)?.tenant_id;
    if (!tenantId) return { dossiers: [], clients: [], documents: [] };
    const like = `%${data.q.replace(/[%_]/g, "\\$&")}%`;
    const [dossiers, clients, documents] = await Promise.all([
      supabaseAdmin.from("dossiers").select("id, title, status, category")
        .eq("tenant_id", tenantId).ilike("title", like).limit(8),
      supabaseAdmin.from("clients").select("id, full_name, email, job_title")
        .eq("tenant_id", tenantId).ilike("full_name", like).limit(8),
      supabaseAdmin.from("documents").select("id, title, status")
        .eq("tenant_id", tenantId).ilike("title", like).limit(8),
    ]);
    return {
      dossiers: (dossiers.data ?? []) as any[],
      clients: (clients.data ?? []) as any[],
      documents: (documents.data ?? []) as any[],
    };
  });
