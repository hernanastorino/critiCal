import { buildSlots, type Slot } from "./availability";
import { type TravelOptions, travelBuffers } from "./travel";
import {
  type Activity,
  type CalendarEvent,
  type DayOverride,
  type Interval,
  type Level,
  MINUTE,
  type PlanBlock,
  type Settings,
  type Task,
  type TaskStatus,
} from "./types";

export interface ScheduleInput {
  now: number;
  horizonEnd: number;
  settings: Settings;
  activities: readonly Activity[];
  tasks: readonly Task[];
  events: readonly CalendarEvent[];
  /** Blocks that must not move (in progress or already seen today). */
  frozen?: readonly PlanBlock[];
  overrides?: readonly DayOverride[];
  travel?: TravelOptions;
  /** Let academic work use free time. */
  allowFreeTime?: boolean;
  /** Overrides settings.maxActivitiesPerDay. */
  maxActivitiesPerDay?: number;
}

export interface ScheduleResult {
  blocks: PlanBlock[];
  status: TaskStatus[];
  /** Every minimum fits. */
  feasible: boolean;
  unresolvedLocations: string[];
}

// Scoring weights, in "minutes of badness".
const W = {
  newActivityOnDay: 60,
  sameActivityOnDay: -30,
  contextSwitch: 45,
  continuesTask: -20,
  outsidePreferred: 40,
  freeTime: 120,
  perDayLater: 10,
  perDayLaterUrgent: 120,
};

interface Prepared {
  task: Task;
  activity: Activity;
  /** Minimum minutes still to place. */
  min: number;
  /** Target minutes still to place (≥ min). */
  target: number;
  frozenMinutes: number;
  chunkSlots: number;
}

class Board {
  readonly owner: (string | null)[];
  readonly dayLoad = new Map<string, number>();
  readonly dayActivities = new Map<string, Map<string, number>>();
  readonly dayTask = new Map<string, number>();

  constructor(
    readonly slots: Slot[],
    readonly slotMinutes: number,
  ) {
    this.owner = slots.map(() => null);
  }

  contiguous(i: number): boolean {
    const a = this.slots[i];
    const b = this.slots[i + 1];
    return !!a && !!b && a.end === b.start;
  }

  assign(i: number, p: Prepared): void {
    const slot = this.slots[i] as Slot;
    this.owner[i] = p.task.id;
    this.dayLoad.set(slot.date, (this.dayLoad.get(slot.date) ?? 0) + this.slotMinutes);
    const acts = this.dayActivities.get(slot.date) ?? new Map<string, number>();
    acts.set(p.activity.id, (acts.get(p.activity.id) ?? 0) + 1);
    this.dayActivities.set(slot.date, acts);
    const key = `${p.task.id}|${slot.date}`;
    this.dayTask.set(key, (this.dayTask.get(key) ?? 0) + this.slotMinutes);
  }

  unassign(i: number, p: Prepared): void {
    const slot = this.slots[i] as Slot;
    this.owner[i] = null;
    this.dayLoad.set(slot.date, (this.dayLoad.get(slot.date) ?? 0) - this.slotMinutes);
    const acts = this.dayActivities.get(slot.date) as Map<string, number>;
    const left = (acts.get(p.activity.id) ?? 1) - 1;
    if (left === 0) acts.delete(p.activity.id);
    else acts.set(p.activity.id, left);
    const key = `${p.task.id}|${slot.date}`;
    this.dayTask.set(key, (this.dayTask.get(key) ?? 0) - this.slotMinutes);
  }
}

export function schedule(input: ScheduleInput): ScheduleResult {
  const { settings, now } = input;
  const slotMinutes = settings.slotMinutes;
  const frozen = input.frozen ?? [];
  const activityById = new Map(input.activities.map((a) => [a.id, a]));
  const maxActivities = input.maxActivitiesPerDay ?? settings.maxActivitiesPerDay;

  const travel = input.travel
    ? travelBuffers(input.events, input.travel)
    : { busy: [], unresolved: [] };
  const busy: Interval[] = [
    ...input.events.filter((e) => e.busy && !e.allDay),
    ...travel.busy,
    ...frozen,
  ];
  const board = new Board(
    buildSlots(settings, input.overrides ?? [], now, input.horizonEnd, busy),
    slotMinutes,
  );

  const prepared: Prepared[] = [];
  for (const task of input.tasks) {
    const activity = activityById.get(task.activityId);
    if (!activity)
      throw new Error(`Task ${task.id} references unknown activity ${task.activityId}`);
    const frozenMinutes = frozen
      .filter((b) => b.taskId === task.id)
      .reduce((sum, b) => sum + (b.end - b.start) / MINUTE, 0);
    const min = Math.max(0, task.minRemainingMinutes - frozenMinutes);
    const target = Math.max(min, task.remainingMinutes - frozenMinutes);
    const chunkMinutes = task.sessionMinutes ?? activity.minBlockMinutes;
    prepared.push({
      task,
      activity,
      min,
      target,
      frozenMinutes,
      chunkSlots: Math.max(1, Math.round(chunkMinutes / slotMinutes)),
    });
  }
  prepared.sort((a, b) => a.task.deadline - b.task.deadline || b.task.priority - a.task.priority);

  const eligible = (p: Prepared, slot: Slot, strict: boolean): boolean =>
    slot.start >= Math.max(now, p.task.earliestStart ?? now) &&
    slot.end <= p.task.deadline &&
    (!slot.soft || !p.activity.academic || (!strict && !!input.allowFreeTime));

  const placed = new Map<string, number>(prepared.map((p) => [p.task.id, 0]));

  /** Slack of every pending minimum with the current board (EDF over free slots). */
  const minimumsFit = (): boolean => {
    let demand = 0;
    for (const p of prepared) {
      demand += Math.max(0, p.min - (placed.get(p.task.id) ?? 0));
      let capacity = 0;
      board.slots.forEach((s, i) => {
        if (board.owner[i] === null && eligible(p, s, false)) capacity += slotMinutes;
      });
      if (capacity < demand) return false;
    }
    return true;
  };

  const score = (p: Prepared, start: number, length: number, urgent: boolean): number | null => {
    const first = board.slots[start] as Slot;
    const last = board.slots[start + length - 1] as Slot;
    // Same-activity run including neighbours must respect the session cap.
    let run = length;
    for (let i = start - 1; i >= 0 && board.contiguous(i); i--) {
      const o = board.owner[i];
      if (!o || activityOf(o) !== p.activity.id) break;
      run++;
    }
    for (let i = start + length; i < board.slots.length && board.contiguous(i - 1); i++) {
      const o = board.owner[i];
      if (!o || activityOf(o) !== p.activity.id) break;
      run++;
    }
    if (run * slotMinutes > p.activity.maxSessionMinutes) return null;
    const perDay = p.task.maxPerDayMinutes;
    const today = board.dayTask.get(`${p.task.id}|${first.date}`) ?? 0;
    if (perDay !== undefined && today + length * slotMinutes > perDay) return null;

    let s = board.dayLoad.get(first.date) ?? 0;
    const acts = board.dayActivities.get(first.date);
    if (acts?.has(p.activity.id)) s += W.sameActivityOnDay;
    else {
      // The daily subject cap is firm; `recommendations` proposes relaxing it.
      if ((acts?.size ?? 0) >= maxActivities) return null;
      s += W.newActivityOnDay;
    }
    const before = start > 0 && board.contiguous(start - 1) ? board.owner[start - 1] : null;
    const after = board.contiguous(start + length - 1) ? board.owner[start + length] : null;
    for (const n of [before, after]) {
      if (!n) continue;
      if (n === p.task.id) s += W.continuesTask;
      else if (activityOf(n) !== p.activity.id) s += W.contextSwitch;
    }
    const pref = p.activity.preferred;
    if (pref && (first.minuteOfDay < pref.start || last.minuteOfDay + slotMinutes > pref.end)) {
      s += W.outsidePreferred;
    }
    for (let i = start; i < start + length; i++) if (board.slots[i]?.soft) s += W.freeTime;
    const daysOut = (first.start - now) / (1440 * MINUTE);
    s += daysOut * (urgent ? W.perDayLaterUrgent : W.perDayLater);
    return s;
  };

  const taskActivity = new Map(prepared.map((p) => [p.task.id, p.activity.id]));
  const activityOf = (taskId: string) => taskActivity.get(taskId);

  const candidates = (p: Prepared, length: number, strict: boolean, urgent: boolean) => {
    const out: { start: number; score: number }[] = [];
    for (let i = 0; i + length <= board.slots.length; i++) {
      let ok = true;
      for (let j = i; j < i + length; j++) {
        const slot = board.slots[j] as Slot;
        if (board.owner[j] !== null || !eligible(p, slot, strict)) ok = false;
        else if (j > i && !board.contiguous(j - 1)) ok = false;
        if (!ok) break;
      }
      if (!ok) continue;
      const s = score(p, i, length, urgent);
      if (s !== null) out.push({ start: i, score: s });
    }
    return out.sort((a, b) => a.score - b.score || a.start - b.start);
  };

  const place = (p: Prepared, goal: number, guard: boolean) => {
    // Tight tasks get pulled early; relaxed ones spread out.
    let free = 0;
    board.slots.forEach((s, i) => {
      if (board.owner[i] === null && eligible(p, s, true)) free += slotMinutes;
    });
    const urgent = guard && free - goal < 4 * p.chunkSlots * slotMinutes;
    for (let attempt = 0; attempt < 1000; attempt++) {
      const missing = goal - (placed.get(p.task.id) ?? 0);
      if (missing <= 0) return;
      const wanted = Math.min(p.chunkSlots, Math.ceil(missing / slotMinutes));
      let done = false;
      const lengths = p.task.sessionMinutes ? [wanted] : range(wanted, 1);
      for (const strict of input.allowFreeTime ? [true, false] : [true]) {
        for (const length of lengths) {
          for (const c of candidates(p, length, strict, urgent)) {
            for (let j = c.start; j < c.start + length; j++) board.assign(j, p);
            placed.set(p.task.id, (placed.get(p.task.id) ?? 0) + length * slotMinutes);
            if (!guard || minimumsFit()) {
              done = true;
              break;
            }
            for (let j = c.start; j < c.start + length; j++) board.unassign(j, p);
            placed.set(p.task.id, (placed.get(p.task.id) ?? 0) - length * slotMinutes);
          }
          if (done) break;
        }
        if (done) break;
      }
      if (!done && guard) {
        // Nothing keeps every other minimum intact: take the best slot anyway.
        for (const length of lengths) {
          const c = candidates(p, length, false, true)[0];
          if (!c) continue;
          for (let j = c.start; j < c.start + length; j++) board.assign(j, p);
          placed.set(p.task.id, (placed.get(p.task.id) ?? 0) + length * slotMinutes);
          done = true;
          break;
        }
      }
      if (!done) return;
    }
  };

  for (const p of prepared) place(p, p.min, true);
  for (const p of prepared) place(p, p.target, false);

  const blocks = collectBlocks(board);
  const status = statuses(prepared, placed, board, eligible, settings);
  const statusById = new Map(status.map((s) => [s.taskId, s]));
  for (const b of blocks) b.level = blockLevel(b, prepared, statusById, settings);
  for (const b of frozen) blocks.push({ ...b, frozen: true });
  blocks.sort((a, b) => a.start - b.start);

  return {
    blocks,
    status,
    feasible: status.every((s) => s.minDeficit === 0),
    unresolvedLocations: travel.unresolved,
  };
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i >= to; i--) out.push(i);
  return out;
}

function collectBlocks(board: Board): PlanBlock[] {
  const blocks: PlanBlock[] = [];
  board.slots.forEach((slot, i) => {
    const taskId = board.owner[i];
    if (!taskId) return;
    const prev = blocks[blocks.length - 1];
    if (prev && prev.taskId === taskId && prev.end === slot.start) {
      prev.end = slot.end;
      prev.soft = prev.soft || slot.soft;
    } else {
      blocks.push({
        id: `${taskId}@${slot.start}`,
        taskId,
        activityId: "",
        start: slot.start,
        end: slot.end,
        soft: slot.soft,
      });
    }
  });
  return blocks;
}

function statuses(
  prepared: Prepared[],
  placed: Map<string, number>,
  board: Board,
  eligible: (p: Prepared, s: Slot, strict: boolean) => boolean,
  settings: Settings,
): TaskStatus[] {
  // Slack: capacity before each deadline (free + planned slots, strict rules) minus
  // the minimums due by then, in deadline order.
  let demand = 0;
  return prepared.map((p) => {
    demand += p.min;
    let capacity = 0;
    board.slots.forEach((s) => {
      if (eligible(p, s, true)) capacity += settings.slotMinutes;
    });
    const scheduled = placed.get(p.task.id) ?? 0;
    const slack = capacity - demand;
    const minDeficit = Math.max(0, p.min - scheduled);
    const chunk = p.chunkSlots * settings.slotMinutes;
    const level: Level =
      minDeficit > 0 || slack < chunk
        ? "critical"
        : slack < settings.warnSlackMinutes
          ? "warn"
          : "ok";
    return {
      taskId: p.task.id,
      scheduledMinutes: scheduled + p.frozenMinutes,
      minDeficit,
      targetDeficit: Math.max(0, p.target - scheduled),
      slack,
      level,
    };
  });
}

function blockLevel(
  block: PlanBlock,
  prepared: Prepared[],
  status: Map<string, TaskStatus>,
  settings: Settings,
): Level {
  const own = prepared.find((p) => p.task.id === block.taskId) as Prepared;
  block.activityId = own.activity.id;
  const length = (block.end - block.start) / MINUTE;
  // Losing this block's time hurts every task due after it starts.
  let minSlack = Number.POSITIVE_INFINITY;
  for (const p of prepared) {
    if (p.task.deadline <= block.start || p.min === 0) continue;
    minSlack = Math.min(minSlack, (status.get(p.task.id) as TaskStatus).slack);
  }
  const ownStatus = status.get(block.taskId) as TaskStatus;
  if (ownStatus.minDeficit > 0 || (own.min > 0 && minSlack < length)) return "critical";
  if (minSlack < settings.warnSlackMinutes) return "warn";
  return "ok";
}
