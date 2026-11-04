// Numbers for the weekly planning and for "planned vs done". Pure.
import { addDays, localParts, MINUTE, zonedInstant } from "./engine.js";
import { holidaysBetween } from "./holidays.js";
import type { AppData } from "./model.js";
import { weekStart } from "./planning.js";

const DAY = 1440 * MINUTE;

/** The week to plan: next week on weekends, otherwise this one (from today). */
export function weekToPlan(data: AppData, now: number): string[] {
  const tz = data.settings.timezone;
  const { weekday } = localParts(tz, now);
  const monday = weekStart(tz, weekday === 0 || weekday === 6 ? now + 2 * DAY : now);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export interface DayPlan {
  date: string;
  minutes: number;
  critical: number;
  holiday?: string;
}

export function weekPlan(data: AppData, dates: string[]): DayPlan[] {
  const tz = data.settings.timezone;
  const holidays = holidaysBetween(dates[0] as string, dates[6] as string);
  return dates.map((date) => {
    const from = zonedInstant(tz, date, 0);
    const to = zonedInstant(tz, addDays(date, 1), 0);
    const blocks = data.plan.filter((b) => b.start >= from && b.start < to);
    return {
      date,
      minutes: blocks.reduce((s, b) => s + (b.end - b.start) / MINUTE, 0),
      critical: blocks.filter((b) => b.level === "critical").length,
      holiday: holidays.find((h) => h.date === date)?.name,
    };
  });
}

export interface PlannedDone {
  taskId: string;
  title: string;
  color?: string;
  /** Minutes planned in blocks that already ended this week. */
  planned: number;
  done: number;
}

/** This week so far: what was planned (blocks already over) and what was really done. */
export function plannedVsDone(data: AppData, now: number): PlannedDone[] {
  const tz = data.settings.timezone;
  const since = zonedInstant(tz, weekStart(tz, now), 0);
  const rows = new Map<string, PlannedDone>();
  const row = (taskId: string) => {
    let r = rows.get(taskId);
    if (!r) {
      const task = data.tasks.find((t) => t.id === taskId);
      r = {
        taskId,
        title: task?.title ?? "—",
        color: data.activities.find((a) => a.id === task?.activityId)?.color,
        planned: 0,
        done: 0,
      };
      rows.set(taskId, r);
    }
    return r;
  };
  for (const b of data.plan) {
    if (b.start >= since && b.end <= now) row(b.taskId).planned += (b.end - b.start) / MINUTE;
  }
  for (const c of data.checkIns) {
    if (c.createdAt >= since && c.createdAt <= now) row(c.taskId).done += c.minutesDone;
  }
  return [...rows.values()].sort((a, b) => b.planned - a.planned);
}
