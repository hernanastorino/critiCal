import { buildSlots } from "./availability.js";
import { overlaps } from "./intervals.js";
import { type ScheduleInput, type ScheduleResult, schedule } from "./scheduler.js";
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
  | "prioritize";

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

  // A flexible event before the last deadline in trouble, moved to the free time
  // closest to it within a week.
  for (const e of input.events) {
    if (!e.flexible || !e.busy || e.allDay || e.start <= input.now || e.start >= deadlineLimit)
      continue;
    const to = moveSpot(input, e);
    if (!to) continue;
    const next = {
      ...input,
      events: [...input.events.filter((x) => x.id !== e.id), { ...e, ...to }],
    };
    options.push({
      id: `move-event:${e.id}`,
      kind: "move-event",
      eventId: e.id,
      moveTo: to,
      label: `Mover «${e.title}» al ${when(input.settings.timezone, to.start)}`,
      input: next,
      result: schedule(next),
    });
  }

  const deficit = short.reduce((sum, s) => sum + s.minDeficit, 0);

  // Exams: leave out the units that weigh least until the time fits.
  for (const t of involved) {
    const units = [...(t.units ?? [])].sort((a, b) => a.weight - b.weight);
    const out: typeof units = [];
    let freed = 0;
    // Always keep the heaviest unit.
    for (const u of units.slice(0, -1)) {
      if (freed >= deficit) break;
      out.push(u);
      freed += u.minutes;
    }
    if (out.length === 0) continue;
    const next = withTasks(
      input,
      input.tasks.map((x) =>
        x.id === t.id
          ? {
              ...x,
              minRemainingMinutes: Math.max(0, x.minRemainingMinutes - freed),
              remainingMinutes: Math.max(0, x.remainingMinutes - freed),
            }
          : x,
      ),
    );
    options.push({
      id: `prioritize:${t.id}`,
      kind: "prioritize",
      taskId: t.id,
      unitIds: out.map((u) => u.id),
      label: `Priorizar los temas de ${t.title}: dejar afuera ${out.map((u) => `«${u.title}»`).join(", ")}`,
      input: next,
      result: schedule(next),
    });
  }

  // Entregas: hand in the smallest version still worth it.
  for (const t of involved) {
    if (t.mvpMinutes === undefined || t.mvpMinutes >= t.minRemainingMinutes) continue;
    add(
      `minimum-viable:${t.id}`,
      "minimum-viable",
      `Entregar una versión mínima de ${t.title} (${duration(t.mvpMinutes)})`,
      withTasks(
        input,
        input.tasks.map((x) =>
          x.id === t.id
            ? {
                ...x,
                minRemainingMinutes: t.mvpMinutes as number,
                remainingMinutes: Math.min(x.remainingMinutes, t.mvpMinutes as number),
              }
            : x,
        ),
      ),
      t.id,
    );
  }
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
  "move-event",
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
