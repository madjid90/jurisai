/**
 * Utilitaires de validation partagés (S23, A11, A14).
 */

/** Validation SIRET (14 chiffres + algorithme de Luhn). */
export function isValidSiret(input: unknown): boolean {
  if (typeof input !== "string") return false;
  const digits = input.replace(/\D/g, "");
  if (digits.length !== 14) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(digits[i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Validation SIREN (9 chiffres + Luhn). */
export function isValidSiren(input: unknown): boolean {
  if (typeof input !== "string") return false;
  const digits = input.replace(/\D/g, "");
  if (digits.length !== 9) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(digits[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * Échappe les caractères spéciaux de PostgreSQL ILIKE (%, _, \).
 * À utiliser avant toute interpolation utilisateur dans `.ilike()`.
 */
export function escapeIlike(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Valide une date ISO (YYYY-MM-DD) en rejetant les dates inexistantes
 * (ex. 2025-02-31). Retourne le Date ou null.
 */
export function parseStrictDate(input: unknown): Date | null {
  if (typeof input !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) return null;
  return dt;
}
