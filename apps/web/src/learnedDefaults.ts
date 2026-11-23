// Defaults that learn (SPEC §18.1): a new delivery starts from the hours of the user's own
// earlier ones of the same kind (parcial or entrega), and of the same materia when it has any.
import type { AppTask } from "./model.js";

export interface LearnedHours {
  estimateMinutes: number;
  minMinutes: number;
  /** Where it comes from: the materia's own earlier ones, or all of that kind. */
  source: "subject" | "kind";
  /** How many earlier deliveries it was taken from. */
  from: number;
}

/** The middle value; with an even count, the mean of the two middle ones to the quarter hour. */
export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid] as number;
  return Math.round(((s[mid - 1] as number) + (s[mid] as number)) / 2 / 15) * 15;
}

/** Earlier deliveries that can teach: real deliverables of the same kind, not dropped. */
function teachers(tasks: AppTask[], exam: boolean, skip?: string): AppTask[] {
  return tasks.filter(
    (t) =>
      t.id !== skip &&
      t.kind === "deliverable" &&
      !t.study &&
      t.status !== "dropped" &&
      !!t.exam === exam &&
      t.estimateMinutes > 0 &&
      t.minMinutes > 0,
  );
}

/**
 * The hours to propose for a new delivery, or null with no history (the fixed ones then
 * stand). The median of the materia's earlier ones of the same kind when there are any,
 * else of all that kind. The minimum never goes above the estimate.
 */
export function learnedHours(
  tasks: AppTask[],
  exam: boolean,
  activityId?: string,
  skip?: string,
): LearnedHours | null {
  const kind = teachers(tasks, exam, skip);
  const own = activityId ? kind.filter((t) => t.activityId === activityId) : [];
  const [pool, source] = own.length > 0 ? ([own, "subject"] as const) : ([kind, "kind"] as const);
  if (pool.length === 0) return null;
  const estimateMinutes = median(pool.map((t) => t.estimateMinutes));
  const minMinutes = Math.min(estimateMinutes, median(pool.map((t) => t.minMinutes)));
  return { estimateMinutes, minMinutes, source, from: pool.length };
}

/** Said under the fields: where the proposed hours come from. */
export function learnedNote(l: LearnedHours, exam: boolean): string {
  const what = exam ? "parciales" : "entregas";
  return l.source === "subject"
    ? `Como tus ${what} anteriores de esta materia.`
    : `Como tus ${what} anteriores.`;
}
