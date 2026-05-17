// Système de propositions de mise à jour de barèmes.
//
// Workflow :
//   1. Un connecteur (CDTN, INSEE, Legifrance, BOSS) détecte une nouvelle valeur officielle
//   2. Il appelle `proposeReferenceValueUpdate(...)` → INSERT dans bareme_update_log
//      avec action="propose", verified=false (PAS d'insertion dans reference_values)
//   3. Un admin va sur /admin/baremes, voit la proposition, clique "valider"
//   4. `validateProposal(id)` → exécute le vrai updateReferenceValue + marque verified=true
//   5. Le calculateur utilise désormais la nouvelle valeur
//
// La table reference_values N'EST JAMAIS modifiée tant que pas validée.
// Le calculateur continue de servir l'ancienne valeur en attendant.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { updateReferenceValue } from "./bareme-updater.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;

export type ReferenceValueProposal = {
  key: string;
  newValue: number;
  validFrom: string; // YYYY-MM-DD
  label: string;
  sourceRef: string; // ex: "Décret n°2025-1239 du 20 décembre 2025"
  sourceUrl: string | null;
  connector: string; // "cdtn" | "legifrance" | "boss" | "insee" | "bofip"
};

// JSON value type (serializable par TanStack)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonValue = any;

export type ProposalRow = {
  id: string;
  table_name: string;
  action: string;
  new_value: JsonValue;
  source: string;
  updated_by: string;
  verified: boolean;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
};

/**
 * Soumet une proposition de mise à jour d'une valeur de référence.
 * Vérifie qu'aucune proposition identique n'existe déjà (anti-doublon).
 * N'écrit PAS dans reference_values — uniquement dans bareme_update_log.
 */
export async function proposeReferenceValueUpdate(p: ReferenceValueProposal): Promise<{
  status: "proposed" | "skipped_existing" | "skipped_same_value";
  id?: string;
}> {
  // 1. Vérifier que la valeur actuelle est différente
  const { data: current } = await db
    .from("reference_values")
    .select("value, valid_from")
    .eq("key", p.key)
    .is("valid_to", null)
    .order("valid_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (current && Number(current.value) === p.newValue && current.valid_from === p.validFrom) {
    return { status: "skipped_same_value" };
  }

  // 2. Anti-doublon : déjà proposé et pas encore validé/rejeté ?
  const { data: existing } = await db
    .from("bareme_update_log")
    .select("id")
    .eq("table_name", "reference_values")
    .eq("action", "propose")
    .eq("verified", false)
    .filter("new_value->>key", "eq", p.key)
    .filter("new_value->>valid_from", "eq", p.validFrom)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return { status: "skipped_existing", id: existing.id };
  }

  // 3. Insertion de la proposition
  const { data: row, error } = await db
    .from("bareme_update_log")
    .insert({
      table_name: "reference_values",
      action: "propose",
      new_value: {
        key: p.key,
        value: p.newValue,
        valid_from: p.validFrom,
        label: p.label,
        source_url: p.sourceUrl,
        connector: p.connector,
      },
      source: p.sourceRef,
      updated_by: `connector:${p.connector}`,
      verified: false,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Proposition impossible : ${error.message}`);
  return { status: "proposed", id: row.id };
}

/**
 * Liste les propositions en attente (verified=false, action=propose).
 */
export async function listPendingProposals() {
  const { data, error } = await db
    .from("bareme_update_log")
    .select("*")
    .eq("action", "propose")
    .eq("verified", false)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Lecture impossible : ${error.message}`);
  return (data ?? []) as ProposalRow[];
}

/**
 * Valide une proposition : exécute la vraie MAJ + marque verified=true.
 */
export async function validateProposal(proposalId: string, adminUserId: string): Promise<{
  ok: true;
  newRecordId: string;
}> {
  const { data: proposal, error: pErr } = await db
    .from("bareme_update_log")
    .select("*")
    .eq("id", proposalId)
    .eq("action", "propose")
    .eq("verified", false)
    .maybeSingle();

  if (pErr) throw new Error(`Lecture proposition : ${pErr.message}`);
  if (!proposal) throw new Error("Proposition introuvable ou déjà traitée");

  const nv = proposal.new_value as Record<string, unknown>;
  if (proposal.table_name !== "reference_values") {
    throw new Error(`Validation non supportée pour table_name=${proposal.table_name}`);
  }

  const result = await updateReferenceValue(
    String(nv.key),
    Number(nv.value),
    String(nv.valid_from),
    String(nv.label),
    String(proposal.source),
    (nv.source_url as string | null) ?? null,
    `admin:${adminUserId}`,
  );

  await db
    .from("bareme_update_log")
    .update({
      verified: true,
      verified_by: adminUserId,
      verified_at: new Date().toISOString(),
    })
    .eq("id", proposalId);

  return { ok: true, newRecordId: result.id };
}

/**
 * Rejette une proposition (marque verified=true avec verified_by = admin pour traçabilité,
 * mais action="reject" pour distinguer du "validate"). Plus simple : on update juste verified=true
 * et on ajoute updated_by suffix.
 */
export async function rejectProposal(proposalId: string, adminUserId: string, reason?: string): Promise<void> {
  const { error } = await db
    .from("bareme_update_log")
    .update({
      verified: true,
      verified_by: adminUserId,
      verified_at: new Date().toISOString(),
      action: "rejected",
      old_value: { rejection_reason: reason ?? null },
    })
    .eq("id", proposalId)
    .eq("action", "propose")
    .eq("verified", false);
  if (error) throw new Error(`Rejet impossible : ${error.message}`);
}
