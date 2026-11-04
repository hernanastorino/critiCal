import { type ScheduleInput, type ScheduleResult, schedule } from "./scheduler.js";
import type { Task } from "./types.js";

export type OptionKind =
  | "drop"
  | "lower-minimum"
  | "proportional"
  | "use-free-time"
  | "minimum-only";

export interface PlanOption {
  id: string;
  kind: OptionKind;
  /** Task the option is about, if any. */
  taskId?: string;
  label: string;
  /** The schedule the option would produce. */
  result: ScheduleResult;
  /** Input to apply if chosen. */
  input: ScheduleInput;
}

function withTasks(input: ScheduleInput, tasks: Task[]): ScheduleInput {
  return { ...input, tasks };
}

/**
 * Deterministic ways out when the minimums do not fit, each previewed with its
 * own schedule. Feasible options come first; within them, least invasive first.
 */
export function infeasibilityOptions(input: ScheduleInput, result: ScheduleResult): PlanOption[] {
  if (result.feasible) return [];
  const taskById = new Map(input.tasks.map((t) => [t.id, t]));
  const short = result.status.filter((s) => s.minDeficit > 0);
  const deadlineLimit = Math.max(...short.map((s) => (taskById.get(s.taskId) as Task).deadline));
  const involved = input.tasks.filter(
    (t) => t.deadline <= deadlineLimit && t.minRemainingMinutes > 0,
  );
  const options: PlanOption[] = [];
  const add = (id: string, kind: OptionKind, label: string, next: ScheduleInput, taskId?: string) =>
    options.push({ id, kind, taskId, label, input: next, result: schedule(next) });

  if (!input.allowFreeTime) {
    add("use-free-time", "use-free-time", "Usar tiempo libre para llegar", {
      ...input,
      allowFreeTime: true,
    });
  }

  const deficit = short.reduce((sum, s) => sum + s.minDeficit, 0);
  for (const t of [...involved].sort((a, b) => a.priority - b.priority)) {
    const lowered = Math.max(0, t.minRemainingMinutes - deficit);
    // Lowering to zero is just "No hacer", which is offered below.
    if (lowered > 0)
      add(
        `lower-minimum:${t.id}`,
        "lower-minimum",
        `Dedicarle menos a ${t.title} (mínimo ${duration(lowered)})`,
        withTasks(
          input,
          input.tasks.map((x) =>
            x.id === t.id
              ? {
                  ...x,
                  minRemainingMinutes: lowered,
                  remainingMinutes: Math.min(
                    x.remainingMinutes,
                    Math.max(lowered, x.remainingMinutes - deficit),
                  ),
                }
              : x,
          ),
        ),
        t.id,
      );
    add(
      `drop:${t.id}`,
      "drop",
      `No hacer ${t.title}`,
      withTasks(
        input,
        input.tasks.filter((x) => x.id !== t.id),
      ),
      t.id,
    );
  }

  const demand = involved.reduce((sum, t) => sum + t.minRemainingMinutes, 0);
  const factor = demand > 0 ? (demand - deficit) / demand : 0;
  if (factor > 0) {
    const ids = new Set(involved.map((t) => t.id));
    add(
      "proportional",
      "proportional",
      `Un poco de todo (${Math.round(factor * 100)} % de cada mínimo)`,
      withTasks(
        input,
        input.tasks.map((t) =>
          ids.has(t.id)
            ? {
                ...t,
                minRemainingMinutes: Math.floor(t.minRemainingMinutes * factor),
                remainingMinutes: Math.floor(t.remainingMinutes * factor),
              }
            : t,
        ),
      ),
    );
  }

  return options.sort(
    (a, b) => Number(b.result.feasible) - Number(a.result.feasible) || rank(a.kind) - rank(b.kind),
  );
}

function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const ORDER: OptionKind[] = [
  "use-free-time",
  "lower-minimum",
  "proportional",
  "minimum-only",
  "drop",
];
const rank = (k: OptionKind) => ORDER.indexOf(k);

/** When minimums fit but targets do not: settle for the minimum. */
export function targetOptions(input: ScheduleInput, result: ScheduleResult): PlanOption[] {
  const short = result.status.filter((s) => s.minDeficit === 0 && s.targetDeficit > 0);
  if (short.length === 0) return [];
  const ids = new Set(short.map((s) => s.taskId));
  const next = withTasks(
    input,
    input.tasks.map((t) => (ids.has(t.id) ? { ...t, remainingMinutes: t.minRemainingMinutes } : t)),
  );
  const options: PlanOption[] = [
    {
      id: "minimum-only",
      kind: "minimum-only",
      label: "Quedarme con el mínimo",
      input: next,
      result: schedule(next),
    },
  ];
  if (!input.allowFreeTime) {
    const free = { ...input, allowFreeTime: true };
    options.push({
      id: "use-free-time",
      kind: "use-free-time",
      label: "Usar tiempo libre para llegar al objetivo",
      input: free,
      result: schedule(free),
    });
  }
  return options;
}

export interface Recommendation {
  id: "relax-context";
  message: string;
  input: ScheduleInput;
  result: ScheduleResult;
}

const freeMinutes = (r: ScheduleResult) =>
  r.blocks
    .filter((b) => b.soft && !b.frozen)
    .reduce((sum, b) => sum + (b.end - b.start) / 60_000, 0);
const deficit = (r: ScheduleResult) => r.status.reduce((sum, s) => sum + s.targetDeficit, 0);

/**
 * "Unless you want to study at 8pm, mix subjects today": compares the plan that
 * respects the context-switch rule with one that relaxes it.
 */
export function recommendations(input: ScheduleInput, result: ScheduleResult): Recommendation[] {
  const relaxedInput = { ...input, maxActivitiesPerDay: Number.POSITIVE_INFINITY };
  const relaxed = schedule(relaxedInput);
  const savedFree = freeMinutes(result) - freeMinutes(relaxed);
  const savedDeficit = deficit(result) - deficit(relaxed);
  const fixesFeasibility = !result.feasible && relaxed.feasible;
  if (savedFree <= 0 && savedDeficit <= 0 && !fixesFeasibility) return [];
  const reasons: string[] = [];
  if (fixesFeasibility) reasons.push("llegás a todos los mínimos");
  if (savedFree > 0) reasons.push(`te ahorrás ${savedFree} min de tiempo libre`);
  if (savedDeficit > 0) reasons.push(`cubrís ${savedDeficit} min más`);
  return [
    {
      id: "relax-context",
      message: `Si mezclás más materias por día, ${reasons.join(" y ")}.`,
      input: relaxedInput,
      result: relaxed,
    },
  ];
}
