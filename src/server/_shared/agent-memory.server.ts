// Mémoire agentique persistée (table agent_memory).
// Lecture/écriture sécurisée via supabaseAdmin + scoping tenant strict.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type MemoryScope = "tenant" | "user" | "dossier";

export type MemoryEntry = {
  id: string;
  scope: MemoryScope;
  key: string;
  value: Record<string, unknown>;
  relevance: number;
  dossier_id: string | null;
  user_id: string | null;
  updated_at: string;
};

type RecallParams = {
  tenantId: string;
  userId?: string;
  dossierId?: string;
  limit?: number;
};

/** Récupère les souvenirs pertinents pour un contexte (tenant + user + dossier optionnels). */
export async function recallMemory(p: RecallParams): Promise<MemoryEntry[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;
  let q = sb
    .from("agent_memory")
    .select("id, scope, key, value, relevance, dossier_id, user_id, updated_at")
    .eq("tenant_id", p.tenantId)
    .order("relevance", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(p.limit ?? 8);

  // On laisse postgres faire l'OR via filtre côté client : tenant scope toujours,
  // + dossier scope si dossierId fourni, + user scope si userId fourni.
  const { data, error } = await q;
  if (error) return [];
  const rows = (data ?? []) as MemoryEntry[];
  return rows.filter((r) => {
    if (r.scope === "tenant") return true;
    if (r.scope === "user") return p.userId ? r.user_id === p.userId : false;
    if (r.scope === "dossier") return p.dossierId ? r.dossier_id === p.dossierId : false;
    return false;
  });
}

type RememberParams = {
  tenantId: string;
  scope: MemoryScope;
  key: string;
  value: Record<string, unknown>;
  userId?: string | null;
  dossierId?: string | null;
  relevance?: number;
  expiresAt?: string | null;
};

/** Insère ou met à jour un souvenir (clé unique par tenant+scope+key+dossier+user). */
export async function rememberMemory(p: RememberParams): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabaseAdmin as any;
  // Upsert manuel (pas d'unique en DB pour rester souple : on cherche, on update sinon insert).
  const match = sb
    .from("agent_memory")
    .select("id")
    .eq("tenant_id", p.tenantId)
    .eq("scope", p.scope)
    .eq("key", p.key);
  if (p.scope === "dossier" && p.dossierId) match.eq("dossier_id", p.dossierId);
  if (p.scope === "user" && p.userId) match.eq("user_id", p.userId);

  const { data: existing } = await match.maybeSingle();
  if (existing?.id) {
    await sb
      .from("agent_memory")
      .update({
        value: p.value,
        relevance: p.relevance ?? 0.5,
        expires_at: p.expiresAt ?? null,
      })
      .eq("id", existing.id);
    return;
  }
  await sb.from("agent_memory").insert({
    tenant_id: p.tenantId,
    scope: p.scope,
    key: p.key,
    value: p.value,
    user_id: p.userId ?? null,
    dossier_id: p.dossierId ?? null,
    relevance: p.relevance ?? 0.5,
    expires_at: p.expiresAt ?? null,
  });
}

/** Construit un préambule textuel injectable dans le system prompt. */
export function memoryPreamble(entries: MemoryEntry[]): string {
  if (entries.length === 0) return "";
  const lines = entries.slice(0, 8).map((e) => {
    const v = typeof e.value === "string" ? e.value : JSON.stringify(e.value).slice(0, 240);
    return `- [${e.scope}] ${e.key} : ${v}`;
  });
  return `Souvenirs pertinents (à utiliser sans les répéter inutilement) :\n${lines.join("\n")}`;
}
