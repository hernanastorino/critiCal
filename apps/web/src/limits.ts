// Limits shared by the app and its server functions.

/** Longest event address the travel function accepts. */
export const SPOT_TEXT_MAX = 200;

/** Earliest deadline accepted: older dates are a typo, not a task. */
export const DEADLINE_MIN = Date.UTC(2000, 0, 1);
/** Deadlines may go up to the end of the year this many years ahead. Year 9999 overflows the database's timestamps. */
export const DEADLINE_YEARS_AHEAD = 5;

/** The last year a deadline may fall in (the date field's max and the error say it). */
export const deadlineMaxYear = (now: number) =>
  new Date(now).getUTCFullYear() + DEADLINE_YEARS_AHEAD;

/**
 * A deadline the app and the database can hold: a real instant from 2000 to the end of
 * `deadlineMaxYear`. The upper bound has a day of slack so 31/12 23:59 passes in any zone.
 */
export function deadlineInRange(at: number, now: number): boolean {
  return Number.isFinite(at) && at >= DEADLINE_MIN && at < Date.UTC(deadlineMaxYear(now) + 1, 0, 2);
}

/**
 * A typed calendar date ("2031-12-31", "2031-12-31T23:59") whose year the plan accepts:
 * 2000 to `deadlineMaxYear`, by the date as written, whatever the time zone.
 */
export function dateYearInRange(value: string, now: number): boolean {
  const year = Number(/^(\d{4,6})-\d{2}-\d{2}/.exec(value)?.[1]);
  return year >= 2000 && year <= deadlineMaxYear(now);
}

/** A real calendar day, not just its shape (2026-02-30 is not one). */
export function isRealDate(x: unknown): x is string {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const d = new Date(`${x}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === x;
}

/** The least a part of a silo may take: a part of 0 min would never plan. */
export const UNIT_MINUTES_MIN = 1;
/**
 * The most a part of a silo may take: the whole of the longest silo (1000 h), since «1 tema»
 * of a 30 h silo is one part of 30 h. One limit for the form, the topics log, the program
 * and the backup.
 */
export const UNIT_MINUTES_MAX = 60_000;

/** The most hours one silo may hold (what its field accepts). */
export const MAX_HOURS = 1000;
/** The most minutes of one silo (its estimate and its minimum): the same for the form, the program and the backup. */
export const ESTIMATE_MINUTES_MAX = MAX_HOURS * 60;
/** What a backup carries as a silo's minutes: more than the form lets you type, so old data still imports. */
export const BACKUP_MINUTES_MAX = 100_000;
/** The most sessions a week of a weekly habit: one-hour sessions all week (a materia's «Estudio semanal» of 168 h). */
export const SESSIONS_PER_WEEK_MAX = 168;

/** What the database stores as an id (`uuid` columns). */
export const isUuid = (x: unknown): x is string =>
  typeof x === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);

/** Longest name of a materia or rutina (their fields stop at it). */
export const NAME_MAX = 60;
/** Longest name of a task («Parcial Física I», «Entrega 3»). */
export const TITLE_MAX = 80;
/** What a backup may carry: more than the app lets you type, so old data still imports. */
export const BACKUP_TEXT_MAX = 300;
/** Longest address of a place (what the travel function reads of it). */
export const ADDRESS_MAX = SPOT_TEXT_MAX;
/** Longest text of the «Alias» field (all of them, with their commas). */
export const ALIASES_FIELD_MAX = 500;

/**
 * Text without the characters that turn the writing direction (U+202A–U+202E, U+2066–U+2069):
 * pasted into a name they flip the text around it, the list and the notices that quote it.
 */
export const stripBidi = (s: string) => s.replace(/[‪-‮⁦-⁩]/g, "");

/** Nothing to read in it: empty, spaces, or only characters that draw nothing (zero width). */
export const isBlank = (s: string) =>
  s.replace(/[\s\u00ad\u200b-\u200f\u2060\u2066-\u2069\ufeff]/g, "") === "";

/**
 * What is wrong with a typed calendar date, or null when it is fine (or empty): a day
 * that does not exist, or a year the plan does not take (it would freeze or overflow).
 */
export function dateError(value: string, now: number): string | null {
  if (!value) return null;
  if (!isRealDate(value)) return "Esa fecha no existe.";
  return dateYearInRange(value, now)
    ? null
    : `Elegí una fecha entre el 1/1/2000 y el 31/12/${deadlineMaxYear(now)}.`;
}
