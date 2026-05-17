// Connecteur fiscal : récupère les taux IS, TVA et barème IR depuis le CGI
// (Code général des impôts) via l'API Légifrance, et extrait les valeurs via LLM.
//
// Sources :
//   - Art. 219 CGI (taux IS standard 25 %, taux réduit PME 15 % jusqu'à 42 500 €)
//   - Art. 278 CGI (TVA taux normal 20 %)
//   - Art. 278-0 bis CGI (TVA taux 5,5 %)
//   - Art. 278 bis CGI (TVA taux 10 %)
//   - Art. 281 quater CGI (TVA taux 2,1 %)
//
// Le barème IR change chaque année (loi de finances) → traité séparément
// en recherchant la dernière LF dans JORF.

import { legifranceFetch } from "../piste-client.server";
import { llmFetch } from "../llm-fetch.server";
import { AI_GATEWAY, LLM_API_KEY } from "../constants.server";
import { proposeReferenceValueUpdate } from "../bareme-proposals.server";
import { safeParseJSON } from "../agent-tools.server";

type Result = { proposed: number; skipped: number; errors: string[] };

type FiscalRate = {
  key: string;            // ex: "tva_taux_normal"
  label: string;
  description: string;    // pour le LLM, ce qu'il doit extraire
  articleId: string;      // ELI ou id CGI
  unit: "PERCENT" | "EUR";
  validRange: [number, number]; // sanity check (min, max)
};

const FISCAL_TARGETS: FiscalRate[] = [
  {
    key: "is_taux_standard",
    label: "Taux normal de l'impôt sur les sociétés",
    description: "Taux normal de l'IS applicable aux bénéfices des sociétés (un seul nombre en pourcentage, ex: 25)",
    articleId: "LEGIARTI000044980912", // art. 219 CGI — id stable récent
    unit: "PERCENT",
    validRange: [10, 50],
  },
  {
    key: "is_taux_reduit_pme",
    label: "Taux réduit IS pour PME (< 42 500 € bénéfice)",
    description: "Taux réduit IS pour PME sur la fraction de bénéfice inférieure à 42 500 € (un seul nombre en pourcentage, ex: 15)",
    articleId: "LEGIARTI000044980912",
    unit: "PERCENT",
    validRange: [10, 30],
  },
  {
    key: "tva_taux_normal",
    label: "TVA taux normal",
    description: "Taux normal de la TVA en France métropolitaine (un seul nombre en pourcentage, ex: 20)",
    articleId: "LEGIARTI000033813763", // art. 278 CGI
    unit: "PERCENT",
    validRange: [15, 25],
  },
  {
    key: "tva_taux_reduit_10",
    label: "TVA taux réduit 10 %",
    description: "Taux réduit TVA à 10 % (un seul nombre en pourcentage, ex: 10)",
    articleId: "LEGIARTI000041464800", // art. 278 bis CGI (à vérifier)
    unit: "PERCENT",
    validRange: [5, 15],
  },
  {
    key: "tva_taux_reduit_5_5",
    label: "TVA taux réduit 5,5 %",
    description: "Taux super réduit TVA à 5,5 % (un seul nombre en pourcentage, ex: 5.5)",
    articleId: "LEGIARTI000046983886", // art. 278-0 bis CGI
    unit: "PERCENT",
    validRange: [2, 10],
  },
  {
    key: "tva_taux_super_reduit_2_1",
    label: "TVA taux particulier 2,1 %",
    description: "Taux particulier TVA à 2,1 % (presse, médicaments remboursés…) (un seul nombre, ex: 2.1)",
    articleId: "LEGIARTI000038689686", // art. 281 quater CGI
    unit: "PERCENT",
    validRange: [1, 5],
  },
];

const FETCH_TIMEOUT_MS = 20_000;

type LegifranceArticleResponse = {
  article?: { texte?: string; texteHtml?: string; dateDebut?: number };
  texte?: string;
};

async function fetchArticleText(articleId: string): Promise<{ text: string; dateDebut: string | null }> {
  const resp = await legifranceFetch<LegifranceArticleResponse>("/consult/getArticle", { id: articleId });
  const text = String(resp.article?.texte ?? resp.article?.texteHtml ?? resp.texte ?? "").slice(0, 25_000);
  const dateDebut = resp.article?.dateDebut ? new Date(resp.article.dateDebut).toISOString().slice(0, 10) : null;
  return { text, dateDebut };
}

type LlmExtraction = {
  value: number | null;
  confidence: "high" | "medium" | "low";
  rationale: string;
};

async function extractRate(articleText: string, target: FiscalRate): Promise<LlmExtraction> {
  if (!LLM_API_KEY) return { value: null, confidence: "low", rationale: "LLM_API_KEY manquant" };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await llmFetch(`${AI_GATEWAY}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${LLM_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 250,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Tu extrais un taux fiscal officiel depuis le texte d'un article du Code général des impôts. Retourne STRICTEMENT JSON : { "value": number | null, "confidence": "high"|"medium"|"low", "rationale": "court" }
- value : la valeur demandée (sans symbole, format décimal point). Si plusieurs valeurs possibles, prendre celle en vigueur actuellement (la plus récente non barrée).
- confidence : high = formulation explicite univoque ; medium = inférence ; low = ambiguïté
- rationale : 1 phrase`,
          },
          {
            role: "user",
            content: `Texte de l'article :\n"""${articleText.slice(0, 10_000)}"""\n\nValeur à extraire : ${target.description}`,
          },
        ],
      }),
      signal: ctrl.signal,
    } as RequestInit & { signal?: AbortSignal });
    if (!res.ok) return { value: null, confidence: "low", rationale: `LLM ${res.status}` };
    const json = await res.json();
    const parsed = safeParseJSON(json.choices?.[0]?.message?.content ?? "{}") as Partial<LlmExtraction>;
    return {
      value: typeof parsed.value === "number" ? parsed.value : null,
      confidence: parsed.confidence === "high" || parsed.confidence === "medium" ? parsed.confidence : "low",
      rationale: String(parsed.rationale ?? ""),
    };
  } catch (e) {
    return { value: null, confidence: "low", rationale: e instanceof Error ? e.message : "fail" };
  } finally {
    clearTimeout(t);
  }
}

export async function fetchBofipFiscalRates(): Promise<Result> {
  const errors: string[] = [];
  let proposed = 0, skipped = 0;

  for (const target of FISCAL_TARGETS) {
    try {
      const { text, dateDebut } = await fetchArticleText(target.articleId);
      if (!text) {
        errors.push(`${target.key}: texte article vide`);
        continue;
      }
      const ex = await extractRate(text, target);
      const [vMin, vMax] = target.validRange;
      if (ex.value == null || ex.value < vMin || ex.value > vMax) {
        errors.push(`${target.key}: valeur invalide (${ex.value}, attendu [${vMin}-${vMax}])`);
        continue;
      }
      const validFrom = dateDebut ?? `${new Date().getFullYear()}-01-01`;

      const r = await proposeReferenceValueUpdate({
        key: target.key,
        newValue: Math.round(ex.value * 100) / 100,
        validFrom,
        label: `${target.label} (CGI, ${validFrom})`,
        sourceRef: `CGI art. ${target.articleId} via Légifrance (LLM confidence: ${ex.confidence})`,
        sourceUrl: `https://www.legifrance.gouv.fr/codes/article_lc/${target.articleId}`,
        connector: "bofip",
      });
      r.status === "proposed" ? proposed++ : skipped++;
    } catch (e) {
      errors.push(`${target.key}: ${e instanceof Error ? e.message : "fail"}`);
    }
  }

  return { proposed, skipped, errors };
}
