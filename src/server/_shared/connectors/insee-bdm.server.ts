// Connecteur INSEE BDM (Banque de Données Macroéconomiques).
// API publique JSON-stat : https://api.insee.fr/series/BDM/V1/data/SERIES_BDM/{series_id}
//
// Pas d'auth requise pour les séries publiques.
// Documentation : https://www.insee.fr/fr/information/2868055
//
// Indices récupérés (utilisés pour révision loyers/salaires/contrats) :
//   - ICC  = Indice du coût de la construction (série 000008630)         → révision loyers commerciaux
//   - IRL  = Indice de référence des loyers (série 010605198)            → révision loyers habitation
//   - ILAT = Indice des loyers des activités tertiaires (série 010534768) → bureaux/commerces non-soumis ILC
//   - ILC  = Indice des loyers commerciaux (série 010534765)             → baux commerciaux
//   - ICHT-TS = Indice du coût horaire du travail tous salariés (série 010606336)

import { proposeReferenceValueUpdate } from "../bareme-proposals.server";

const INSEE_BASE = "https://api.insee.fr/series/BDM/V1";
const FETCH_TIMEOUT_MS = 15_000;

type Series = {
  id: string;
  key: string;       // clé dans reference_values
  label: string;
  url: string;       // page INSEE pour le source_url
};

const SERIES: Series[] = [
  { id: "000008630", key: "icc",      label: "Indice du coût de la construction (ICC)",
    url: "https://www.insee.fr/fr/statistiques/serie/000008630" },
  { id: "010605198", key: "irl",      label: "Indice de référence des loyers (IRL)",
    url: "https://www.insee.fr/fr/statistiques/serie/010605198" },
  { id: "010534768", key: "ilat",     label: "Indice des loyers des activités tertiaires (ILAT)",
    url: "https://www.insee.fr/fr/statistiques/serie/010534768" },
  { id: "010534765", key: "ilc",      label: "Indice des loyers commerciaux (ILC)",
    url: "https://www.insee.fr/fr/statistiques/serie/010534765" },
  { id: "010606336", key: "icht_ts",  label: "Indice du coût horaire du travail (ICHT-TS)",
    url: "https://www.insee.fr/fr/statistiques/serie/010606336" },
];

type CdtnFetchResult = {
  proposed: number;
  skipped: number;
  errors: string[];
};

type InseeJsonStat = {
  dataSets?: Array<{
    observations?: Record<string, [number]>;
  }>;
  structure?: {
    dimensions?: {
      observation?: Array<{
        id: string;
        values?: Array<{ id: string }>;
      }>;
    };
  };
};

/**
 * Récupère la dernière observation d'une série BDM.
 * Format JSON-stat normalisé : observations indexées par offset, dimension TIME_PERIOD.
 */
async function fetchLatestObservation(seriesId: string): Promise<{ value: number; period: string } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${INSEE_BASE}/data/SERIES_BDM/${seriesId}?lastNObservations=1`,
      {
        headers: {
          "User-Agent": "JurisAI-bareme-watcher/1.0",
          "Accept": "application/vnd.sdmx.data+json;version=1.0.0-wd",
        },
        signal: ctrl.signal,
      },
    );
    if (!res.ok) throw new Error(`INSEE ${seriesId}: HTTP ${res.status}`);
    const json = (await res.json()) as InseeJsonStat;

    const obs = json.dataSets?.[0]?.observations ?? {};
    const keys = Object.keys(obs);
    if (keys.length === 0) return null;

    const lastKey = keys[keys.length - 1];
    const value = obs[lastKey]?.[0];
    if (value == null || !Number.isFinite(value)) return null;

    // Index du dernier point dans la dimension TIME_PERIOD
    const timeDim = json.structure?.dimensions?.observation?.find((d) => d.id === "TIME_PERIOD");
    const timeIdx = Number(lastKey.split(":").pop() ?? 0);
    const period = timeDim?.values?.[timeIdx]?.id ?? "unknown";

    return { value, period };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Convertit une période INSEE (YYYY, YYYY-Mxx, YYYY-Qx) en date YYYY-MM-DD (1er jour de la période).
 */
function periodToDate(period: string): string {
  // Trimestriel YYYY-Qx
  const qMatch = period.match(/^(\d{4})-Q([1-4])$/);
  if (qMatch) {
    const month = (Number(qMatch[2]) - 1) * 3 + 1;
    return `${qMatch[1]}-${String(month).padStart(2, "0")}-01`;
  }
  // Mensuel YYYY-Mxx
  const mMatch = period.match(/^(\d{4})-M(\d{1,2})$/);
  if (mMatch) {
    return `${mMatch[1]}-${String(Number(mMatch[2])).padStart(2, "0")}-01`;
  }
  // Annuel YYYY
  if (/^\d{4}$/.test(period)) return `${period}-01-01`;
  // Fallback
  return new Date().toISOString().slice(0, 10);
}

export async function fetchInseeIndices(): Promise<CdtnFetchResult> {
  const errors: string[] = [];
  let proposed = 0, skipped = 0;

  for (const s of SERIES) {
    try {
      const obs = await fetchLatestObservation(s.id);
      if (!obs) {
        errors.push(`${s.key}: aucune observation`);
        continue;
      }
      const validFrom = periodToDate(obs.period);
      const r = await proposeReferenceValueUpdate({
        key: s.key,
        newValue: Math.round(obs.value * 100) / 100,
        validFrom,
        label: `${s.label} (${obs.period})`,
        sourceRef: `INSEE BDM série ${s.id} — observation ${obs.period}`,
        sourceUrl: s.url,
        connector: "insee",
      });
      if (r.status === "proposed") proposed++;
      else skipped++;
    } catch (e) {
      errors.push(`${s.key}: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  return { proposed, skipped, errors };
}
