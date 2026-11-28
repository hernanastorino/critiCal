import { eventRole, normalize, visibleEvents } from "./calendars.js";
import {
  addDays,
  type CalendarEvent,
  ceilStep,
  type DayOverride,
  type DaySettings,
  effortRatio,
  floorStep,
  type Interval,
  infeasibilityOptions,
  joinList,
  localParts,
  type Meal,
  type MealKind,
  type MealTime,
  MINUTE,
  type MinuteRange,
  moveSpot,
  overlaps,
  type PlanBlock,
  type PlanOption,
  placeMeal,
  placeMeals,
  type Recommendation,
  recommendations,
  type ScheduleInput,
  type ScheduleResult,
  type Settings,
  type StartAfter,
  schedule,
  scheduleAlone,
  selfShort,
  type Task,
  targetOptions,
  travelBuffers,
  weekdayOf,
  zonedInstant,
} from "./engine.js";
import { hours } from "./format.js";
import { withHolidays } from "./holidays.js";
import { withLateNight } from "./lateNight.js";
import {
  type AppData,
  type AppEvent,
  type AppTask,
  type CheckIn,
  type MealRun,
  type Proposal,
  type Unit,
  undoable,
} from "./model.js";
import { editedMinimum, improves } from "./need.js";
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

/** The newest record of each block: by date, then by id (rows come back in any order). */
export function latestCheckIns(data: AppData): Map<string, CheckIn> {
  const last = new Map<string, CheckIn>();
  for (const c of data.checkIns) {
    const prev = last.get(c.blockId);
    if (!prev || c.createdAt > prev.createdAt || (c.createdAt === prev.createdAt && c.id > prev.id))
      last.set(c.blockId, c);
  }
  return last;
}

/**
 * The check-ins that count: the log only grows (SPEC §3), so a correction is a newer
 * check-in of the same block, and it is the one that stands. A «retired» one (an undo of
 * the first record) leaves the block with none.
 */
export function standingCheckIns(data: AppData): CheckIn[] {
  const last = latestCheckIns(data);
  return data.checkIns.filter((c) => last.get(c.blockId) === c && c.status !== "retired");
}

/**
 * A record that only repeats an earlier answer of its block, written by «Deshacer» (it
 * says so: `origin`), or that retires it: it is not a new answer, so it is not news (no
 * celebration). The same answer given again by hand is news.
 */
export function isUndoCopy(_data: AppData, c: CheckIn): boolean {
  return c.status === "retired" || c.origin === "undo" || c.origin === "slept";
}

/** The block's standing record says the user was asleep: closed by the app, not editable. */
export function sleptBlockIds(data: AppData): Set<string> {
  return new Set(standingCheckIns(data).flatMap((c) => (c.origin === "slept" ? [c.blockId] : [])));
}

/** The oldest standing record's date that declares each part, per task. */
function declaredBy(data: AppData): Map<string, Map<string, number>> {
  const declared = new Map<string, Map<string, number>>();
  for (const c of standingCheckIns(data)) {
    const mine = declared.get(c.taskId) ?? new Map<string, number>();
    for (const id of c.unitIds) {
      const at = mine.get(id);
      if (at === undefined || c.createdAt < at) mine.set(id, c.createdAt);
    }
    declared.set(c.taskId, mine);
  }
  return declared;
}

/**
 * Data from before `doneByHand` (a done part with the field unset) gets it as the migration
 * did: done and declared by no standing record means marked by hand. The dates stay as
 * they are. Returns `data` itself when there is nothing to say.
 */
export function withHandMarks(data: AppData): AppData {
  const declared = declaredBy(data);
  let moved = false;
  const tasks = data.tasks.map((t) => {
    if (!t.units.some((u) => u.doneAt !== undefined && u.doneByHand === undefined)) return t;
    moved = true;
    const mine = declared.get(t.id);
    return {
      ...t,
      units: t.units.map((u) =>
        u.doneAt !== undefined && u.doneByHand === undefined
          ? { ...u, doneByHand: !mine?.has(u.id) }
          : u,
      ),
    };
  });
  return moved ? { ...data, tasks } : data;
}

/**
 * A file's parts that say «done, not by hand» when no standing record of its own declares
 * them (a record corrected or edited out of the file): they would reopen on their own, so
 * they are read as marked by hand, the way a part with no field is. Returns `data` itself
 * when there is nothing to say.
 */
export function withOrphanMarks(data: AppData, around: AppData = data): AppData {
  const declared = declaredBy(data);
  // `around`: the same data with records made after the file, which also declare parts.
  const declaredAround = declaredBy(around);
  let moved = false;
  const orphan = (u: Unit, mine?: Map<string, number>, near?: Map<string, number>) =>
    u.doneAt !== undefined && u.doneByHand === false && !mine?.has(u.id) && !near?.has(u.id);
  const tasks = data.tasks.map((t) => {
    const mine = declared.get(t.id);
    const near = declaredAround.get(t.id);
    if (!t.units.some((u) => orphan(u, mine, near))) return t;
    moved = true;
    return {
      ...t,
      units: t.units.map((u) => (orphan(u, mine, near) ? { ...u, doneByHand: true } : u)),
    };
  });
  return moved ? { ...data, tasks } : data;
}

/**
 * The parts brought in line with what stands: a part is done when it was marked by hand
 * or when the standing record of some block declares it. Its date is the hand mark's, or
 * the oldest standing record's that declares it. Returns `data` itself when nothing
 * changes.
 */
export function settleUnits(data: AppData): AppData {
  const declared = declaredBy(withHandMarks(data));
  let moved = false;
  const tasks = withHandMarks(data).tasks.map((t) => {
    const mine = declared.get(t.id);
    let touched = false;
    const units = t.units.map((u) => {
      const record = mine?.get(u.id);
      const byHand = u.doneAt !== undefined && u.doneByHand === true;
      const doneAt = byHand ? u.doneAt : record;
      const doneByHand = byHand ? true : doneAt !== undefined ? false : undefined;
      if (doneAt === u.doneAt && doneByHand === u.doneByHand) return u;
      touched = true;
      const { doneAt: _d, doneByHand: _h, ...rest } = u;
      return {
        ...rest,
        ...(doneAt !== undefined && { doneAt }),
        ...(doneByHand !== undefined && { doneByHand }),
      };
    });
    if (!touched) return t;
    moved = true;
    return { ...t, units };
  });
  return moved ? { ...data, tasks } : data;
}

/** When the block a check-in is about starts: the week it belongs to, not when it was logged. */
export function blockStartOf(data: AppData, c: CheckIn): number {
  return data.plan.find((b) => b.id === c.blockId)?.start ?? c.createdAt;
}

/** Minutes really worked on a task, from check-ins. */
export function doneMinutes(data: AppData, taskId: string, since = 0): number {
  return standingCheckIns(data)
    .filter((c) => c.taskId === taskId && blockStartOf(data, c) >= since)
    .reduce((sum, c) => sum + c.minutesDone, 0);
}

function samples(data: AppData) {
  return standingCheckIns(data)
    .filter((c) => c.status !== "missed")
    .flatMap((c) => {
      const task = data.tasks.find((t) => t.id === c.taskId);
      // A record with no minutes says nothing about how long a part takes.
      if (!task || c.unitIds.length === 0 || c.minutesDone <= 0) return [];
      const estimated = task.units
        .filter((u) => c.unitIds.includes(u.id))
        .reduce((sum, u) => sum + u.estimateMinutes, 0);
      // Block time counts whole, break included (SPEC §18.17): a 60-minute block done is 60.
      return [
        {
          activityId: task.activityId,
          estimatedMinutes: estimated,
          actualMinutes: c.minutesDone,
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
  /** The learned effort ratio that adjusted the parts (only for tasks with parts). */
  ratio?: number;
}

/**
 * What a silo of the week holds when the plan cannot place all of it (SPEC §18 punto 19):
 * `placed` minutes of the task's blocks still ahead in the week, of the `of` the silo
 * shows. Only a weekly study silo or a delivery due inside that week, and only when the
 * plan is short of it (the same deficit that makes it «crítico» or offers options);
 * otherwise undefined: nothing to say when it all fits.
 */
export function siloWeekFit(
  data: AppData,
  now: number,
  p: TaskProgress,
  plan: {
    blocks: readonly PlanBlock[];
    status: readonly { taskId: string; targetDeficit: number }[];
  },
): { placed: number; of: number } | undefined {
  const tz = data.settings.timezone;
  const end = endOfWeek(tz, focusWeekAt(data, now));
  const weekly = p.task.kind === "habit" && !!p.task.study;
  if (!weekly && (p.task.kind === "habit" || p.deadline >= end)) return undefined;
  if (p.remainingMinutes <= 0) return undefined;
  const short = plan.status.find((s) => s.taskId === p.task.id)?.targetDeficit ?? 0;
  if (short <= 0) return undefined;
  const placed = plan.blocks
    .filter((b) => b.taskId === p.task.id && b.end > now && b.start < end)
    .reduce((sum, b) => sum + (b.end - b.start) / 60_000, 0);
  const rounded = Math.round(placed);
  return rounded < p.remainingMinutes ? { placed: rounded, of: p.remainingMinutes } : undefined;
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

/**
 * Active, not paused or skipped this week, and not waiting in the Bandeja to be accepted
 * (SPEC §18.14): the planner works on it.
 */
export const isRunning = (task: AppTask, now: number) =>
  task.status === "active" && !task.needsReview && !task.paused && !((task.skipUntil ?? 0) > now);

/**
 * The sessions a habit asks of the week `now` is in. One made mid-week asks the share of
 * the days left, counting the day it was made: 3 a week made on Saturday leave 2 of 7
 * days, so 1 session. Rounded up, so a routine never starts with nothing to do, and it
 * never asks more than a day holds (the daily cap is sessions per week over 7, rounded
 * up). From the next week on, all of them. Study silos and habits from before the
 * creation date was kept ask the whole week.
 */
export function sessionsThisWeek(task: AppTask, tz: string, now: number): number {
  const full = task.sessionsPerWeek ?? 0;
  const made = task.createdAt;
  if (made === undefined || task.study) return full;
  if (made < zonedInstant(tz, weekStart(tz, now), 0) || made >= endOfWeek(tz, now)) return full;
  const daysLeft = 7 - ((localParts(tz, made).weekday + 6) % 7);
  return Math.min(full, Math.ceil((full * daysLeft) / 7));
}

/**
 * The days of the week of `weekAt` a routine can still be done: from `now` (today counts
 * only while a whole session still fits in its valid hours) or from Monday of a later
 * week, to Sunday. A day the routine does not go («No ese día») or whose franja is shorter
 * than a session does not count.
 */
export function routineDaysLeft(data: AppData, task: AppTask, now: number, weekAt = now): number {
  const tz = data.settings.timezone;
  const hoursOf = data.activities.find((a) => a.id === task.activityId)?.validHours;
  const from = Math.max(now, zonedInstant(tz, weekStart(tz, weekAt), 0));
  const end = endOfWeek(tz, weekAt);
  const today = localParts(tz, from);
  let count = 0;
  for (let day = today.date; zonedInstant(tz, day, 0) < end; day = addDays(day, 1)) {
    const own = hoursOf?.days?.[weekdayOf(day)];
    if (own === null) continue;
    const range = own ?? hoursOf?.all ?? { start: 0, end: 24 * 60 };
    const at = day === today.date ? today : undefined;
    if (dayHolds(data, range, task.sessionMinutes ?? 0, at)) count += 1;
  }
  return count;
}

/**
 * Whether a franja still holds a whole session: for today (`at`), from now on and only
 * before the free-time hours (a session that would only fit there is not done).
 */
function dayHolds(
  data: AppData,
  range: MinuteRange,
  session: number,
  at?: { weekday: number; minuteOfDay: number },
): boolean {
  if (!at) return range.start + session <= range.end;
  const free = data.settings.week[at.weekday]?.freeFrom ?? 24 * 60;
  return Math.max(range.start, at.minuteOfDay) + session <= Math.min(range.end, free);
}

/** Whether a task is a routine: a habit of an activity that is a «rutina». */
export const isRoutine = (data: AppData, task: AppTask) =>
  task.kind === "habit" &&
  !task.study &&
  data.activities.find((a) => a.id === task.activityId)?.kind === "rutina";

/**
 * What a routine can hold in the week `weekAt` is in (SPEC §5.8): the sessions already
 * done plus the lesser of what is missing and the days it can still go, never more than
 * one a day. Any week, not only the one it was made in.
 */
export function routineCapacity(data: AppData, task: AppTask, now: number, weekAt = now): number {
  const full = task.sessionsPerWeek ?? 0;
  if ((task.sessionMinutes ?? 0) <= 0) return full;
  const done = Math.min(full, routineDone(data, task, now, weekAt));
  return done + Math.min(full - done, routineDaysLeft(data, task, now, weekAt));
}

/**
 * The sessions a routine asks of the week `weekAt` is in: all of them, but in the week it
 * was made, only what its days left can hold (it never starts with a complaint about days
 * that went by before it existed).
 */
export function routineSessions(data: AppData, task: AppTask, now: number, weekAt = now): number {
  const tz = data.settings.timezone;
  const made = task.createdAt;
  const inWeek =
    made !== undefined &&
    made >= zonedInstant(tz, weekStart(tz, weekAt), 0) &&
    made < endOfWeek(tz, weekAt);
  return inWeek ? routineCapacity(data, task, now, weekAt) : (task.sessionsPerWeek ?? 0);
}

/** A routine that is running and asks sessions of some length. */
const runsAsRoutine = (data: AppData, task: AppTask, now: number) =>
  isRoutine(data, task) && (task.sessionMinutes ?? 0) > 0 && isRunning(task, now);

/**
 * The sessions of the week `weekAt` is in that are behind: checked ones and the past
 * blocks not yet answered (planned and over).
 */
export function routineDone(data: AppData, task: AppTask, now: number, weekAt = now): number {
  const tz = data.settings.timezone;
  const session = task.sessionMinutes ?? 0;
  const monday = zonedInstant(tz, weekStart(tz, weekAt), 0);
  const end = endOfWeek(tz, weekAt);
  const checked = session > 0 ? Math.floor(doneMinutes(data, task.id, monday) / session) : 0;
  const over = pendingConfirmations(data, now).filter(
    (b) => b.taskId === task.id && b.start >= monday && b.start < end,
  ).length;
  return checked + over;
}

/** The sessions a weekly habit asks of the week `weekAt` is in. */
const sessionsOf = (data: AppData, task: AppTask, now: number, weekAt: number) =>
  isRoutine(data, task)
    ? routineSessions(data, task, now, weekAt)
    : sessionsThisWeek(task, data.settings.timezone, weekAt);

/** Monday of next week (the one the weekly planning always works on). */
export function nextWeekStart(tz: string, now: number): string {
  return addDays(weekStart(tz, now), 7);
}

/**
 * An instant inside the week silos and widget show: the current one until the user has
 * planned the next (`settings.weekPlannedFor`), and the next one from then on.
 */
export function focusWeekAt(data: AppData, now: number): number {
  const tz = data.settings.timezone;
  const next = nextWeekStart(tz, now);
  return data.settings.weekPlannedFor === next ? zonedInstant(tz, next, 720) : now;
}

/** Parts' minutes adjusted by the learned ratio, never above the estimate (what the plan reserves). */
const scaled = (task: AppTask, minutes: number, ratio: number) =>
  Math.min(task.estimateMinutes, Math.round(minutes * ratio));

/**
 * What is left of each active task: its unmarked parts adjusted by the materia's learned
 * effort ratio (what the plan reserves, so «Faltan» and the calendar agree), or its estimate
 * minus what was logged. `weekAt`: an instant of the week the weekly habits are counted in (default `now`).
 */
export function progress(data: AppData, now: number, weekAt = now): TaskProgress[] {
  const tz = data.settings.timezone;
  const effort = samples(data);
  return data.tasks
    .filter((t) => isRunning(t, now))
    .map((task) => {
      if (task.kind === "habit") {
        // A weekly study silo whose total was split by hand (SPEC §18.18) keeps those minutes,
        // not the whole sessions that hold them.
        // Saved before the exact total existed (estimate 0): its weekly hours are the minimum.
        const total =
          task.study && task.estimateMinutes > 0
            ? task.estimateMinutes
            : task.study && task.minMinutes > 0
              ? task.minMinutes
              : sessionsOf(data, task, now, weekAt) * (task.sessionMinutes ?? 0);
        const since = zonedInstant(tz, weekStart(tz, weekAt), 0);
        const left = Math.max(0, total - doneMinutes(data, task.id, since));
        return {
          task,
          totalMinutes: total,
          remainingMinutes: left,
          minRemainingMinutes: Math.min(left, task.minMinutes || total),
          deadline: endOfWeek(tz, weekAt),
        };
      }
      // Hours and check-ins are both block time, break included (SPEC §18.17).
      const done = standingCheckIns(data)
        .filter((c) => c.taskId === task.id)
        .reduce((sum, c) => sum + c.minutesDone, 0);
      const capLeft = Math.max(0, task.estimateMinutes - done);
      // With parts, what is left is the parts still unmarked (left out ones are neither
      // done nor missing); the minutes logged already marked them, so they are not
      // taken off again. Without parts, the estimate minus what was logged.
      const remaining =
        task.units.length > 0
          ? Math.min(
              task.estimateMinutes,
              task.units
                .filter((u) => !u.skipped && !u.doneAt)
                .reduce((sum, u) => sum + u.estimateMinutes, 0),
            )
          : capLeft;
      // What counts toward the minimum is what lowers «Faltan»: with parts, the parts done
      // (by hand or by a record; minutes logged without parts move neither); without, the minutes.
      const doneMin =
        task.units.length > 0
          ? task.units
              .filter((u) => !u.skipped && u.doneAt)
              .reduce((n, u) => n + u.estimateMinutes, 0)
          : done;
      const ratio = task.units.length > 0 ? effortRatio(effort, task.activityId) : undefined;
      const left = ratio === undefined ? remaining : scaled(task, remaining, ratio);
      return {
        task,
        totalMinutes: task.estimateMinutes,
        remainingMinutes: left,
        // As the planner takes it: never above what it reserves.
        minRemainingMinutes: Math.min(left, Math.max(0, task.minMinutes - doneMin)),
        deadline: task.deadline ?? endOfWeek(tz, now),
        ratio,
      };
    });
}

/**
 * The total a silo shows next to what is left. With parts, «faltan» is the parts still
 * unmarked at the learned ratio (capped by the estimate), so the total is all the parts at
 * that ratio (same cap): an estimate above their sum would read as hours no part holds.
 */
export function shownTotal(p: TaskProgress): number {
  if (p.task.kind === "habit" || p.task.units.length === 0) return p.totalMinutes;
  const parts = p.task.units
    .filter((u) => !u.skipped)
    .reduce((sum, u) => sum + u.estimateMinutes, 0);
  return Math.max(p.remainingMinutes, Math.min(p.totalMinutes, Math.round(parts * (p.ratio ?? 1))));
}

/**
 * Weighed units still to study, in planner minutes. They are scaled so together with
 * the rest they never exceed what is left of the task (capped by its estimate), so
 * leaving some out never takes the time of the ones kept.
 */
function weighedUnits(p: TaskProgress, ratio: number, remaining: number) {
  if (!p.task.units.some((u) => u.weight !== undefined)) return undefined;
  const open = p.task.units.filter((u) => !u.doneAt && !u.skipped);
  const raw = (u: (typeof open)[number]) => u.estimateMinutes * ratio;
  const total = open.reduce((sum, u) => sum + raw(u), 0);
  const left = remaining;
  const scale = total > left && total > 0 ? left / total : 1;
  return open
    .filter((u) => u.weight !== undefined)
    .map((u) => ({
      id: u.id,
      title: u.title,
      // Like what is left: the learned effort ratio.
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

/**
 * A weekly silo spreads its sessions one a day; more sessions than days in a week
 * (running 8 times) need two on some days, so the daily cap grows to fit them.
 */
export function maxPerDay(task: AppTask): number | undefined {
  if (task.maxPerDayMinutes !== undefined || task.kind !== "habit") return task.maxPerDayMinutes;
  if (task.sessionMinutes === undefined) return undefined;
  return task.sessionMinutes * Math.max(1, Math.ceil((task.sessionsPerWeek ?? 0) / 7));
}

export function toEngineTasks(data: AppData, now: number): Task[] {
  const effort = samples(data);
  const tz = data.settings.timezone;
  const kept = keptDays(data, now);
  // What the planner reserves is what the screens show as «Faltan» (progress applies the
  // materia's learned effort ratio), so they cannot diverge.
  const planned = (p: TaskProgress) => p.remainingMinutes;
  return progress(data, now)
    .filter((p) => p.deadline > now && (p.remainingMinutes > 0 || p.minRemainingMinutes > 0))
    .map((p) => ({
      id: p.task.id,
      activityId: p.task.activityId,
      title: p.task.title,
      deadline: p.deadline,
      remainingMinutes: Math.ceil(planned(p)),
      minRemainingMinutes: Math.ceil(Math.min(planned(p), p.minRemainingMinutes)),
      sessionMinutes: p.task.sessionMinutes,
      // A weekly study silo with its total reserves exactly that: the last session is shorter.
      exactMinutes: (p.task.study && p.task.kind === "habit" && p.task.minMinutes > 0) || undefined,
      maxPerDayMinutes: maxPerDay(p.task),
      priority: p.task.priority,
      earliestStart: earliestStartOf(data, p.task),
      // An entrega can be handed in smaller: half its minimum, never below an hour
      // (study time, planned as block time like the rest).
      mvpMinutes:
        p.task.kind === "deliverable" && !isExam(data, p.task) && p.minRemainingMinutes > 60
          ? Math.max(60, Math.ceil(p.minRemainingMinutes / 2))
          : undefined,
      // Exams with weighed units can leave the lightest ones out; a unit with no weight
      // is of unknown importance, so it is never offered to leave out.
      units: weighedUnits(p, effortRatio(effort, p.task.activityId), planned(p)),
      reviewDates:
        p.task.exam && p.task.deadline ? examDays(tz, p.task.deadline, now).reviews : undefined,
      avoid: kept.filter((day) => day.activityId !== p.task.activityId).map((day) => day.span),
      // A weekly silo's target is its sessions: options can lower only its minimum.
      fixedTarget: p.task.kind === "habit" || undefined,
      // A routine behind is not a minimum missing for the others (lateRoutines forgives it).
      forgiving:
        (p.task.kind === "habit" &&
          data.activities.find((a) => a.id === p.task.activityId)?.kind === "rutina") ||
        undefined,
      validHours: data.activities.find((x) => x.id === p.task.activityId)?.validHours,
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
  merienda: "Merienda",
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
  ["merienda", /\b(merienda|merendar)/],
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

/** How the question about a meal put on top of study begins (the Bandeja words its «no» by it). */
export const MEAL_OVER_STUDY = "Una comida quedó encima de";

/** The events the planner reads: visible ones, with their places and meals. */
const plannerEvents = (data: AppData) => withMealEvents(withPlaces(data, visibleEvents(data)));

/** The stretches the plan keeps for trips (before and after located events), as it reserves them. */
export function travelIntervals(data: AppData): { start: number; end: number }[] {
  const travel = travelOptions(data);
  if (!travel) return [];
  return travelBuffers(plannerEvents(data), travel).busy.filter((i) => i.end > i.start);
}

/**
 * Whether `span` lands on something fixed: a busy event that is not flexible, or the time
 * the plan keeps for a trip. A meal is never dropped there by hand.
 */
export function onFixedOrTrip(data: AppData, span: { start: number; end: number }): boolean {
  const fixed = plannerEvents(data).filter((e) => e.busy && !e.allDay && !e.flexible);
  return [...fixed, ...travelIntervals(data)].some((i) => overlaps(i, span));
}

/**
 * Another fixed event that `event` overlaps at a different place (two classes at once in
 * two sites): the plan cannot get you to both, so its card says so.
 */
export function placeClash(data: AppData, event: AppEvent): AppEvent | undefined {
  return placeClashes(data, event).at(0);
}

/** Every fixed event that `event` overlaps at a different place (a card names them all). */
export function placeClashes(data: AppData, event: AppEvent): AppEvent[] {
  if (!event.busy || event.allDay || event.flexible) return [];
  const events = plannerEvents(data);
  const place = events.find((e) => e.id === event.id)?.location;
  if (!place) return [];
  return visibleEvents(data).filter((o) => {
    if (o.id === event.id || !o.busy || o.allDay || o.flexible || !overlaps(o, event)) return false;
    const there = events.find((e) => e.id === o.id)?.location;
    return !!there && there !== place;
  });
}

/** The day overrides the planner uses: late nights and, unless turned off, holidays. */
function overridesFor(data: AppData, now: number, from: number, to: number) {
  const base =
    data.preferences?.holidaysOff === false
      ? withLateNight(data, now)
      : withHolidays(withLateNight(data, now), data.settings.timezone, from, to);
  // Meals skipped or moved by hand ride along in that day's override, merged into the
  // one already there (a late night, a holiday): consumers keep one override per day.
  const byDate = new Map(base.map((o) => [o.date, o]));
  for (const { date, ...meal } of data.mealChoices ?? []) {
    const o = byDate.get(date);
    byDate.set(date, { ...o, date, meals: [...(o?.meals ?? []), meal] });
  }
  return [...byDate.values()];
}

/**
 * That day's waking hours as the planner sees them (minutes since its midnight; bed may
 * pass 1440): its routine, or the one a holiday borrows, with a late night's wake-up.
 */
export function wakingDay(data: AppData, now: number, date: string) {
  const tz = data.settings.timezone;
  const noon = zonedInstant(tz, date, 720);
  const o = overridesFor(data, now, noon, noon).find((x) => x.date === date);
  const routine = data.settings.week[o?.asWeekday ?? localParts(tz, noon).weekday];
  const wake = o?.wake ?? routine?.wake ?? 0;
  const rawBed = o?.bed ?? routine?.bed ?? 1440;
  return { wake, bed: rawBed <= wake ? rawBed + 1440 : rawBed };
}

/**
 * Where each meal between `from` and `to` happens: at its time unless a fixed event,
 * its travel or a block pinned by hand is there, then at the closest free time.
 * A day already over is not worked out again (SPEC §5): its meals are where `mealRuns`
 * says they were; what the runs do not have (data from before them) is worked out as before.
 */
export function mealTimes(data: AppData, now: number, from: number, to: number): MealTime[] {
  const worked = workedMealTimes(data, now, from, to);
  const runs = data.mealRuns;
  if (!runs?.length) return worked;
  const tz = data.settings.timezone;
  const today = localParts(tz, now).date;
  const out: MealTime[] = [];
  const seen = new Set<string>();
  for (const m of worked) {
    const kept = pastOrSame(data, runs, today, m);
    if (m.kind && (m.date < today || todayRun(runs, m.kind, today, m.date))) {
      seen.add(`${m.kind}|${m.date}`);
    }
    if (kept) out.push(kept);
  }
  // A meal the settings no longer have (or have somewhere else) was still there that day.
  const startDay = localParts(tz, from).date;
  const endDay = localParts(tz, to).date;
  for (let date = startDay; date <= endDay && date <= today; date = addDays(date, 1)) {
    for (const run of runs) {
      if (run.weekday !== weekdayOf(date) || seen.has(`${run.meal}|${date}`)) continue;
      if (!(run.from <= date && (!run.to || date <= run.to))) continue;
      // Today only has what was written down this very day (see `keepStartedMeals`).
      if (date === today && run.from !== today) continue;
      const meal = pastMeal(tz, date, run.meal, run, 0, undefined);
      if (meal.at && meal.at.end > from && meal.at.start < to) out.push(meal);
    }
  }
  return out.sort((a, b) => (a.at?.start ?? 0) - (b.at?.start ?? 0));
}

/** One worked meal as it stands: today and later as worked; a day that is over as its run says. */
function pastOrSame(
  data: AppData,
  runs: readonly MealRun[],
  today: string,
  m: MealTime,
): MealTime | null {
  if (!m.kind || !m.at) return m;
  if (m.date === today) {
    const kept = todayRun(runs, m.kind, today, m.date);
    return kept ? pastMeal(data.settings.timezone, m.date, m.kind, kept, m.latest, m.chosen) : m;
  }
  if (m.date > today) return m;
  const run = runAt(runs, m.kind, m.date) ?? firstRun(runs, m.kind, m.date);
  if (run) return pastMeal(data.settings.timezone, m.date, m.kind, run, m.latest, m.chosen);
  // A meal added after that day was written down: the past does not get it.
  const firstFrozen = runs.map((r) => r.from).sort()[0] ?? today;
  const written = m.date >= firstFrozen && data.mealsFrozenThrough !== undefined;
  return written ? null : m;
}

/** The run written today for `meal` (a meal that had begun when the week changed), if any. */
function todayRun(
  runs: readonly MealRun[],
  meal: MealKind,
  today: string,
  date: string,
): MealRun | undefined {
  if (date !== today) return undefined;
  const weekday = weekdayOf(today);
  return runs.find((r) => r.meal === meal && r.weekday === weekday && r.from === today);
}

/** A meal of a day that is over, as its run says: it is what it was, never moved or on top. */
function pastMeal(
  tz: string,
  date: string,
  kind: MealKind,
  run: MealRun,
  latest: number,
  chosen: boolean | undefined,
): MealTime {
  const midnight = zonedInstant(tz, date, 0);
  const at = { start: midnight + run.start * MINUTE, end: midnight + run.end * MINUTE };
  return {
    date,
    kind,
    preferred: at,
    at,
    ...(chosen ? { chosen } : {}),
    latest: latest || at.start,
  };
}

/** The run that says where `meal` was on `date` (its weekday's series). */
export function runAt(runs: readonly MealRun[], meal: MealKind, date: string): MealRun | undefined {
  const weekday = weekdayOf(date);
  return runs.find(
    (r) => r.meal === meal && r.weekday === weekday && r.from <= date && (!r.to || date <= r.to),
  );
}

/**
 * A day before the first run of its series (older than the longest catch-up): the first
 * run is the best record of what was shown, so the past still does not move with settings.
 */
function firstRun(runs: readonly MealRun[], meal: MealKind, date: string): MealRun | undefined {
  const weekday = weekdayOf(date);
  const series = runs.filter((r) => r.meal === meal && r.weekday === weekday);
  const first = series.reduce<MealRun | undefined>(
    (a, r) => (!a || r.from < a.from ? r : a),
    undefined,
  );
  return first && date < first.from ? first : undefined;
}

/**
 * Today's blocks that already started: they stay where they were (the plan is not worked
 * out again under them), so a meal never lands on top of one.
 */
function startedToday(data: AppData, now: number): PlanBlock[] {
  const tz = data.settings.timezone;
  const dayStart = zonedInstant(tz, localParts(tz, now).date, 0);
  return data.plan.filter((b) => b.start >= dayStart && b.start <= now);
}

/** What a meal goes around: busy events, their trips, running pins and blocks already started. */
function mealBusy(data: AppData, now: number, events: ReturnType<typeof plannerEvents>) {
  const travel = travelOptions(data);
  return [
    ...events.filter((e) => e.busy && !e.allDay),
    ...(travel ? travelBuffers(events, travel).busy : []),
    ...(data.pins ?? []).filter((p) =>
      data.tasks.some((t) => t.id === p.taskId && isRunning(t, now)),
    ),
    ...startedToday(data, now),
  ];
}

function workedMealTimes(data: AppData, now: number, from: number, to: number): MealTime[] {
  const events = plannerEvents(data);
  const busy = mealBusy(data, now, events);
  return placeMeals(
    withMeals(data.settings),
    overridesFor(data, now, from, to),
    from,
    to,
    busy,
    events,
  );
}

/**
 * The longest catch-up. It is also how far back the very first one goes (a new account,
 * a demo just created, the first time this version opens): every day before today shows
 * what the settings in force say, never what a later change would make of it.
 */
const FREEZE_MAX_DAYS = 60;

/**
 * Writes down the meals of every day that is over and not yet written (from the last
 * frozen day to yesterday): for each meal, if its time matches the run standing for its
 * meal and weekday nothing changes; if not, that run closes the day before this date and
 * a new one opens on it. Meant to run on opening the app, before any change of settings
 * applies, so a gap of several days is written with the settings that were in force.
 */
export function freezeMeals(data: AppData, now: number): AppData {
  const tz = data.settings.timezone;
  const today = localParts(tz, now).date;
  const yesterday = addDays(today, -1);
  const last = data.mealsFrozenThrough;
  if (last !== undefined && last >= yesterday) return data;
  const earliest = addDays(today, -FREEZE_MAX_DAYS);
  const first = last === undefined || addDays(last, 1) < earliest ? earliest : addDays(last, 1);
  // One pass over the whole stretch, then written day by day in order.
  const worked = workedMealTimes(data, now, zonedInstant(tz, first, 0), zonedInstant(tz, today, 0));
  let runs = [...(data.mealRuns ?? [])];
  for (let date = first; date <= yesterday; date = addDays(date, 1)) {
    runs = freezeDay(zonedInstant(tz, date, 0), date, worked, runs);
  }
  return { ...data, mealRuns: runs, mealsFrozenThrough: yesterday };
}

/** `runs` with the meals of `date` written in (see `freezeMeals`). */
function freezeDay(midnight: number, date: string, worked: MealTime[], runs: MealRun[]): MealRun[] {
  const weekday = weekdayOf(date);
  let out = runs;
  const written = (meal: MealKind) =>
    runs.some((r) => r.meal === meal && r.weekday === weekday && r.from === date);
  for (const m of worked) {
    if (!m.at || !m.kind || m.date !== date) continue;
    // A meal kept as it was when the week changed that day is already written down.
    if (written(m.kind)) continue;
    const start = Math.round((m.at.start - midnight) / MINUTE);
    const end = Math.round((m.at.end - midnight) / MINUTE);
    out = withRun(out, { meal: m.kind, weekday, from: date, start, end });
  }
  // A meal this day does not have (taken out of the settings) closes its standing run.
  const had = new Set(worked.filter((m) => m.date === date && m.at).map((m) => m.kind));
  return out.map((r) =>
    r.weekday === weekday && !r.to && r.from < date && !had.has(r.meal)
      ? { ...r, to: addDays(date, -1) }
      : r,
  );
}

/**
 * Changing Mi semana does not rewrite what already happened today: the meals of today that
 * had begun by `now` stay as `prev` had them (written as runs that stand from today, like a
 * day that is over); the ones still to come take the new settings. `prev` is the data
 * before the change, already frozen through yesterday.
 */
export function keepStartedMeals(prev: AppData, next: AppData, now: number): AppData {
  const tz = prev.settings.timezone;
  const today = localParts(tz, now).date;
  const midnight = zonedInstant(tz, today, 0);
  const end = zonedInstant(tz, addDays(today, 1), 0);
  const started = mealTimes(prev, now, midnight, end).filter(
    (m) => m.date === today && m.kind && m.at && m.at.start <= now,
  );
  const after = mealTimes(next, now, midnight, end);
  const weekday = weekdayOf(today);
  const old = next.mealRuns ?? [];
  let runs = old;
  for (const m of started) {
    const { kind, at } = m;
    if (!kind || !at) continue;
    const written = runs.some((r) => r.meal === kind && r.weekday === weekday && r.from === today);
    const same = after.some(
      (a) => a.kind === kind && a.at?.start === at.start && a.at.end === at.end,
    );
    if (written || same) continue;
    const run = {
      meal: kind,
      weekday,
      from: today,
      start: Math.round((at.start - midnight) / MINUTE),
      end: Math.round((at.end - midnight) / MINUTE),
    };
    runs = openFromToday(runs, run);
  }
  if (runs === old) return next;
  return {
    ...next,
    mealRuns: runs,
    mealsFrozenThrough: next.mealsFrozenThrough ?? addDays(today, -1),
  };
}

/** `runs` with `run` standing from today, even when the standing one says the same time. */
function openFromToday(runs: MealRun[], run: MealRun): MealRun[] {
  const standing = runs.find((r) => r.meal === run.meal && r.weekday === run.weekday && !r.to);
  return [...runs.map((r) => (r === standing ? { ...r, to: addDays(run.from, -1) } : r)), run];
}

/** `runs` with `run` standing from its date: the open run of its series closes the day before. */
function withRun(runs: MealRun[], run: MealRun): MealRun[] {
  const standing = runs.find((r) => r.meal === run.meal && r.weekday === run.weekday && !r.to);
  if (standing?.start === run.start && standing.end === run.end) return runs;
  return [...runs.map((r) => (r === standing ? { ...r, to: addDays(run.from, -1) } : r)), run];
}

/**
 * Whether pinning `block` at `start` leaves a meal on top of it: meals go around a pin,
 * but one with no room near its time (or put there by hand) stays where it is (§5.1).
 */
export function mealOverPin(data: AppData, now: number, block: PlanBlock, start: number): boolean {
  const pin = pinBlock(block, start);
  const next = { ...data, pins: [...(data.pins ?? []).filter((p) => p.id !== block.id), pin] };
  return mealTimes(next, now, pin.start - 1440 * MINUTE, pin.end + 1440 * MINUTE).some(
    (m) => m.at && overlaps(m.at, pin),
  );
}

/** The meals of a day in the order they are eaten (those that exist). */
const MEAL_ORDER: MealKind[] = ["desayuno", "almuerzo", "merienda", "cena"];

/**
 * Whether a meal of `length` minutes starting at `minute` of `date` would sit before the
 * day's previous meal ends or after its next one starts: breakfast, lunch, snack and
 * dinner keep their order (the ones that exist that day).
 */
export function mealOutOfOrder(
  data: AppData,
  now: number,
  date: string,
  kind: MealKind,
  minute: number,
  length: number,
): boolean {
  const tz = data.settings.timezone;
  const midnight = zonedInstant(tz, date, 0);
  const start = midnight + minute * MINUTE;
  const end = start + length * MINUTE;
  const rank = MEAL_ORDER.indexOf(kind);
  return mealTimes(data, now, midnight, zonedInstant(tz, addDays(date, 1), 0)).some((m) => {
    if (m.date !== date || !m.kind || !m.at || m.kind === kind) return false;
    return MEAL_ORDER.indexOf(m.kind) < rank ? start < m.at.end : end > m.at.start;
  });
}

/** A meal put by hand on top of something fixed that has free room in its range: «¿Movés …?». */
export interface MealOffer {
  date: string;
  kind: MealKind;
  /** Where it is now. */
  at: Interval;
  /** Minutes since that day's midnight of the free time it could go to. */
  minute: number;
  /** That free time as an instant. */
  to: number;
}

/**
 * Meals put by hand on an event or a trip (they stay: one can eat during it) that have a
 * free gap within reach of their time: asked once per meal and day (`asked`), whatever the
 * answer. A meal the plan put is moved by the plan instead.
 */
export function mealOffers(data: AppData, now: number): MealOffer[] {
  const meals = mealTimes(data, now, now, now + 7 * 1440 * MINUTE);
  const busy = mealBusy(data, now, plannerEvents(data));
  return meals.flatMap((m) => {
    const offer = offerFor(data, now, m, meals, busy);
    return offer ? [offer] : [];
  });
}

/** A meal put by hand on something fixed, still to come, whose move was never asked. */
function askable(data: AppData, now: number, m: MealTime, kind: string, at: Interval): boolean {
  if (!m.chosen || at.end <= now || !onFixedOrTrip(data, at)) return false;
  return !data.mealChoices?.some((c) => c.date === m.date && c.kind === kind && c.asked);
}

/** The offer for one meal, if it is one put by hand on something fixed with a free gap near. */
function offerFor(
  data: AppData,
  now: number,
  m: MealTime,
  meals: readonly MealTime[],
  busy: readonly Interval[],
): MealOffer | null {
  const tz = data.settings.timezone;
  const { kind, at } = m;
  if (!kind || !at || !askable(data, now, m, kind, at)) return null;
  const others = meals.flatMap((o) => (o.date === m.date && o.kind !== kind && o.at ? [o.at] : []));
  const { wake, bed } = wakingDay(data, now, m.date);
  const free = placeMeal(
    at,
    [...busy, ...others],
    zonedInstant(tz, m.date, bed),
    Math.max(zonedInstant(tz, m.date, wake), now),
    kind === "desayuno",
  );
  if (!free || free.start === at.start || free.start < now) return null;
  const minute = Math.round((free.start - zonedInstant(tz, m.date, 0)) / MINUTE);
  if (mealOutOfOrder(data, now, m.date, kind, minute, (at.end - at.start) / MINUTE)) return null;
  return { date: m.date, kind, at, minute, to: free.start };
}

/**
 * Meals within the next week with no room near their time (they sit on top of something
 * fixed), until their last possible start.
 */
export function missedMeals(data: AppData, now: number): MealTime[] {
  return mealTimes(data, now, now, now + 7 * 1440 * MINUTE).filter(
    // As placeMeals keeps it: until the later of its last possible start and its end.
    (m) => m.overlapping && Math.max(m.latest, m.at?.end ?? 0) > now,
  );
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

/** What a routine's week holds (SPEC §18 punto 13): the one count every screen reads. */
export interface RoutineWeek {
  taskId: string;
  activityId: string;
  name: string;
  /** Sessions the week asks (done, plus what is missing within the days that can still hold one). */
  wanted: number;
  /** Done (checked, or planned and already over). */
  done: number;
  /** Still planned from now to the end of that week. */
  planned: number;
  /** `done + planned`, never above `wanted`: what the week really holds. */
  placed: number;
  /** It is the week after the one under way, not this one. */
  next: boolean;
  /**
   * Why it falls short, when it does and the plan is known: `own` it would not fit with
   * nothing else to do (the days or its franja do not hold it), `others` the other tasks
   * take the room.
   */
  reason?: "own" | "others";
}

/** A routine whose week has no room for all its sessions: `placed` of `wanted` go in. */
export type RoutineShort = RoutineWeek;

/**
 * The count of one routine in the week `weekAt` is in: done, planned and what fits. With
 * the plan's `input`, a short week of the current week also says whether it would fit
 * with nothing else to do (the same «alone» plan the options use).
 */
export function routineWeek(
  data: AppData,
  now: number,
  blocks: readonly PlanBlock[],
  task: AppTask,
  input?: ScheduleInput,
  weekAt = now,
): RoutineWeek | undefined {
  const activity = data.activities.find((a) => a.id === task.activityId);
  if (!activity || !runsAsRoutine(data, task, now)) return undefined;
  const tz = data.settings.timezone;
  const wanted = routineSessions(data, task, now, weekAt);
  // The whole week as the grid shows it: sessions done, past blocks not yet answered
  // (planned and over) and the blocks still planned.
  const done = routineDone(data, task, now, weekAt);
  const planned = plannedIn(data, blocks, task, now, weekAt);
  const week: RoutineWeek = {
    taskId: task.id,
    activityId: activity.id,
    name: activity.name,
    wanted,
    done,
    planned,
    placed: Math.min(wanted, done + planned),
    next: weekAt >= endOfWeek(tz, now),
  };
  const reason =
    week.placed < wanted ? shortReason(data, now, week, task, input, weekAt) : undefined;
  return reason ? { ...week, reason } : week;
}

/** The blocks of a task still planned from `now` in the week `weekAt` is in. */
function plannedIn(
  data: AppData,
  blocks: readonly PlanBlock[],
  task: AppTask,
  now: number,
  weekAt: number,
): number {
  const tz = data.settings.timezone;
  const monday = zonedInstant(tz, weekStart(tz, weekAt), 0);
  const end = endOfWeek(tz, weekAt);
  return blocks.filter(
    (b) => b.taskId === task.id && b.end > now && b.start >= monday && b.start < end,
  ).length;
}

/** Why a routine's week falls short: it would not fit even alone (`own`), or others take the room. */
function shortReason(
  data: AppData,
  now: number,
  week: RoutineWeek,
  task: AppTask,
  input: ScheduleInput | undefined,
  weekAt: number,
): "own" | "others" | undefined {
  // The days (or the franja) do not hold them: it would not fit with nothing else to do.
  if (routineCapacity(data, task, now, weekAt) < week.wanted) return "own";
  if (!input || weekAt !== now) return undefined;
  const alone = plannedIn(data, scheduleAlone(input, task.id).blocks, task, now, weekAt);
  return week.done + alone < week.wanted ? "own" : "others";
}

/**
 * Routines that do not fit whole in the week under way: what the plan really placed for
 * the rest of the week, against the sessions it asks. Paused and skipped ones are not
 * running, so they never show.
 */
export function routineShortfalls(
  data: AppData,
  now: number,
  blocks: readonly PlanBlock[],
  input?: ScheduleInput,
): RoutineShort[] {
  return data.tasks.flatMap((task) => {
    const week = routineWeek(data, now, blocks, task, input);
    return week && week.placed < week.wanted ? [week] : [];
  });
}

/**
 * The routines of the week after this one (SPEC §5.8): the plan always has this week and
 * the whole next one, Monday to Sunday, whatever the day. A routine is not left to what
 * the studies leave free: its next-week sessions are placed first, around the events
 * and what is already fixed for today, within its valid hours, its excluded days and its
 * daily cap, and the main plan then works around them. Past days are never touched.
 * `missing` is what could not be placed (target minutes by routine): it is reported with
 * the rest of what does not fit.
 */
function nextWeekRoutines(
  data: AppData,
  now: number,
  input: ScheduleInput,
  keep: PlanBlock[],
): { blocks: PlanBlock[]; missing: Map<string, number> } {
  const none = { blocks: [], missing: new Map<string, number>() };
  const tz = data.settings.timezone;
  const monday = zonedInstant(tz, nextWeekStart(tz, now), 0);
  const habits = new Set(data.tasks.filter((t) => t.kind === "habit").map((t) => t.id));
  if (habits.size === 0) return none;
  // Counted as the first moment of that week: a routine left out «this week only» is back.
  const weekData = { ...data, tasks: data.tasks.filter((t) => habits.has(t.id)) };
  const tasks = toEngineTasks(weekData, monday + 720 * MINUTE).map((t) => ({
    ...t,
    earliestStart: Math.max(t.earliestStart ?? 0, monday),
  }));
  if (tasks.length === 0) return none;
  // What is fixed for today only takes room: a routine's block of today is not one of
  // next week's sessions.
  const taken = keep.map((b) => (habits.has(b.taskId) ? { ...b, taskId: `${b.taskId}#now` } : b));
  const second = schedule({
    ...input,
    horizonEnd: endOfWeek(tz, monday),
    tasks,
    frozen: taken,
  });
  const have = new Set(keep.map((b) => b.id));
  const blocks = second.blocks.filter(
    (b) => habits.has(b.taskId) && b.start >= monday && !have.has(b.id),
  );
  const missing = new Map(
    second.status.filter((s) => s.targetDeficit > 0).map((s) => [s.taskId, s.targetDeficit]),
  );
  return { blocks, missing };
}

/** What the next week's routines could not place counts as missing, like anything that does not fit. */
function withMissing(result: ScheduleResult, missing: Map<string, number>): ScheduleResult {
  if (missing.size === 0) return result;
  const status = result.status.map((s) => {
    const m = missing.get(s.taskId) ?? 0;
    return m > 0
      ? {
          ...s,
          minDeficit: s.minDeficit + m,
          targetDeficit: s.targetDeficit + m,
          level: "critical" as const,
        }
      : s;
  });
  return { ...result, status };
}

/** When today's bedtime is, if an override sets it (as the planner reads it: at or before waking is after midnight). */
function bedInstant(
  tz: string,
  date: string,
  override: DayOverride | undefined,
  routine: { wake: number } | undefined,
): number | undefined {
  if (override?.bed === undefined) return undefined;
  const wake = override.wake ?? routine?.wake ?? 0;
  return zonedInstant(tz, date, override.bed <= wake ? override.bed + 1440 : override.bed);
}

/**
 * A routine that fell behind in the week under way plans the sessions that fit in what is
 * left of it; one that would only fit in the free-time hours of its day (late, after
 * «freeFrom») is not done. What does not fit is not reported as missing: the Bandeja says
 * how many fit (SPEC §18 punto 13). Its sessions are never red: a routine is not a
 * deadline. The next week asks for all.
 */
function lateRoutines(data: AppData, result: ScheduleResult): ScheduleResult {
  const late = new Set(
    data.tasks
      .filter(
        (t) =>
          t.kind === "habit" &&
          data.activities.find((a) => a.id === t.activityId)?.kind === "rutina",
      )
      .map((t) => t.id),
  );
  const tz = data.settings.timezone;
  const inFreeTime = (b: PlanBlock) => {
    const at = localParts(tz, b.start);
    return at.minuteOfDay >= (data.settings.week[at.weekday]?.freeFrom ?? 24 * 60);
  };
  const critical = result.blocks.filter((b) => late.has(b.taskId) && b.level === "critical");
  const dropped = critical.filter(inFreeTime);
  const short = result.status.some((s) => late.has(s.taskId) && s.minDeficit > 0);
  if (critical.length === 0 && !short) return result;
  return {
    ...result,
    blocks: result.blocks
      .filter((b) => !dropped.includes(b))
      .map((b) => (critical.includes(b) ? { ...b, level: "ok" as const } : b)),
    status: result.status.map((s) =>
      late.has(s.taskId) ? { ...s, minDeficit: 0, targetDeficit: 0, level: "ok" as const } : s,
    ),
  };
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
  // A trip kept since (a new place, longer minutes) takes that time as an event does.
  const trips = travelIntervals(data);
  const clashes = (b: PlanBlock) =>
    busy.some((e) => overlaps(e, b)) || trips.some((t) => overlaps(t, b));
  // A meal of today on top of a block (moved there by hand, or with no room) takes
  // that time: the block is planned again, as a proposal since it is today (§5.7).
  const meals = mealTimes(data, now, now, todayEnd).flatMap((m) => (m.at ? [m.at] : []));
  const eats = (b: PlanBlock) => meals.some((m) => overlaps(m, b));
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
  // Going to bed earlier (set by hand) frees the blocks that now end after it.
  const bedAt = bedInstant(tz, date, dayOverride, routine);
  const afterBed = (b: PlanBlock) => b.start > now && bedAt !== undefined && b.end > bedAt;
  const displaced = (b: PlanBlock) =>
    afterBed(b) || (plannableAt !== undefined && b.start > now && b.start < plannableAt);
  // Displaced blocks are planned again anyway: never a conflict to ask about.
  const conflicts = unpinned.filter(
    (b) => !displaced(b) && (clashes(b) || reserved(b) || eats(b) || tooEarly(b)),
  );
  const keep = [...unpinned.filter((b) => !conflicts.includes(b) && !displaced(b)), ...pins];

  const input = scheduleInput(data, now, keep);
  const next = nextWeekRoutines(data, now, input, keep);
  // Their time is taken before the studies are placed; as another task's, so they do not
  // count as this week's sessions.
  const held = next.blocks.map((b) => ({ ...b, taskId: `${b.taskId}#next` }));
  const main = schedule({ ...input, frozen: [...keep, ...held] });
  const placed = main.blocks.filter((b) => !b.taskId.endsWith("#next"));
  const settled = withMissing(
    lateRoutines(data, {
      ...main,
      blocks: [...placed, ...next.blocks].sort((a, b) => a.start - b.start),
    }),
    next.missing,
  );
  // A routine that fell behind is not reported as missing, so it is not why the plan fails
  // to fit either: it fits when no minimum is left short.
  const result = settled.feasible
    ? settled
    : { ...settled, feasible: settled.status.every((s) => s.minDeficit === 0) };
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
      // (past bedtime nothing stays: it would be studying while asleep).
      ...unpinned.filter((b) => displaced(b) && !afterBed(b)),
      // schedule() echoes frozen blocks, so pins on later days are already in keep.
      ...plan.filter((b) => b.start >= todayEnd && !keep.some((k) => k.id === b.id)),
    ],
    input,
    result,
    proposal: {
      id: `conflict@${now}`,
      message: conflicts.some(clashes)
        ? `Un evento nuevo pisa ${names.join(", ")}. ¿Reacomodo el día?`
        : conflicts.some(eats)
          ? `${MEAL_OVER_STUDY} ${names.join(", ")}. ¿Reacomodo el día?`
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
  const answered = new Set(standingCheckIns(data).map((c) => c.blockId));
  return data.plan
    .filter((b) => b.end <= now && !answered.has(b.id))
    .sort((a, b) => a.start - b.start);
}

export interface Decisions {
  /** The options that help; each one's plan is worked out when this is first read. */
  readonly options: PlanOption[];
  /** Whether any option helps: stops at the first one, so counting the Bandeja is cheap. */
  readonly hasOptions: boolean;
  recommendations: Recommendation[];
  /** Tasks whose minimum does not fit even alone: the cause no cut elsewhere fixes. */
  impossible: string[];
  /** Of those, the ones no offered option fits: the Bandeja names only these as the cause. */
  readonly noFits: string[];
}

/**
 * What choosing an option really gives: its changes applied to the user's data and the
 * plan worked out again, as the app does (routines of next week placed first, a routine
 * that fell behind not reported as missing). The engine's own preview knows neither, so a
 * card could promise «todavía faltaría tiempo» for a plan that fits, or the other way
 * round. A minimum named in a label is the one the screens then show, in their format.
 */
function simulated(
  from: { data: AppData; now: number },
  input: ScheduleInput,
  option: PlanOption,
): PlanOption {
  const after = applyOption(from.data, input, option, from.now);
  // The minimum the task keeps: the one the ficha, the form and «Repartir tiempo» show.
  const keptTask = after.tasks.find((t) => t.id === option.taskId);
  const kept = keptTask && editedMinimum(keptTask);
  const named =
    kept !== undefined && (option.kind === "lower-minimum" || option.kind === "minimum-viable")
      ? option.label.replace(/\(([^()]*)\)$| a (\d\S*)$/, (all: string) =>
          all.startsWith(" a ") ? ` a ${hours(kept)}` : `(${hours(kept)})`,
        )
      : option.label;
  // Planning again is what costs: only done when the card is drawn (or the option is
  // checked), not to count what waits in the Bandeja.
  let real: ScheduleResult | undefined;
  return {
    ...option,
    label: named,
    get result() {
      real ??= refreshPlan(after, from.now).result;
      return real;
    },
  };
}

/**
 * «Quedarme con el mínimo» promises the targets are covered. When the cut cannot be made
 * in the tasks (with parts, what is left is measured by them, so a lower estimate changes
 * nothing), choosing it would only say «Listo» and leave the plan as it was: it is not
 * offered. Checked by the plan it really gives.
 */
function keepsItsPromise(
  input: ScheduleInput,
  result: ScheduleResult,
  option: PlanOption,
): boolean {
  if (option.kind !== "minimum-only") return true;
  // Tasks with no minimum are not cut (cutting them to 0 is «No hacer»).
  const cuttable = new Set(input.tasks.filter((t) => t.minRemainingMinutes > 0).map((t) => t.id));
  const short = new Set(
    result.status
      .filter((s) => s.minDeficit === 0 && s.targetDeficit > 0 && cuttable.has(s.taskId))
      .map((s) => s.taskId),
  );
  return !option.result.status.some((s) => short.has(s.taskId) && s.targetDeficit > 0);
}

/** Ids of the options chosen that still stand (not undone, not archived). */
function takenOptions(data: AppData, now: number): Set<string> {
  const taken = new Set<string>();
  for (const d of data.applied ?? []) {
    if (d.at <= now - DECISIONS_SHOWN_MS) continue;
    const id = d.id.split("@").at(0) ?? "";
    // Free time never had tasks: it stands while the week it lent is not over.
    const stands =
      d.before.length === 0
        ? id === "use-free-time" && (data.freeTimeUntil ?? 0) > now
        : undoable(data, d).length > 0;
    if (stands) taken.add(id);
  }
  return taken;
}

/**
 * Whether an option contradicts a decision that still stands: free time and «quedarme con
 * el mínimo» are two ways out of the same shortfall (and not offered twice), and a lower
 * minimum, a smaller version and «No hacer» are three for the same task.
 */
function opposed(option: PlanOption, taken: ReadonlySet<string>): boolean {
  // «Un poco de todo» taken stands until undone: it is not offered again (§5.6).
  if (option.kind === "proportional") return taken.has(option.id);
  if (option.kind === "use-free-time" || option.kind === "minimum-only") {
    const other = option.kind === "use-free-time" ? "minimum-only" : "use-free-time";
    return taken.has(option.id) || taken.has(other);
  }
  if (!option.taskId) return false;
  const own = ["lower-minimum", "minimum-viable", "drop"];
  return own.some((k) => k !== option.kind && taken.has(`${k}:${option.taskId}`));
}

/**
 * «Mezclá más materias por hoy»: what the button really does (the plan worked out again
 * as the app does, with the rule relaxed until tonight) against the plan now. The minutes
 * are what that plan gains, without the tasks that fit nowhere anyway (they stay short
 * either way and would inflate it); once it is applied there is nothing left to suggest.
 */
function relaxRecommendations(
  from: { data: AppData; now: number },
  result: ScheduleResult,
  impossible: readonly string[],
): Recommendation[] {
  const { data, now } = from;
  if ((data.relaxContextUntil ?? 0) > now) return [];
  const until = endOfDay(data.settings.timezone, now);
  const relaxedData = { ...data, relaxContextUntil: until };
  const plan = refreshPlan(relaxedData, now);
  const free = (r: ScheduleResult) =>
    r.blocks
      .filter((b) => b.soft && !b.frozen)
      .reduce((sum, b) => sum + (b.end - b.start) / MINUTE, 0);
  const lack = (r: ScheduleResult) =>
    r.status
      .filter((s) => !impossible.includes(s.taskId))
      .reduce((sum, s) => sum + s.targetDeficit, 0);
  const savedFree = Math.round(free(result) - free(plan.result));
  const savedDeficit = Math.round(lack(result) - lack(plan.result));
  const fixes = !result.feasible && plan.result.feasible;
  const reasons = [
    ...(fixes ? ["llegás a todos los mínimos"] : []),
    ...(savedFree > 0 ? [`te ahorrás ${savedFree} min de tiempo libre`] : []),
    ...(savedDeficit > 0 ? [`cubrís ${savedDeficit} min más`] : []),
  ];
  if (reasons.length === 0) return [];
  return [
    {
      id: "relax-context",
      message: `Si mezclás más materias por día, ${joinList(reasons)}.`,
      input: plan.input,
      result: plan.result,
    },
  ];
}

export function decisions(
  input: ScheduleInput,
  result: ScheduleResult,
  /** With the user's data, the options are checked to do what they say. */
  from?: { data: AppData; now: number },
): Decisions {
  const impossible = result.feasible ? [] : selfShort(input, result);
  const offered = result.feasible
    ? targetOptions(input, result)
    : infeasibilityOptions(input, result, impossible);
  if (!from) {
    return {
      options: offered,
      hasOptions: offered.length > 0,
      recommendations: recommendations(input, result),
      impossible,
      noFits: impossible,
    };
  }
  // Each is the plan it really gives: one that reaches no minimum the plan did not is no way
  // out. That plan is only worked out when asked: to know whether there is any option it
  // stops at the first that helps, and the list is filtered when the Bandeja draws it.
  const taken = takenOptions(from.data, from.now);
  const tried = offered.filter((o) => !opposed(o, taken)).map((o) => simulated(from, input, o));
  const helps = (o: PlanOption) =>
    keepsItsPromise(input, result, o) &&
    (result.feasible || (improves(result, o.result) && cutsItsOwn(impossible, o)));
  let kept: PlanOption[] | undefined;
  let suggested: Recommendation[] | undefined;
  return {
    get options() {
      kept ??= tried.filter(helps);
      return kept;
    },
    get hasOptions() {
      return kept ? kept.length > 0 : tried.some(helps);
    },
    get recommendations() {
      suggested ??= relaxRecommendations(from, result, impossible);
      return suggested;
    },
    impossible,
    get noFits() {
      const offered = this.options;
      return impossible.filter((id) => !offered.some((o) => reaches(o, id)));
    },
  };
}

/** Whether the plan an option gives meets the minimum of a task (it is not short in it). */
function reaches(option: PlanOption, taskId: string): boolean {
  if (option.kind === "drop") return false;
  const s = option.result.status.find((x) => x.taskId === taskId);
  return s !== undefined && s.minDeficit === 0;
}

/**
 * An option about a task that fits nowhere (a smaller version, an earlier start) is only
 * a way out if the task then fits: otherwise its card would promise «llegás a todo menos»
 * that very task. Same for the rest: what only leaves a task short is no way out.
 */
function cutsItsOwn(impossible: readonly string[], option: PlanOption): boolean {
  if (
    option.kind === "drop" ||
    option.kind === "start-earlier" ||
    !option.taskId ||
    !impossible.includes(option.taskId)
  )
    return true;
  return reaches(option, option.taskId);
}

/** Whether an option reaches every minimum but those of tasks that fit nowhere anyway. */
export function onlyImpossibleLeft(option: PlanOption, impossible: readonly string[]): boolean {
  const short = option.result.status.filter((s) => s.minDeficit > 0);
  return short.length > 0 && short.every((s) => impossible.includes(s.taskId));
}

/** The «puedo empezar» an earlier start becomes: a date, or right away. */
export function startAfterAt(tz: string, at: number | undefined, now: number): StartAfter {
  if (at === undefined || at <= now) return { now: true };
  // The engine offers starts of local days, so this is the day it tested.
  return { date: localParts(tz, at).date };
}

/** Decisions shown in the inbox this long; older ones are archived (kept, not listed). */
export const DECISIONS_SHOWN_MS = 7 * 86_400_000;

/**
 * Routines an older decision dropped for good come back: a decision about a routine
 * holds for the week it was made in. One made this week becomes a skip until the week
 * ends; one from an earlier week just comes back. A routine the user ended themself
 * (`endedAt`) is left alone. Same data back when nothing changes.
 */
export function routinesBack(data: AppData, now: number): AppData {
  const tz = data.settings.timezone;
  const until = new Map<string, number>();
  for (const d of data.applied ?? []) {
    for (const id of d.dropped ?? []) {
      // The latest decision about it is the one that counts.
      until.set(id, Math.max(until.get(id) ?? 0, endOfWeek(tz, d.at)));
    }
  }
  if (until.size === 0) return data;
  let changed = false;
  const tasks = data.tasks.map((t) => {
    const end = until.get(t.id);
    if (end === undefined || t.kind !== "habit" || t.status !== "dropped" || t.endedAt) return t;
    changed = true;
    return { ...t, status: "active" as const, ...(end > now ? { skipUntil: end } : {}) };
  });
  if (!changed) return data;
  // Those records are settled: they no longer say the routine is dropped.
  const applied = data.applied?.map((d) => {
    const back = d.dropped?.filter((id) => {
      const t = tasks.find((x) => x.id === id);
      return t?.kind === "habit" && until.has(id);
    });
    if (!back?.length) return d;
    const rest = d.dropped?.filter((id) => !back.includes(id)) ?? [];
    const after = d.after && { ...d.after };
    for (const id of back) if (after?.[id] === "dropped") after[id] = "active";
    return {
      ...d,
      ...(after ? { after } : {}),
      dropped: rest.length ? rest : undefined,
      skipUntil: {
        ...d.skipUntil,
        ...Object.fromEntries(back.map((id) => [id, endOfWeek(tz, d.at)])),
      },
    };
  });
  return { ...data, tasks, applied };
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
    // A routine is left out for this week only: next week the plan places it again.
    if (!next && task.kind === "habit")
      return { ...task, skipUntil: endOfWeek(data.settings.timezone, now) };
    if (!next) return { ...task, status: "dropped" as const };
    const out = new Set(option.kind === "prioritize" ? (option.unitIds ?? []) : []);
    return {
      ...task,
      ...(option.kind === "start-earlier" && option.taskId === task.id
        ? { startAfter: startAfterAt(data.settings.timezone, option.startAt, now) }
        : {}),
      ...minutesAfter(data, task, old, next, option.kind),
      units: out.size
        ? task.units.map((u) => (out.has(u.id) ? { ...u, skipped: true } : u))
        : task.units,
    };
  });
  return { ...data, tasks };
}

/**
 * The figures a kind of option changes, in whole study minutes (the engine cuts block
 * time): a lower minimum or a share of the minimums change only `minMinutes`;
 * «quedarme con el mínimo» only the estimate; a smaller version both. Never 0 (that is «No hacer»),
 * never above what the task had, and what the option does not name is left as it is.
 */
function minutesAfter(
  data: AppData,
  task: AppTask,
  old: Task,
  next: Task,
  kind: PlanOption["kind"],
): Partial<Pick<AppTask, "minMinutes" | "estimateMinutes">> {
  if (kind === "minimum-only") return estimateAfter(task, old, next);
  if (kind !== "lower-minimum" && kind !== "minimum-viable" && kind !== "proportional") return {};
  if (next.minRemainingMinutes >= old.minRemainingMinutes) return {};
  return {
    minMinutes: minimumAfter(data, task, next),
    ...(kind === "minimum-viable" ? estimateAfter(task, old, next) : {}),
  };
}

/**
 * The estimate goes down by the study time the option takes off what is left (what is
 * left is measured from it, with parts capped by it): «quedarme con el mínimo», and a
 * smaller version, which is the whole delivery then.
 */
function estimateAfter(task: AppTask, old: Task, next: Task) {
  const cut = Math.round(old.remainingMinutes - next.remainingMinutes);
  // Quarter hours (as the sliders): the hours up, never above what the task had.
  const left = Math.max(1, Math.round(task.estimateMinutes) - cut);
  return cut > 0
    ? { estimateMinutes: Math.min(Math.round(task.estimateMinutes), ceilStep(left)) }
    : {};
}

/** The stored minimum that leaves what the option previewed (what was done counts in it). */
function minimumAfter(data: AppData, task: AppTask, next: Task): number {
  const done =
    task.kind === "habit"
      ? 0
      : Math.ceil(
          standingCheckIns(data)
            .filter((c) => c.taskId === task.id)
            .reduce((s, c) => s + c.minutesDone, 0),
        );
  // Quarter hours (as the sliders): the minimum down.
  const exact = Math.round(next.minRemainingMinutes) + done;
  const minimum = floorStep(exact) || exact;
  const cap = task.minMinutes > 0 ? Math.round(task.minMinutes) : minimum;
  return Math.max(1, Math.min(cap, minimum));
}
