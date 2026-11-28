import type { ScheduleResult } from "./engine.js";
import { hours } from "./format.js";
import { type AppData, type AppTask, taskTotal } from "./model.js";
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
 * The minimum of the task as it is edited («Mínimo 6h»): the saved one, never above the
 * total (a saved one that is, is shown cut to it), the same in «Repartir tiempo» and the form.
 */
export const editedMinimum = (
  task: Pick<AppTask, "minMinutes" | "estimateMinutes"> & Partial<Pick<AppTask, "kind" | "units">>,
): number => {
  const total = taskTotal({ kind: "deliverable", units: [], ...task });
  return total > 0 ? Math.min(task.minMinutes, total) : task.minMinutes;
};

/**
 * What the ficha, the block's sheet and the Bandeja say next to «Faltan»: what is left to
 * reach the minimum (never above what is left), «mínimo cubierto» once it is, nothing for a
 * task with no minimum. The minimum the task keeps is only said where it is edited.
 */
export function minimumNote(need: Need, task?: Pick<AppTask, "minMinutes">): string {
  if (task && task.minMinutes <= 0) return "";
  if (need.minimum <= 0) return "mínimo cubierto";
  return `para el mínimo, ${hours(Math.min(need.minimum, need.left))}`;
}

/** «Faltan 5h (para el mínimo, 3h)»: what a task lacks, in one line. */
export function lackText(need: Need, task?: Pick<AppTask, "minMinutes">): string {
  const note = minimumNote(need, task);
  return `Faltan ${hours(need.left)}${note && ` (${note})`}`;
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
