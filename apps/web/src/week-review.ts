// Numbers for the weekly planning and for "planned vs done". Pure.
import { addDays, MINUTE, zonedInstant } from "./engine.js";
import { holidaysBetween } from "./holidays.js";
import type { AppData } from "./model.js";
import {
  blockStartOf,
  endOfWeek,
  nextWeekStart,
  progress,
  shownTotal,
  standingCheckIns,
  weekStart,
} from "./planning.js";

/** The week to plan: always next week, Monday to Sunday, whatever day it is today. */
export function weekToPlan(data: AppData, now: number): string[] {
  const monday = nextWeekStart(data.settings.timezone, now);
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

export interface WeekLeft {
  taskId: string;
  title: string;
  color?: string;
  /** A routine (Gym...) rather than a materia's task. */
  routine?: boolean;
  /** What is left of it, the same figure as its silo's «faltan» (SPEC §18.17). */
  left: number;
  /** The hours given to it (to the week, for a weekly silo): moving a block never changes them. */
  assigned: number;
}

/**
 * This real week, what is left of each task and what was assigned to it. A silo starts full
 * and empties with progress: «2h30 / 3h». Only tasks with a block in the week or progress
 * logged in it, like the plan's reading before.
 */
export function weekLeft(data: AppData, now: number): WeekLeft[] {
  const tz = data.settings.timezone;
  const since = zonedInstant(tz, weekStart(tz, now), 0);
  const until = endOfWeek(tz, now);
  const involved = new Set(
    data.plan.filter((b) => b.start >= since && b.start < until).map((b) => b.taskId),
  );
  for (const c of standingCheckIns(data)) {
    if (blockStartOf(data, c) >= since) involved.add(c.taskId);
  }
  return progress(data, now)
    .filter((p) => involved.has(p.task.id) && shownTotal(p) > 0)
    .map((p) => {
      const activity = data.activities.find((a) => a.id === p.task.activityId);
      return {
        taskId: p.task.id,
        title: p.task.title,
        color: activity?.color,
        routine: activity?.kind === "rutina" || undefined,
        left: Math.round(p.remainingMinutes),
        assigned: Math.round(shownTotal(p)),
      };
    })
    .sort((a, b) => b.assigned - a.assigned);
}
