// What the silo form checks before saving: each problem is said beside its field.
import { DEFAULTS, eventRole } from "./calendars.js";
import { hours } from "./format.js";
import { MAX_HOURS, TITLE_MAX, UNIT_MINUTES_MAX, UNIT_MINUTES_MIN } from "./limits.js";
import type { AppData } from "./model.js";
import { validRoutine } from "./subjects.js";

/** The most hours a detected kind may be given (more would not fit a backup). */
export const MAX_DETECTED_HOURS = 200;

/** What is wrong with the hours and minimum typed for a detected kind, and in which field. */
export function detectedProblem(
  estimate: string,
  min: string,
): { field: "estimate" | "min"; text: string } | null {
  const own = hoursProblem(estimate, true);
  if (own) return { field: "estimate", text: own };
  if (isZeroHours(estimate)) {
    return { field: "estimate", text: "Las horas no pueden ser 0: poné cuánto planificar." };
  }
  if (typedHours(estimate) > MAX_DETECTED_HOURS) {
    return { field: "estimate", text: `Hasta ${MAX_DETECTED_HOURS} h.` };
  }
  const low = minimumProblem(min, typedHours(estimate));
  return low ? { field: "min", text: low } : null;
}

/** How many detected tasks «Volver todo lo detectado a estas horas» would change. */
export function detectedToReset(data: AppData): number {
  return data.tasks.filter((t) => {
    const event = t.sourceEventId ? data.events.find((e) => e.id === t.sourceEventId) : undefined;
    const role = event ? eventRole(data, event) : undefined;
    if (role !== "parcial" && role !== "entrega" && role !== "presentacion") return false;
    const d = data.preferences?.importDefaults?.[role] ?? DEFAULTS[role];
    return t.estimateMinutes !== d.estimate || t.minMinutes !== d.min;
  }).length;
}

/** The most hours one silo may hold (its minutes must fit a backup: see `backup.ts`). */
/** The most minutes one part of a silo may hold (the same for the backup: see `limits.ts`). */
export { MAX_HOURS, UNIT_MINUTES_MAX };
/** The most minutes of one session of a weekly habit: a whole day. */
export const MAX_SESSION_MINUTES = 1440;

/** A plain non-negative figure («2», «1,5»): no signs, letters or exponents. */
const figure = (v: string) => /^\s*\d+(?:[.,]\d+)?\s*$/.test(v);

/** Hours as typed, or NaN if they are not a valid figure. */
export const typedHours = (v: string): number =>
  figure(v) ? Number(v.replace(",", ".")) : Number.NaN;

/** Hours that are 0, or so few that they round to 0 minutes («0,004»). */
export const isZeroHours = (v: string): boolean => {
  const n = typedHours(v);
  return Number.isFinite(n) && Math.round(n * 60) === 0;
};

/** Minutes as hours in a field, the way the app writes them: «4», «11,5». */
export const hoursField = (minutes: number): string => String(minutes / 60).replace(".", ",");

/** What is wrong with hours typed in a field, if anything (`positive`: 0 is not accepted). */
export function hoursProblem(v: string, positive = false): string | null {
  const n = typedHours(v);
  if (Number.isFinite(n) && n <= MAX_HOURS) return null;
  const from = positive ? "más de 0" : "0";
  return `Poné horas de ${from} a ${MAX_HOURS}, solo cifras (1,5 sirve; negativos no).`;
}

/** What is wrong with a delivery's estimate: not a figure, too long, or nothing to do (0 h, no parts). */
export function estimateProblem(v: string, partsMinutes: number): string | null {
  const own = hoursProblem(v, partsMinutes === 0) ?? partsProblem(v, partsMinutes);
  if (own) return own;
  return isZeroHours(v) && partsMinutes === 0
    ? "Las horas estimadas no pueden ser 0: poné cuánto pensás que lleva."
    : null;
}

/** Minutes as the rest of the app writes them: «2h», «1h30» or «45m». */
export const durationLabel = hours;

/**
 * What the parts add up to beside the estimate, so a silo showing less than the estimate
 * (what is left is measured by the parts) is understood. Null without parts or figures.
 */
export function partsSummary(estimate: string, partsMinutes: number): string | null {
  const n = typedHours(estimate);
  if (!Number.isFinite(n) || partsMinutes <= 0) return null;
  return `Partes: ${durationLabel(partsMinutes)} de ${durationLabel(Math.round(n * 60))} estimadas.`;
}

/**
 * Hours typed below what the parts add up to: said, not raised on its own (the parts are
 * the work; a 0 next to 10 h of parts would save 10 h behind the figure shown).
 */
export function partsProblem(v: string, partsMinutes: number): string | null {
  const n = typedHours(v);
  if (!Number.isFinite(n) || partsMinutes <= 0 || Math.round(n * 60) >= partsMinutes) return null;
  return `Las partes suman ${durationLabel(partsMinutes)}: poné esas horas o más, o quitá partes.`;
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

/**
 * A new part typed as «Nombre (minutos)»: its title and minutes, or what is wrong. Only a
 * final «(n)» is the minutes (a figure that is not a whole number of 1 to 1440 is an
 * error); any other parenthesis («Parte B (opcional)») is part of the name.
 */
export function parseUnit(
  text: string,
): { title: string; minutes: number } | { error: string } | null {
  if (!text.trim()) return null;
  const m = text.match(/^(.*?)\s*\(\s*([-+]?\d+(?:[.,]\d+)?)\s*\)\s*$/);
  const title = (m ? (m[1] ?? "") : text).trim();
  if (title.length > TITLE_MAX) {
    return { error: `El nombre de la parte tiene como máximo ${TITLE_MAX} caracteres.` };
  }
  if (!m) return { title, minutes: 60 };
  const minutes = Number(m[2]);
  // «(-30)» or «(1,5)» are minutes typed wrong, not a name.
  if (!/^\d+$/.test(m[2] ?? "") || minutes < UNIT_MINUTES_MIN || minutes > UNIT_MINUTES_MAX) {
    return {
      error: `Los minutos entre paréntesis son un número entero de ${UNIT_MINUTES_MIN} a ${UNIT_MINUTES_MAX}, como «Práctico 5 (60)».`,
    };
  }
  return title ? { title, minutes } : { error: "Poné el nombre de la parte antes de los minutos." };
}

/** The most a weekly habit may add up to when the week's waking time is not known. */
export const MAX_HABIT_WEEK_MINUTES = 100 * 60;

/** Minutes awake in a week of the settings (wake to bed, each day). */
export const awakeWeekMinutes = (week: readonly { wake: number; bed: number }[]): number =>
  week.reduce((n, d) => n + (d.bed <= d.wake ? d.bed + 1440 : d.bed) - d.wake, 0);

/** A whole number as typed («3»): no decimals, signs or letters. */
const whole = (v: string): number => (/^\s*\d+\s*$/.test(v) ? Number(v) : Number.NaN);

/**
 * What is wrong with a weekly habit's times and minutes, each said for its own field.
 * Times × minutes must fit in `weekMinutes` (the week's waking time); a routine's habit also
 * keeps Rutinas' limits (`routine`).
 */
export function habitProblems(
  times: string,
  minutes: string,
  weekMinutes: number,
  routine: boolean,
): { times: string | null; minutes: string | null } {
  const t = whole(times);
  const m = whole(minutes);
  const timesOk = t >= 1 && t <= 14;
  const minutesOk = m >= 1 && m <= MAX_SESSION_MINUTES;
  const room =
    weekMinutes > 0 ? Math.min(weekMinutes, MAX_HABIT_WEEK_MINUTES) : MAX_HABIT_WEEK_MINUTES;
  return {
    times: timesOk ? null : "Poné de 1 a 14 veces por semana, en cifras enteras.",
    minutes: minutesOk
      ? habitTotalProblem(timesOk ? t : Number.NaN, m, room, routine)
      : `Poné de 1 a ${MAX_SESSION_MINUTES} minutos por vez, en cifras enteras.`,
  };
}

/** What is wrong with `times` × `minutes` as a whole, given what fits in a week. */
function habitTotalProblem(times: number, minutes: number, room: number, routine: boolean) {
  if (!Number.isFinite(times)) return null;
  if (routine && !validRoutine(times, minutes)) {
    return "Una rutina va hasta 6 h por vez y 40 h por semana.";
  }
  return times * minutes > room
    ? `No entra en una semana: ${times} × ${minutes} min son ${durationLabel(times * minutes)} y en una semana entran ${Math.floor(room / 60)} h.`
    : null;
}
