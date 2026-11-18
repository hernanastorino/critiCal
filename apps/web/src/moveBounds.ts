import { localParts, MINUTE, zonedInstant } from "./engine.js";
import type { AppData, AppTask } from "./model.js";
import { wakingDay } from "./planning.js";

/** Where a block may sit on a day, in minutes since that day's midnight. */
export interface MoveBounds {
  /** Earliest start: waking up plus the morning that is never planned. */
  from: number;
  /** Latest end: bedtime, or «nothing to study from» when that comes first. */
  to: number;
  /** The task's deadline on this day's scale (can be negative or past 1440); null if none. */
  deadline: number | null;
}

/** The limits a manual move (key or drag) keeps on `date` for a task due at `deadline`. */
export function moveBounds(
  data: AppData,
  now: number,
  date: string,
  task: AppTask | undefined,
): MoveBounds {
  const tz = data.settings.timezone;
  const { deadline } = task ?? {};
  // «Nada de estudio desde» is about academic work: a gym session may go after it.
  const academic = data.activities.find((a) => a.id === task?.activityId)?.academic ?? true;
  const midnight = zonedInstant(tz, date, 0);
  const { wake, bed } = wakingDay(data, now, date);
  const day = data.settings.week[localParts(tz, zonedInstant(tz, date, 720)).weekday];
  const from = wake + Math.max(0, day?.morningMinutes ?? 0);
  // A «nothing to study from» that falls before waking up is ignored, not a closed day.
  const free = academic && day && day.freeFrom > from ? day.freeFrom : bed;
  return {
    from,
    to: Math.min(bed, free),
    deadline: deadline === undefined ? null : (deadline - midnight) / MINUTE,
  };
}

/** Why a block of `minutes` starting at `minute` cannot sit within `bounds`; null when it can. */
export function moveRefusal(bounds: MoveBounds, minute: number, minutes: number): string | null {
  if (bounds.deadline !== null && minute + minutes > bounds.deadline) {
    return "Después de la entrega no";
  }
  if (minute < bounds.from || minute + minutes > bounds.to) return "Fuera de tu horario de estudio";
  return null;
}
