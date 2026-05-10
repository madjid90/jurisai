// LOT 5 RAG — Vérification post-réponse des références juridiques.
// Extrait toutes les références citées dans une réponse IA (ex: "Article L1234-5
// du Code du travail", "D. 1234-5", "art. R. 4624-22") et vérifie qu'elles
// existent dans la vue `legal_reference_index` (sources actives).
//
// Retourne un score de fiabilité + la liste des références introuvables,
// que l'on log dans `usage_logs` (et/ou utilise pour ajouter un disclaimer).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface ReferenceVerificationResult {
  references_found: string[];        // brutes telles qu'extraites
  references_verified: string[];     // matchent un legal_source actif
  references_unknown: string[];      // non trouvées dans l'index
  verification_score: number;        // verified / found (1 si aucune référence)
  should_warn: boolean;              // true si score < 0.6
}

// Patterns d'articles juridiques courants : L./R./D./A. + numéro (avec tirets/points)
// Couvre : "L1234-5", "L. 1234-5", "Article L1234-5", "art. R. 4624-22", "D 1234"
const RX_ARTICLES = [
  /\b[Aa]rt(?:icle|\.)?\s*([LRDA])\.?\s*(\d{1,5}(?:[\s\-]\d{1,4}){0,3})/g,
  /\b([LRDA])\.\s*(\d{1,5}(?:[\s\-]\d{1,4}){0,3})/g,
];

function normalize(ref: string): string {
  return ref.toLowerCase().replace(/[\s\.\-]+/g, "");
}

export function extractLegalReferences(answer: string): string[] {
  const found = new Set<string>();
  for (const rx of RX_ARTICLES) {
    rx.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(answer)) !== null) {
      const code = (m[1] ?? "").toUpperCase();
      const num = (m[2] ?? "").trim();
      if (code && num) found.add(`${code}${num.replace(/\s/g, "")}`);
    }
  }
  return [...found];
}

export async function verifyReferences(
  supabaseUrl: string,
  serviceKey: string,
  answer: string,
): Promise<ReferenceVerificationResult> {
  const found = extractLegalReferences(answer);
  if (found.length === 0) {
    return {
      references_found: [],
      references_verified: [],
      references_unknown: [],
      verification_score: 1,
      should_warn: false,
    };
  }

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const normalized = found.map(normalize);

  // Lookup batch sur la vue d'index
  const { data, error } = await sb
    .from("legal_reference_index")
    .select("reference_norm")
    .in("reference_norm", normalized);

  if (error) {
    console.error("[verifyReferences] lookup failed", error);
    return {
      references_found: found,
      references_verified: [],
      references_unknown: found,
      verification_score: 0,
      should_warn: true,
    };
  }

  const verifiedNorms = new Set(
    (data ?? []).map((r: { reference_norm: string }) => r.reference_norm),
  );
  const verified: string[] = [];
  const unknown: string[] = [];
  found.forEach((ref, i) => {
    if (verifiedNorms.has(normalized[i])) verified.push(ref);
    else unknown.push(ref);
  });

  const score = verified.length / found.length;
  return {
    references_found: found,
    references_verified: verified,
    references_unknown: unknown,
    verification_score: Number(score.toFixed(3)),
    should_warn: score < 0.6,
  };
}
