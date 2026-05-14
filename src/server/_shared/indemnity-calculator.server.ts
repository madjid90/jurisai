/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MOTEUR DE CALCUL D'INDEMNITÉS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Calcule les indemnités légales et conventionnelles en appliquant le
 * principe de faveur (le plus avantageux pour le salarié).
 *
 * Toutes les valeurs sont versionnées (valid_from/valid_to) → le moteur
 * utilise toujours les barèmes en vigueur à la date du fait générateur.
 *
 * Audit trail : chaque calcul est persisté dans `calculation_history`
 * avec un snapshot des barèmes utilisés pour traçabilité juridique.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ─── Types ────────────────────────────────────────────────────────────────

export interface CalculationInput {
  /** Salaire mensuel brut de référence */
  salaireMensuelBrut: number;
  /** Salaire moyen des 12 derniers mois (si différent) */
  salaireMoyen12m?: number;
  /** Salaire moyen des 3 derniers mois avec primes proratisées */
  salaireMoyen3m?: number;
  /** Ancienneté en mois */
  ancienneteMois: number;
  /** Motif de rupture */
  motif: "licenciement_cause_reelle" | "licenciement_faute_grave" | "licenciement_faute_lourde"
    | "licenciement_eco" | "rupture_conventionnelle" | "mise_retraite" | "depart_retraite"
    | "licenciement_inaptitude_pro" | "licenciement_inaptitude_non_pro";
  /** Code IDCC de la convention collective (optionnel) */
  idcc?: string;
  /** Catégorie professionnelle (cadre, non-cadre, ETAM...) */
  categorie?: string;
  /** Taille entreprise : ≥11 salariés (standard) ou <11 (small) */
  tailleEntreprise?: "standard" | "small";
  /** Date du fait générateur (défaut: aujourd'hui) */
  dateEffet?: string;
  /** Le salarié a-t-il des congés non pris ? */
  joursCongesNonPris?: number;
}

export interface IndemnityResult {
  /** Résumé en une phrase */
  summary: string;
  /** Détail de chaque composante */
  components: IndemnityComponent[];
  /** Total toutes indemnités confondues */
  totalBrut: number;
  /** Fourchette Macron si licenciement abusif contesté */
  macronRange?: { min: number; max: number };
  /** Salaire de référence retenu */
  salaireReference: number;
  /** Méthode de calcul du salaire de référence */
  salaireReferenceMethode: string;
  /** Ancienneté retenue */
  ancienneteAnnees: number;
  ancienneteMois: number;
  /** Barèmes utilisés (snapshot pour traçabilité) */
  baremesUtilises: Record<string, unknown>;
  /** Références légales citées */
  referencesLegales: string[];
  /** Avertissements */
  warnings: string[];
}

export interface IndemnityComponent {
  type: string;
  label: string;
  montant: number;
  detail: string;
  source: "legal" | "conventionnel";
  referenceLegale: string;
}

// ─── Helpers DB ───────────────────────────────────────────────────────────

async function getReferenceValue(key: string, date: string): Promise<number | null> {
  const { data } = await (supabaseAdmin as any).rpc("get_reference_value", {
    p_key: key,
    p_date: date,
  });
  return typeof data === "number" ? data : null;
}

async function getMacronScale(seniorityYears: number, companySize: string, date: string) {
  const { data } = await (supabaseAdmin as any).rpc("get_macron_scale", {
    p_seniority_years: Math.min(seniorityYears, 30),
    p_company_size: companySize,
    p_date: date,
  });
  if (Array.isArray(data) && data.length > 0) return data[0];
  return null;
}

async function getLegalFormula(type: string, date: string) {
  const { data } = await (supabaseAdmin as any)
    .from("indemnity_formulas")
    .select("formula_json, conditions_json, source_ref")
    .eq("type", type)
    .lte("valid_from", date)
    .or(`valid_to.is.null,valid_to.gte.${date}`)
    .order("valid_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function getConventionFormula(idcc: string, type: string, categorie: string | null, date: string) {
  let query = (supabaseAdmin as any)
    .from("convention_indemnity_scales")
    .select("formula_json, conditions_json, source_ref, convention_name")
    .eq("idcc", idcc)
    .eq("type", type)
    .lte("valid_from", date)
    .or(`valid_to.is.null,valid_to.gte.${date}`)
    .order("valid_from", { ascending: false })
    .limit(2);

  const { data } = await query;
  if (!data || data.length === 0) return null;

  // Chercher d'abord la catégorie spécifique, sinon la générique (NULL)
  const specific = data.find((d: any) => d.conditions_json?.category === categorie || false);
  const generic = data.find((d: any) => !d.conditions_json?.category);
  return specific ?? generic ?? data[0];
}

// ─── Calcul du salaire de référence ───────────────────────────────────────

function computeRefSalary(input: CalculationInput): { amount: number; method: string } {
  const avg12 = input.salaireMoyen12m ?? input.salaireMensuelBrut;
  const avg3 = input.salaireMoyen3m ?? input.salaireMensuelBrut;

  // Art. R1234-4 : le plus favorable entre moyenne 12 mois et moyenne 3 mois
  if (avg3 >= avg12) {
    return { amount: avg3, method: "Moyenne des 3 derniers mois (avec primes proratisées) — Art. R1234-4 CT" };
  }
  return { amount: avg12, method: "Moyenne des 12 derniers mois — Art. R1234-4 CT" };
}

// ─── Calcul indemnité légale de licenciement ──────────────────────────────

function computeLegalSeverance(refSalary: number, seniorityMonths: number): { amount: number; detail: string } {
  const years = seniorityMonths / 12;

  if (seniorityMonths < 8) {
    return { amount: 0, detail: "Ancienneté insuffisante (< 8 mois)" };
  }

  let amount: number;
  if (years <= 10) {
    amount = (1 / 4) * refSalary * years;
  } else {
    amount = (1 / 4) * refSalary * 10 + (1 / 3) * refSalary * (years - 10);
  }

  const detail = years <= 10
    ? `1/4 × ${refSalary.toFixed(2)}€ × ${years.toFixed(2)} ans = ${amount.toFixed(2)}€`
    : `(1/4 × ${refSalary.toFixed(2)}€ × 10 ans) + (1/3 × ${refSalary.toFixed(2)}€ × ${(years - 10).toFixed(2)} ans) = ${amount.toFixed(2)}€`;

  return { amount: Math.round(amount * 100) / 100, detail };
}

// ─── Calcul indemnité conventionnelle ─────────────────────────────────────

function computeConventionalSeverance(
  formula: any,
  refSalary: number,
  seniorityMonths: number
): { amount: number; detail: string } | null {
  if (!formula?.formula_json?.rules) return null;

  const years = seniorityMonths / 12;
  const rules = formula.formula_json.rules;
  let amount = 0;
  const parts: string[] = [];

  for (const rule of rules) {
    if (rule.rate) {
      let applicableYears: number;

      if (rule.up_to_years !== undefined) {
        applicableYears = Math.min(years, rule.up_to_years);
      } else if (rule.above_years !== undefined) {
        applicableYears = Math.max(0, years - rule.above_years);
      } else if (rule.from_years !== undefined && rule.to_years !== undefined) {
        applicableYears = Math.max(0, Math.min(years, rule.to_years) - rule.from_years);
      } else if (rule.from_years !== undefined) {
        applicableYears = Math.max(0, years - rule.from_years);
      } else {
        applicableYears = years;
      }

      if (applicableYears > 0) {
        const partAmount = rule.rate * refSalary * applicableYears;
        amount += partAmount;
        parts.push(`${rule.rate} × ${refSalary.toFixed(0)}€ × ${applicableYears.toFixed(2)} ans = ${partAmount.toFixed(2)}€`);
      }
    }
  }

  if (amount === 0) return null;
  return {
    amount: Math.round(amount * 100) / 100,
    detail: parts.join(" + "),
  };
}

// ─── Calcul préavis ───────────────────────────────────────────────────────

function computeNoticePeriod(
  formula: any,
  seniorityMonths: number,
  categorie: string | undefined
): { months: number; detail: string } {
  if (!formula?.formula_json?.rules) {
    // Légal par défaut
    if (categorie?.toLowerCase() === "cadre") {
      return { months: 3, detail: "3 mois (usage cadre)" };
    }
    if (seniorityMonths < 6) return { months: 0, detail: "Selon contrat (< 6 mois)" };
    if (seniorityMonths < 24) return { months: 1, detail: "1 mois (6 mois à 2 ans d'ancienneté)" };
    return { months: 2, detail: "2 mois (≥ 2 ans d'ancienneté)" };
  }

  const rules = formula.formula_json.rules;
  const years = seniorityMonths / 12;
  const cat = categorie?.toLowerCase() ?? "non-cadre";

  for (const rule of rules) {
    const catMatch = !rule.category || rule.category.toLowerCase() === cat;
    if (!catMatch) continue;

    if (rule.seniority_range) {
      const [min, max] = rule.seniority_range;
      const seniorityCheck = max === null ? years >= min : years >= min && years < max;
      if (seniorityCheck && rule.duration_months !== undefined) {
        return { months: rule.duration_months, detail: `${rule.duration_months} mois (convention)` };
      }
    } else if (rule.duration_months !== undefined) {
      return { months: rule.duration_months, detail: `${rule.duration_months} mois (convention)` };
    }
  }

  // Fallback légal
  if (seniorityMonths < 6) return { months: 0, detail: "Selon contrat" };
  if (seniorityMonths < 24) return { months: 1, detail: "1 mois (légal)" };
  return { months: 2, detail: "2 mois (légal)" };
}

// ─── Fonction principale ──────────────────────────────────────────────────

export async function calculateIndemnity(input: CalculationInput): Promise<IndemnityResult> {
  const dateEffet = input.dateEffet ?? new Date().toISOString().split("T")[0];
  const seniorityYears = Math.floor(input.ancienneteMois / 12);
  const companySize = input.tailleEntreprise ?? "standard";
  const warnings: string[] = [];
  const referencesLegales: string[] = [];
  const components: IndemnityComponent[] = [];
  const baremesUtilises: Record<string, unknown> = {};

  // 1. Salaire de référence
  const refSalary = computeRefSalary(input);
  baremesUtilises.salaire_reference = refSalary;

  // 2. Vérifier les exclusions
  const isFauteLourde = input.motif === "licenciement_faute_lourde";
  const isFauteGrave = input.motif === "licenciement_faute_grave";
  const isRuptureConv = input.motif === "rupture_conventionnelle";
  const isDepartRetraite = input.motif === "depart_retraite";
  const isMiseRetraite = input.motif === "mise_retraite";
  const isInaptitudePro = input.motif === "licenciement_inaptitude_pro";

  // ── Indemnité de licenciement / rupture ──

  if (isFauteLourde) {
    warnings.push("Faute lourde : aucune indemnité de licenciement n'est due (Art. L1234-9 CT). Seuls les congés payés acquis restent dus.");
    referencesLegales.push("Art. L1234-9 Code du travail");
  } else if (isFauteGrave) {
    warnings.push("Faute grave : pas d'indemnité de licenciement ni de préavis (Art. L1234-1 et L1234-9 CT).");
    referencesLegales.push("Art. L1234-1 Code du travail", "Art. L1234-9 Code du travail");
  } else {
    // Calcul indemnité légale
    const legal = computeLegalSeverance(refSalary.amount, input.ancienneteMois);
    referencesLegales.push("Art. R1234-1 à R1234-4 Code du travail");

    let conventionalResult: { amount: number; detail: string } | null = null;
    let conventionName = "";

    // Calcul indemnité conventionnelle si IDCC fourni
    if (input.idcc) {
      const convType = isRuptureConv ? "licenciement" : // RC = au minimum l'indemnité de licenciement
        isDepartRetraite ? "depart_retraite" :
        isMiseRetraite ? "mise_retraite" : "licenciement";

      const convFormula = await getConventionFormula(input.idcc, convType, input.categorie ?? null, dateEffet);
      if (convFormula) {
        conventionalResult = computeConventionalSeverance(convFormula, refSalary.amount, input.ancienneteMois);
        conventionName = convFormula.convention_name ?? `CC IDCC ${input.idcc}`;
        baremesUtilises.convention = { idcc: input.idcc, formula: convFormula.formula_json, source: convFormula.source_ref };

        if (convFormula.source_ref) {
          referencesLegales.push(convFormula.source_ref);
        }
      }
    }

    // Principe de faveur : le plus avantageux
    const legalAmount = legal.amount;
    const convAmount = conventionalResult?.amount ?? 0;

    if (convAmount > legalAmount && conventionalResult) {
      components.push({
        type: "indemnite_licenciement",
        label: `Indemnité conventionnelle (${conventionName})`,
        montant: convAmount,
        detail: `${conventionalResult.detail}\n(Plus favorable que le légal : ${legalAmount.toFixed(2)}€)`,
        source: "conventionnel",
        referenceLegale: `Principe de faveur — ${conventionName}`,
      });
      warnings.push(`L'indemnité conventionnelle (${convAmount.toFixed(2)}€) est plus favorable que le légal (${legalAmount.toFixed(2)}€).`);
    } else {
      components.push({
        type: "indemnite_licenciement",
        label: isRuptureConv ? "Indemnité spécifique de rupture conventionnelle" :
          isDepartRetraite ? "Indemnité de départ volontaire à la retraite" :
          isMiseRetraite ? "Indemnité de mise à la retraite" :
          "Indemnité légale de licenciement",
        montant: legalAmount,
        detail: legal.detail,
        source: "legal",
        referenceLegale: "Art. R1234-1 à R1234-4 CT",
      });
    }

    // Doublement si inaptitude d'origine professionnelle
    if (isInaptitudePro) {
      const baseAmount = components[0].montant;
      components[0].montant = baseAmount * 2;
      components[0].detail += `\n⚠️ Doublée (inaptitude professionnelle) : ${baseAmount.toFixed(2)}€ × 2 = ${(baseAmount * 2).toFixed(2)}€`;
      components[0].referenceLegale += " + Art. L1226-14 CT";
      referencesLegales.push("Art. L1226-14 Code du travail (doublement inaptitude pro)");
    }
  }

  // ── Indemnité compensatrice de préavis ──

  if (!isFauteGrave && !isFauteLourde && !isDepartRetraite) {
    // Chercher d'abord le conventionnel
    let noticeFormula = null;
    if (input.idcc) {
      noticeFormula = await getConventionFormula(input.idcc, "preavis", input.categorie ?? null, dateEffet);
    }
    if (!noticeFormula) {
      noticeFormula = await getLegalFormula("preavis_legal", dateEffet);
    }

    const notice = computeNoticePeriod(noticeFormula, input.ancienneteMois, input.categorie);
    if (notice.months > 0) {
      const montantPreavis = refSalary.amount * notice.months;
      components.push({
        type: "indemnite_preavis",
        label: "Indemnité compensatrice de préavis",
        montant: montantPreavis,
        detail: `${refSalary.amount.toFixed(2)}€ × ${notice.months} mois = ${montantPreavis.toFixed(2)}€ (${notice.detail})`,
        source: noticeFormula?.source_ref?.includes("CC") ? "conventionnel" : "legal",
        referenceLegale: noticeFormula?.source_ref ?? "Art. L1234-1 CT",
      });
      referencesLegales.push("Art. L1234-5 Code du travail (indemnité compensatrice de préavis)");

      // Congés payés sur préavis
      const cpSurPreavis = montantPreavis * 0.10;
      components.push({
        type: "cp_sur_preavis",
        label: "Congés payés sur préavis",
        montant: Math.round(cpSurPreavis * 100) / 100,
        detail: `10% de l'indemnité de préavis = ${cpSurPreavis.toFixed(2)}€`,
        source: "legal",
        referenceLegale: "Art. L3141-28 CT",
      });
    }

    // Doublement du préavis si inaptitude pro
    if (isInaptitudePro && components.find(c => c.type === "indemnite_preavis")) {
      const preavisComp = components.find(c => c.type === "indemnite_preavis")!;
      // L'indemnité compensatrice = préavis même si dispense (art. L1226-14)
      warnings.push("Inaptitude professionnelle : l'indemnité compensatrice de préavis est due même si le salarié ne peut pas l'exécuter (Art. L1226-14 CT).");
    }
  }

  // ── Congés payés non pris ──

  if (input.joursCongesNonPris && input.joursCongesNonPris > 0) {
    const tauxJournalier = refSalary.amount / 21.67; // jours ouvrés moyens par mois
    const montantCP = tauxJournalier * input.joursCongesNonPris;
    components.push({
      type: "conges_payes",
      label: "Indemnité compensatrice de congés payés",
      montant: Math.round(montantCP * 100) / 100,
      detail: `${input.joursCongesNonPris} jours × ${tauxJournalier.toFixed(2)}€/jour = ${montantCP.toFixed(2)}€`,
      source: "legal",
      referenceLegale: "Art. L3141-28 CT",
    });
    referencesLegales.push("Art. L3141-28 Code du travail (congés payés)");
  }

  // ── Barème Macron (fourchette prud'homale) ──

  let macronRange: { min: number; max: number } | undefined;
  const isLicenciement = input.motif.startsWith("licenciement_") && !isFauteLourde;

  if (isLicenciement && !isInaptitudePro) {
    const macron = await getMacronScale(seniorityYears, companySize, dateEffet);
    if (macron) {
      macronRange = {
        min: macron.min_months * refSalary.amount,
        max: macron.max_months * refSalary.amount,
      };
      baremesUtilises.macron = {
        anciennete: seniorityYears,
        taille: companySize,
        min_mois: macron.min_months,
        max_mois: macron.max_months,
      };
      referencesLegales.push("Art. L1235-3 Code du travail (barème Macron)");
    }
  }

  // ── Total ──

  const totalBrut = components.reduce((sum, c) => sum + c.montant, 0);

  // ── Résumé ──

  const motifLabel: Record<string, string> = {
    licenciement_cause_reelle: "licenciement pour cause réelle et sérieuse",
    licenciement_faute_grave: "licenciement pour faute grave",
    licenciement_faute_lourde: "licenciement pour faute lourde",
    licenciement_eco: "licenciement économique",
    rupture_conventionnelle: "rupture conventionnelle",
    mise_retraite: "mise à la retraite",
    depart_retraite: "départ volontaire à la retraite",
    licenciement_inaptitude_pro: "licenciement pour inaptitude professionnelle",
    licenciement_inaptitude_non_pro: "licenciement pour inaptitude non professionnelle",
  };

  const summary = `Pour un(e) salarié(e) avec ${seniorityYears} ans et ${input.ancienneteMois % 12} mois d'ancienneté, un salaire de référence de ${refSalary.amount.toFixed(2)}€ brut/mois, en cas de ${motifLabel[input.motif] ?? input.motif}${input.idcc ? ` (CC IDCC ${input.idcc})` : ""} : le coût total estimé est de ${totalBrut.toFixed(2)}€ brut.`;

  return {
    summary,
    components,
    totalBrut: Math.round(totalBrut * 100) / 100,
    macronRange,
    salaireReference: refSalary.amount,
    salaireReferenceMethode: refSalary.method,
    ancienneteAnnees: seniorityYears,
    ancienneteMois: input.ancienneteMois,
    baremesUtilises,
    referencesLegales: [...new Set(referencesLegales)],
    warnings,
  };
}

// ─── Persistance audit trail ──────────────────────────────────────────────

export async function saveCalculation(
  tenantId: string,
  userId: string,
  dossierId: string | null,
  input: CalculationInput,
  result: IndemnityResult
): Promise<string> {
  const { data, error } = await (supabaseAdmin as any)
    .from("calculation_history")
    .insert({
      tenant_id: tenantId,
      user_id: userId,
      dossier_id: dossierId,
      calculation_type: input.motif,
      input_params: input,
      result_json: result,
      legal_refs: result.referencesLegales,
      baremes_used: result.baremesUtilises,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[saveCalculation] Error:", error);
    throw new Error("Impossible de sauvegarder le calcul");
  }
  return data.id;
}
