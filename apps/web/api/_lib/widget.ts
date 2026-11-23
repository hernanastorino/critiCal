// What the Scriptable widget shows: the silos, ordered by urgency.

import { hours } from "../../src/format.js";
import { inboxRows } from "../../src/inbox.js";
import type { AppData } from "../../src/model.js";
import { focusWeekAt, progress, refreshPlan, splitPastSilos } from "../../src/planning.js";

export interface WidgetSilo {
  title: string;
  color: string;
  remainingMinutes: number;
  totalMinutes: number;
  level: "ok" | "warn" | "critical";
  deadline: number;
  /** Next planned block, if any. */
  next?: number;
}

/**
 * The silos in force: what the Silos view shows (nothing due before the week in focus)
 * minus the deliverables whose deadline already passed. Weekly habits stay: they are
 * counted in the week in focus.
 */
export function widgetSilos(data: AppData, now: number): WidgetSilo[] {
  const levels = new Map(refreshPlan(data, now).result.status.map((s) => [s.taskId, s.level]));
  const focus = focusWeekAt(data, now);
  const { current } = splitPastSilos(
    progress(data, now, focus).filter((p) => p.totalMinutes > 0),
    data.settings.timezone,
    focus,
  );
  return current
    .filter((p) => p.task.kind === "habit" || p.deadline > now)
    .sort((a, b) => a.deadline - b.deadline)
    .map((p) => ({
      title: p.task.title,
      color: data.activities.find((a) => a.id === p.task.activityId)?.color ?? "#888888",
      remainingMinutes: Math.round(p.remainingMinutes),
      totalMinutes: Math.round(p.totalMinutes),
      level: levels.get(p.task.id) ?? "ok",
      deadline: p.deadline,
      next: data.plan
        .filter((b) => b.taskId === p.task.id && b.end > now)
        .sort((a, b) => a.start - b.start)[0]?.start,
    }));
}

/** One line of what the widget draws: the server decides, the script only paints. */
export interface WidgetRow {
  title: string;
  /** Short text under or next to the title. */
  detail: string;
  color: string;
  level: "ok" | "warn" | "critical";
  /** 0–1 of the silo still to do (tanks only). */
  ratio?: number;
}

export interface WidgetView {
  /** «silos» while there are silos in force; otherwise the Bandeja. */
  mode: "silos" | "inbox";
  /** «tanks» draws a tank per row; «list» draws lines. */
  style: "tanks" | "list";
  rows: WidgetRow[];
  /** What to say when there are no rows. */
  empty: string;
  /** Minutes after which the script asks again (iOS decides in the end). */
  refreshMinutes: number;
}

export const WIDGET_REFRESH_MINUTES = 5;
export const WIDGET_EMPTY = "Todo al día ✓";

export function widgetView(data: AppData, now: number, silos = widgetSilos(data, now)): WidgetView {
  const refreshMinutes = WIDGET_REFRESH_MINUTES;
  if (silos.length > 0) {
    return {
      mode: "silos",
      style: "tanks",
      rows: silos.map((s) => ({
        title: s.title,
        detail: hours(s.remainingMinutes),
        color: s.color,
        level: s.level,
        ratio: s.totalMinutes > 0 ? Math.min(1, s.remainingMinutes / s.totalMinutes) : 0,
      })),
      empty: WIDGET_EMPTY,
      refreshMinutes,
    };
  }
  return {
    mode: "inbox",
    style: "list",
    rows: inboxRows(data, now).map((r) => ({
      title: r.title,
      detail: r.detail,
      color: r.color ?? "#888888",
      level: "ok" as const,
    })),
    empty: WIDGET_EMPTY,
    refreshMinutes,
  };
}

export async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
