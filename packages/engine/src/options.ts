import { buildSlots } from "./availability.js";
import { overlaps } from "./intervals.js";
import { type ScheduleInput, type ScheduleResult, schedule } from "./scheduler.js";
import { addDays, localParts, zonedInstant } from "./time.js";
import { travelBuffers } from "./travel.js";
import { type CalendarEvent, type Interval, MINUTE, type Task } from "./types.js";

export type OptionKind =
  | "drop"
  | "lower-minimum"
  | "proportional"
  | "use-free-time"
  | "minimum-only"
  | "move-event"
  | "minimum-viable"
  | "prioritize"
  | "start-earlier";

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
  /** move-event: the event and where it would go. */
  eventId?: string;
  moveTo?: Interval;
  /** prioritize: the exam's units left out. */
  unitIds?: string[];
  /** start-earlier: when the task could start instead (now, or the start of a day). */
  startAt?: number;
}

function withTasks(input: ScheduleInput, tasks: Task[]): ScheduleInput {
  return { ...input, tasks };
}

/**
 * The plan of one task with the time all to itself: nothing of the others is placed, not
 * even what they hold fixed for today (its own fixed blocks stay). The one answer to «does
 * it fit even alone», for the tasks and for the routines' count.
 */
export function scheduleAlone(input: ScheduleInput, id: string): ScheduleResult {
  return schedule({
    ...input,
    tasks: input.tasks.filter((t) => t.id === id),
    frozen: input.frozen?.filter((b) => b.taskId === id),
  });
}

/**
 * Short tasks whose minimum does not fit even with the time all to themselves (more
 * sessions than days left, a minimum beyond what is awake before the deadline): no
 * cut to the others can make room, only changing them.
 */
export function selfShort(input: ScheduleInput, result: ScheduleResult): string[] {
  return result.status
    .filter((s) => s.minDeficit > 0)
    .map((s) => s.taskId)
    .filter((id) => scheduleAlone(input, id).status.some((s) => s.minDeficit > 0));
}

const option = (
  id: string,
  kind: OptionKind,
  label: string,
  input: ScheduleInput,
  taskId?: string,
): PlanOption => ({ id, kind, taskId, label, input, result: schedule(input) });

/** The task with a new minimum and target; a fixed target (a routine's) stays. */
function cut(t: Task, minimum: number, target: number): Task {
  return {
    ...t,
    minRemainingMinutes: minimum,
    remainingMinutes: t.fixedTarget ? t.remainingMinutes : target,
  };
}

const withTask = (input: ScheduleInput, id: string, change: (t: Task) => Task) =>
  withTasks(
    input,
    input.tasks.map((t) => (t.id === id ? change(t) : t)),
  );

const lastDeadline = (input: ScheduleInput, short: { taskId: string }[]) => {
  const taskById = new Map(input.tasks.map((t) => [t.id, t]));
  return Math.max(...short.map((s) => (taskById.get(s.taskId) as Task).deadline));
};

/**
 * Deterministic ways out when the minimums do not fit, each previewed with its
 * own schedule. Feasible options come first; within them, least invasive first.
 * Tasks that do not fit even alone (`impossible`) are told apart: they force no cut on
 * the others, only options about themselves.
 */
export function infeasibilityOptions(
  input: ScheduleInput,
  result: ScheduleResult,
  impossible: readonly string[] = selfShort(input, result),
): PlanOption[] {
  if (result.feasible) return [];
  const short = result.status.filter((s) => s.minDeficit > 0);
  const fixable = short.filter((s) => !impossible.includes(s.taskId));
  const limit = lastDeadline(input, short);
  const pending = input.tasks.filter((t) => t.deadline <= limit && t.minRemainingMinutes > 0);
  const options = [
    ...freeTimeOptions(input),
    ...moveEventOptions(input, limit),
    ...startEarlierOptions(input, pending),
    ...ownOptions(
      input,
      short.filter((s) => impossible.includes(s.taskId)),
    ),
    ...(fixable.length > 0 ? cutOptions(input, fixable, impossible) : []),
  ];
  return options.sort(
    (a, b) => Number(b.result.feasible) - Number(a.result.feasible) || rank(a.kind) - rank(b.kind),
  );
}

function freeTimeOptions(input: ScheduleInput): PlanOption[] {
  if (input.allowFreeTime) return [];
  return [
    option("use-free-time", "use-free-time", "Usar tiempo libre para llegar", {
      ...input,
      allowFreeTime: true,
    }),
  ];
}

/**
 * A flexible event before the last deadline in trouble, moved to the free time
 * closest to it within a week.
 */
function moveEventOptions(input: ScheduleInput, limit: number): PlanOption[] {
  const options: PlanOption[] = [];
  for (const e of input.events) {
    if (!e.flexible || !e.busy || e.allDay || e.start <= input.now || e.start >= limit) continue;
    const to = moveSpot(input, e);
    if (!to) continue;
    const next = {
      ...input,
      events: [...input.events.filter((x) => x.id !== e.id), { ...e, ...to }],
    };
    options.push({
      ...option(
        `move-event:${e.id}`,
        "move-event",
        `Mover «${e.title}» al ${when(input.settings.timezone, to.start)}`,
        next,
      ),
      eventId: e.id,
      moveTo: to,
    });
  }
  return options;
}

/**
 * A task that cannot start yet (§18.7): start it on the latest day that still fits
 * everything, or right away if no later day does.
 */
function startEarlierOptions(input: ScheduleInput, pending: Task[]): PlanOption[] {
  const tz = input.settings.timezone;
  return pending.flatMap((t) => {
    const from = t.earliestStart;
    if (from === undefined || from <= input.now) return [];
    const at = earlierStart(input, t, from);
    if (at === undefined) return [];
    return [
      {
        ...option(
          `start-earlier:${t.id}`,
          "start-earlier",
          at <= input.now
            ? `Empezar ${t.title} ya, sin esperar a la fecha de inicio`
            : `Empezar ${t.title} antes: desde el ${when(tz, at).replace(/ \d\d:\d\d$/, "")}`,
          withTask(input, t.id, (x) => ({ ...x, earliestStart: at })),
          t.id,
        ),
        startAt: at,
      },
    ];
  });
}

/** The latest start of a local day before `from` that fits everything, else now if it does. */
function earlierStart(input: ScheduleInput, t: Task, from: number): number | undefined {
  const fits = (at: number) =>
    schedule(withTask(input, t.id, (x) => ({ ...x, earliestStart: at }))).feasible;
  const tz = input.settings.timezone;
  const fromDay = localParts(tz, from).date;
  // Latest day first: the first that fits is the least change (feasibility need not
  // grow monotonically going back, so every day is tried). Counted in local dates, from
  // the start's own day if earlier. Right away is the last try.
  for (let back = 0; ; back++) {
    const candidate = zonedInstant(tz, addDays(fromDay, -back), 0);
    if (candidate <= input.now) break;
    if (candidate < from && fits(candidate)) return candidate;
  }
  return fits(input.now) ? input.now : undefined;
}

/**
 * A task that does not fit even alone: less of it (what it is short now: its lightest
 * units, a smaller version, a lower minimum) or none of it. Cutting the others would
 * not make it fit, so they are left alone.
 */
function ownOptions(
  input: ScheduleInput,
  short: { taskId: string; minDeficit: number }[],
): PlanOption[] {
  return short.flatMap((s) => {
    const t = input.tasks.find((x) => x.id === s.taskId) as Task;
    const lowered = Math.max(0, t.minRemainingMinutes - s.minDeficit);
    return [
      ...prioritizeOption(input, t, s.minDeficit),
      ...minimumViableOption(input, t),
      ...(lowered > 0 ? [lowerOption(input, t, lowered, s.minDeficit)] : []),
      dropOption(input, t),
    ];
  });
}

function lowerOption(input: ScheduleInput, t: Task, lowered: number, deficit: number) {
  return option(
    `lower-minimum:${t.id}`,
    "lower-minimum",
    `Bajar el mínimo de ${t.title} a ${duration(lowered)}`,
    withTask(input, t.id, (x) =>
      cut(
        x,
        lowered,
        Math.min(x.remainingMinutes, Math.max(lowered, x.remainingMinutes - deficit)),
      ),
    ),
    t.id,
  );
}

const dropOption = (input: ScheduleInput, t: Task) =>
  option(
    `drop:${t.id}`,
    "drop",
    `No hacer ${t.title}`,
    withTasks(
      input,
      input.tasks.filter((x) => x.id !== t.id),
    ),
    t.id,
  );

/** Cuts to the tasks due by the last deadline in trouble, to make room for the short ones. */
function cutOptions(
  input: ScheduleInput,
  short: { taskId: string; minDeficit: number }[],
  impossible: readonly string[],
): PlanOption[] {
  const limit = lastDeadline(input, short);
  const involved = input.tasks.filter(
    (t) => t.deadline <= limit && t.minRemainingMinutes > 0 && !impossible.includes(t.id),
  );
  const deficit = short.reduce((sum, s) => sum + s.minDeficit, 0);
  const options = [
    ...involved.flatMap((t) => prioritizeOption(input, t, deficit)),
    ...involved.flatMap((t) => minimumViableOption(input, t)),
  ];
  for (const t of [...involved].sort((a, b) => a.priority - b.priority)) {
    const lowered = Math.max(0, t.minRemainingMinutes - deficit);
    // Lowering to zero is just "No hacer", which is offered too.
    if (lowered > 0) options.push(lowerOption(input, t, lowered, deficit));
    options.push(dropOption(input, t));
  }
  return [...options, ...proportionalOption(input, involved, deficit)];
}

/** Exams: leave out the units that weigh least until the time fits. */
function prioritizeOption(input: ScheduleInput, t: Task, deficit: number): PlanOption[] {
  const units = [...(t.units ?? [])].sort((a, b) => a.weight - b.weight);
  const out: typeof units = [];
  let freed = 0;
  // Always keep the heaviest unit.
  for (const u of units.slice(0, -1)) {
    if (freed >= deficit) break;
    out.push(u);
    freed += u.minutes;
  }
  if (out.length === 0) return [];
  const next = withTask(input, t.id, (x) =>
    cut(x, Math.max(0, x.minRemainingMinutes - freed), Math.max(0, x.remainingMinutes - freed)),
  );
  return [
    {
      ...option(
        `prioritize:${t.id}`,
        "prioritize",
        `Priorizar los temas de ${t.title}: dejar afuera ${out.map((u) => `«${u.title}»`).join(", ")}`,
        next,
        t.id,
      ),
      unitIds: out.map((u) => u.id),
    },
  ];
}

/** Entregas: hand in the smallest version still worth it. */
function minimumViableOption(input: ScheduleInput, t: Task): PlanOption[] {
  const mvp = t.mvpMinutes;
  if (mvp === undefined || mvp >= t.minRemainingMinutes) return [];
  return [
    option(
      `minimum-viable:${t.id}`,
      "minimum-viable",
      `Entregar una versión mínima de ${t.title} (${duration(mvp)})`,
      withTask(input, t.id, (x) => cut(x, mvp, Math.min(x.remainingMinutes, mvp))),
      t.id,
    ),
  ];
}

/** "Un poco de todo": the same share of every involved minimum. */
function proportionalOption(input: ScheduleInput, involved: Task[], deficit: number) {
  const demand = involved.reduce((sum, t) => sum + t.minRemainingMinutes, 0);
  const factor = demand > 0 ? (demand - deficit) / demand : 0;
  if (factor <= 0) return [];
  const ids = new Set(involved.map((t) => t.id));
  return [
    option(
      "proportional",
      "proportional",
      `Un poco de todo (${Math.round(factor * 100)} % de cada mínimo)`,
      withTasks(
        input,
        input.tasks.map((t) =>
          ids.has(t.id)
            ? cut(
                t,
                Math.floor(t.minRemainingMinutes * factor),
                Math.floor(t.remainingMinutes * factor),
              )
            : t,
        ),
      ),
    ),
  ];
}

function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  // The app's format everywhere: «4h30», «5h», «45m».
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

const ORDER: OptionKind[] = [
  "use-free-time",
  "move-event",
  "start-earlier",
  "lower-minimum",
  "prioritize",
  "minimum-viable",
  "proportional",
  "minimum-only",
  "drop",
];

/** "jue 5/11 18:00" in the user's time zone. */
function when(timeZone: string, instant: number): string {
  const f = new Intl.DateTimeFormat("es-UY", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return f.format(instant).replace(",", "");
}

/** Where `event` could go instead: the free time closest to it within a week. */
export function moveSpot(input: ScheduleInput, event: CalendarEvent): Interval | null {
  const without = { ...input, events: input.events.filter((x) => x.id !== event.id) };
  return freeSpot(without, schedule(without), event);
}

/**
 * Where an event could go instead: the awake, non-free-time stretch closest to its
 * time, within a week either side, after now, that neither the plan nor any other event
 * uses, nor the trips to and from it there.
 */
function freeSpot(
  input: ScheduleInput,
  result: ScheduleResult,
  event: CalendarEvent,
): Interval | null {
  const length = event.end - event.start;
  const week = 7 * 1440 * MINUTE;
  const from = Math.max(input.now, event.start - week);
  const to = Math.min(input.horizonEnd, event.start + week);
  const others = input.events.filter((e) => e.id !== event.id);
  const travel = input.travel;
  const trips = travel ? travelBuffers(others, travel).busy : [];
  const taken: Interval[] = [
    ...input.events.filter((e) => e.busy && !e.allDay),
    ...result.blocks,
    ...(input.frozen ?? []),
  ];
  // The trips to the other events are taken too, as schedule() counts them.
  const slots = buildSlots(
    input.settings,
    input.overrides ?? [],
    from,
    to,
    [...taken, ...trips],
    others,
  ).filter((s) => !s.soft);
  // The event's own trips there must fit too. Not checked against the other trips:
  // placing the event may change those very trips.
  const tripsFit = (spot: Interval) => {
    if (!travel) return true;
    const own = travelBuffers([...others, { ...event, ...spot }], travel).busy.filter(
      (t) => !trips.some((b) => b.start === t.start && b.end === t.end),
    );
    return own.every((t) => t.start >= input.now && !taken.some((b) => overlaps(b, t)));
  };
  let best: Interval | null = null;
  for (let i = 0; i < slots.length; i++) {
    const first = slots[i] as (typeof slots)[number];
    let end = first.end;
    let j = i;
    // Contiguous slots of one day, long enough for the event.
    while (
      end - first.start < length &&
      slots[j + 1]?.start === end &&
      slots[j + 1]?.date === first.date
    ) {
      j++;
      end = (slots[j] as (typeof slots)[number]).end;
    }
    if (end - first.start < length) continue;
    const spot = { start: first.start, end: first.start + length };
    if (spot.start === event.start) continue;
    if (best && Math.abs(spot.start - event.start) >= Math.abs(best.start - event.start)) continue;
    if (tripsFit(spot)) best = spot;
  }
  return best;
}
const rank = (k: OptionKind) => ORDER.indexOf(k);

/** «Leer», «Leer y Gym», «Leer, Gym y TP». */
function names(tasks: Task[]): string {
  const titles = tasks.map((t) => t.title);
  const last = titles.pop() as string;
  return titles.length > 0 ? `${titles.join(", ")} y ${last}` : last;
}

/**
 * When minimums fit but targets do not: settle for the minimum. A fixed target (a
 * routine's sessions) is no decision: the plan places what fits of it beyond the minimum.
 */
export function targetOptions(input: ScheduleInput, result: ScheduleResult): PlanOption[] {
  const ids = new Set(
    result.status.filter((s) => s.minDeficit === 0 && s.targetDeficit > 0).map((s) => s.taskId),
  );
  const short = input.tasks.filter((t) => ids.has(t.id) && !t.fixedTarget);
  if (short.length === 0) return [];
  // A task with no minimum has nothing to settle for: cutting it to 0 is «No hacer».
  const cut = short.filter((t) => t.minRemainingMinutes > 0);
  const cutIds = new Set(cut.map((t) => t.id));
  const options: PlanOption[] = [];
  if (cut.length > 0) {
    const next = withTasks(
      input,
      input.tasks.map((t) =>
        cutIds.has(t.id) ? { ...t, remainingMinutes: t.minRemainingMinutes } : t,
      ),
    );
    options.push(
      option("minimum-only", "minimum-only", `Quedarme con el mínimo de ${names(cut)}`, next),
    );
  }
  // Only materias wait for free time: routines may use it already.
  if (!input.allowFreeTime) {
    options.push(
      option("use-free-time", "use-free-time", `Usar tiempo libre para ${names(short)}`, {
        ...input,
        allowFreeTime: true,
      }),
    );
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
