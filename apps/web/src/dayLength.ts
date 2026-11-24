import { hours, parseClock } from "./format.js";

/** The shortest and longest awake day «Hoy» takes (the SPEC sets no limit; see §4). */
const MIN_AWAKE = 4 * 60;
const MAX_AWAKE = 22 * 60;

/**
 * Hours awake between waking up and going to bed ("HH:MM"); a bedtime at or before the
 * wake-up is after midnight, as the planner reads it.
 */
export function awakeMinutes(wake: string, bed: string): number {
  const w = parseClock(wake) ?? 0;
  const b = parseClock(bed) ?? 0;
  return b <= w ? b + 1440 - w : b - w;
}

/** «3h59», «22h01», «23h»: the exact length, so the edge never contradicts itself. */
export const awakeText = hours;

/** An error for a day that is too short or too long to plan, or null when it is fine. */
export function awakeProblem(wake: string, bed: string): string | null {
  // Read as everywhere else: «7» is 07:00; «25:99» or an empty field is not a time.
  if (parseClock(wake) === null || parseClock(bed) === null) return "Hora inválida.";
  const awake = awakeMinutes(wake, bed);
  if (awake >= MIN_AWAKE && awake <= MAX_AWAKE) return null;
  return `De ${wake} a ${bed} estás despierto ${awakeText(awake)}: el día tiene que tener entre 4 y 22 h despierto. Revisá a qué hora te levantaste y a qué hora te acostás.`;
}
