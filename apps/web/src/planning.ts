import { eventRole, visibleEvents } from "./calendars.js";
import {
  type Activity,
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
import { withHolidays } from "./holidays.js";
import type { AppData, AppTask, CheckIn, Proposal } from "./model.js";
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

/** Study minutes and break after them, by default, for materias (academic activities). */
export const DEFAULT_STUDY_MINUTES = 50;
export const DEFAULT_BREAK_MINUTES = 10;

/**
 * Block time per study minute of an activity: 60/50 with the default 50 + 10 breaks.
 * Breaks are not drawn; a planned block includes them. Routines have none.
 */
export function blockFactor(activity: Activity | undefined): number {
  if (!activity) return 1;
  const study = activity.studyMinutes ?? (activity.academic ? DEFAULT_STUDY_MINUTES : 0);
  const rest = activity.breakMinutes ?? (activity.academic ? DEFAULT_BREAK_MINUTES : 0);
  return study > 0 && rest > 0 ? (study + rest) / study : 1;
}

/** Minutes really worked on a task, from check-ins. */
export function doneMinutes(data: AppData, taskId: string, since = 0): number {
  return data.checkIns
    .filter((c) => c.taskId === taskId && c.createdAt >= since)
    .reduce((sum, c) => sum + c.minutesDone, 0);
}

/** Study minutes of a check-in: its block time without the breaks it had then. */
export const studyMinutes = (c: CheckIn) => c.minutesDone / (c.factor ?? 1);

/** The block factor to record on a new check-in of a task. */
export function checkInFactor(data: AppData, taskId: string): number | undefined {
  const task = data.tasks.find((t) => t.id === taskId);
  if (!task || task.kind === "habit") return undefined;
  const k = blockFactor(data.activities.find((a) => a.id === task.activityId));
  return k === 1 ? undefined : k;
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
      // Check-ins count block time, breaks included; estimates are study time.
      return [
        {
          activityId: task.activityId,
          estimatedMinutes: estimated,
          actualMinutes: studyMinutes(c),
        },
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
      // Estimates are study time and check-ins block time (breaks included then).
      const done = data.checkIns
        .filter((c) => c.taskId === task.id)
        .reduce((sum, c) => sum + studyMinutes(c), 0);
      const capLeft = Math.max(0, task.estimateMinutes - done);
      // Units left out to make the rest fit are neither done nor missing.
      const units = task.units.filter((u) => !u.skipped);
      const fromUnits =
        units.length > 0
          ? remainingFromUnits(
              units.map((u) => ({ estimateMinutes: u.estimateMinutes, done: !!u.doneAt })),
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
    .map((p) => {
      // The planner places block time: study plus its breaks. Weekly silos are already
      // counted in blocks (a 60-minute session includes its rest).
      const k =
        p.task.kind === "habit"
          ? 1
          : blockFactor(data.activities.find((a) => a.id === p.task.activityId));
      return { p, k };
    })
    .map(({ p, k }) => ({
      id: p.task.id,
      activityId: p.task.activityId,
      title: p.task.title,
      deadline: p.deadline,
      remainingMinutes: Math.ceil(p.remainingMinutes * k),
      minRemainingMinutes: Math.ceil(p.minRemainingMinutes * k),
      sessionMinutes: p.task.sessionMinutes,
      maxPerDayMinutes:
        p.task.maxPerDayMinutes ?? (p.task.kind === "habit" ? p.task.sessionMinutes : undefined),
      priority: p.task.priority,
      // An entrega can be handed in smaller: half its minimum, never below an hour
      // (study time, planned as block time like the rest).
      mvpMinutes:
        p.task.kind === "deliverable" && !isExam(data, p.task) && p.minRemainingMinutes > 60
          ? Math.ceil(Math.max(60, Math.ceil(p.minRemainingMinutes / 2)) * k)
          : undefined,
      // Exams with weighed units can leave the lightest ones out.
      units: p.task.units.some((u) => u.weight !== undefined)
        ? p.task.units
            .filter((u) => !u.doneAt && !u.skipped)
            .map((u) => ({
              id: u.id,
              title: u.title,
              minutes: Math.ceil(u.estimateMinutes * k),
              weight: u.weight ?? 0,
            }))
        : undefined,
    }));
}

/** Titles of exams (not entregas): no "smaller version" of those. */
const EXAM = /(?<![\p{L}\p{N}])(parcial(es)?|ex[aá]men(es)?|pruebas?|final(es)?)(?![\p{L}\p{N}])/iu;

/** An exam has no smaller version to hand in: by its title or its calendar event. */
function isExam(data: AppData, task: AppTask): boolean {
  if (EXAM.test(task.title)) return true;
  const event = task.sourceEventId && data.events.find((e) => e.id === task.sourceEventId);
  return !!event && eventRole(data, event) === "parcial";
}

export function scheduleInput(data: AppData, now: number, frozen: PlanBlock[]): ScheduleInput {
  const tasks = toEngineTasks(data, now);
  // Reach the furthest deadline so its capacity (and slack) is complete.
  const horizonEnd = Math.min(
    now + MAX_HORIZON_DAYS * 1440 * MINUTE,
    Math.max(now + HORIZON_DAYS * 1440 * MINUTE, ...tasks.map((t) => t.deadline)),
  );
  return {
    now,
    horizonEnd,
    settings: data.settings,
    activities: data.activities,
    tasks,
    events: withPlaces(data, visibleEvents(data)),
    travel: travelOptions(data),
    frozen,
    overrides:
      data.preferences?.holidaysOff === false
        ? data.overrides
        : withHolidays(data.overrides, data.settings.timezone, now, horizonEnd),
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

/**
 * Minimums that the upcoming pins put out of reach: what each task misses with them,
 * beyond what it would miss if the plan were free to place those blocks itself.
 */
export function pinShortfall(
  data: AppData,
  now: number,
  withPins: ScheduleResult = refreshPlan(data, now).result,
) {
  const pins = (data.pins ?? []).filter((p) => p.start > now);
  if (pins.length === 0) return { pins, short: [] };
  const free = refreshPlan({ ...data, pins: (data.pins ?? []).filter((p) => p.start <= now) }, now)
    .result.status;
  const unpinned = new Map(free.map((s) => [s.taskId, s.minDeficit]));
  const short = withPins.status
    .map((s) => ({ taskId: s.taskId, minutes: s.minDeficit - (unpinned.get(s.taskId) ?? 0) }))
    .filter((s) => s.minutes > 0);
  return { pins, short };
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
  if (option.kind === "move-event" && option.eventId && option.moveTo) {
    const event = data.events.find((e) => e.id === option.eventId);
    if (!event) return data;
    // Planned at the new time until the calendar shows it moved (or the user undoes it).
    const move = { eventId: event.id, from: event.start, ...option.moveTo };
    return {
      ...data,
      movedEvents: [...(data.movedEvents ?? []).filter((m) => m.eventId !== event.id), move],
    };
  }
  const before = new Map(input.tasks.map((t) => [t.id, t]));
  const after = new Map(option.input.tasks.map((t) => [t.id, t]));
  const tasks = data.tasks.map((task) => {
    const old = before.get(task.id);
    if (!old) return task;
    const next = after.get(task.id);
    if (!next) return { ...task, status: "dropped" as const };
    // The engine cuts block time; tasks keep study time (breaks are not work).
    const k =
      task.kind === "habit"
        ? 1
        : blockFactor(data.activities.find((a) => a.id === task.activityId));
    const minCut = Math.round((old.minRemainingMinutes - next.minRemainingMinutes) / k);
    const cut = Math.round((old.remainingMinutes - next.remainingMinutes) / k);
    const out = new Set(option.kind === "prioritize" ? (option.unitIds ?? []) : []);
    return {
      ...task,
      minMinutes: Math.max(0, task.minMinutes - minCut),
      estimateMinutes: Math.max(0, task.estimateMinutes - cut),
      units: out.size
        ? task.units.map((u) => (out.has(u.id) ? { ...u, skipped: true } : u))
        : task.units,
    };
  });
  return { ...data, tasks };
}
