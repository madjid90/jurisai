// Calculateur de délais juridiques français.
// Supporte : jours calendaires, jours ouvrés (L→V hors fériés),
// jours ouvrables (L→S hors fériés), mois (article 642 CPC),
// avec report automatique au prochain jour ouvrable si l'échéance
// tombe un samedi/dimanche/férié (art. 642 al.2 CPC).
//
// Pure functions, server-safe (utilisé dans createServerFn).

export type DelayUnit = "calendar_days" | "business_days" | "working_days" | "months" | "weeks";

export type DelayInput = {
  /** ISO date or Date – point de départ */
  startDate: string | Date;
  amount: number;
  unit: DelayUnit;
  /** art. 642 CPC : si l'échéance tombe samedi/dimanche/férié, report au prochain jour ouvrable */
  rollForward?: boolean;
};

export type DelayResult = {
  startDate: string;
  dueDate: string;
  unit: DelayUnit;
  amount: number;
  rolled: boolean;
  rollReason: string | null;
  holidaysSkipped: string[];
  rule: string;
};

// ----- Pâques (Meeus/Jones/Butcher) -----
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDaysUTC(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Jours fériés légaux français pour une année donnée (métropole). */
export function frHolidays(year: number): Set<string> {
  const easter = easterSunday(year);
  const list = [
    new Date(Date.UTC(year, 0, 1)), // Jour de l'An
    addDaysUTC(easter, 1), // Lundi de Pâques
    new Date(Date.UTC(year, 4, 1)), // Fête du Travail
    new Date(Date.UTC(year, 4, 8)), // Victoire 1945
    addDaysUTC(easter, 39), // Ascension
    addDaysUTC(easter, 50), // Lundi de Pentecôte
    new Date(Date.UTC(year, 6, 14)), // Fête nationale
    new Date(Date.UTC(year, 7, 15)), // Assomption
    new Date(Date.UTC(year, 10, 1)), // Toussaint
    new Date(Date.UTC(year, 10, 11)), // Armistice 1918
    new Date(Date.UTC(year, 11, 25)), // Noël
  ];
  return new Set(list.map(ymd));
}

function isHoliday(d: Date, cache: Map<number, Set<string>>): boolean {
  const y = d.getUTCFullYear();
  let s = cache.get(y);
  if (!s) {
    s = frHolidays(y);
    cache.set(y, s);
  }
  return s.has(ymd(d));
}

function dow(d: Date): number {
  return d.getUTCDay(); // 0 dim, 6 sam
}

function isBusinessDay(d: Date, cache: Map<number, Set<string>>): boolean {
  const w = dow(d);
  if (w === 0 || w === 6) return false;
  return !isHoliday(d, cache);
}

function isWorkingDay(d: Date, cache: Map<number, Set<string>>): boolean {
  // jours ouvrables : L à S, hors fériés
  if (dow(d) === 0) return false;
  return !isHoliday(d, cache);
}

function rollForwardToBusinessDay(
  d: Date,
  cache: Map<number, Set<string>>,
): { rolled: Date; reason: string | null; skipped: string[] } {
  const skipped: string[] = [];
  let cur = new Date(d.getTime());
  let reason: string | null = null;
  while (!isBusinessDay(cur, cache)) {
    skipped.push(ymd(cur));
    if (!reason) {
      const w = dow(cur);
      reason =
        w === 0 ? "report (dimanche)" : w === 6 ? "report (samedi)" : "report (jour férié)";
    }
    cur = addDaysUTC(cur, 1);
  }
  return { rolled: cur, reason, skipped };
}

/**
 * Calcule une échéance légale française.
 * - calendar_days : ajout brut de jours
 * - business_days : ajout de N jours ouvrés (L-V hors fériés)
 * - working_days  : ajout de N jours ouvrables (L-S hors fériés)
 * - weeks         : 7 * N jours calendaires
 * - months        : ajout en mois (même quantième, sinon dernier jour du mois)
 *
 * Application automatique de l'article 642 CPC (rollForward par défaut true)
 * pour calendar_days/weeks/months. Pour business_days/working_days, le
 * résultat est déjà un jour ouvré/ouvrable par construction.
 */
export function computeLegalDeadline(input: DelayInput): DelayResult {
  const start = typeof input.startDate === "string" ? new Date(input.startDate) : input.startDate;
  if (Number.isNaN(start.getTime())) throw new Error("startDate invalide");
  const startUTC = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const cache = new Map<number, Set<string>>();
  const rollForward = input.rollForward ?? true;
  const skipped: string[] = [];
  let due: Date;
  let rule = "";

  switch (input.unit) {
    case "calendar_days":
      due = addDaysUTC(startUTC, input.amount);
      rule = `+${input.amount} jour(s) calendaire(s)`;
      break;
    case "weeks":
      due = addDaysUTC(startUTC, input.amount * 7);
      rule = `+${input.amount} semaine(s)`;
      break;
    case "business_days": {
      let n = input.amount;
      due = startUTC;
      while (n > 0) {
        due = addDaysUTC(due, 1);
        if (isBusinessDay(due, cache)) n--;
        else skipped.push(ymd(due));
      }
      rule = `+${input.amount} jour(s) ouvré(s) (L-V hors fériés)`;
      break;
    }
    case "working_days": {
      let n = input.amount;
      due = startUTC;
      while (n > 0) {
        due = addDaysUTC(due, 1);
        if (isWorkingDay(due, cache)) n--;
        else skipped.push(ymd(due));
      }
      rule = `+${input.amount} jour(s) ouvrable(s) (L-S hors fériés)`;
      break;
    }
    case "months": {
      const m = startUTC.getUTCMonth() + input.amount;
      const targetYear = startUTC.getUTCFullYear() + Math.floor(m / 12);
      const targetMonth = ((m % 12) + 12) % 12;
      const day = startUTC.getUTCDate();
      // Si le quantième n'existe pas, prendre le dernier jour du mois
      const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
      due = new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
      rule = `+${input.amount} mois (art. 641 CPC)`;
      break;
    }
    default:
      throw new Error(`Unité inconnue : ${input.unit}`);
  }

  let rolled = false;
  let rollReason: string | null = null;
  if (rollForward && (input.unit === "calendar_days" || input.unit === "weeks" || input.unit === "months")) {
    if (!isBusinessDay(due, cache)) {
      const r = rollForwardToBusinessDay(due, cache);
      due = r.rolled;
      rolled = true;
      rollReason = `${r.reason} – art. 642 al.2 CPC`;
      skipped.push(...r.skipped);
    }
  }

  return {
    startDate: ymd(startUTC),
    dueDate: ymd(due),
    unit: input.unit,
    amount: input.amount,
    rolled,
    rollReason,
    holidaysSkipped: skipped,
    rule,
  };
}

/**
 * Helper : extrait un délai depuis une définition d'étape JSON.
 * Cherche les clés courantes : delay_amount + delay_unit, ou delay_days, ou délai en texte.
 */
export function extractStepDelay(stepDef: Record<string, unknown> | null | undefined): {
  amount: number;
  unit: DelayUnit;
} | null {
  if (!stepDef) return null;
  const amt =
    (stepDef.delay_amount as number | undefined) ??
    (stepDef.delay_days as number | undefined) ??
    (stepDef.duration_days as number | undefined);
  const rawUnit =
    (stepDef.delay_unit as string | undefined) ??
    (stepDef.delay_days !== undefined || stepDef.duration_days !== undefined ? "calendar_days" : undefined);
  if (typeof amt !== "number" || amt <= 0) return null;
  const unit = normalizeUnit(rawUnit);
  if (!unit) return null;
  return { amount: amt, unit };
}

function normalizeUnit(u: string | undefined): DelayUnit | null {
  if (!u) return "calendar_days";
  const s = u.toLowerCase().trim();
  if (s.includes("ouvré") || s.includes("ouvre") || s === "business_days") return "business_days";
  if (s.includes("ouvrable") || s === "working_days") return "working_days";
  if (s.includes("mois") || s === "months" || s === "month") return "months";
  if (s.includes("semaine") || s === "weeks" || s === "week") return "weeks";
  if (s.includes("calend") || s === "calendar_days" || s === "days" || s === "jour" || s === "jours") return "calendar_days";
  return null;
}
