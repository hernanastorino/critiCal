import { visibleEvents } from "./calendars.js";
import {
  addDays,
  effortRatio,
  infeasibilityOptions,
  localParts,
  MINUTE,
  overlaps,
  type PlanBlock,
  type PlanOption,
  type Recommendation,
  recommendations,
  remainingFromUnits,
  type ScheduleInput,
  type ScheduleResult,
  schedule,
  type Task,
  targetOptions,
  zonedInstant,
} from "./engine.js";
import type { AppData, AppTask, Proposal } from "./model.js";
import { travelOptions, withPlaces } from "./places.js";

const HORIZON_DAYS = 14;
/** Never plan further than this, even for far deadlines. */
const MAX_HORIZON_DAYS = 90;

export function weekStart(tz: string, instant: number): string {
  const { date, weekday } = localParts(tz, instant);
  return addDays(date, -((weekday + 6) % 7));
}

export function weekDates(tz: string, instant: number): string[] {
  const monday = weekStart(tz, instant);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function endOfDay(tz: string, instant: number): number {
  return zonedInstant(tz, localParts(tz, instant).date, 1440);
}

export function endOfWeek(tz: string, instant: number): number {
  return zonedInstant(tz, addDays(weekStart(tz, instant), 7), 0);
}

/** Minutes really worked on a task, from check-ins. */
export function doneMinutes(data: AppData, taskId: string, since = 0): number {
  return data.checkIns
    .filter((c) => c.taskId === taskId && c.createdAt >= since)
    .reduce((sum, c) => sum + c.minutesDone, 0);
}

function samples(data: AppData) {
  return data.checkIns
    .filter((c) => c.status !== "missed")
    .flatMap((c) => {
      const task = data.tasks.find((t) => t.id === c.taskId);
      if (!task || c.unitIds.length === 0) return [];
      const estimated = task.units
        .filter((u) => c.unitIds.includes(u.id))
        .reduce((sum, u) => sum + u.estimateMinutes, 0);
      return [
        { activityId: task.activityId, estimatedMinutes: estimated, actualMinutes: c.minutesDone },
      ];
    });
}

export interface TaskProgress {
  task: AppTask;
  totalMinutes: number;
  remainingMinutes: number;
  minRemainingMinutes: number;
  deadline: number;
}

/** Active and not paused or skipped this week: the planner works on it. */
export const isRunning = (task: AppTask, now: number) =>
  task.status === "active" && !task.paused && !((task.skipUntil ?? 0) > now);

/** What is left of each active task, with the learned effort ratio applied. */
export function progress(data: AppData, now: number): TaskProgress[] {
  const tz = data.settings.timezone;
  const effort = samples(data);
  return data.tasks
    .filter((t) => isRunning(t, now))
    .map((task) => {
      if (task.kind === "habit") {
        const total = (task.sessionsPerWeek ?? 0) * (task.sessionMinutes ?? 0);
        const since = zonedInstant(tz, weekStart(tz, now), 0);
        const left = Math.max(0, total - doneMinutes(data, task.id, since));
        return {
          task,
          totalMinutes: total,
          remainingMinutes: left,
          minRemainingMinutes: Math.min(left, task.minMinutes || total),
          deadline: endOfWeek(tz, now),
        };
      }
      const done = doneMinutes(data, task.id);
      const capLeft = Math.max(0, task.estimateMinutes - done);
      const fromUnits =
        task.units.length > 0
          ? remainingFromUnits(
              task.units.map((u) => ({ estimateMinutes: u.estimateMinutes, done: !!u.doneAt })),
              effortRatio(effort, task.activityId),
            )
          : capLeft;
      const remaining = Math.min(capLeft, fromUnits);
      return {
        task,
        totalMinutes: task.estimateMinutes,
        remainingMinutes: remaining,
        minRemainingMinutes: Math.min(remaining, Math.max(0, task.minMinutes - done)),
        deadline: task.deadline ?? endOfWeek(tz, now),
      };
    });
}

export function toEngineTasks(data: AppData, now: number): Task[] {
  return progress(data, now)
    .filter((p) => p.deadline > now && (p.remainingMinutes > 0 || p.minRemainingMinutes > 0))
    .map((p) => ({
      id: p.task.id,
      activityId: p.task.activityId,
      title: p.task.title,
      deadline: p.deadline,
      remainingMinutes: p.remainingMinutes,
      minRemainingMinutes: p.minRemainingMinutes,
      sessionMinutes: p.task.sessionMinutes,
      maxPerDayMinutes:
        p.task.maxPerDayMinutes ?? (p.task.kind === "habit" ? p.task.sessionMinutes : undefined),
      priority: p.task.priority,
    }));
}

export function scheduleInput(data: AppData, now: number, frozen: PlanBlock[]): ScheduleInput {
  const tasks = toEngineTasks(data, now);
  return {
    now,
    // Reach the furthest deadline so its capacity (and slack) is complete.
    horizonEnd: Math.min(
      now + MAX_HORIZON_DAYS * 1440 * MINUTE,
      Math.max(now + HORIZON_DAYS * 1440 * MINUTE, ...tasks.map((t) => t.deadline)),
    ),
    settings: data.settings,
    activities: data.activities,
    tasks,
    events: withPlaces(data, visibleEvents(data)),
    travel: travelOptions(data),
    frozen,
    overrides: data.overrides,
    allowFreeTime: (data.freeTimeUntil ?? 0) > now,
    maxActivitiesPerDay: (data.relaxContextUntil ?? 0) > now ? Number.POSITIVE_INFINITY : undefined,
  };
}

export interface Refresh {
  plan: PlanBlock[];
  proposal?: Proposal;
  input: ScheduleInput;
  result: ScheduleResult;
}

/**
 * Re-plans from `now`. Past blocks stay as history. Today's upcoming blocks stay
 * put; if a new event clashes with one, the re-plan becomes a proposal instead.
 */
export const isPinned = (b: PlanBlock) => b.id.startsWith("pin:");

export const pinId = (taskId: string, start: number) => `pin:${taskId}@${start}`;

/** A block moved by hand to `start` (same length), pinned there. */
export function pinBlock(block: PlanBlock, start: number): PlanBlock {
  return {
    ...block,
    id: pinId(block.taskId, start),
    start,
    end: start + (block.end - block.start),
    frozen: undefined,
  };
}

/** Upcoming pins that a calendar event now overlaps; they stay until the user acts. */
export function pinClashes(data: AppData, now: number) {
  const busy = visibleEvents(data).filter((e) => e.busy && !e.allDay);
  // Pins of paused, skipped or ended silos are not on the plan, so they cannot clash.
  const running = new Set(data.tasks.filter((t) => isRunning(t, now)).map((t) => t.id));
  return (data.pins ?? []).flatMap((pin) => {
    if (!running.has(pin.taskId)) return [];
    const event = pin.end > now ? busy.find((e) => overlaps(e, pin)) : undefined;
    return event ? [{ pin, event }] : [];
  });
}

export function refreshPlan(data: AppData, now: number): Refresh {
  const tz = data.settings.timezone;
  const todayEnd = endOfDay(tz, now);
  const active = new Set(data.tasks.filter((t) => isRunning(t, now)).map((t) => t.id));
  const busy = visibleEvents(data).filter((e) => e.busy && !e.allDay);
  const past = data.plan.filter((b) => b.end <= now);
  const today = data.plan.filter((b) => b.end > now && b.start < todayEnd && active.has(b.taskId));
  // Blocks the user placed by hand stay exactly where they are.
  const pins = (data.pins ?? []).filter((b) => b.end > now && active.has(b.taskId));
  const unpinned = today.filter((b) => !isPinned(b) && !pins.some((p) => overlaps(p, b)));
  const conflicts = unpinned.filter((b) => busy.some((e) => overlaps(e, b)));
  const keep = [...unpinned.filter((b) => !conflicts.includes(b)), ...pins];

  const input = scheduleInput(data, now, keep);
  const result = schedule(input);
  const plan = [...past, ...result.blocks.map((b) => ({ ...b, frozen: undefined }))];
  if (conflicts.length === 0) return { plan, input, result };

  const names = conflicts.map(
    (b) => data.tasks.find((t) => t.id === b.taskId)?.title ?? "un bloque",
  );
  return {
    plan: [
      ...past,
      ...keep,
      ...conflicts,
      // schedule() echoes frozen blocks, so pins on later days are already in keep.
      ...plan.filter((b) => b.start >= todayEnd && !keep.some((k) => k.id === b.id)),
    ],
    input,
    result,
    proposal: {
      id: `conflict@${now}`,
      message: `Un evento nuevo pisa ${names.join(", ")}. ¿Reacomodo el día?`,
      plan,
      conflicts: conflicts.map((b) => b.id),
      createdAt: now,
    },
  };
}

/** Past blocks with no check-in yet. */
export function pendingConfirmations(data: AppData, now: number): PlanBlock[] {
  const answered = new Set(data.checkIns.map((c) => c.blockId));
  return data.plan
    .filter((b) => b.end <= now && !answered.has(b.id))
    .sort((a, b) => a.start - b.start);
}

export interface Decisions {
  options: PlanOption[];
  recommendations: Recommendation[];
}

export function decisions(input: ScheduleInput, result: ScheduleResult): Decisions {
  return {
    options: result.feasible ? targetOptions(input, result) : infeasibilityOptions(input, result),
    recommendations: recommendations(input, result),
  };
}

/** Turns an engine option back into changes to the user's tasks. */
export function applyOption(
  data: AppData,
  input: ScheduleInput,
  option: PlanOption,
  now: number,
): AppData {
  if (option.kind === "use-free-time")
    return { ...data, freeTimeUntil: endOfWeek(data.settings.timezone, now) };
  const before = new Map(input.tasks.map((t) => [t.id, t]));
  const after = new Map(option.input.tasks.map((t) => [t.id, t]));
  const tasks = data.tasks.map((task) => {
    const old = before.get(task.id);
    if (!old) return task;
    const next = after.get(task.id);
    if (!next) return { ...task, status: "dropped" as const };
    const minCut = old.minRemainingMinutes - next.minRemainingMinutes;
    const cut = old.remainingMinutes - next.remainingMinutes;
    return {
      ...task,
      minMinutes: Math.max(0, task.minMinutes - minCut),
      estimateMinutes: Math.max(0, task.estimateMinutes - cut),
    };
  });
  return { ...data, tasks };
}
