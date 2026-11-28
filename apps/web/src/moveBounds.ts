import { localParts, MINUTE, type PlanBlock, weekdayOf, zonedInstant } from "./engine.js";
import { weekdayLong } from "./format.js";
import type { AppData, AppTask } from "./model.js";
import { isRoutine, pinBlock, refreshPlan, wakingDay } from "./planning.js";

/** Where a block may sit on a day, in minutes since that day's midnight. */
export interface MoveBounds {
  /** Earliest start: waking up plus the morning that is never planned. */
  from: number;
  /** Latest end: bedtime, or «nothing to study from» when that comes first. */
  to: number;
  /** The task's deadline on this day's scale (can be negative or past 1440); null if none. */
  deadline: number | null;
  /** The task's title, for the refusal to name it. */
  title?: string;
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
    ...(task?.title && { title: task.title }),
  };
}

/** Why a block of `minutes` starting at `minute` cannot sit within `bounds`; null when it can. */
export function moveRefusal(bounds: MoveBounds, minute: number, minutes: number): string | null {
  if (bounds.deadline !== null && minute + minutes > bounds.deadline) {
    return `Después de la entrega${bounds.title ? ` de ${bounds.title}` : ""} no`;
  }
  if (minute < bounds.from || minute + minutes > bounds.to) return "Fuera de tu horario de estudio";
  return null;
}

/** «los domingos», «los lunes»: the weekday in the plural, as a routine says it does not go. */
const plural = (day: string) => (day.endsWith("o") ? `${day}s` : day);

/**
 * Why a routine's block cannot be pinned at `start`: its valid hours (SPEC §5) say it does
 * not go that day («No ese día»), or pinned there the plan would not keep it. Null when it
 * can: other blocks, and a franja that is only a preference, stay where they are put.
 */
export function pinRefusal(
  data: AppData,
  now: number,
  block: PlanBlock,
  start: number,
): string | null {
  const task = data.tasks.find((t) => t.id === block.taskId);
  if (!task || !isRoutine(data, task)) return null;
  const tz = data.settings.timezone;
  const hours = data.activities.find((a) => a.id === task.activityId)?.validHours;
  if (hours?.days?.[weekdayOf(localParts(tz, start).date)] === null) {
    return `${task.title} no va los ${plural(weekdayLong(tz, start))}: vuelve a su lugar`;
  }
  // Whatever else would drop it from the plan: it goes back instead of vanishing.
  const pin = pinBlock(block, start);
  const next = { ...data, pins: [...(data.pins ?? []).filter((p) => p.id !== block.id), pin] };
  const kept = refreshPlan(next, now).plan.some((b) => b.id === pin.id);
  return kept ? null : `${task.title} no entra ahí: vuelve a su lugar`;
}
