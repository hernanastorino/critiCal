// What the silo form checks before saving: each problem is said beside its field.

/** The most hours one silo may hold (its minutes must fit a backup: see `backup.ts`). */
export const MAX_HOURS = 1000;
/** The most minutes one part of a silo may hold: a whole day. */
export const MAX_UNIT_MINUTES = 1440;

/** A plain non-negative figure («2», «1,5»): no signs, letters or exponents. */
const figure = (v: string) => /^\s*\d+(?:[.,]\d+)?\s*$/.test(v);

/** Hours as typed, or NaN if they are not a valid figure. */
export const typedHours = (v: string): number =>
  figure(v) ? Number(v.replace(",", ".")) : Number.NaN;

/** What is wrong with hours typed in a field, if anything. */
export function hoursProblem(v: string): string | null {
  const n = typedHours(v);
  if (Number.isFinite(n) && n <= MAX_HOURS) return null;
  return `Poné horas de 0 a ${MAX_HOURS}, solo cifras (1,5 sirve; negativos no).`;
}

/**
 * What is wrong with the minimum, given the estimate it must not exceed (the larger of the
 * typed hours and what the parts add up to). Only said once both are valid figures.
 */
export function minimumProblem(minimum: string, estimateHours: number): string | null {
  const own = hoursProblem(minimum);
  if (own) return own;
  return typedHours(minimum) > estimateHours
    ? "El mínimo no puede ser mayor que las horas estimadas."
    : null;
}

/** A new part typed as «Nombre (minutos)»: its title and minutes, or what is wrong. */
export function parseUnit(
  text: string,
): { title: string; minutes: number } | { error: string } | null {
  if (!text.trim()) return null;
  const m = text.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (!m) return { title: text.trim(), minutes: 60 };
  const raw = (m[2] ?? "").trim();
  const minutes = Number(raw);
  if (!/^\d+$/.test(raw) || minutes < 1 || minutes > MAX_UNIT_MINUTES) {
    return {
      error: `Los minutos entre paréntesis son un número entero de 1 a ${MAX_UNIT_MINUTES}, como «Práctico 5 (60)».`,
    };
  }
  const title = (m[1] ?? "").trim();
  return title ? { title, minutes } : { error: "Poné el nombre de la parte antes de los minutos." };
}
