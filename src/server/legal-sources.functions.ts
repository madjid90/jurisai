// Admin server functions: legal sources CRUD + manual URL ingestion.
// All require super_admin role.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertSuperAdmin(userId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .maybeSingle();
  if (error) throw new Error(`Role check failed: ${error.message}`);
  if (!data) throw new Error("Accès réservé aux super-administrateurs");
}

export type LegalSourceRow = {
  id: string;
  title: string;
  source_type: string;
  reference_code: string | null;
  official_url: string | null;
  idcc: string | null;
  connector: string | null;
  is_active: boolean;
  version_date: string | null;
  last_synced_at: string | null;
  created_at: string;
};

export const listLegalSources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { search?: string; type?: string; idcc?: string; limit?: number }) => input,
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    let query = supabaseAdmin
      .from("legal_sources")
      .select(
        "id, title, source_type, reference_code, official_url, idcc, connector, is_active, version_date, last_synced_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 100);

    if (data.search) {
      const safe = data.search.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&");
      query = query.ilike("title", `%${safe}%`);
    }
    if (data.type) query = query.eq("source_type", data.type);
    if (data.idcc) query = query.eq("idcc", data.idcc);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return { sources: (rows ?? []) as LegalSourceRow[] };
  });

export const toggleLegalSourceActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; is_active: boolean }) => input)
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    const client = supabaseAdmin as unknown as {
      from: (t: string) => {
        update: (v: Record<string, unknown>) => {
          eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>;
        };
      };
    };
    const { error } = await client
      .from("legal_sources")
      .update({ is_active: data.is_active })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteLegalSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    // Delete chunks first (no cascade declared)
    await supabaseAdmin.from("legal_chunks").delete().eq("source_id", data.id);
    const { error } = await supabaseAdmin.from("legal_sources").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const ingestLegalUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      title: string;
      source_type: string;
      url?: string;
      raw_text?: string;
      reference_code?: string;
      official_url?: string;
      idcc?: string;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    if (!data.title || !data.source_type) throw new Error("Titre et type requis");
    if (!data.url && !data.raw_text) throw new Error("Fournir une URL ou du texte brut");

    const { data: result, error } = await supabaseAdmin.functions.invoke("ingest-legal-source", {
      body: data,
    });
    if (error) throw new Error(error.message);
    return { result };
  });
