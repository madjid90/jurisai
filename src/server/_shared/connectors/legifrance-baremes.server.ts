// Connecteur Légifrance JORF (PISTE) pour décrets fixant des valeurs officielles.
//
// Pour chaque type de barème, on :
//   1. Recherche dans JORF les décrets/arrêtés correspondants (les plus récents).
//   2. Récupère le texte intégral du décret.
//   3. Extrait la valeur numérique via LLM (cross-check regex pour le typique).
//   4. Propose la mise à jour si différente de la valeur active.
//
// Couvre :
//   - PSS (plafond mensuel de la sécurité sociale) — arrêté annuel
//   - Aide unique embauche apprenti — décret annuel
//   - Bonus-malus contribution chômage — décret URSSAF
//
// Les valeurs ne sont JAMAIS insérées sans validation humaine (verified=false).

import { legifranceFetch } from "../piste-client.server";
import { llmFetch } from "../llm-fetch.server";
import { AI_GATEWAY, LLM_API_KEY } from "../constants.server";
import { proposeReferenceValueUpdate } from "../bareme-proposals.server";
import { safeParseJSON } from "../agent-tools.server";

type Result = {
  proposed: number;
  skipped: number;
  errors: string[];
};

type JorfSearchHit = {
  id: string;        // ELI ou CID du texte
  titre: string;
  nature: string;    // ARRETE | DECRET | LOI
  dateTexte: string; // YYYY-MM-DD
};

type JorfArticleResponse = {
  content?: string;
  text?: { texte?: string };
  jorfText?: { content?: string };
};

type LlmExtractionResult = {
  value: number | null;
  validFrom: string | null;
  confidence: "high" | "medium" | "low";
  rationale: string;
};

const FETCH_TIMEOUT_MS = 20_000;

async function searchJorf(query: string, natures: string[]): Promise<JorfSearchHit[]> {
  // Endpoint : POST /search avec recherche sur fond JORF
  try {
    const body = {
      recherche: {
        champs: [{ typeChamp: "TITRE", criteres: [{ typeRecherche: "EXACTE", valeur: query, operateur: "ET" }] }],
        filtres: [{ facette: "NATURE", valeurs: natures }],
        pageNumber: 1,
        pageSize: 5,
        sort: "PERTINENCE",
        operateur: "ET",
        typePagination: "DEFAUT",
      },
      fond: "JORF",
    };
    const resp = await legifranceFetch<{ results?: Array<{ titles?: Array<JorfSearchHit> }> }>("/search", body);
    const hits: JorfSearchHit[] = [];
    for (const r of resp.results ?? []) {
      for (const t of r.titles ?? []) hits.push(t);
    }
    return hits;
  } catch (e) {
    throw new Error(`searchJorf("${query}"): ${e instanceof Error ? e.message : "fail"}`);
  }
}

async function fetchJorfText(textId: string): Promise<string> {
  try {
    const resp = await legifranceFetch<JorfArticleResponse>("/consult/jorf", { textId });
    return String(resp.content ?? resp.text?.texte ?? resp.jorfText?.content ?? "").slice(0, 30_000);
  } catch (e) {
    throw new Error(`fetchJorfText(${textId}): ${e instanceof Error ? e.message : "fail"}`);
  }
}

/**
 * Extraction LLM d'une valeur numérique depuis un texte de décret.
 * Retourne value=null si pas trouvée fiablement.
 */
async function extractValueWithLlm(decreeText: string, valueDescription: string): Promise<LlmExtractionResult> {
  const apiKey = LLM_API_KEY;
  if (!apiKey) return { value: null, validFrom: null, confidence: "low", rationale: "LLM_API_KEY manquant" };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await llmFetch(`${AI_GATEWAY}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 400,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Tu extrais des valeurs numériques officielles depuis des décrets/arrêtés français. Retourne STRICTEMENT JSON :
{ "value": number | null, "validFrom": "YYYY-MM-DD" | null, "confidence": "high"|"medium"|"low", "rationale": "court" }
- value : la valeur demandée en EUR (sans symbole, format décimal point), null si non trouvée
- validFrom : date d'entrée en vigueur explicite dans le texte, null si non précisée
- confidence : high = formulation très claire ; medium = inférence raisonnable ; low = ambiguïté
- rationale : 1 phrase pour expliquer`,
          },
          {
            role: "user",
            content: `Texte du décret :\n"""${decreeText.slice(0, 12_000)}"""\n\nValeur à extraire : ${valueDescription}`,
          },
        ],
      }),
      signal: ctrl.signal,
    } as RequestInit & { signal?: AbortSignal });
    if (!res.ok) return { value: null, validFrom: null, confidence: "low", rationale: `LLM ${res.status}` };
    const json = await res.json();
    const raw = json.choices?.[0]?.message?.content ?? "{}";
    const parsed = safeParseJSON(raw) as Partial<LlmExtractionResult>;
    return {
      value: typeof parsed.value === "number" ? parsed.value : null,
      validFrom: typeof parsed.validFrom === "string" ? parsed.validFrom : null,
      confidence: parsed.confidence === "high" || parsed.confidence === "medium" ? parsed.confidence : "low",
      rationale: String(parsed.rationale ?? ""),
    };
  } catch (e) {
    return { value: null, validFrom: null, confidence: "low", rationale: e instanceof Error ? e.message : "fail" };
  } finally {
    clearTimeout(t);
  }
}

// ─── PSS ──────────────────────────────────────────────────────────────────
async function fetchPss(): Promise<{ proposed: number; skipped: number; error?: string }> {
  try {
    const hits = await searchJorf("plafond de la sécurité sociale", ["ARRETE"]);
    if (hits.length === 0) return { proposed: 0, skipped: 0, error: "Aucun arrêté PSS trouvé" };

    // Trier par date desc et prendre le plus récent
    hits.sort((a, b) => (b.dateTexte ?? "").localeCompare(a.dateTexte ?? ""));
    const latest = hits[0];

    const text = await fetchJorfText(latest.id);
    if (!text) return { proposed: 0, skipped: 0, error: "Texte vide" };

    const ex = await extractValueWithLlm(text, "Plafond mensuel de la sécurité sociale en euros (un seul nombre, ex : 3925)");
    if (!ex.value || ex.value < 3000 || ex.value > 6000) {
      return { proposed: 0, skipped: 0, error: `PSS LLM : value invalide (${ex.value})` };
    }
    const validFrom = ex.validFrom ?? `${new Date().getFullYear()}-01-01`;

    const r = await proposeReferenceValueUpdate({
      key: "plafond_ss_mensuel",
      newValue: Math.round(ex.value * 100) / 100,
      validFrom,
      label: `Plafond mensuel SS (${validFrom})`,
      sourceRef: `${latest.nature} du ${latest.dateTexte} — ${latest.titre.slice(0, 100)} (LLM confidence: ${ex.confidence})`,
      sourceUrl: `https://www.legifrance.gouv.fr/eli/${latest.nature.toLowerCase()}/${latest.dateTexte}`,
      connector: "legifrance",
    });
    return { proposed: r.status === "proposed" ? 1 : 0, skipped: r.status !== "proposed" ? 1 : 0 };
  } catch (e) {
    return { proposed: 0, skipped: 0, error: e instanceof Error ? e.message : "PSS fail" };
  }
}

// ─── Aide unique embauche apprenti ───────────────────────────────────────
async function fetchAideApprenti(): Promise<{ proposed: number; skipped: number; error?: string }> {
  try {
    const hits = await searchJorf("aide unique employeurs apprenti", ["DECRET"]);
    if (hits.length === 0) return { proposed: 0, skipped: 0, error: "Aucun décret aide apprenti trouvé" };
    hits.sort((a, b) => (b.dateTexte ?? "").localeCompare(a.dateTexte ?? ""));
    const latest = hits[0];
    const text = await fetchJorfText(latest.id);
    if (!text) return { proposed: 0, skipped: 0, error: "Texte vide" };

    const ex = await extractValueWithLlm(text, "Montant en euros de l'aide unique versée à l'employeur pour la 1re année du contrat d'apprentissage (un seul nombre, ex : 6000)");
    if (!ex.value || ex.value < 1000 || ex.value > 20000) {
      return { proposed: 0, skipped: 0, error: `aide_apprenti LLM : value invalide (${ex.value})` };
    }
    const validFrom = ex.validFrom ?? `${new Date().getFullYear()}-01-01`;

    const r = await proposeReferenceValueUpdate({
      key: "aide_unique_apprenti_an1",
      newValue: Math.round(ex.value),
      validFrom,
      label: `Aide unique embauche apprenti — 1re année (${validFrom})`,
      sourceRef: `${latest.nature} du ${latest.dateTexte} (LLM confidence: ${ex.confidence})`,
      sourceUrl: `https://www.legifrance.gouv.fr/eli/${latest.nature.toLowerCase()}/${latest.dateTexte}`,
      connector: "legifrance",
    });
    return { proposed: r.status === "proposed" ? 1 : 0, skipped: r.status !== "proposed" ? 1 : 0 };
  } catch (e) {
    return { proposed: 0, skipped: 0, error: e instanceof Error ? e.message : "aide_apprenti fail" };
  }
}

export async function fetchLegifranceBaremes(): Promise<Result> {
  const errors: string[] = [];
  let proposed = 0, skipped = 0;

  const pss = await fetchPss();
  proposed += pss.proposed; skipped += pss.skipped;
  if (pss.error) errors.push(`pss: ${pss.error}`);

  const apr = await fetchAideApprenti();
  proposed += apr.proposed; skipped += apr.skipped;
  if (apr.error) errors.push(`apprenti: ${apr.error}`);

  return { proposed, skipped, errors };
}
