// What the Scriptable widget shows: the silos, ordered by urgency.

import type { AppData } from "../../src/model.js";
import { progress, refreshPlan } from "../../src/planning.js";

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

export function widgetSilos(data: AppData, now: number): WidgetSilo[] {
  const levels = new Map(refreshPlan(data, now).result.status.map((s) => [s.taskId, s.level]));
  return progress(data, now)
    .filter((p) => p.totalMinutes > 0)
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

export async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
