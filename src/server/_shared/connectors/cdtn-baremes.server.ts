// Connecteur Code du Travail Numérique (CDTN) pour barèmes officiels.
// API publique : https://code.travail.gouv.fr/api
//
// Données récupérées :
//   - SMIC horaire + mensuel (modeles/smic)
//   - Indemnité légale de licenciement (paramètres dans modeles)
//   - Périodes de prescription (intégrées dans le code, stables — pas updatées via API)
//
// Pas d'authentification requise. Rate limit raisonnable (~100 req/min).
// Source officielle maintenue par le Ministère du Travail.

import { proposeReferenceValueUpdate } from "../bareme-proposals.server";

const CDTN_BASE = "https://code.travail.gouv.fr/api/v1";
const FETCH_TIMEOUT_MS = 15_000;

type CdtnFetchResult = {
  proposed: number;
  skipped: number;
  errors: string[];
};

async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "JurisAI-bareme-watcher/1.0", "Accept": "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`CDTN ${url}: HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * SMIC : endpoint /modeles/smic retourne typiquement
 *   { value: 12.02, hourly: 12.02, monthly: 1823.04, dateEffet: "2026-01-01", source: "..." }
 * Le schéma exact varie — on est défensif sur le parsing.
 */
async function fetchSmic(): Promise<{ proposed: number; skipped: number; error?: string }> {
  try {
    // Tentative 1 : endpoint dédié SMIC (si exposé)
    let data: Record<string, unknown> | null = null;
    try {
      data = (await fetchJson(`${CDTN_BASE}/modeles/smic`)) as Record<string, unknown>;
    } catch {
      // Fallback : recherche dans modeles
      try {
        data = (await fetchJson(`${CDTN_BASE}/search?q=smic+horaire&source=modeles`)) as Record<string, unknown>;
      } catch {
        // ignore, on essaiera l'URL alternative
      }
    }

    if (!data) {
      return { proposed: 0, skipped: 0, error: "CDTN SMIC : aucune source accessible" };
    }

    // Extraction défensive — l'API peut retourner différents formats
    const hourly = Number(data.hourly ?? data.smicHoraire ?? data.value ?? 0);
    const monthly = Number(data.monthly ?? data.smicMensuel ?? hourly * 151.67);
    const dateEffet = String(data.dateEffet ?? data.effective_date ?? data.valid_from ?? new Date().toISOString().slice(0, 10));
    const sourceUrl = String(data.source ?? data.url ?? "https://code.travail.gouv.fr/outils/simulateur-embauche");

    if (!hourly || hourly < 8 || hourly > 25) {
      return { proposed: 0, skipped: 0, error: `CDTN SMIC : valeur horaire suspecte (${hourly})` };
    }

    let proposed = 0, skipped = 0;
    const sourceRef = `CDTN api.code.travail.gouv.fr (récupéré le ${new Date().toISOString().slice(0, 10)})`;

    const r1 = await proposeReferenceValueUpdate({
      key: "smic_horaire",
      newValue: hourly,
      validFrom: dateEffet,
      label: `SMIC horaire brut (CDTN, ${dateEffet})`,
      sourceRef,
      sourceUrl,
      connector: "cdtn",
    });
    r1.status === "proposed" ? proposed++ : skipped++;

    const r2 = await proposeReferenceValueUpdate({
      key: "smic_mensuel",
      newValue: Math.round(monthly * 100) / 100,
      validFrom: dateEffet,
      label: `SMIC mensuel brut 35h (CDTN, ${dateEffet})`,
      sourceRef,
      sourceUrl,
      connector: "cdtn",
    });
    r2.status === "proposed" ? proposed++ : skipped++;

    return { proposed, skipped };
  } catch (e) {
    return { proposed: 0, skipped: 0, error: e instanceof Error ? e.message : "fetchSmic failed" };
  }
}

/**
 * Indemnité légale de licenciement : taux et tranches définis par R.1234-2.
 * Stables depuis 2017 (1/4 mois jusqu'à 10 ans, 1/3 au-delà).
 * Pas vraiment "updaté" mais on peut proposer la valeur du facteur 0.25/0.3333 si jamais.
 *
 * NB : ces taux sont dans le Code, l'API CDTN ne les expose pas en tant que tels.
 * On fait juste un check de présence — sinon on n'a rien à proposer.
 */
async function fetchIndemniteLegale(): Promise<{ proposed: number; skipped: number; error?: string }> {
  // Le modèle CDTN "indemnite-licenciement" calcule, il n'expose pas un coefficient.
  // Les coefficients R.1234-2 sont stables — pas de proposition à faire.
  // On retourne juste 0/0 sans erreur pour signaler que c'est "à jour par construction".
  return { proposed: 0, skipped: 1 };
}

export async function fetchCdtnBaremes(): Promise<CdtnFetchResult> {
  const errors: string[] = [];
  let proposed = 0, skipped = 0;

  const smic = await fetchSmic();
  proposed += smic.proposed; skipped += smic.skipped;
  if (smic.error) errors.push(`smic: ${smic.error}`);

  const indem = await fetchIndemniteLegale();
  proposed += indem.proposed; skipped += indem.skipped;
  if (indem.error) errors.push(`indemnite: ${indem.error}`);

  return { proposed, skipped, errors };
}
