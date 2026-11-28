// What the silo form checks before saving: each problem is said beside its field.
import { DEFAULTS, detectedRole } from "./calendars.js";
import { hours, parseHoursText } from "./format.js";
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
    const role = detectedRole(data, t);
    if (!role) return false;
    const d = data.preferences?.importDefaults?.[role] ?? DEFAULTS[role];
    return t.estimateMinutes !== d.estimate || t.minMinutes !== d.min;
  }).length;
}

/** The most hours one silo may hold (its minutes must fit a backup: see `backup.ts`). */
/** The most minutes one part of a silo may hold (the same for the backup: see `limits.ts`). */
export { MAX_HOURS, UNIT_MINUTES_MAX };
/** The most minutes of one session of a weekly habit: a whole day. */
export const MAX_SESSION_MINUTES = 1440;

/**
 * Minutes as the hours a field shows, the way the app writes them: «5,42» for 5 h 25, «11,5», not the fifteen digits of the
 * division. Two decimals are at most 18 s off, so reading it back gives the same minute.
 */
export const hoursField = (minutes: number): string =>
  String(Math.round((minutes / 60) * 100) / 100).replace(".", ",");

/** Hours as typed, or NaN if they are not a valid figure. */
export const typedHours = parseHoursText;

/** Hours that are 0, or so few that they round to 0 minutes («0,004»). */
export const isZeroHours = (v: string): boolean => {
  const n = typedHours(v);
  return Number.isFinite(n) && Math.round(n * 60) === 0;
};

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
 * With parts, the total is their sum (SPEC §18.18): said once, so the silo and the form
 * show the same figure. Null without parts.
 */
export function partsSummary(partsMinutes: number): string | null {
  if (partsMinutes <= 0) return null;
  return `Total ${durationLabel(partsMinutes)}, la suma de las partes.`;
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

/** What a part's parentheses may say: «90», «90 min», «90'», «2h», «1h30», «1h 30 min», «1,5h», «1:30». */
const DURATION =
  /^(\d+(?:[.,]\d+)?)\s*(?:(?:(h|hs|hora|horas|:)\s*(?:(\d{1,2})\s*(?:m|min|mins|minutos)?)?)|(?:(m|min|mins|minutos|')?))$/i;

/** Parentheses that start with a figure and say nothing but time are meant as the minutes. */
const TIME_LIKE = /^[-+]?\d[\d\s.,:]*(?:(?:h|hs|hora|horas|m|min|mins|minutos|')[\d\s.,:]*)*$/i;

const MINUTES_HELP = `Los minutos entre paréntesis: «(90)», «(90 min)», «(2h)», «(1h30)» o «(1:30)», de ${UNIT_MINUTES_MIN} a ${UNIT_MINUTES_MAX} minutos, como «Práctico 5 (60)». Después de la h van de 0 a 59.`;

/** Minutes of what a part's parentheses say, NaN when they are time but cannot be read. */
function typedMinutes(inner: string): number {
  const m = DURATION.exec(inner);
  if (!m) return Number.NaN;
  const n = Number(String(m[1]).replace(",", "."));
  if (!m[2]) return Number.isInteger(n) ? n : Number.NaN;
  // «1:30» needs its minutes; the ones after an «h» are 0–59.
  if (m[2] === ":" && m[3] === undefined) return Number.NaN;
  const extra = m[3] === undefined ? 0 : Number(m[3]);
  return extra <= 59 ? Math.round(n * 60) + extra : Number.NaN;
}

/**
 * A new part typed as «Nombre (tiempo)»: its title and minutes, or what is wrong. Only a
 * final «(…)» that starts with a figure is the time («(90)», «(90 min)», «(2h)», «(1h30)»;
 * one that is not a whole number of 1 to 60000 minutes is an error); any other parenthesis
 * («Parte B (opcional)») is part of the name.
 */
export function parseUnit(
  text: string,
): { title: string; minutes: number } | { error: string } | null {
  if (!text.trim()) return null;
  const m = text.match(/^(.*?)\s*\(\s*([^()]*?)\s*\)\s*$/);
  // Full-width digits («２h») are read as the ordinary ones.
  const inner = (m?.[2] ?? "").normalize("NFKC");
  const timed = !!m && TIME_LIKE.test(inner);
  const title = (timed ? (m?.[1] ?? "") : text).trim();
  if (title.length > TITLE_MAX) {
    return { error: `El nombre de la parte tiene como máximo ${TITLE_MAX} caracteres.` };
  }
  if (!timed) return { title, minutes: 60 };
  const minutes = typedMinutes(inner);
  // «(-30)» or «(1,5)» are minutes typed wrong, not a name.
  if (!Number.isInteger(minutes) || minutes < UNIT_MINUTES_MIN || minutes > UNIT_MINUTES_MAX) {
    return { error: MINUTES_HELP };
  }
  return title ? { title, minutes } : { error: "Poné el nombre de la parte antes de los minutos." };
}

/** Parts that add up to more than a delivery may hold (said in the list of parts). */
export const partsTotalProblem = (partsMinutes: number): string | null =>
  partsMinutes > MAX_HOURS * 60 ? `Las partes suman más de ${MAX_HOURS} h.` : null;

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

/**
 * A routine session is placed in whole slots (SPEC §18.14): when its minutes are not a
 * multiple of the slot, a one-line note says what the plan will really reserve.
 */
export function slotNote(minutes: number, slotMinutes: number): string | null {
  if (!Number.isFinite(minutes) || minutes <= 0 || slotMinutes <= 0) return null;
  if (minutes % slotMinutes === 0) return null;
  const reserved = Math.ceil(minutes / slotMinutes) * slotMinutes;
  return `Se planifica en bloques de ${slotMinutes} min: ${reserved} min`;
}

/** Minutes as a routine list writes them: «30 min», «2h» (whole hours from 1). */
const sessionLabel = (m: number) => (m >= 60 && m % 60 === 0 ? `${m / 60}h` : `${m} min`);

/**
 * A routine session as the list shows it: what it takes in the plan (whole slots), and when
 * that is not what was asked, «30 min (pediste 15)». A multiple of the slot is just «90 min».
 */
export function sessionShown(minutes: number, slotMinutes: number): string {
  if (!(slotMinutes > 0) || minutes % slotMinutes === 0) return `${minutes} min`;
  const reserved = Math.ceil(minutes / slotMinutes) * slotMinutes;
  const asked = minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}`;
  return `${sessionLabel(reserved)} (pediste ${asked}${asked.endsWith("h") ? "" : " min"})`;
}
