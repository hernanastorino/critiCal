import { eventRole, normalize, visibleEvents } from "./calendars.js";
import {
  type Activity,
  addDays,
  type CalendarEvent,
  type DaySettings,
  effortRatio,
  type Interval,
  infeasibilityOptions,
  localParts,
  type Meal,
  type MealKind,
  type MealTime,
  MINUTE,
  moveSpot,
  overlaps,
  type PlanBlock,
  type PlanOption,
  placeMeals,
  type Recommendation,
  recommendations,
  remainingFromUnits,
  type ScheduleInput,
  type ScheduleResult,
  type Settings,
  schedule,
  type Task,
  targetOptions,
  travelBuffers,
  zonedInstant,
} from "./engine.js";
import { withHolidays } from "./holidays.js";
import { withLateNight } from "./lateNight.js";
import type { AppData, AppEvent, AppTask, CheckIn, Proposal } from "./model.js";
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

/**
 * Deliverables whose deadline passed before this week are "anteriores": they leave the
 * silos view once the week they were due in is over. Newest first.
 */
export function splitPastSilos(items: TaskProgress[], tz: string, now: number) {
  const since = zonedInstant(tz, weekStart(tz, now), 0);
  const isPast = (p: TaskProgress) => p.task.kind !== "habit" && p.deadline < since;
  return {
    current: items.filter((p) => !isPast(p)),
    past: items.filter(isPast).sort((a, b) => b.deadline - a.deadline),
  };
}

/**
 * "2.º cuatrimestre 2026": January–July is the first, August–December the second, so
 * the year in the title is always the year of the dates below it.
 */
export function semesterLabel(tz: string, instant: number) {
  const [y, m] = localParts(tz, instant).date.split("-").map(Number) as [number, number];
  return m <= 7 ? `1.er cuatrimestre ${y}` : `2.º cuatrimestre ${y}`;
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
      // With units, only those count (all left out: nothing to plan); without, the estimate.
      const fromUnits =
        task.units.length > 0
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

/**
 * Weighed units still to study, in planner minutes. They are scaled so together with
 * the rest they never exceed what is left of the task (capped by its estimate), so
 * leaving some out never takes the time of the ones kept.
 */
function weighedUnits(p: TaskProgress, k: number, ratio: number) {
  if (!p.task.units.some((u) => u.weight !== undefined)) return undefined;
  const open = p.task.units.filter((u) => !u.doneAt && !u.skipped);
  const raw = (u: (typeof open)[number]) => u.estimateMinutes * ratio * k;
  const total = open.reduce((sum, u) => sum + raw(u), 0);
  const left = p.remainingMinutes * k;
  const scale = total > left && total > 0 ? left / total : 1;
  return open
    .filter((u) => u.weight !== undefined)
    .map((u) => ({
      id: u.id,
      title: u.title,
      // Like what is left: the learned effort ratio, then block time.
      minutes: Math.floor(raw(u) * scale),
      weight: u.weight as number,
    }));
}

/** Days before an exam its review sessions should fall on. */
export const REVIEW_DAYS_BEFORE = [7, 3, 1];

/** The exam's local date and its review dates still ahead. */
function examDays(tz: string, deadline: number, now: number) {
  const date = localParts(tz, deadline).date;
  const today = localParts(tz, now).date;
  const reviews = REVIEW_DAYS_BEFORE.map((d) => addDays(date, -d)).filter((d) => d >= today);
  return { date, reviews };
}

/** Days kept for one materia's exam: everything else stays away from them. */
function keptDays(data: AppData, now: number) {
  const tz = data.settings.timezone;
  return data.tasks
    .filter((t) => t.exam && t.dayBeforeOnly && t.deadline && t.deadline > now && isRunning(t, now))
    .map((t) => {
      const before = addDays(examDays(tz, t.deadline as number, now).date, -1);
      return {
        activityId: t.activityId,
        span: { start: zonedInstant(tz, before, 0), end: zonedInstant(tz, before, 1440) },
      };
    });
}

/**
 * The first instant a deliverable can be worked on (§18.7): its own «puedo empezar»,
 * else its materia's; a date counts from that day's start, «N días antes» from the start
 * of that day before the deadline. Undefined: from now.
 */
export function earliestStartOf(data: AppData, task: AppTask): number | undefined {
  if (task.kind === "habit") return undefined;
  const rule = task.startAfter ?? data.activities.find((a) => a.id === task.activityId)?.startAfter;
  if (!rule || "now" in rule) return undefined;
  const tz = data.settings.timezone;
  if ("date" in rule) return zonedInstant(tz, rule.date, 0);
  if (task.deadline === undefined) return undefined;
  const day = localParts(tz, task.deadline).date;
  return zonedInstant(tz, addDays(day, -Math.max(0, Math.round(rule.daysBefore))), 0);
}

export function toEngineTasks(data: AppData, now: number): Task[] {
  const effort = samples(data);
  const tz = data.settings.timezone;
  const kept = keptDays(data, now);
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
      earliestStart: earliestStartOf(data, p.task),
      // An entrega can be handed in smaller: half its minimum, never below an hour
      // (study time, planned as block time like the rest).
      mvpMinutes:
        p.task.kind === "deliverable" && !isExam(data, p.task) && p.minRemainingMinutes > 60
          ? Math.ceil(Math.max(60, Math.ceil(p.minRemainingMinutes / 2)) * k)
          : undefined,
      // Exams with weighed units can leave the lightest ones out; a unit with no weight
      // is of unknown importance, so it is never offered to leave out.
      units: weighedUnits(p, k, effortRatio(effort, p.task.activityId)),
      reviewDates:
        p.task.exam && p.task.deadline ? examDays(tz, p.task.deadline, now).reviews : undefined,
      avoid: kept.filter((day) => day.activityId !== p.task.activityId).map((day) => day.span),
    }));
}

/** Titles of exams (not entregas): no "smaller version" of those. */
const EXAM = /(?<![\p{L}\p{N}])(parcial(es)?|ex[aá]men(es)?|pruebas?|final(es)?)(?![\p{L}\p{N}])/iu;

/** An exam has no smaller version to hand in: by its title or its calendar event. */
function isExam(data: AppData, task: AppTask): boolean {
  const event = task.sourceEventId && data.events.find((e) => e.id === task.sourceEventId);
  const role = event ? eventRole(data, event) : undefined;
  if (task.exam || role === "parcial") return true;
  // From an entrega or presentación, "final" is the last one, not an exam.
  const title =
    role === "entrega" || role === "presentacion"
      ? task.title.replace(/(?<![\p{L}\p{N}])final(es)?(?![\p{L}\p{N}])/giu, "")
      : task.title;
  return EXAM.test(title);
}

export const MEAL_NAMES: Record<MealKind, string> = {
  desayuno: "Desayuno",
  almuerzo: "Almuerzo",
  cena: "Cena",
};

/** Default breakfast for routines from before it was a meal: on waking, 30 min. */
const BREAKFAST_MINUTES = 30;

/**
 * A day's meals, each with its kind. Routines saved before breakfast was a meal list
 * lunch and dinner only (in that order, at least one): they get a breakfast on waking.
 */
export function mealsOf(day: DaySettings): Meal[] {
  // No meals at all is a choice (every duration at 0), not an old routine.
  if (day.meals.length === 0 || day.meals.some((m) => m.kind)) return day.meals;
  const kinds: MealKind[] = ["almuerzo", "cena"];
  return [
    { kind: "desayuno", start: day.wake, end: day.wake + BREAKFAST_MINUTES },
    ...day.meals.map((m, i) => ({ ...m, ...(kinds[i] ? { kind: kinds[i] } : {}) })),
  ];
}

/** The settings as the planner reads them: every day's meals with their kind. */
export const withMeals = (settings: Settings): Settings => ({
  ...settings,
  week: settings.week.map((d) => ({ ...d, meals: mealsOf(d) })),
});

const MEAL_WORDS: [MealKind, RegExp][] = [
  ["desayuno", /\bdesayun/],
  ["almuerzo", /\b(almuerz|almorz)/],
  ["cena", /\b(cena|cenar|cenamos)\b/],
];

/** Events whose title says they are a meal ("Almuerzo con la abuela"), marked as that meal. */
function withMealEvents<E extends CalendarEvent>(events: E[]): E[] {
  return events.map((e) => {
    const title = normalize(e.title);
    const meal = MEAL_WORDS.find(([, word]) => word.test(title))?.[0];
    return meal ? { ...e, meal } : e;
  });
}

/** The events the planner reads: visible ones, with their places and meals. */
const plannerEvents = (data: AppData) => withMealEvents(withPlaces(data, visibleEvents(data)));

/** The day overrides the planner uses: late nights and, unless turned off, holidays. */
function overridesFor(data: AppData, now: number, from: number, to: number) {
  return data.preferences?.holidaysOff === false
    ? withLateNight(data, now)
    : withHolidays(withLateNight(data, now), data.settings.timezone, from, to);
}

/**
 * Where each meal between `from` and `to` happens: at its time unless a fixed event,
 * its travel or a block pinned by hand is there, then at the closest free time.
 */
export function mealTimes(data: AppData, now: number, from: number, to: number): MealTime[] {
  const events = plannerEvents(data);
  const travel = travelOptions(data);
  const busy = [
    ...events.filter((e) => e.busy && !e.allDay),
    ...(travel ? travelBuffers(events, travel).busy : []),
    ...(data.pins ?? []).filter((p) =>
      data.tasks.some((t) => t.id === p.taskId && isRunning(t, now)),
    ),
  ];
  return placeMeals(
    withMeals(data.settings),
    overridesFor(data, now, from, to),
    from,
    to,
    busy,
    events,
  );
}

/** Meals within the next week with no room near their time, until their last possible start. */
export function missedMeals(data: AppData, now: number): MealTime[] {
  return mealTimes(data, now, now, now + 7 * 1440 * MINUTE).filter((m) => !m.at && m.latest > now);
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
    settings: withMeals(data.settings),
    activities: data.activities,
    tasks,
    events: plannerEvents(data),
    travel: travelOptions(data),
    frozen,
    overrides: overridesFor(data, now, now, horizonEnd),
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

/**
 * Upcoming pins that a calendar event now overlaps; they stay until the user acts. A
 * flexible event under a pin comes with `moveTo`, the free time closest to it, to
 * propose moving the event instead.
 */
export function pinClashes(
  data: AppData,
  now: number,
  planned?: ScheduleInput,
): { pin: PlanBlock; event: AppEvent; moveTo?: Interval }[] {
  const busy = visibleEvents(data).filter((e) => e.busy && !e.allDay);
  // Pins of paused, skipped or ended silos are not on the plan, so they cannot clash.
  const running = new Set(data.tasks.filter((t) => isRunning(t, now)).map((t) => t.id));
  const clashes = (data.pins ?? []).flatMap((pin) => {
    if (!running.has(pin.taskId)) return [];
    const event = pin.end > now ? busy.find((e) => overlaps(e, pin)) : undefined;
    return event ? [{ pin, event }] : [];
  });
  if (!clashes.some((c) => c.event.flexible && c.event.start > now)) return clashes;
  const input = planned ?? refreshPlan(data, now).input;
  return clashes.map((c) => {
    if (!c.event.flexible || c.event.start <= now) return c;
    const event = input.events.find((e) => e.id === c.event.id);
    const moveTo = event && moveSpot(input, event);
    return moveTo ? { ...c, moveTo } : c;
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
  // Days kept for another materia's exam count as taken, like a busy event (also for
  // blocks of tasks with nothing left to plan).
  const kept = keptDays(data, now);
  // By the task's current materia: a block keeps the one it was planned with.
  const activityOf = (b: PlanBlock) =>
    data.tasks.find((t) => t.id === b.taskId)?.activityId ?? b.activityId;
  const reserved = (b: PlanBlock) =>
    kept.some((k) => k.activityId !== activityOf(b) && overlaps(k.span, b));
  const clashes = (b: PlanBlock) => busy.some((e) => overlaps(e, b));
  // A block of today before its task can start (a «puedo empezar» set since) goes, as
  // a proposal since it is today (§5.7, §18.7).
  const tooEarly = (b: PlanBlock) => {
    const task = data.tasks.find((t) => t.id === b.taskId);
    const from = task && earliestStartOf(data, task);
    return from !== undefined && b.start < from;
  };
  // A later wake-up (a late night, or one set by hand) frees the blocks it now falls
  // before; they are planned again instead of staying put.
  const date = localParts(tz, now).date;
  const lateOverrides = withLateNight(data, now);
  const dayOverride = (
    data.preferences?.holidaysOff === false
      ? lateOverrides
      : withHolidays(lateOverrides, tz, now, now)
  ).find((o) => o.date === date);
  const routine = data.settings.week[dayOverride?.asWeekday ?? localParts(tz, now).weekday];
  // Work starts after the morning routine, as the planner counts it.
  const plannableAt =
    dayOverride?.wake === undefined
      ? undefined
      : zonedInstant(tz, date, dayOverride.wake) +
        Math.max(0, routine?.morningMinutes ?? 0) * MINUTE;
  const displaced = (b: PlanBlock) =>
    plannableAt !== undefined && b.start > now && b.start < plannableAt;
  // Displaced blocks are planned again anyway: never a conflict to ask about.
  const conflicts = unpinned.filter(
    (b) => !displaced(b) && (clashes(b) || reserved(b) || tooEarly(b)),
  );
  const keep = [...unpinned.filter((b) => !conflicts.includes(b) && !displaced(b)), ...pins];

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
      // Until the proposal is answered, today stays as it was, displaced blocks included.
      ...unpinned.filter(displaced),
      // schedule() echoes frozen blocks, so pins on later days are already in keep.
      ...plan.filter((b) => b.start >= todayEnd && !keep.some((k) => k.id === b.id)),
    ],
    input,
    result,
    proposal: {
      id: `conflict@${now}`,
      message: conflicts.some(clashes)
        ? `Un evento nuevo pisa ${names.join(", ")}. ¿Reacomodo el día?`
        : conflicts.some(tooEarly)
          ? `${names.join(", ")} todavía no se puede empezar. ¿Reacomodo el día?`
          : `Hoy quedó reservado para un parcial y tiene ${names.join(", ")}. ¿Reacomodo el día?`,
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
