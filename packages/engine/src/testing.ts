import { zonedInstant } from "./time.js";
import type { Activity, DaySettings, Settings, Task } from "./types.js";

export const TZ = "America/Montevideo";

/** Local instant in Montevideo, e.g. at("2026-11-02", "10:30"). */
export function at(date: string, hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return zonedInstant(TZ, date, h * 60 + m);
}

export const day: DaySettings = {
  wake: 8 * 60,
  bed: 0,
  meals: [
    { start: 13 * 60, end: 14 * 60 },
    { start: 21 * 60, end: 21 * 60 + 30 },
  ],
  freeFrom: 19 * 60 + 30,
};

export const settings: Settings = {
  timezone: TZ,
  week: Array.from({ length: 7 }, () => day),
  slotMinutes: 30,
  travelMarginMinutes: 10,
  maxActivitiesPerDay: 2,
  warnSlackMinutes: 240,
};

export function activity(id: string, over: Partial<Activity> = {}): Activity {
  return {
    id,
    name: id,
    color: "#000",
    academic: true,
    maxSessionMinutes: 120,
    minBlockMinutes: 60,
    ...over,
  };
}

export function task(
  id: string,
  activityId: string,
  deadline: number,
  over: Partial<Task> = {},
): Task {
  return {
    id,
    activityId,
    title: id,
    deadline,
    remainingMinutes: 120,
    minRemainingMinutes: 60,
    priority: 1,
    ...over,
  };
}
