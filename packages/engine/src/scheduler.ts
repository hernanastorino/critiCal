import { buildSlots, placeMeals, type Slot } from "./availability.js";
import { addDays, localParts, weekdayOf } from "./time.js";
import { type TravelOptions, travelBuffers } from "./travel.js";
import {
  type Activity,
  type CalendarEvent,
  type DayOverride,
  type Interval,
  type Level,
  type MealTime,
  MINUTE,
  type PlanBlock,
  type Settings,
  type Task,
  type TaskStatus,
} from "./types.js";

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
  /** Meals from `now` to the horizon, where the plan left room for them. */
  meals: MealTime[];
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
  /** Pull towards an exam's review days, enough to beat several days of "later". */
  reviewDay: -90,
};

interface Prepared {
  /** Position in the sorted list: the key of its eligibility masks. */
  index: number;
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
    this.count(slot.date, p.task.id, p.activity.id, this.slotMinutes);
  }

  /** Adds work to a day's tallies (also used for frozen blocks, which own no slot). */
  count(date: string, taskId: string, activityId: string, minutes: number): void {
    this.dayLoad.set(date, (this.dayLoad.get(date) ?? 0) + minutes);
    const acts = this.dayActivities.get(date) ?? new Map<string, number>();
    acts.set(activityId, (acts.get(activityId) ?? 0) + minutes / this.slotMinutes);
    this.dayActivities.set(date, acts);
    const key = `${taskId}|${date}`;
    this.dayTask.set(key, (this.dayTask.get(key) ?? 0) + minutes);
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

/** Whether two inputs are the same but for their tasks (every other field, by identity). */
function sameButTasks(a: ScheduleInput, b: ScheduleInput): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete("tasks");
  for (const k of keys) {
    if (Reflect.get(a, k) !== Reflect.get(b, k)) return false;
  }
  return true;
}

/** What was found for a task, with the rest of the input it was found with. */
const aloneCache = new WeakMap<Task, { input: ScheduleInput; short: boolean }[]>();

/**
 * Whether the task's minimum does not fit even with all the time to itself. The options
 * run `schedule` many times over inputs that differ in other tasks, not in this one, so
 * the answer is kept while the task and the rest of the input are the same objects.
 */
function fitsNowhere(input: ScheduleInput, task: Task): boolean {
  const kept = aloneCache.get(task) ?? [];
  const hit = kept.find((k) => sameButTasks(k.input, input));
  if (hit) return hit.short;
  const only = schedule({ ...input, tasks: [task] }, true);
  const short = only.status.some((s) => s.minDeficit > 0);
  kept.push({ input, short });
  // A few inputs per task are enough: the options reuse the plan's own.
  if (kept.length > 8) kept.shift();
  aloneCache.set(task, kept);
  return short;
}

/**
 * `alone` is internal: the check of a task that fits nowhere runs the plan with that
 * task by itself, and must not look for more of them.
 */
export function schedule(input: ScheduleInput, alone = false): ScheduleResult {
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
    buildSlots(settings, input.overrides ?? [], now, input.horizonEnd, busy, input.events),
    slotMinutes,
  );
  // Frozen work still counts towards each day's subject cap and per-task cap.
  // Counted slot by slot so a block that crosses wake-up time is split between days.
  const overrideByDate = new Map((input.overrides ?? []).map((o) => [o.date, o]));
  for (const b of frozen) {
    for (let t = b.start; t < b.end; t += slotMinutes * MINUTE) {
      const piece = Math.min(slotMinutes, (b.end - t) / MINUTE);
      board.count(logicalDate(settings, overrideByDate, t), b.taskId, b.activityId, piece);
    }
  }

  const prepared: Prepared[] = [];
  for (const task of input.tasks) {
    const activity = activityById.get(task.activityId);
    if (!activity)
      throw new Error(`Task ${task.id} references unknown activity ${task.activityId}`);
    const frozenMinutes = frozen
      .filter((b) => b.taskId === task.id)
      .reduce((sum, b) => sum + (b.end - b.start) / MINUTE, 0);
    const chunkMinutes = task.sessionMinutes ?? activity.minBlockMinutes;
    // Sessions land on whole slots (45 min on 30-min slots take 60): what a task asks is
    // counted in those, or its last session would be left out for 15 minutes.
    const whole = task.sessionMinutes
      ? Math.max(1, Math.round(chunkMinutes / slotMinutes)) * slotMinutes
      : 0;
    const inSlots = (m: number) =>
      whole > 0 && whole !== chunkMinutes ? Math.ceil(m / chunkMinutes) * whole : m;
    const min = Math.max(0, inSlots(task.minRemainingMinutes) - frozenMinutes);
    const target = Math.max(min, inSlots(task.remainingMinutes) - frozenMinutes);
    prepared.push({
      index: 0,
      task,
      activity,
      min,
      target,
      frozenMinutes,
      chunkSlots: Math.max(1, Math.round(chunkMinutes / slotMinutes)),
    });
  }
  prepared.sort((a, b) => a.task.deadline - b.task.deadline || b.task.priority - a.task.priority);
  prepared.forEach((p, i) => {
    p.index = i;
  });

  const eligibleSlot = (p: Prepared, slot: Slot, strict: boolean): boolean =>
    slot.start >= Math.max(now, p.task.earliestStart ?? now) &&
    slot.end <= p.task.deadline &&
    !(p.task.avoid ?? []).some((a) => slot.start < a.end && slot.end > a.start) &&
    insideHours(p.task, slot, slotMinutes) &&
    (!slot.soft || !p.activity.academic || (!strict && !!input.allowFreeTime));

  // Whether a task may use a slot depends on neither the board nor the other tasks, and
  // it is asked for every slot of every task at every try: worked out once per task.
  const masks: (Uint8Array | undefined)[] = [];
  const maskOf = (p: Prepared, strict: boolean): Uint8Array => {
    const key = p.index * 2 + (strict ? 1 : 0);
    let mask = masks[key];
    if (!mask) {
      mask = Uint8Array.from(board.slots, (slot) => (eligibleSlot(p, slot, strict) ? 1 : 0));
      masks[key] = mask;
    }
    return mask;
  };
  const eligible = (p: Prepared, i: number, strict: boolean): boolean => maskOf(p, strict)[i] === 1;

  const placed = new Map<string, number>(prepared.map((p) => [p.task.id, 0]));

  /**
   * Which pending tasks may use each slot does not depend on the board: kept while the
   * same tasks are pending (it only changes when one reaches its minimum).
   */
  let groupKeys: { signature: string; keys: string[]; lists: Map<string, number[]> } | undefined;
  const slotGroups = (pending: Prepared[]) => {
    const signature = pending.map((p) => p.index).join(",");
    if (groupKeys?.signature === signature) return groupKeys;
    const masks = pending.map((p) => maskOf(p, false));
    const lists = new Map<string, number[]>();
    const keys = board.slots.map((_s, i) => {
      const tasks: number[] = [];
      masks.forEach((m, t) => {
        if (m[i] === 1) tasks.push(t);
      });
      if (tasks.length === 0) return "";
      const key = tasks.join(",");
      if (!lists.has(key)) lists.set(key, tasks);
      return key;
    });
    groupKeys = { signature, keys, lists };
    return groupKeys;
  };
  /**
   * Whether every pending minimum can still get free slots it may use, all at once:
   * an exact assignment check (max flow from tasks to groups of slots with the same
   * eligible tasks), since days avoided by some tasks break the deadline nesting.
   */
  const minimumsFit = (): boolean => {
    const pending = prepared
      .map((p) => ({ p, need: Math.max(0, p.min - (placed.get(p.task.id) ?? 0)) }))
      .filter((x) => x.need > 0);
    if (pending.length === 0) return true;
    // Without avoided times eligibility is nested by deadline, so the cumulative check
    // over deadline prefixes is already exact (and much cheaper than the flow).
    if (!pending.some((x) => x.p.task.avoid?.length || x.p.task.validHours)) {
      let demand = 0;
      for (const x of pending) {
        demand += x.need;
        const mask = maskOf(x.p, false);
        let capacity = 0;
        for (let i = 0; i < mask.length; i++) {
          if (mask[i] === 1 && board.owner[i] === null) capacity += slotMinutes;
        }
        if (capacity < demand) return false;
      }
      return true;
    }
    const { keys, lists } = slotGroups(pending.map((x) => x.p));
    const minutesOf = new Map<string, number>();
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i] as string;
      if (key !== "" && board.owner[i] === null) {
        minutesOf.set(key, (minutesOf.get(key) ?? 0) + slotMinutes);
      }
    }
    const groups = [...minutesOf].map(([key, minutes]) => ({
      tasks: lists.get(key) as number[],
      minutes,
    }));
    return assignable(
      pending.map((x) => x.need),
      groups,
    );
  };

  const academic = (activityId: string) => activityById.get(activityId)?.academic ?? true;

  /**
   * Mixing activities on one day: the cap counts distinct materias (§5.4), so routines
   * (gym, running…) neither count towards it nor are limited by it. Null: over the cap.
   */
  const mixScore = (p: Prepared, date: string): number | null => {
    const acts = board.dayActivities.get(date);
    if (acts?.has(p.activity.id)) return W.sameActivityOnDay;
    const materias = [...(acts?.keys() ?? [])].filter(academic).length;
    // The daily subject cap is firm; `recommendations` proposes relaxing it.
    if (p.activity.academic && materias >= maxActivities) return null;
    return W.newActivityOnDay;
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
    // Nor does the session cap sit under one whole session (see the day's cap below).
    const sessionCap = Math.max(p.activity.maxSessionMinutes, p.chunkSlots * slotMinutes);
    if (run * slotMinutes > sessionCap) return null;
    const perDay = p.task.maxPerDayMinutes;
    const today = board.dayTask.get(`${p.task.id}|${first.date}`) ?? 0;
    // A session of 45 min on 30-min slots is two slots (60 min): the day's cap never sits
    // under one whole session, or a routine of 45 min could not be placed on any day.
    const dayCap = perDay === undefined ? undefined : Math.max(perDay, p.chunkSlots * slotMinutes);
    if (dayCap !== undefined && today + length * slotMinutes > dayCap) return null;

    const mix = mixScore(p, first.date);
    if (mix === null) return null;
    let s = (board.dayLoad.get(first.date) ?? 0) + mix;
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
    // The slot's calendar date: after midnight `date` is still the wake-up day.
    if (p.task.reviewDates?.includes(localParts(settings.timezone, first.start).date)) {
      s += W.reviewDay;
    }
    const daysOut = (first.start - now) / (1440 * MINUTE);
    s += daysOut * (urgent ? W.perDayLaterUrgent : W.perDayLater);
    return s;
  };

  const taskActivity = new Map(prepared.map((p) => [p.task.id, p.activity.id]));
  const activityOf = (taskId: string) => taskActivity.get(taskId);

  const candidates = (p: Prepared, length: number, strict: boolean, urgent: boolean) => {
    const out: { start: number; score: number }[] = [];
    const mask = maskOf(p, strict);
    for (let i = 0; i + length <= board.slots.length; i++) {
      let ok = true;
      for (let j = i; j < i + length; j++) {
        if (board.owner[j] !== null || mask[j] !== 1) ok = false;
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
    const strictMask = maskOf(p, true);
    let free = 0;
    for (let i = 0; i < strictMask.length; i++) {
      if (strictMask[i] === 1 && board.owner[i] === null) free += slotMinutes;
    }
    const urgent = guard && free - goal < 4 * p.chunkSlots * slotMinutes;
    for (let attempt = 0; attempt < 1000; attempt++) {
      const missing = goal - (placed.get(p.task.id) ?? 0);
      if (missing <= 0) return;
      // A session is always whole: its last one is not cut to what is missing.
      const wanted = p.task.sessionMinutes
        ? p.chunkSlots
        : Math.min(p.chunkSlots, Math.ceil(missing / slotMinutes));
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
  // A task whose minimum does not fit even with all the time to itself is reported on
  // its own: it must not make the others' time critical (it could use it, but no cut
  // would make it fit).
  const impossible = new Set<string>();
  if (!alone) {
    for (const p of prepared) {
      if (p.min - (placed.get(p.task.id) ?? 0) <= 0) continue;
      if (fitsNowhere(input, p.task)) impossible.add(p.task.id);
    }
  }
  // What does not count against the others: a task that fits nowhere, and a routine that
  // may fall behind.
  const excused = new Set([
    ...impossible,
    ...prepared.filter((p) => p.task.forgiving).map((p) => p.task.id),
  ]);
  // Time a forgiven routine holds frozen is still free for the minimums of the others, as
  // when it is placed: the studies go first and the routine takes what is left.
  // Only for the tasks that could use those slots (hours, dates and days they allow).
  const heldBlocks = frozen.filter((b) => excused.has(b.taskId));
  const held =
    heldBlocks.length === 0
      ? []
      : buildSlots(
          settings,
          input.overrides ?? [],
          now,
          input.horizonEnd,
          busy.filter((b) => !heldBlocks.some((h) => h === b)),
          input.events,
        ).filter((s) => heldBlocks.some((b) => s.start >= b.start && s.end <= b.end));
  const status = statuses(
    prepared,
    placed,
    board,
    { at: eligible, slot: eligibleSlot },
    settings,
    excused,
    held,
  );
  const statusById = new Map(status.map((s) => [s.taskId, s]));
  const slotAt = new Map(board.slots.map((s, i) => [s.start, i]));
  /** Whether `p` could take any of the block's time if it were skipped. */
  const couldUse = (p: Prepared, block: PlanBlock): boolean => {
    for (let t = block.start; t < block.end; t += slotMinutes * MINUTE) {
      const at = slotAt.get(t) ?? -1;
      const slot = board.slots[at];
      if (!slot || !eligible(p, at, false)) continue;
      const perDay = p.task.maxPerDayMinutes;
      const today = board.dayTask.get(`${p.task.id}|${slot.date}`) ?? 0;
      if (perDay === undefined || today + slotMinutes <= perDay) return true;
    }
    return false;
  };
  for (const b of blocks) {
    b.level = blockLevel(b, prepared, statusById, settings, couldUse, excused);
    if (isReviewBlock(prepared, b, settings.timezone)) b.review = true;
  }
  // Frozen blocks keep their time, not the level they had when planned: a decision
  // since (a lower minimum) may have taken them out of danger.
  for (const b of frozen) {
    const level = statusById.has(b.taskId)
      ? blockLevel({ ...b }, prepared, statusById, settings, couldUse, excused)
      : b.level;
    blocks.push({ ...b, frozen: true, level });
  }
  blocks.sort((a, b) => a.start - b.start);

  return {
    blocks,
    status,
    feasible: status.every((s) => s.minDeficit === 0),
    unresolvedLocations: travel.unresolved,
    meals: placeMeals(settings, input.overrides ?? [], now, input.horizonEnd, busy, input.events),
  };
}

/**
 * Whether a slot is inside the task's valid hours of its day (always, with none set). The
 * day is the one it is planned as: a holiday that borrows Sunday's routine uses Sunday's.
 */
function insideHours(task: Task, slot: Slot, slotMinutes: number): boolean {
  const hours = task.validHours;
  if (!hours) return true;
  const own = hours.days?.[slot.weekday ?? weekdayOf(slot.date)];
  // «No ese día»: the routine does not go on this day.
  if (own === null) return false;
  const range = own ?? hours.all;
  return !range || (slot.minuteOfDay >= range.start && slot.minuteOfDay + slotMinutes <= range.end);
}

/** The wake-up date an instant belongs to (after-midnight time counts for the day before). */
function logicalDate(
  settings: Settings,
  overrides: Map<string, DayOverride>,
  instant: number,
): string {
  const p = localParts(settings.timezone, instant);
  const override = overrides.get(p.date);
  // A holiday planned as a Sunday also wakes up on Sunday's time.
  const wake = override?.wake ?? settings.week[override?.asWeekday ?? p.weekday]?.wake ?? 0;
  return p.minuteOfDay < wake ? addDays(p.date, -1) : p.date;
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

/**
 * Whether `needs` (minutes per task) fit in `groups` of slots, each usable by some of
 * the tasks: max flow source → task → group → sink (Edmonds–Karp on a tiny graph).
 */
export function assignable(
  needs: number[],
  groups: { tasks: number[]; minutes: number }[],
): boolean {
  const n = needs.length;
  const g = groups.length;
  const size = n + g + 2;
  const source = n + g;
  const sink = source + 1;
  // Residual capacities, row-major: cap[u * size + v].
  const cap = new Float64Array(size * size);
  needs.forEach((need, t) => {
    cap[source * size + t] = need;
  });
  groups.forEach((group, j) => {
    for (const t of group.tasks) cap[t * size + n + j] = Number.POSITIVE_INFINITY;
    cap[(n + j) * size + sink] = group.minutes;
  });
  let flow = 0;
  for (;;) {
    const prev = new Int32Array(size).fill(-1);
    prev[source] = source;
    const queue = [source];
    for (let q = 0; q < queue.length && prev[sink] === -1; q++) {
      const u = queue[q] as number;
      for (let v = 0; v < size; v++) {
        if (prev[v] === -1 && (cap[u * size + v] as number) > 0) {
          prev[v] = u;
          queue.push(v);
        }
      }
    }
    if (prev[sink] === -1) break;
    let push = Number.POSITIVE_INFINITY;
    for (let v = sink; v !== source; v = prev[v] as number) {
      push = Math.min(push, cap[(prev[v] as number) * size + v] as number);
    }
    for (let v = sink; v !== source; v = prev[v] as number) {
      const u = prev[v] as number;
      cap[u * size + v] = (cap[u * size + v] as number) - push;
      cap[v * size + u] = (cap[v * size + u] as number) + push;
    }
    flow += push;
  }
  return flow >= needs.reduce((a, b) => a + b, 0);
}

function statuses(
  prepared: Prepared[],
  placed: Map<string, number>,
  board: Board,
  eligible: {
    at: (p: Prepared, i: number, strict: boolean) => boolean;
    slot: (p: Prepared, s: Slot, strict: boolean) => boolean;
  },
  settings: Settings,
  impossible: ReadonlySet<string>,
  held: readonly Slot[] = [],
): TaskStatus[] {
  // Slack: capacity before each deadline (free + planned slots, strict rules) minus
  // the minimums due by then, in deadline order.
  // Capacity is every slot some task of the deadline prefix may use (avoided days make
  // eligibility not nested), and a task's own slots bound its slack too.
  let demand = 0;
  let capacity = 0;
  const counted = board.slots.map(() => false);
  const heldCounted = held.map(() => false);
  return prepared.map((p) => {
    const skip = impossible.has(p.task.id);
    if (!skip) demand += p.min;
    let own = 0;
    // The time a forgiven routine holds frozen is free for the minimums of the others, as
    // when it is placed after them: counted for the tasks that could use it.
    held.forEach((s, i) => {
      if (!eligible.slot(p, s, true)) return;
      own += settings.slotMinutes;
      if (!skip && !heldCounted[i]) {
        heldCounted[i] = true;
        capacity += settings.slotMinutes;
      }
    });
    board.slots.forEach((_s, i) => {
      if (!eligible.at(p, i, true)) return;
      own += settings.slotMinutes;
      if (!skip && !counted[i]) {
        counted[i] = true;
        capacity += settings.slotMinutes;
      }
    });
    const scheduled = placed.get(p.task.id) ?? 0;
    const slack = Math.min(capacity - demand, own - p.min);
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

/** A block on one of its task's review dates (a week, three days, one day before an exam). */
function isReviewBlock(prepared: Prepared[], block: PlanBlock, timezone: string): boolean {
  const own = prepared.find((p) => p.task.id === block.taskId);
  return !!own?.task.reviewDates?.includes(localParts(timezone, block.start).date);
}

function blockLevel(
  block: PlanBlock,
  prepared: Prepared[],
  status: Map<string, TaskStatus>,
  settings: Settings,
  couldUse: (p: Prepared, block: PlanBlock) => boolean,
  impossible: ReadonlySet<string>,
): Level {
  const own = prepared.find((p) => p.task.id === block.taskId) as Prepared;
  block.activityId = own.activity.id;
  const length = (block.end - block.start) / MINUTE;
  // Losing this block's time hurts every task due after it starts.
  let minSlack = Number.POSITIVE_INFINITY;
  for (const p of prepared) {
    if (p.task.deadline <= block.start || p.min === 0 || impossible.has(p.task.id)) continue;
    minSlack = Math.min(minSlack, (status.get(p.task.id) as TaskStatus).slack);
  }
  const ownStatus = status.get(block.taskId) as TaskStatus;
  // If some minimum already does not fit, every block before its deadline that it
  // could use is needed. Time it could not take (its once-a-day routine already ran
  // that day, a free-time evening for study) does not make the block critical.
  const shortAfter = prepared.some(
    (p) =>
      p.task.deadline > block.start &&
      !impossible.has(p.task.id) &&
      (status.get(p.task.id) as TaskStatus).minDeficit > 0 &&
      couldUse(p, block),
  );
  if (shortAfter || ownStatus.minDeficit > 0 || (own.min > 0 && minSlack < length))
    return "critical";
  if (minSlack < settings.warnSlackMinutes) return "warn";
  return "ok";
}
