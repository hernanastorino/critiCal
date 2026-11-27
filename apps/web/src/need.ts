import type { ScheduleResult } from "./engine.js";
import type { AppData } from "./model.js";
import { progress } from "./planning.js";

/**
 * What a task needs, in study minutes (the unit the screens speak): what the plan reserves
 * (`left`, with the learned effort ratio) and the part of it that must happen (`minimum`,
 * never above `left`). It is exactly what the planner receives (divided by the block
 * factor), so a screen, an option's label and the plan cannot name different numbers.
 */
export interface Need {
  left: number;
  minimum: number;
}

export function needOf(data: AppData, now: number, taskId: string): Need | undefined {
  const p = progress(data, now).find((x) => x.task.id === taskId);
  return (
    p && { left: p.remainingMinutes, minimum: Math.min(p.minRemainingMinutes, p.remainingMinutes) }
  );
}

/**
 * What each task lacks of its minimum in the plan, in study minutes (the plan counts block
 * time, breaks included). Only the tasks that lack some.
 */
export function shortfall(result: ScheduleResult): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of result.status) {
    if (s.minDeficit <= 0) continue;
    out.set(s.taskId, Math.ceil(s.minDeficit));
  }
  return out;
}

/**
 * Whether a plan reaches a minimum more than another: some task lacks less and none lacks
 * more. An option that does not is no way out, so it is not offered.
 */
export function improves(before: ScheduleResult, after: ScheduleResult): boolean {
  const lack = (r: ScheduleResult, id: string) =>
    r.status.find((s) => s.taskId === id)?.minDeficit ?? 0;
  const ids = new Set([...before.status, ...after.status].map((s) => s.taskId));
  const all = [...ids];
  return (
    all.some((id) => lack(after, id) < lack(before, id)) &&
    all.every((id) => lack(after, id) <= lack(before, id))
  );
}
