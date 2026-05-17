// Connecteur BOSS (Bulletin Officiel de la Sécurité Sociale).
// boss.gouv.fr publie les cotisations/exonérations URSSAF en HTML structuré.
// Pas d'API REST publique → on fetch les pages clés et on extrait via LLM.
//
// Pages cibles :
//   - Réduction générale (ex-Fillon) → coefficient T, plafond 1,6 SMIC
//   - Forfait social → taux par cas (8 %, 16 %, 20 %)
//   - LODEOM Outre-mer → plafonds par strate
//
// Le HTML brut est volumineux : on strip les tags + on envoie au LLM
// qui retourne un JSON normalisé. Toujours verified=false côté admin.

import { llmFetch } from "../llm-fetch.server";
import { AI_GATEWAY, LLM_API_KEY } from "../constants.server";
import { proposeReferenceValueUpdate } from "../bareme-proposals.server";
import { safeParseJSON } from "../agent-tools.server";

type Result = { proposed: number; skipped: number; errors: string[] };

type BossTarget = {
  key: string;
  label: string;
  description: string; // pour LLM
  url: string;         // page BOSS
  unit: "PERCENT" | "EUR" | "RATIO";
  validRange: [number, number];
};

const TARGETS: BossTarget[] = [
  {
    key: "reduction_generale_T_moins_50",
    label: "Coefficient T réduction générale (entreprise <50 salariés)",
    description: "Coefficient T maximal de la réduction générale des cotisations patronales pour une entreprise de moins de 50 salariés (un nombre décimal, ex: 0.3194 ou 0.3193)",
    url: "https://boss.gouv.fr/portail/accueil/exonerations-et-allegements/reduction-generale-des-cotisat.html",
    unit: "RATIO",
    validRange: [0.25, 0.35],
  },
  {
    key: "reduction_generale_T_plus_50",
    label: "Coefficient T réduction générale (entreprise ≥50 salariés)",
    description: "Coefficient T maximal de la réduction générale pour une entreprise de 50 salariés ou plus (un nombre décimal, ex: 0.3234 ou 0.3233)",
    url: "https://boss.gouv.fr/portail/accueil/exonerations-et-allegements/reduction-generale-des-cotisat.html",
    unit: "RATIO",
    validRange: [0.25, 0.35],
  },
  {
    key: "reduction_generale_plafond_smic",
    label: "Plafond réduction générale (en multiples de SMIC)",
    description: "Multiple du SMIC en deçà duquel s'applique la réduction générale (un nombre, ex: 1.6)",
    url: "https://boss.gouv.fr/portail/accueil/exonerations-et-allegements/reduction-generale-des-cotisat.html",
    unit: "RATIO",
    validRange: [1.4, 2.5],
  },
  {
    key: "forfait_social_taux_standard",
    label: "Forfait social taux standard",
    description: "Taux du forfait social applicable aux sommes assujetties (taux normal, généralement 20%) (un nombre en pourcentage, ex: 20)",
    url: "https://boss.gouv.fr/portail/accueil/cotisations-et-contributions-soci/forfait-social.html",
    unit: "PERCENT",
    validRange: [5, 25],
  },
];

const FETCH_TIMEOUT_MS = 20_000;

async function fetchHtmlAsText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "JurisAI-bareme-watcher/1.0 (contact@jurisai.fr)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`BOSS ${url}: HTTP ${res.status}`);
    const html = await res.text();
    return stripHtml(html);
  } finally {
    clearTimeout(t);
  }
}

/**
 * Suppression naïve des balises HTML + nettoyage entités HTML courantes.
 * Pas besoin d'un parseur complet — on garde juste assez de structure
 * pour que le LLM comprenne (titres, paragraphes, tableaux).
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h[1-6]|tr|div)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&euro;/g, "€")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type LlmExtraction = {
  value: number | null;
  validFrom: string | null;
  confidence: "high" | "medium" | "low";
  rationale: string;
};

async function extractValue(text: string, target: BossTarget): Promise<LlmExtraction> {
  if (!LLM_API_KEY) return { value: null, validFrom: null, confidence: "low", rationale: "LLM_API_KEY manquant" };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await llmFetch(`${AI_GATEWAY}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${LLM_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 300,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Tu extrais une valeur officielle depuis une page du Bulletin Officiel de la Sécurité Sociale (BOSS). Retourne STRICTEMENT JSON :
{ "value": number | null, "validFrom": "YYYY-MM-DD" | null, "confidence": "high"|"medium"|"low", "rationale": "court" }
- value : la valeur demandée (sans symbole, format décimal point). Si plusieurs valeurs présentes, prendre la plus récente actuellement en vigueur (ne pas confondre avec valeurs historiques tracées dans des tableaux).
- validFrom : date d'entrée en vigueur si mentionnée explicitement, sinon "${new Date().getFullYear()}-01-01"
- confidence : high = formulation explicite univoque ; medium = inférence raisonnable ; low = ambiguïté
- rationale : 1 phrase`,
          },
          {
            role: "user",
            content: `Page BOSS (extrait nettoyé) :\n"""${text.slice(0, 12_000)}"""\n\nValeur à extraire : ${target.description}`,
          },
        ],
      }),
      signal: ctrl.signal,
    } as RequestInit & { signal?: AbortSignal });
    if (!res.ok) return { value: null, validFrom: null, confidence: "low", rationale: `LLM ${res.status}` };
    const json = await res.json();
    const parsed = safeParseJSON(json.choices?.[0]?.message?.content ?? "{}") as Partial<LlmExtraction>;
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

// Cache du HTML pour éviter de re-fetch la même URL plusieurs fois dans la même passe
const htmlCache = new Map<string, string>();

async function getCachedHtml(url: string): Promise<string> {
  const cached = htmlCache.get(url);
  if (cached !== undefined) return cached;
  const html = await fetchHtmlAsText(url);
  htmlCache.set(url, html);
  return html;
}

export async function fetchBossUrssafRates(): Promise<Result> {
  const errors: string[] = [];
  let proposed = 0, skipped = 0;
  htmlCache.clear();

  for (const target of TARGETS) {
    try {
      const text = await getCachedHtml(target.url);
      if (!text || text.length < 500) {
        errors.push(`${target.key}: page BOSS vide ou trop courte`);
        continue;
      }
      const ex = await extractValue(text, target);
      const [vMin, vMax] = target.validRange;
      if (ex.value == null || ex.value < vMin || ex.value > vMax) {
        errors.push(`${target.key}: valeur invalide (${ex.value}, attendu [${vMin}-${vMax}])`);
        continue;
      }
      const validFrom = ex.validFrom ?? `${new Date().getFullYear()}-01-01`;

      const r = await proposeReferenceValueUpdate({
        key: target.key,
        newValue: target.unit === "RATIO" ? Math.round(ex.value * 10000) / 10000 : Math.round(ex.value * 100) / 100,
        validFrom,
        label: `${target.label} (BOSS, ${validFrom})`,
        sourceRef: `BOSS.gouv.fr (LLM confidence: ${ex.confidence}, scrapé le ${new Date().toISOString().slice(0, 10)})`,
        sourceUrl: target.url,
        connector: "boss",
      });
      r.status === "proposed" ? proposed++ : skipped++;
    } catch (e) {
      errors.push(`${target.key}: ${e instanceof Error ? e.message : "fail"}`);
    }
  }

  return { proposed, skipped, errors };
}
