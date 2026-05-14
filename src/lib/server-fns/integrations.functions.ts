import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash, randomBytes } from "crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getTenantId, requireAdmin } from "@/server/_shared/tenant.server";
import { enforceRateLimit } from "@/server/_shared/rate-limit.server";

// ─── INTEGRATIONS SETTINGS ──────────────────────────────────────────────────

export const getIntegrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await getTenantId(userId);

    let { data } = await supabaseAdmin
      .from("tenant_integrations").select("*").eq("tenant_id", tenantId).maybeSingle();

    if (!data) {
      // Lazy-create the row via service role
      const { data: created } = await supabaseAdmin
        .from("tenant_integrations").insert({ tenant_id: tenantId }).select("*").single();
      data = created;
    }
    return data as {
      tenant_id: string; slack_channel: string | null; slack_enabled: boolean;
      calendar_token: string; updated_at: string;
    };
  });

export const updateIntegrations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      slack_channel: z.string().trim().max(100).nullable().optional(),
      slack_enabled: z.boolean().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await requireAdmin(userId);
    const { error } = await supabaseAdmin
      .from("tenant_integrations")
      .upsert({ tenant_id: tenantId, ...data }, { onConflict: "tenant_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const rotateCalendarToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await requireAdmin(userId);
    const { data, error } = await supabaseAdmin
      .from("tenant_integrations")
      .update({ calendar_token: crypto.randomUUID() })
      .eq("tenant_id", tenantId)
      .select("calendar_token").single();
    if (error) throw new Error(error.message);
    return { calendar_token: data.calendar_token as string };
  });

// ─── API KEYS ───────────────────────────────────────────────────────────────

export const listApiKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await requireAdmin(userId);
    const { data, error } = await supabaseAdmin
      .from("tenant_api_keys")
      .select("id, label, prefix, scopes, last_used_at, revoked_at, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{
      id: string; label: string; prefix: string; scopes: string[];
      last_used_at: string | null; revoked_at: string | null; created_at: string;
    }>;
  });

export const createApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      label: z.string().trim().min(1).max(100),
      scopes: z.array(z.enum(["read", "write"])).min(1).default(["read"]),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    // S16 (audit) : 3 créations de clé/min — empêche scripting massif.
    await enforceRateLimit(userId, "create_api_key", 3);
    const tenantId = await requireAdmin(userId);

    const raw = randomBytes(24).toString("base64url");
    const prefix = `jak_${raw.slice(0, 8)}`;
    const fullKey = `${prefix}_${raw}`;
    const keyHash = createHash("sha256").update(fullKey).digest("hex");

    const { data: row, error } = await supabaseAdmin
      .from("tenant_api_keys")
      .insert({
        tenant_id: tenantId, created_by: userId, label: data.label,
        prefix, key_hash: keyHash, scopes: data.scopes,
      })
      .select("id, prefix, created_at").single();
    if (error) throw new Error(error.message);

    // Returned ONCE — user must save it
    return { id: row.id, key: fullKey, prefix: row.prefix, created_at: row.created_at };
  });

export const revokeApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await requireAdmin(userId);
    const { error } = await supabaseAdmin
      .from("tenant_api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id).eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── WEBHOOKS ───────────────────────────────────────────────────────────────

export const listWebhooks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await requireAdmin(userId);
    // S14 : ne JAMAIS retourner `secret` complet à l'UI ; uniquement `secret_last4`.
    const { data, error } = await supabaseAdmin
      .from("tenant_webhooks")
      .select("id, target_url, events, active, created_at, secret_last4")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{
      id: string; target_url: string; events: string[]; active: boolean;
      created_at: string; secret_last4: string | null;
    }>;
  });

const WEBHOOK_EVENTS = [
  "dossier.created", "dossier.updated",
  "task.created", "task.completed",
  "comment.added", "alert.published",
] as const;

function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

export const createWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({
      target_url: z.string().url().max(500),
      events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await requireAdmin(userId);
    const secret = generateWebhookSecret();

    const { data: row, error } = await supabaseAdmin
      .from("tenant_webhooks")
      .insert({
        tenant_id: tenantId, created_by: userId,
        target_url: data.target_url, events: data.events,
        secret, secret_last4: secret.slice(-4),
      } as never)
      .select("id").single();
    if (error) throw new Error(error.message);
    // Le secret en clair n'est renvoyé QUE ici, à la création. Plus jamais ensuite.
    return { id: row.id, secret };
  });

// S14 : régénérer le secret (le précédent devient invalide immédiatement).
// Le nouveau secret en clair n'est renvoyé qu'une seule fois.
export const rotateWebhookSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await requireAdmin(userId);
    const secret = generateWebhookSecret();
    const { error } = await supabaseAdmin
      .from("tenant_webhooks")
      .update({ secret, secret_last4: secret.slice(-4) } as never)
      .eq("id", data.id).eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { id: data.id, secret };
  });

export const toggleWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ id: z.string().uuid(), active: z.boolean() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await requireAdmin(userId);
    const { error } = await supabaseAdmin
      .from("tenant_webhooks").update({ active: data.active })
      .eq("id", data.id).eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await requireAdmin(userId);
    const { error } = await supabaseAdmin
      .from("tenant_webhooks").delete().eq("id", data.id).eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── SLACK TEST MESSAGE ─────────────────────────────────────────────────────

export const sendSlackTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    const tenantId = await requireAdmin(userId);

    const { data: integ } = await supabaseAdmin
      .from("tenant_integrations").select("slack_channel, slack_enabled")
      .eq("tenant_id", tenantId).maybeSingle();
    const channel = integ?.slack_channel as string | null;
    if (!integ?.slack_enabled || !channel) throw new Error("Slack non configuré");

    const { postSlackMessage } = await import("@/server/slack.server");
    await postSlackMessage(channel, "✅ Test JurisAI — l'intégration Slack fonctionne !");
    return { ok: true };
  });
