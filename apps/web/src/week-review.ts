// Numbers for the weekly planning and for "planned vs done". Pure.
import { addDays, MINUTE, type PlanBlock, zonedInstant } from "./engine.js";
import { holidaysBetween } from "./holidays.js";
import type { AppData } from "./model.js";
import {
  blockFactor,
  blockStartOf,
  endOfWeek,
  nextWeekStart,
  standingCheckIns,
  studyMinutes,
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

export interface PlannedDone {
  taskId: string;
  title: string;
  color?: string;
  /** A routine (Gym...) rather than a materia's task. */
  routine?: boolean;
  /**
   * Study minutes in the plan's blocks of this real week (Monday to Sunday), those already
   * over and those still ahead. Only blocks: logging progress never changes it (SPEC §18.14).
   */
  planned: number;
  /** Study minutes really done, like the silos (breaks are not work). */
  done: number;
}

/** This real week: what the plan has in blocks and what was really done. */
export function plannedVsDone(data: AppData, now: number): PlannedDone[] {
  const tz = data.settings.timezone;
  const since = zonedInstant(tz, weekStart(tz, now), 0);
  const until = endOfWeek(tz, now);
  const rows = new Map<string, PlannedDone>();
  const row = (taskId: string) => {
    let r = rows.get(taskId);
    if (!r) {
      const task = data.tasks.find((t) => t.id === taskId);
      r = {
        taskId,
        title: task?.title ?? "—",
        color: data.activities.find((a) => a.id === task?.activityId)?.color,
        routine:
          data.activities.find((a) => a.id === task?.activityId)?.kind === "rutina" || undefined,
        planned: 0,
        done: 0,
      };
      rows.set(taskId, r);
    }
    return r;
  };
  for (const b of data.plan) {
    if (b.start < since || b.start >= until) continue;
    row(b.taskId).planned += (b.end - b.start) / MINUTE / factorOf(data, b);
  }
  for (const c of standingCheckIns(data)) {
    // No upper bound: the screen's clock ticks once a minute, so what was just logged is
    // stamped a little after it.
    if (blockStartOf(data, c) < since) continue;
    const r = row(c.taskId);
    r.done += studyMinutes(c);
  }
  for (const r of rows.values()) {
    r.planned = Math.round(r.planned);
    r.done = Math.round(r.done);
  }
  return [...rows.values()].sort((a, b) => b.planned - a.planned);
}

/** Block time per study minute of a block's task (weekly silos count block time). */
function factorOf(data: AppData, b: PlanBlock): number {
  const task = data.tasks.find((t) => t.id === b.taskId);
  if (task?.kind === "habit") return 1;
  return blockFactor(data.activities.find((a) => a.id === (task?.activityId ?? b.activityId)));
}
