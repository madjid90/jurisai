// Extraction d'entités juridiques basique à partir d'un texte OCR.
// Heuristiques regex (rapide, déterministe). Ces entités servent ensuite
// au context-linking automatique vers les dossiers existants.

export type ExtractedEntity = {
  type:
    | "person"
    | "company"
    | "siren"
    | "siret"
    | "iban"
    | "email"
    | "phone"
    | "date"
    | "amount"
    | "dossier_ref"
    | "address"
    | "other";
  raw: string;
  normalized?: string;
  start?: number;
  end?: number;
};

const RX_SIREN = /\b(\d{3}[\s.]?\d{3}[\s.]?\d{3})\b/g;
const RX_SIRET = /\b(\d{3}[\s.]?\d{3}[\s.]?\d{3}[\s.]?\d{5})\b/g;
const RX_IBAN = /\b([A-Z]{2}\d{2}(?:[\s]?[A-Z0-9]{4}){3,7})\b/g;
const RX_EMAIL = /\b([\w.+-]+@[\w-]+\.[\w.-]+)\b/g;
const RX_PHONE = /\b(?:\+33|0)\s?[1-9](?:[\s.-]?\d{2}){4}\b/g;
const RX_DATE_FR = /\b(\d{1,2}[\s/.-]\d{1,2}[\s/.-]\d{2,4})\b/g;
const RX_AMOUNT = /\b(\d{1,3}(?:[\s.]\d{3})*(?:,\d{2})?)\s?(?:€|EUR|euros?)\b/gi;
const RX_DOSSIER_REF = /\b(?:dossier|réf(?:érence)?|ref|n°|numéro)\s*:?\s*([A-Z0-9][\w/-]{2,20})\b/gi;

function pushAll(
  out: ExtractedEntity[],
  text: string,
  rx: RegExp,
  type: ExtractedEntity["type"],
  normalize?: (raw: string) => string,
) {
  let m: RegExpExecArray | null;
  rx.lastIndex = 0;
  while ((m = rx.exec(text)) !== null) {
    const raw = (m[1] ?? m[0]).trim();
    if (!raw) continue;
    out.push({
      type,
      raw,
      normalized: normalize ? normalize(raw) : raw.toLowerCase(),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
}

export function extractEntities(text: string): ExtractedEntity[] {
  if (!text || text.length < 5) return [];
  const out: ExtractedEntity[] = [];
  const stripSpaces = (s: string) => s.replace(/[\s.]/g, "");

  pushAll(out, text, RX_SIRET, "siret", stripSpaces);
  pushAll(out, text, RX_SIREN, "siren", stripSpaces);
  pushAll(out, text, RX_IBAN, "iban", (s) => s.replace(/\s/g, "").toUpperCase());
  pushAll(out, text, RX_EMAIL, "email", (s) => s.toLowerCase());
  pushAll(out, text, RX_PHONE, "phone", stripSpaces);
  pushAll(out, text, RX_DATE_FR, "date");
  pushAll(out, text, RX_AMOUNT, "amount");
  pushAll(out, text, RX_DOSSIER_REF, "dossier_ref");

  // Dédup sur (type, normalized)
  const seen = new Set<string>();
  return out.filter((e) => {
    const k = `${e.type}::${e.normalized ?? e.raw}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
