/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SYSTÈME DE MISE À JOUR DES BARÈMES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 3 modes de mise à jour :
 *
 * 1. CRON MENSUEL (automatique)
 *    → Vérifie les valeurs connues (SMIC, PSS) via sources officielles
 *    → Si changement détecté → crée une entrée "pending" + alerte admin
 *    → Ne modifie JAMAIS les barèmes sans validation humaine
 *
 * 2. ADMIN UI (manuel)
 *    → CRUD sur les barèmes via l'interface admin
 *    → Historique versionné (valid_from / valid_to)
 *    → Chaque modification tracée dans bareme_update_log
 *
 * 3. AGENT IA (assisté)
 *    → Le RAG détecte un nouveau texte législatif impactant les barèmes
 *    → Propose la mise à jour → validation humaine obligatoire
 *
 * PRINCIPE FONDAMENTAL : aucune mise à jour automatique sans validation humaine.
 * Les données juridiques engagent la responsabilité → l'humain valide toujours.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const db = supabaseAdmin as unknown as { from: (table: string) => any };

// ─── Types ────────────────────────────────────────────────────────────────

export interface BaremeUpdateRequest {
  tableName: "reference_values" | "macron_scale" | "indemnity_formulas" | "convention_indemnity_scales" | "prescription_periods";
  action: "insert" | "update" | "close";
  recordId?: string;
  newValue: Record<string, unknown>;
  oldValue?: Record<string, unknown>;
  source: string;         // URL ou référence du texte officiel
  updatedBy: string;      // admin:uuid | cron | agent:run_id
}

export interface BaremeCheckResult {
  key: string;
  currentValue: number;
  expectedValue?: number;
  status: "ok" | "outdated" | "missing" | "unknown";
  source?: string;
  message: string;
}

// ─── 1. Vérification périodique (appelée par cron) ────────────────────────

/**
 * Vérifie que les valeurs de référence sont à jour.
 * Retourne la liste des anomalies détectées.
 *
 * Cette fonction ne MODIFIE rien — elle retourne un rapport.
 * L'admin décide ensuite de valider ou non les mises à jour.
 */
export async function checkBaremesHealth(): Promise<BaremeCheckResult[]> {
  const results: BaremeCheckResult[] = [];
  const today = new Date().toISOString().split("T")[0];
  const currentYear = new Date().getFullYear();

  // Vérifier les valeurs de référence obligatoires
  const requiredKeys = [
    { key: "smic_horaire", label: "SMIC horaire" },
    { key: "smic_mensuel", label: "SMIC mensuel" },
    { key: "plafond_ss_mensuel", label: "Plafond SS mensuel" },
    { key: "plafond_ss_annuel", label: "Plafond SS annuel" },
  ];

  for (const req of requiredKeys) {
    const { data } = await db
      .from("reference_values")
      .select("value, valid_from, valid_to, source_ref")
      .eq("key", req.key)
      .is("valid_to", null)
      .order("valid_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) {
      results.push({
        key: req.key,
        currentValue: 0,
        status: "missing",
        message: `${req.label} : aucune valeur active trouvée !`,
      });
    } else {
      const validFrom = new Date(data.valid_from);
      const yearsDiff = currentYear - validFrom.getFullYear();

      if (yearsDiff > 1) {
        results.push({
          key: req.key,
          currentValue: data.value,
          status: "outdated",
          source: data.source_ref,
          message: `${req.label} : valeur de ${validFrom.getFullYear()}, possiblement obsolète (${data.value}€)`,
        });
      } else {
        results.push({
          key: req.key,
          currentValue: data.value,
          status: "ok",
          source: data.source_ref,
          message: `${req.label} : ${data.value}€ (en vigueur depuis le ${data.valid_from})`,
        });
      }
    }
  }

  // Vérifier que le barème Macron est complet (0-30 ans)
  const { count: macronCount } = await db
    .from("macron_scale")
    .select("id", { count: "exact", head: true })
    .eq("company_size", "standard")
    .is("valid_to", null);

  if ((macronCount ?? 0) < 30) {
    results.push({
      key: "macron_scale",
      currentValue: macronCount ?? 0,
      status: "missing",
      message: `Barème Macron incomplet : ${macronCount ?? 0}/31 entrées (0-30 ans)`,
    });
  } else {
    results.push({
      key: "macron_scale",
      currentValue: macronCount ?? 0,
      status: "ok",
      message: `Barème Macron complet : ${macronCount} entrées`,
    });
  }

  // Vérifier les formules d'indemnités
  const requiredFormulas = [
    "licenciement_legal", "preavis_legal", "conges_payes",
    "rupture_conventionnelle", "depart_retraite",
  ];

  for (const type of requiredFormulas) {
    const { data } = await db
      .from("indemnity_formulas")
      .select("id, valid_from")
      .eq("type", type)
      .is("valid_to", null)
      .maybeSingle();

    results.push({
      key: `formula_${type}`,
      currentValue: data ? 1 : 0,
      status: data ? "ok" : "missing",
      message: data
        ? `Formule ${type} : présente (depuis ${data.valid_from})`
        : `Formule ${type} : ABSENTE !`,
    });
  }

  return results;
}

// ─── 2. Mise à jour avec audit trail ──────────────────────────────────────

/**
 * Ajoute une nouvelle valeur de référence (versionnée).
 * Clôture automatiquement l'ancienne valeur (valid_to = veille du nouveau valid_from).
 * Trace dans bareme_update_log.
 */
export async function updateReferenceValue(
  key: string,
  newValue: number,
  validFrom: string,
  label: string,
  sourceRef: string,
  sourceUrl: string | null,
  updatedBy: string
): Promise<{ id: string }> {
  // 1. Clôturer l'ancienne valeur active
  const validFromDate = new Date(validFrom);
  const dayBefore = new Date(validFromDate);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const validToStr = dayBefore.toISOString().split("T")[0];

  const { data: existing } = await db
    .from("reference_values")
    .select("id, value")
    .eq("key", key)
    .is("valid_to", null)
    .order("valid_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    await db
      .from("reference_values")
      .update({ valid_to: validToStr, updated_at: new Date().toISOString() })
      .eq("id", existing.id);

    // Log la clôture
    await db.from("bareme_update_log").insert({
      table_name: "reference_values",
      record_id: existing.id,
      action: "close",
      old_value: { value: existing.value, valid_to: null },
      new_value: { valid_to: validToStr },
      updated_by: updatedBy,
      source: sourceRef,
    });
  }

  // 2. Insérer la nouvelle valeur
  const { data: newRecord, error } = await db
    .from("reference_values")
    .insert({
      key,
      value: newValue,
      unit: "EUR",
      label,
      source_ref: sourceRef,
      source_url: sourceUrl,
      valid_from: validFrom,
      valid_to: null,
      updated_by: updatedBy,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Mise à jour impossible : ${error.message}`);

  // 3. Log l'insertion
  await db.from("bareme_update_log").insert({
    table_name: "reference_values",
    record_id: newRecord.id,
    action: "insert",
    new_value: { key, value: newValue, valid_from: validFrom, source_ref: sourceRef },
    updated_by: updatedBy,
    source: sourceRef,
  });

  return { id: newRecord.id };
}

// ─── 3. Liste des mises à jour récentes ──────────────────────────────────

export async function getRecentBaremeUpdates(limit = 20) {
  const { data, error } = await db
    .from("bareme_update_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Lecture impossible : ${error.message}`);
  return data ?? [];
}

// ─── 4. Snapshot des barèmes pour traçabilité ─────────────────────────────

/**
 * Prend un snapshot de toutes les valeurs de référence actives à une date donnée.
 * Utilisé par le moteur de calcul pour stocker dans calculation_history.
 */
export async function snapshotBaremesAtDate(date: string): Promise<Record<string, unknown>> {
  const { data: refs } = await db
    .from("reference_values")
    .select("key, value, unit, source_ref, valid_from")
    .lte("valid_from", date)
    .or(`valid_to.is.null,valid_to.gte.${date}`);

  const snapshot: Record<string, unknown> = {
    date,
    generated_at: new Date().toISOString(),
    values: {},
  };

  if (refs) {
    // Grouper par key, garder la plus récente
    const byKey: Record<string, any> = {};
    for (const ref of refs) {
      if (!byKey[ref.key] || ref.valid_from > byKey[ref.key].valid_from) {
        byKey[ref.key] = ref;
      }
    }
    (snapshot as any).values = byKey;
  }

  return snapshot;
}

// ─── 5. Sources de données pour mise à jour CRON ──────────────────────────

/**
 * URLs des sources officielles à vérifier lors du cron mensuel.
 * Le cron fetch ces URLs, parse les valeurs, et compare avec la DB.
 *
 * À implémenter dans une Edge Function dédiée (bareme-watcher).
 */
export const OFFICIAL_SOURCES = {
  smic: {
    url: "https://api.code.travail.gouv.fr/api/v1/modeles/smic",
    description: "API Code du travail numérique — SMIC en vigueur",
    frequency: "monthly",
  },
  plafond_ss: {
    url: "https://www.urssaf.fr/api/plafonds",
    description: "URSSAF — Plafond de sécurité sociale",
    frequency: "yearly",
    update_month: 1, // Mis à jour chaque 1er janvier
  },
  conventions: {
    url: "https://api.legifrance.gouv.fr/consult/getConvCollTexte",
    description: "API Legifrance — Textes conventions collectives",
    frequency: "quarterly",
    note: "Nécessite clé API PISTE (gratuit après inscription)",
  },
} as const;

/**
 * Calendrier annuel des mises à jour prévisibles :
 *
 * 1er janvier  → SMIC, Plafond SS, taux AT/MP
 * 1er mai      → Éventuelle revalorisation SMIC intermédiaire
 * 1er novembre → Éventuelle revalorisation SMIC intermédiaire
 * Tout au long → Avenants salaires des conventions collectives
 *
 * Le cron tourne le 2 de chaque mois et vérifie si une mise à jour
 * est attendue. Si oui, il vérifie les sources officielles.
 */
