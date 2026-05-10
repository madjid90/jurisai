// RGPD — export (art. 20) et suppression (art. 17).
//
// Top 51-60 / suppression complète : on couvre désormais TOUTES les tables
// porteuses d'un `user_id` dans `public`. Deux stratégies :
//  - hard delete pour les données strictement personnelles
//  - anonymisation (user_id := NULL) pour les traces légales/audit qui doivent
//    être conservées (audit_logs, workflow_audit_log, usage_logs…)
//
// Les contenus rattachés à un tenant (dossiers, documents générés, workflows
// instanciés) restent au tenant — c'est le tenant qui en est responsable.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { enforceRateLimit } from "@/server/_shared/rate-limit.server";

const db = supabaseAdmin as unknown as { from: (table: string) => any };
const auth = supabaseAdmin.auth as unknown as {
  admin: { deleteUser: (id: string) => Promise<{ error: { message: string } | null }> };
};

// ─── Export (art. 20) ───────────────────────────────────────────────────────

export const exportMyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as { userId: string; userEmail: string | null };
    const { userId, userEmail } = ctx;
    let requestId: string | null = null;
    try {
      const { data: req } = await db
        .from("rgpd_requests")
        .insert({ user_id: userId, kind: "export" })
        .select("id")
        .single();
      requestId = (req as { id?: string } | null)?.id ?? null;
    } catch { /* noop */ }

    const safe = async (table: string, query: (q: any) => any) => {
      try {
        const { data } = await query(db.from(table).select("*"));
        return data ?? [];
      } catch {
        return [];
      }
    };

    const [
      profile,
      roles,
      conversations,
      documents,
      notifications,
      notification_preferences,
      reminders,
      agent_runs,
      document_analyses,
      message_feedback,
      dossier_comments,
      usage_logs,
    ] = await Promise.all([
      safe("profiles", (q) => q.eq("id", userId).maybeSingle()),
      safe("user_roles", (q) => q.eq("user_id", userId)),
      safe("conversations", (q) => q.eq("user_id", userId)),
      safe("documents", (q) => q.eq("user_id", userId)),
      safe("notifications", (q) => q.eq("user_id", userId)),
      safe("notification_preferences", (q) => q.eq("user_id", userId)),
      safe("reminders", (q) => q.eq("user_id", userId)),
      safe("agent_runs", (q) => q.eq("user_id", userId)),
      safe("document_analyses", (q) => q.eq("user_id", userId)),
      safe("message_feedback", (q) => q.eq("user_id", userId)),
      safe("dossier_comments", (q) => q.eq("user_id", userId)),
      safe("usage_logs", (q) => q.eq("user_id", userId)),
    ]);

    const conversationIds = (Array.isArray(conversations) ? conversations : []).map(
      (c: { id: string }) => c.id,
    );
    let messages: any[] = [];
    if (conversationIds.length > 0) {
      const { data: msgs } = await db
        .from("messages")
        .select("*")
        .in("conversation_id", conversationIds);
      messages = msgs ?? [];
    }

    return {
      exportedAt: new Date().toISOString(),
      account: { id: userId, email: userEmail },
      profile,
      roles,
      conversations,
      messages,
      documents,
      notifications,
      notification_preferences,
      reminders,
      agent_runs,
      document_analyses,
      message_feedback,
      dossier_comments,
      usage_logs,
    };
  });

// ─── Delete (art. 17) ───────────────────────────────────────────────────────

const deleteSchema = z.object({ confirmation: z.literal("SUPPRIMER") });

// Tables strictement personnelles : on supprime
const HARD_DELETE_TABLES = [
  "notifications",
  "notification_preferences",
  "reminders",
  "rate_limits",
  "alert_dismissals",
  "message_feedback",
  "documents",
  "document_generation_sessions",
  "document_analyses",
  "dossier_comments",
  "agent_runs",
  "agent_memory",
  "user_roles",
] as const;

// Tables à conserver pour traçabilité — on anonymise (user_id := NULL)
const ANONYMIZE_TABLES = [
  "audit_logs",
  "workflow_audit_log",
  "workflow_generation_runs",
  "server_function_errors",
  "usage_logs",
  "digest_runs",
  "employees",
] as const;

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => deleteSchema.parse(input))
  .handler(async ({ context }) => {
    const ctx = context as { userId: string };
    const { userId } = ctx;
    const errors: string[] = [];

    // S16 (audit) : action irréversible — 2 tentatives/min suffisent largement
    // et bloquent toute attaque brute.
    await enforceRateLimit(userId, "delete_my_account", 2);

    // 1. Conversations + messages (cascade manuel)
    try {
      const { data: convs } = await db
        .from("conversations")
        .select("id")
        .eq("user_id", userId);
      const convIds = ((convs as Array<{ id: string }>) ?? []).map((c) => c.id);
      if (convIds.length > 0) {
        await db.from("messages").delete().in("conversation_id", convIds);
        await db.from("conversations").delete().in("id", convIds);
      }
    } catch (e) {
      errors.push(`conversations: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 2. Hard delete tables personnelles (en parallèle)
    await Promise.all(
      HARD_DELETE_TABLES.map(async (table) => {
        try {
          await db.from(table).delete().eq("user_id", userId);
        } catch (e) {
          errors.push(`${table}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }),
    );

    // 3. Anonymisation des traces légales (user_id := NULL)
    await Promise.all(
      ANONYMIZE_TABLES.map(async (table) => {
        try {
          await db.from(table).update({ user_id: null }).eq("user_id", userId);
        } catch (e) {
          // Certaines tables peuvent avoir user_id NOT NULL — on ignore l'échec
          // mais on log pour audit.
          console.warn(`[rgpd] anonymisation ${table} échouée:`, e);
        }
      }),
    );

    // 4. Profil
    try {
      await db.from("profiles").delete().eq("id", userId);
    } catch (e) {
      errors.push(`profiles: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 5. Compte auth (irréversible — fait en dernier)
    const { error } = await auth.admin.deleteUser(userId);
    if (error) {
      throw new Error(
        `Suppression du compte impossible : ${error.message}` +
          (errors.length ? ` (échecs partiels : ${errors.join("; ")})` : ""),
      );
    }

    return { ok: true, partialErrors: errors };
  });
