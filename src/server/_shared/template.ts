// G5 — Helper partagé d'interpolation `{{var}}` utilisé par documents,
// workflows, agent intent actions et generation. Une seule implémentation
// pour garantir un comportement cohérent (clés manquantes, normalisation).

export type TemplateValues = Record<string, unknown>;

const TOKEN_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;

/** Convertit n'importe quelle valeur en string sûre pour interpolation. */
function asString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

/**
 * Remplace les tokens `{{key}}` (avec espaces optionnels, points et tirets dans la clé)
 * par les valeurs fournies. Si `keepUnknown=true`, les tokens sans correspondance
 * sont laissés tels quels (utile pour signaler des variables manquantes au validateur).
 * Sinon ils sont remplacés par chaîne vide.
 */
export type FillTemplateOptions = {
  /** Si true, garde le token `{{key}}` quand la valeur est absente. */
  keepUnknown?: boolean;
  /** Remplacement personnalisé pour les clés absentes (prioritaire sur keepUnknown). */
  onMissing?: (key: string) => string;
};

export function fillTemplate(
  body: string,
  values: TemplateValues,
  options: FillTemplateOptions = {},
): string {
  if (!body) return "";
  return body.replace(TOKEN_RE, (match, key: string) => {
    if (key in values) {
      const v = values[key];
      if (v === undefined || v === null || v === "") {
        if (options.onMissing) return options.onMissing(key);
        return options.keepUnknown ? match : "";
      }
      return asString(v);
    }
    if (options.onMissing) return options.onMissing(key);
    return options.keepUnknown ? match : "";
  });
}

/** Liste les clés `{{var}}` référencées dans un template. */
export function extractTemplateKeys(body: string): string[] {
  if (!body) return [];
  const seen = new Set<string>();
  for (const m of body.matchAll(TOKEN_RE)) seen.add(m[1]);
  return [...seen];
}

/** Retourne les variables référencées mais absentes des valeurs fournies. */
export function findMissingTemplateVars(
  body: string,
  values: TemplateValues,
): string[] {
  return extractTemplateKeys(body).filter((k) => !(k in values));
}
