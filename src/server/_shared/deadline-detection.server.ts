// Détection d'échéances dans un texte de document.
// Heuristique : recherche d'une date FR proche d'un mot-clé d'échéance.
// Renvoie uniquement les échéances FUTURES.

const KEYWORDS = [
  "échéance", "echeance", "expire", "expiration", "préavis", "preavis",
  "avant le", "au plus tard", "délai", "delai", "renouvellement",
  "fin de contrat", "résiliation", "resiliation", "à payer avant",
  "paiement avant", "audience", "convocation",
];

const RX_DATE = /\b(\d{1,2})[\s./-](\d{1,2})[\s./-](\d{2,4})\b/g;

export type DetectedDeadline = {
  date: string; // ISO yyyy-mm-dd
  context: string;
  keyword: string;
};

function parseFrDate(d: string, m: string, y: string): string | null {
  const day = parseInt(d, 10);
  const month = parseInt(m, 10);
  let year = parseInt(y, 10);
  if (year < 100) year += 2000;
  if (!day || !month || !year || month > 12 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

export function detectDeadlines(text: string): DetectedDeadline[] {
  if (!text || text.length < 20) return [];
  const lower = text.toLowerCase();
  const out: DetectedDeadline[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set<string>();

  let m: RegExpExecArray | null;
  RX_DATE.lastIndex = 0;
  while ((m = RX_DATE.exec(text)) !== null) {
    const iso = parseFrDate(m[1], m[2], m[3]);
    if (!iso || iso <= today) continue;
    const start = Math.max(0, m.index - 80);
    const end = Math.min(text.length, m.index + m[0].length + 40);
    const window = lower.slice(start, end);
    const kw = KEYWORDS.find((k) => window.includes(k));
    if (!kw) continue;
    const key = `${iso}::${kw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      date: iso,
      context: text.slice(start, end).trim().replace(/\s+/g, " "),
      keyword: kw,
    });
  }
  return out;
}
