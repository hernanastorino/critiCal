import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { DEFAULTS, eventRole, normalize, visibleEvents } from "./calendars.js";
import { type Chunk, mergeChunk } from "./data.js";
import { demoData } from "./demo.js";
import { isTestDemo, pruebasData } from "./demoPruebas.js";
import {
  type Activity,
  addDays,
  type DayOverride,
  localParts,
  type MealKind,
  overlaps,
  type PlanBlock,
  type ScheduleResult,
  type Settings,
  type ValidHours,
  zonedInstant,
} from "./engine.js";
import { clipName } from "./format.js";
import { asking, type InboxInputs, inboxCards } from "./inbox.js";
import {
  ADDRESS_MAX,
  ALIASES_FIELD_MAX,
  BACKUP_TEXT_MAX,
  isBlank,
  NAME_MAX,
  SESSIONS_PER_WEEK_MAX,
  stripBidi,
  stripInvisible,
  UNIT_MINUTES_MAX,
  UNIT_MINUTES_MIN,
} from "./limits.js";
import type {
  AppData,
  AppliedDecision,
  AppTask,
  CalendarRole,
  CheckIn,
  EventTravel,
  Place,
  PlanVersion,
  Preferences,
  Spot,
  TravelMode,
  Unit,
} from "./model.js";
import { newId, nextColor, pruneApplied, type RemovedActivity, undoable } from "./model.js";
import {
  aliasTaken,
  eventSpotKey,
  home,
  keepableEvents,
  rekeySpots,
  sameName as samePlaceName,
  spotKey,
  unlocated,
} from "./places.js";
import {
  applyOption,
  checkInFactor,
  type Decisions,
  decisions,
  endOfDay,
  endOfWeek,
  freezeMeals,
  isPinned,
  isRunning,
  keepStartedMeals,
  latestCheckIns,
  missedMeals,
  nextWeekStart,
  pendingConfirmations,
  pinBlock,
  pinClashes,
  pinShortfall,
  type RoutineShort,
  type RoutineWeek,
  refreshPlan,
  routineShortfalls,
  routinesBack,
  routineWeek,
  sleptBlockIds,
  standingCheckIns,
  weekStart,
  withHandMarks,
} from "./planning.js";
import { refresh } from "./refresh.js";
import {
  aliasFrom,
  fitRoutine,
  isNoSubject,
  markLegacyStudy,
  sameName,
  studyOf,
  studyTitle,
  validRoutine,
} from "./subjects.js";
import { hold } from "./updates.js";

/**
 * What to do with a weekly silo, like a repeating calendar event: skip only
 * this week, pause until resumed, stop from today keeping past weeks, or erase
 * it with all its history.
 */
export type RecurrenceChange = "skipWeek" | "pause" | "resume" | "endFromToday" | "deleteAll";

export type Action =
  | { type: "refresh"; now: number }
  | { type: "replace"; data: AppData; now: number }
  /** Rows of other weeks that arrive after the app opened (`progressive.ts`): added, nothing replanned. */
  | { type: "chunk"; chunk: Chunk; now: number }
  /** `id` lets the caller name the record it may take back (and keeps a repeat harmless). */
  | { type: "checkIn"; checkIn: Omit<CheckIn, "id" | "createdAt"> & { id?: string }; now: number }
  | { type: "saveTask"; task: AppTask; activity?: Activity; now: number }
  /**
   * Takes the newest check-in of a block back, e.g. on «Deshacer». The log only grows, so
   * it adds a record: the earlier answer again, or «retired» when there was none.
   */
  | {
      type: "undoCheckIn";
      id: string;
      now: number;
      /** The plan before the answer and right after it, to put the first one back. */
      plans?: { before: PlanBlock[]; after: PlanBlock[] };
    }
  | { type: "override"; override: DayOverride; now: number }
  | { type: "acceptProposal"; id: string; now: number }
  | { type: "rejectProposal"; id: string; now: number }
  | { type: "applyOption"; optionId: string; now: number }
  | { type: "relaxContext"; until: number; now: number }
  | { type: "calendarRole"; calendarId: string; role: CalendarRole; now: number }
  | { type: "review"; taskId: string; keep: boolean; now: number }
  | { type: "replanWeek"; now: number }
  | { type: "pin"; blockId: string; start: number; now: number }
  /** «Fijar acá» on a run of blocks: each one pinned where it is, one replan for all. */
  | { type: "pinAll"; blockIds: string[]; now: number }
  | { type: "unpin"; blockId: string; now: number }
  /** «Soltar todo» on a run of blocks: one replan for all of them. */
  | { type: "unpinAll"; blockIds: string[]; now: number }
  | { type: "recurrence"; taskId: string; change: RecurrenceChange; now: number }
  | {
      type: "logProgress";
      taskId: string;
      minutes: number;
      /** Take the «done» off these units (marked by mistake). */
      reopenUnitIds?: string[];
      /** Mark these existing units done. */
      unitIds?: string[];
      /** For tasks without units: split into this many topics, the first `topicsDone` done. */
      topics?: number;
      topicsDone?: number;
      now: number;
    }
  | { type: "undoDecision"; id: string; now: number }
  | { type: "resetDetected"; taskId?: string; now: number }
  /** Takes an archived task back (only its status: later edits to it stay). */
  | { type: "unarchive"; taskId: string; status: "active" | "done"; now: number }
  | { type: "settings"; settings: Settings; now: number }
  | { type: "preferences"; preferences: Preferences; now: number }
  | { type: "saveActivity"; activity: Activity; now: number }
  /** A materia (or routine) goes away with everything of it: silos, check-ins, blocks. */
  | { type: "deleteActivity"; activityId: string; now: number }
  /** Takes back a `deleteActivity`: what it removed, as it was. */
  | { type: "restoreActivity"; removed: RemovedActivity; now: number }
  /**
   * Takes back an answer («Deshacer»): puts back only what the answer touched, entity by
   * entity, and leaves what was added or edited since.
   */
  | { type: "restoreState"; before: Snapshot; now: number }
  | { type: "savePlace"; place: Place; now: number }
  | { type: "deletePlace"; placeId: string; now: number }
  /** Takes back a `deletePlace`: its version of the undo history, else the place and its typed times. */
  | {
      type: "restorePlace";
      place: Place;
      times: NonNullable<AppData["travelTimes"]>;
      only?: PlanVersion;
      now: number;
    }
  | { type: "travelTime"; from: string; to: string; minutes: number; now: number }
  /** An event's place: adds what the event says as an alias, or marks it as no trip. */
  | { type: "locate"; text: string; placeId: string | null; now: number }
  /** Driving times the server found for event addresses (null: not found or no route). */
  | { type: "spots"; results: { text: string; minutes: number | null }[]; now: number }
  /** Minutes from home typed for an event, without saving a place. */
  | { type: "forgetTravelTime"; from: string; to: string; now: number }
  | { type: "spotMinutes"; text: string; minutes: number; now: number }
  /** Turns an event address into a saved place called `name`. */
  | { type: "saveSpot"; key: string; name: string; now: number }
  | { type: "forgetSpot"; key: string; now: number }
  /**
   * That day only: a meal skipped («Hoy no»), moved to `start` (minutes since that
   * day's midnight), or back to automatic (neither).
   */
  | {
      type: "mealChoice";
      date: string;
      kind: MealKind;
      start?: number;
      skip?: boolean;
      now: number;
    }
  /** Minutes kept for one event (after «Eliminar lugar») changed, or forgotten (`null`). */
  | { type: "eventTravelMinutes"; eventId: string; minutes: number | null; now: number }
  /** How to get to one event just that once; null goes back to the place's own mode. */
  | { type: "tripMode"; eventId: string; mode: TravelMode | null; now: number }
  | {
      type: "tripMinutes";
      eventId: string;
      /** Null forgets both ways. */
      minutes: number | null;
      /** Which way `minutes` is: there (home → event, the default) or back (event → home). */
      way?: "there" | "back";
      start?: number;
      now: number;
    }
  /** Deletes an event address but keeps its minutes on each event that used it. */
  | { type: "dropSpotAddress"; key: string; now: number }
  /**
   * Takes «Eliminar lugar» back: the address returns (unless a newer one took its key)
   * and each event's kept minutes go back to what they were (`before`), unless they
   * changed since.
   */
  | {
      type: "restoreSpot";
      spot: Spot;
      before: Record<string, EventTravel | undefined>;
      now: number;
    }
  /** A flexible event goes back to its own time in the plan. */
  | { type: "unmoveEvent"; eventId: string; now: number }
  /** A flexible event is planned at `start`–`end` until the calendar shows it moved. */
  | { type: "moveEvent"; eventId: string; start: number; end: number; now: number }
  /** Back to the plan as it was before the last reorganization. */
  /** `only`: the version to take back; if another is on top now, nothing happens. */
  | { type: "undoPlan"; only?: PlanVersion; now: number }
  /** A title from the class calendar: a new materia, or just an event (a talk…). */
  | { type: "classTitle"; title: string; as: "materia" | "event"; now: number }
  /** A class-calendar title that is another name of an existing materia. */
  | { type: "classOf"; title: string; activityId: string; now: number }
  /** An activity from before the distinction is a materia or a routine. */
  | { type: "sortActivity"; activityId: string; as: "materia" | "rutina"; now: number }
  /** An activity that was really part of a materia (its evaluations): merged into it. */
  | { type: "mergeActivity"; activityId: string; into: string; now: number }
  /** An evaluation waiting under "Sin materia" belongs to this materia. */
  | { type: "assignSubject"; taskId: string; activityId: string; now: number }
  /** A new materia by name, taking the evaluation `taskId` if given. */
  | { type: "newSubject"; name: string; taskId?: string; now: number }
  /** Weekly study time for a materia beyond its evaluations (0 removes it). */
  | { type: "weeklyStudy"; activityId: string; minutes: number; now: number }
  /** A routine (gym…) the plan places `sessionsPerWeek` times a week. */
  | {
      type: "saveRoutine";
      name: string;
      sessionsPerWeek: number;
      sessionMinutes: number;
      /** The hours it may be placed in; none: any time. */
      validHours?: ValidHours;
      now: number;
    };

/**
 * Every change, plus one rule for the undo history: a task whose status changed by
 * anything other than a decision or its undo leaves the earlier decisions, so undo
 * never overrides it, even if it later returns to the same status.
 */
/** Reorganizations of the plan that «Deshacer» in the week can take back. */
const VERSIONED: Partial<Record<Action["type"], string>> = {
  pin: "mover o fijar un bloque",
  unpin: "soltar un bloque",
  unpinAll: "soltar varios bloques",
  pinAll: "fijar varios bloques",
  replanWeek: "reacomodar la semana",
  override: "ajustar el día",
  acceptProposal: "aceptar un cambio propuesto",
  rejectProposal: "rechazar un cambio propuesto",
  mealChoice: "mover o sacar una comida",
  relaxContext: "mezclar materias por hoy",
};
/** Plan versions kept for undo. */
export const PLAN_HISTORY = 20;

export type { RemovedActivity };

/** What an answer of the inbox may change, kept by the notice that offers «Deshacer». */
export interface Snapshot {
  /** Tasks put back one by one (what was added or edited since stays). */
  tasks?: AppTask[];
  /** Parts of the data as they were before the answer. */
  keys?: Partial<AppData>;
  /** The same parts right after the answer: what it touched is what differs from `keys`. */
  after?: { tasks?: AppTask[]; keys: Partial<AppData> };
}

/** The parts `keys` of `data` as they are now (a missing one stays missing). */
export function snapshotOf(
  data: AppData,
  keys: readonly (keyof AppData)[],
  tasks: readonly AppTask[] = [],
): Snapshot {
  return {
    tasks: [...tasks],
    keys: Object.fromEntries(keys.map((k) => [k, data[k]])) as Partial<AppData>,
  };
}

/** Fills in how the parts of `snap` stand right after the answer (`next` is the data then). */
export function settleSnapshot(snap: Snapshot, next: AppData): void {
  const ids = new Set((snap.tasks ?? []).map((t) => t.id));
  snap.after = {
    tasks: next.tasks.filter((t) => ids.has(t.id)),
    keys: Object.fromEntries(
      Object.keys(snap.keys ?? {}).map((k) => [k, next[k as keyof AppData]]),
    ),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const keyOf = (e: unknown) =>
  e && typeof e === "object" && typeof (e as { id?: unknown }).id === "string"
    ? (e as { id: string }).id
    : JSON.stringify(e);

const DROP = Symbol("drop");

type Entries<T> = { b: Map<string, T>; a: Map<string, T>; c: Map<string, T> };

/** Entry `k` is gone now: back if the answer removed it, not if it went since. */
function goneNow<T>(k: string, { b, a }: Entries<T>): T | symbol {
  const was = b.get(k);
  return was !== undefined && !a.has(k) ? was : DROP;
}

/** Entry `k` was not there before: it goes if the answer added it and it is as it left it. */
function newOne<T>(k: string, { a, c }: Entries<T>): T | symbol {
  const cur = c.get(k) as T;
  return a.has(k) && same(cur, a.get(k)) ? DROP : cur;
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);

/** The fields of an entry that the answer changed (`was` against `mid`). */
function changedFields(was: Record<string, unknown>, mid: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(was), ...Object.keys(mid)])].filter(
    (f) => !same(was[f], mid[f]),
  );
}

/**
 * Entry `k` was there before and is now: each field the answer changed goes back to what
 * it was, unless someone changed it again since (that one stays with the newer value).
 */
function stillThere<T>(k: string, { b, a, c }: Entries<T>): T {
  const was = b.get(k) as T;
  const mid = a.get(k);
  const cur = c.get(k) as T;
  if (mid === undefined) return cur;
  if (!isRecord(was) || !isRecord(mid) || !isRecord(cur)) {
    return !same(was, mid) && same(cur, mid) ? was : cur;
  }
  const out: Record<string, unknown> = { ...cur };
  for (const f of changedFields(was, mid).filter((x) => same(cur[x], mid[x]))) {
    if (was[f] === undefined) delete out[f];
    else out[f] = was[f];
  }
  return out as T;
}

const FIELD_NAMES: Record<string, string> = {
  title: "el nombre",
  name: "el nombre",
  activityId: "la materia",
  kind: "el tipo",
  deadline: "la fecha",
  status: "el estado",
};

/** What an answer's «Deshacer» could not put back, as a list for the notice (empty: all). */
export function leftAfterUndo(data: AppData, snap: Snapshot): string[] {
  const after = snap.after;
  if (!after) return [];
  const left: string[] = [];
  const check = (was: unknown[], mid: unknown[], cur: unknown[]) => {
    const by = (list: unknown[]) => new Map(list.map((e) => [keyOf(e), e]));
    const [b, a, c] = [by(was), by(mid), by(cur)];
    for (const [k, w] of b) {
      const [m, n] = [a.get(k), c.get(k)];
      if (!isRecord(w) || !isRecord(m) || !isRecord(n)) continue;
      const fields = changedFields(w, m).filter((f) => !same(n[f], w[f]));
      if (fields.length === 0) continue;
      const who = String(n.title ?? n.name ?? "").trim();
      const what = fields.map((f) => FIELD_NAMES[f] ?? f).join(", ");
      left.push(who ? `${what} de «${who}»` : what);
    }
  };
  const have = data as unknown as Record<string, unknown>;
  for (const [k, was] of Object.entries(snap.keys ?? {})) {
    const mid = (after.keys as Record<string, unknown>)[k];
    if (Array.isArray(was) && Array.isArray(mid) && Array.isArray(have[k])) {
      check(was, mid, have[k] as unknown[]);
    }
  }
  if (snap.tasks?.length) check(snap.tasks, after.tasks ?? [], data.tasks);
  return [...new Set(left)];
}

/** What stands for entry `k` once the answer is taken back (`DROP`: none). */
function pick<T>(k: string, e: Entries<T>, only?: ReadonlySet<string>): T | symbol {
  if (only && !only.has(k)) return e.c.has(k) ? (e.c.get(k) as T) : DROP;
  if (!e.c.has(k)) return goneNow(k, e);
  return e.b.has(k) ? stillThere(k, e) : newOne(k, e);
}

/**
 * `now` with what the answer changed taken back: what it removed comes back, what it
 * edited returns to its earlier version, what it added goes, and anything else (made or
 * edited since) stays. `only` limits it to those entries.
 */
function mergeBack<T>(now: T[], before: T[], after: T[], only?: ReadonlySet<string>): T[] {
  const by = (list: T[]) => new Map(list.map((e) => [keyOf(e), e]));
  const entries = { b: by(before), a: by(after), c: by(now) };
  // What there was before keeps its order; what is new since goes after.
  const keys = new Set([...entries.b.keys(), ...entries.c.keys()]);
  return [...keys].map((k) => pick(k, entries, only)).filter((e): e is T => e !== DROP);
}

type Records = AppData["checkIns"];

/**
 * The records never go: those the answer removed (with their silo) come back once their
 * silo is back and the block has none; those it added are taken back with a new record.
 */
function restoreRecords(data: AppData, old: Records, mine: Records, now: number): AppData {
  const added = mine.filter((c) => !old.some((o) => o.id === c.id));
  const gone = old.filter((o) => !mine.some((c) => c.id === o.id));
  const tasks = new Set(data.tasks.map((t) => t.id));
  const blocks = new Set(data.checkIns.map((c) => c.blockId));
  let out = {
    ...data,
    checkIns: [
      ...data.checkIns,
      ...gone.filter((c) => tasks.has(c.taskId) && !blocks.has(c.blockId)),
    ],
  };
  for (const c of added.reverse()) out = apply(out, { type: "undoCheckIn", id: c.id, now });
  return out;
}

/** The whole of `data` with the parts of `snap` put back (see `restoreState`). */
function restoreSnapshot(data: AppData, snap: Snapshot, now: number): AppData {
  const after = snap.after;
  // The answer made no change (or its result is not known): nothing to take back.
  if (!after) return data;
  const next: Record<string, unknown> = { ...data };
  const was = (snap.keys ?? {}) as Record<string, unknown>;
  const mid = after.keys as Record<string, unknown>;
  for (const k of Object.keys(was).filter((x) => x !== "checkIns")) {
    const cur = (data as unknown as Record<string, unknown>)[k];
    if (!Array.isArray(was[k]) && !Array.isArray(mid[k])) {
      next[k] = same(cur, mid[k]) ? was[k] : cur;
      continue;
    }
    const list = Array.isArray(cur) ? cur : [];
    const merged = mergeBack(list, (was[k] as unknown[]) ?? [], (mid[k] as unknown[]) ?? []);
    // A part that was missing stays missing while it has nothing in it.
    next[k] = merged.length === 0 && was[k] === undefined ? undefined : merged;
  }
  if (snap.tasks?.length) {
    const only = new Set(snap.tasks.map((t) => t.id));
    next.tasks = mergeBack(next.tasks as AppTask[], snap.tasks, after.tasks ?? [], only);
  }
  const out = next as unknown as AppData;
  const old = was.checkIns as Records | undefined;
  return old ? restoreRecords(out, old, (mid.checkIns as Records | undefined) ?? [], now) : out;
}

/** Everything that goes when the activity `id` is deleted (to put it back on undo). */
export function removedWith(data: AppData, id: string): RemovedActivity | undefined {
  const activity = data.activities.find((a) => a.id === id);
  if (!activity) return undefined;
  const tasks = data.tasks.filter((t) => t.activityId === id);
  const ids = new Set(tasks.map((t) => t.id));
  return {
    activity,
    index: data.activities.indexOf(activity),
    tasks,
    checkIns: data.checkIns.filter((c) => ids.has(c.taskId)),
    pins: (data.pins ?? []).filter((b) => ids.has(b.taskId)),
  };
}

/** A silo the plan can still put blocks for: running and not past its deadline. */
const isPlannable = (t: AppTask, now: number) =>
  isRunning(t, now) && (t.deadline === undefined || t.deadline > now);

/** When a silo is closed, dropped or overdue, its future blocks (and pins) leave the plan. */
function withoutFutureBlocks(data: AppData, task: AppTask, now: number): AppData {
  if (isPlannable(task, now)) return data;
  const stays = (b: { taskId: string; start: number }) => b.taskId !== task.id || b.start <= now;
  return { ...data, plan: data.plan.filter(stays), pins: (data.pins ?? []).filter(stays) };
}

/** `reducer`, telling the action's `onAfter` (if any) how the data stands right after it. */
function withAfter(data: AppData, action: Action): AppData {
  const next = reducer(data, action);
  (action as { onAfter?: (after: AppData) => void }).onAfter?.(next);
  return next;
}

/** Applies `action` and records a plan version for the ones that can be undone. */
/** The names a form saves, without direction-changing characters (see `stripBidi`). */
function cleanNames(a: Action): Action {
  const unit = (u: Unit): Unit =>
    u.title === stripBidi(u.title) ? u : { ...u, title: stripBidi(u.title) };
  switch (a.type) {
    case "saveTask": {
      const task = { ...a.task, title: stripBidi(a.task.title), units: a.task.units.map(unit) };
      const activity = a.activity && { ...a.activity, name: stripBidi(a.activity.name) };
      return { ...a, task, activity };
    }
    case "saveActivity":
      return { ...a, activity: { ...a.activity, name: stripBidi(a.activity.name) } };
    case "savePlace":
      return {
        ...a,
        place: {
          ...a.place,
          name: stripBidi(a.place.name),
          address: a.place.address === undefined ? undefined : stripBidi(a.place.address),
          aliases: a.place.aliases.map(stripBidi),
        },
      };
    case "saveRoutine":
    case "newSubject":
    case "saveSpot":
      return { ...a, name: stripBidi(a.name) };
    default:
      return a;
  }
}

export function reducer(data: AppData, input: Action): AppData {
  // Old weeks coming in are not an action of the person: no freeze, no replan, no undo.
  if (input.type === "chunk") return mergeChunk(data, input.chunk);
  const action = cleanNames(input);
  // Old keys are fixed before planning, so the plan sees the saved minutes; a routine a
  // decision took out for a week comes back when that week is over.
  // The meals of the days gone by are written before anything else changes (SPEC §5).
  const frozen = freezeMeals(data, action.now);
  const base = routinesBack(rekeySpots(withHandMarks(frozen)), action.now);
  const changed = rekeySpots(versioned(base, action, apply(base, action)));
  // Changing Mi semana keeps today's meals that had begun as they were (SPEC §5).
  const next = saved(
    base,
    action,
    action.type === "settings" && changed.settings !== base.settings
      ? keepStartedMeals(base, changed, action.now)
      : changed,
  );
  // An action that changes nothing leaves the data as it came (the freeze waits).
  if (changed === base && frozen !== data)
    return routinesBack(rekeySpots(withHandMarks(data)), action.now);
  // Decisions themselves, and data that arrives whole (loaded, re-planned), already
  // carry their own history.
  const exempt = ["applyOption", "undoDecision", "replace", "refresh", "restoreState"].includes(
    action.type,
  );
  if (exempt || !next.applied?.length) return next;
  const before = new Map(base.tasks.map((t) => [t.id, t.status]));
  const moved = new Set(
    next.tasks.filter((t) => before.has(t.id) && before.get(t.id) !== t.status).map((t) => t.id),
  );
  if (moved.size === 0) return next;
  return { ...next, applied: pruneApplied(next.applied, (id) => moved.has(id)) };
}

/** The parts among `ids` that were done, taken back to not done. */
function reopenUnits(units: Unit[], ids: readonly string[] = []) {
  const back = new Set(ids.filter((id) => units.some((u) => u.id === id && u.doneAt)));
  return {
    ids: back,
    units: back.size
      ? units.map((u) => (back.has(u.id) ? { ...u, doneAt: undefined, doneByHand: undefined } : u))
      : units,
  };
}

const byDate = (a: CheckIn, b: CheckIn) =>
  a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** A record is always newer than the block's earlier ones, whatever the clock says. */
function stampAfter(data: AppData, blockId: string, now: number): number {
  const last = latestCheckIns(data).get(blockId);
  return last ? Math.max(now, last.createdAt + 1) : now;
}

/**
 * Adds a record to the log. The parts follow from the records that stand and from the hand
 * marks (`settleUnits`, run by `refresh`): a part a correction no longer declares is open
 * again unless it was marked by hand. Records are never edited.
 */
function withRecord(data: AppData, record: CheckIn): AppData {
  return { ...data, checkIns: [...data.checkIns, record] };
}

/**
 * «Dormías» (SPEC «El pasado no se recalcula»): when the user says they woke up at `wake`,
 * today's blocks that started before it, are over and have no record are closed with a new
 * «no hecho» record (`origin: 'slept'`). If the wake-up moves earlier, the «dormías» of blocks
 * that no longer start before it are retired with an undo record. The log only grows.
 */
function settleSlept(data: AppData, now: number): AppData {
  const tz = data.settings.timezone;
  const date = localParts(tz, now).date;
  const wake = data.overrides.find((o) => o.date === date)?.wake;
  const wakeAt = wake === undefined ? undefined : zonedInstant(tz, date, wake);
  const dayStart = zonedInstant(tz, date, 0);
  const todays = data.plan.filter((b) => b.start >= dayStart && b.start < endOfDay(tz, now));
  const asleep = sleptBlockIds(data);
  const standing = new Set(standingCheckIns(data).map((c) => c.blockId));
  const record = (
    b: PlanBlock,
    status: "retired" | "missed",
    origin: "undo" | "slept",
  ): CheckIn => ({
    id: newId(),
    blockId: b.id,
    taskId: b.taskId,
    status,
    minutesDone: 0,
    unitIds: [],
    origin,
    createdAt: stampAfter(data, b.id, now),
  });
  const awake = (b: PlanBlock) => wakeAt === undefined || b.start >= wakeAt;
  const added = [
    ...todays.filter((b) => asleep.has(b.id) && awake(b)).map((b) => record(b, "retired", "undo")),
    ...todays
      .filter((b) => !asleep.has(b.id) && !awake(b) && !standing.has(b.id) && b.end <= now)
      .map((b) => record(b, "missed", "slept")),
  ];
  return added.length ? { ...data, checkIns: [...data.checkIns, ...added] } : data;
}

/** The data after `action`, planned again where it changes the plan. */
function apply(data: AppData, action: Action): AppData {
  const now = action.now;
  switch (action.type) {
    case "refresh":
      return refresh(data, now);
    case "chunk":
      return mergeChunk(data, action.chunk);
    case "replace":
      return refresh(rekeySpots(action.data), now);
    case "checkIn": {
      const id = action.checkIn.id ?? newId();
      if (data.checkIns.some((c) => c.id === id)) return data;
      // A block closed as «dormías» is not answered or corrected.
      if (sleptBlockIds(data).has(action.checkIn.blockId)) return data;
      const checkIn: CheckIn = {
        ...action.checkIn,
        id,
        createdAt: stampAfter(data, action.checkIn.blockId, now),
        factor: checkInFactor(data, action.checkIn.taskId),
      };
      return refresh(withRecord(data, checkIn), now);
    }
    case "undoCheckIn": {
      // It must still be the newest of its block, so a repeated «Deshacer» does nothing more.
      const newest = latestCheckIns(data);
      const gone = data.checkIns.find((c) => c.id === action.id);
      if (!gone || gone.status === "retired" || newest.get(gone.blockId) !== gone) return data;
      if (gone.origin === "slept") return data;
      const before = data.checkIns
        .filter((c) => c.blockId === gone.blockId)
        .sort(byDate)
        .findLast((c) => byDate(c, gone) < 0);
      // The log only grows: undoing writes the earlier answer again, or retires the block's
      // first one. Either way what stands is derived from the records.
      const back: CheckIn =
        before && before.status !== "retired"
          ? {
              ...before,
              id: newId(),
              origin: "undo",
              createdAt: stampAfter(data, gone.blockId, now),
            }
          : {
              id: newId(),
              blockId: gone.blockId,
              taskId: gone.taskId,
              status: "retired",
              minutesDone: 0,
              unitIds: [],
              origin: "undo",
              createdAt: stampAfter(data, gone.blockId, now),
            };
      const undone = refresh(withRecord(data, back), now);
      // The plan is not a function of the answers alone (today's blocks stay where they were
      // put): if nothing moved it since the answer, it goes back exactly as it was.
      const { plans } = action;
      // Its own entry in the undo history goes too: the answer is already back.
      const history = data.planHistory?.filter((v) => v.checkIn !== action.id);
      const clean =
        history?.length === data.planHistory?.length ? undone : { ...undone, planHistory: history };
      return plans && same(data.plan, plans.after) ? { ...clean, plan: plans.before } : clean;
    }
    case "unarchive": {
      if (!data.tasks.some((t) => t.id === action.taskId && t.status === "dropped")) return data;
      return refresh(
        {
          ...data,
          tasks: data.tasks.map((t) =>
            t.id === action.taskId ? { ...t, status: action.status } : t,
          ),
        },
        now,
      );
    }
    case "saveTask": {
      const before = data.tasks.find((t) => t.id === action.task.id);
      // A second tap on «Agregar» (a new id, the same new materia) does not add it twice.
      if (
        !before &&
        action.activity &&
        !data.activities.some((a) => a.id === action.activity?.id) &&
        data.activities.some((a) => sameName(a.name, action.activity?.name ?? ""))
      )
        return data;
      // A date the user sets on a task that follows an event is kept against the import.
      const synced =
        before?.sourceEventId && before.deadline !== action.task.deadline
          ? {
              ...action.task,
              deadlineSyncedFrom: before.deadlineSyncedFrom ?? before.deadline,
            }
          : action.task;
      // A new habit remembers when it was made: its first week asks only the days left.
      const task =
        !before && synced.kind === "habit" && synced.createdAt === undefined
          ? { ...synced, createdAt: action.now }
          : synced;
      const tasks = before
        ? data.tasks.map((t) => (t.id === task.id ? task : t))
        : [...data.tasks, task];
      const edited = action.activity;
      // A routine's hours are edited with its task: that activity is replaced, a new one added.
      const activities = !edited
        ? data.activities
        : data.activities.some((a) => a.id === edited.id)
          ? data.activities.map((a) => (a.id === edited.id ? edited : a))
          : [...data.activities, edited];
      return refresh(withoutFutureBlocks({ ...data, tasks, activities }, task, now), now);
    }
    case "override": {
      const overrides = [
        ...data.overrides.filter((o) => o.date !== action.override.date),
        action.override,
      ];
      const next = { ...data, overrides };
      const today = localParts(data.settings.timezone, now).date;
      return refresh(action.override.date === today ? settleSlept(next, now) : next, now);
    }
    case "acceptProposal": {
      const p = data.proposals.find((x) => x.id === action.id);
      if (!p) return data;
      return { ...data, plan: p.plan, proposals: data.proposals.filter((x) => x.id !== p.id) };
    }
    case "rejectProposal": {
      const p = data.proposals.find((x) => x.id === action.id);
      if (!p) return data;
      return {
        ...data,
        plan: data.plan.filter((b) => !p.conflicts.includes(b.id)),
        proposals: data.proposals.filter((x) => x.id !== p.id),
        // No to a plan B: today keeps its blocks for the rest of the day.
        ...(p.id.startsWith("tentative@")
          ? { tentativeHoldUntil: endOfDay(data.settings.timezone, now) }
          : {}),
      };
    }
    case "applyOption": {
      const r = refreshPlan(data, now);
      const option = decisions(r.input, r.result, { data, now }).options.find(
        (o) => o.id === action.optionId,
      );
      if (!option) return data;
      const next = applyOption(data, r.input, option, now);
      const previousMove =
        option.kind === "move-event"
          ? data.movedEvents?.find((m) => m.eventId === option.eventId)
          : undefined;
      // Only tasks whose undoable fields really moved, so undo cannot clobber later edits.
      const changed = data.tasks.filter((t) => {
        const n = next.tasks.find((x) => x.id === t.id);
        return (
          !!n &&
          (n.minMinutes !== t.minMinutes ||
            n.estimateMinutes !== t.estimateMinutes ||
            n.status !== t.status ||
            n.skipUntil !== t.skipUntil ||
            JSON.stringify(n.startAfter) !== JSON.stringify(t.startAfter) ||
            n.units.some((u, i) => !!u.skipped !== !!t.units[i]?.skipped))
        );
      });
      const dropped = changed
        .filter(
          (t) =>
            t.status !== "dropped" && next.tasks.find((x) => x.id === t.id)?.status === "dropped",
        )
        .map((t) => t.id);
      // Units this decision left out: undo brings back only these.
      const skippedUnits = next.tasks.flatMap((n) => {
        const t = data.tasks.find((x) => x.id === n.id);
        return n.units
          .filter((u) => u.skipped && !t?.units.find((o) => o.id === u.id)?.skipped)
          .map((u) => u.id);
      });
      const record: AppliedDecision = {
        id: `${option.id}@${now}`,
        label: option.label,
        at: now,
        before: changed,
        ...(dropped.length ? { dropped } : {}),
        ...(skippedUnits.length ? { skippedUnits } : {}),
        after: Object.fromEntries(
          changed.map((t) => [t.id, next.tasks.find((x) => x.id === t.id)?.status ?? t.status]),
        ),
        afterMinutes: Object.fromEntries(
          changed.map((t) => {
            const n = next.tasks.find((x) => x.id === t.id) ?? t;
            return [t.id, { min: n.minMinutes, estimate: n.estimateMinutes }];
          }),
        ),
        freeTimeUntil: data.freeTimeUntil,
        ...(() => {
          // Routines this decision took out, and until when: undo brings them back.
          const skipped = changed.flatMap((t) => {
            const until = next.tasks.find((x) => x.id === t.id)?.skipUntil;
            return until !== undefined && until !== t.skipUntil ? [[t.id, until] as const] : [];
          });
          return skipped.length ? { skipUntil: Object.fromEntries(skipped) } : {};
        })(),
        ...(option.kind === "start-earlier" && option.taskId
          ? (() => {
              const set = next.tasks.find((x) => x.id === option.taskId)?.startAfter;
              return set ? { startAfter: { [option.taskId]: set } } : {};
            })()
          : {}),
        ...(option.kind === "move-event" && option.eventId
          ? {
              movedEventId: option.eventId,
              ...(previousMove ? { previousMove } : {}),
              ...(() => {
                const move = next.movedEvents?.find((m) => m.eventId === option.eventId);
                return move ? { move } : {};
              })(),
            }
          : {}),
      };
      const planned = refresh({ ...next, applied: [...(data.applied ?? []), record] }, now);
      if (option.kind !== "use-free-time") return planned;
      // Today's blocks stay where they are once planned, so the ones this decision added
      // (in free time) are remembered: undoing it takes them out again.
      const had = new Set(data.plan.map((b) => b.id));
      const addedBlocks = planned.plan.filter((b) => !had.has(b.id)).map((b) => b.id);
      if (addedBlocks.length === 0) return planned;
      return {
        ...planned,
        applied: planned.applied?.map((d) => (d.id === record.id ? { ...d, addedBlocks } : d)),
      };
    }
    case "undoDecision": {
      const record = data.applied?.find((d) => d.id === action.id);
      if (!record) return data;
      // Deleted silos stay deleted and silos dropped since stay dropped.
      const restore = undoable(data, record);
      const tasks = data.tasks.map((t) => {
        const old = restore.find((b) => b.id === t.id);
        return old
          ? {
              ...t,
              // Back what this decision cut, on top of whatever changed since.
              ...(() => {
                const after = record.afterMinutes?.[t.id];
                return after
                  ? {
                      minMinutes: Math.max(0, t.minMinutes + old.minMinutes - after.min),
                      estimateMinutes: Math.max(
                        0,
                        t.estimateMinutes + old.estimateMinutes - after.estimate,
                      ),
                    }
                  : { minMinutes: old.minMinutes, estimateMinutes: old.estimateMinutes };
              })(),
              status: old.status,
              // A routine taken out for the week comes back, unless it was skipped again since.
              ...(record.skipUntil?.[t.id] !== undefined && t.skipUntil === record.skipUntil[t.id]
                ? { skipUntil: old.skipUntil }
                : {}),
              // An earlier start comes back unless the rule was changed since.
              ...(record.startAfter?.[t.id] &&
              JSON.stringify(t.startAfter) === JSON.stringify(record.startAfter[t.id])
                ? { startAfter: old.startAfter }
                : {}),
              // Units this decision left out come back; ones a later decision left out
              // stay out (whatever was done since stays done).
              units: t.units.map((u) =>
                record.skippedUnits?.includes(u.id) ? { ...u, skipped: undefined } : u,
              ),
            }
          : t;
      });
      return refresh(
        {
          ...data,
          tasks,
          movedEvents: undoMove(data.movedEvents, record),
          // Only the decision that lent the free time takes it back: undoing another one
          // (a «No hacer») leaves a later «Usar tiempo libre» as it is.
          freeTimeUntil: record.id.startsWith("use-free-time@")
            ? record.freeTimeUntil
            : data.freeTimeUntil,
          plan: record.addedBlocks
            ? data.plan.filter((b) => !record.addedBlocks?.includes(b.id))
            : data.plan,
          // A later move of the same event that replaced this one now replaces what
          // this one replaced, so undoing it never brings back an undone move.
          applied: data.applied
            ?.filter((d) => d.id !== record.id)
            .map((d) =>
              record.move && d.previousMove && sameMove(d.previousMove, record.move)
                ? { ...d, previousMove: record.previousMove }
                : d,
            ),
        },
        now,
      );
    }
    case "resetDetected": {
      // Detected tasks go back to their category's default hours.
      const tasks = data.tasks.map((t) => {
        if (!t.sourceEventId || (action.taskId && t.id !== action.taskId)) return t;
        const event = data.events.find((e) => e.id === t.sourceEventId);
        const role = event ? eventRole(data, event) : undefined;
        if (role !== "parcial" && role !== "entrega" && role !== "presentacion") return t;
        const d = data.preferences?.importDefaults?.[role] ?? DEFAULTS[role];
        // Resetting hours keeps dropped or done tasks as they are; only an explicit
        // single-task reset brings one back.
        return {
          ...t,
          estimateMinutes: d.estimate,
          minMinutes: d.min,
          status: action.taskId ? ("active" as const) : t.status,
        };
      });
      return refresh({ ...data, tasks }, now);
    }
    case "relaxContext":
      return refresh({ ...data, relaxContextUntil: action.until }, now);
    case "calendarRole": {
      const calendars = (data.calendars ?? []).map((c) =>
        c.id === action.calendarId ? { ...c, role: action.role } : c,
      );
      return refresh({ ...data, calendars }, now);
    }
    case "logProgress": {
      const task = data.tasks.find((t) => t.id === action.taskId);
      if (!task) return data;
      let units = task.units;
      if (units.length === 0 && action.topics && action.topics > 0) {
        // Never a part of 0 min (it would not plan), nor above what a backup takes.
        const each = Math.min(
          UNIT_MINUTES_MAX,
          Math.max(UNIT_MINUTES_MIN, Math.round(task.estimateMinutes / action.topics)),
        );
        units = Array.from({ length: action.topics }, (_, i) => ({
          id: newId(),
          title: `Tema ${i + 1}`,
          estimateMinutes: each,
          ...(i < (action.topicsDone ?? 0) && { doneAt: now, doneByHand: true }),
        }));
      }
      const marked = new Set(action.unitIds ?? []);
      const newlyDone = units.filter((u) => !u.doneAt && marked.has(u.id)).map((u) => u.id);
      // Marked here and declared by the record this makes just below: not by hand.
      units = units.map((u) =>
        marked.has(u.id) && !u.doneAt ? { ...u, doneAt: now, doneByHand: false } : u,
      );
      const reopened = reopenUnits(units, action.reopenUnitIds);
      units = reopened.units;
      let next: AppData = {
        ...data,
        tasks: data.tasks.map((t) => (t.id === task.id ? { ...t, units } : t)),
      };
      // A part a standing record declares is taken back with a correction of that record
      // (the log only grows), so after a reload it is still open.
      for (const c of standingCheckIns(data)) {
        if (c.taskId !== task.id || !c.unitIds.some((id) => reopened.ids.has(id))) continue;
        const { origin: _origin, ...answer } = c;
        next = withRecord(next, {
          ...answer,
          id: newId(),
          unitIds: c.unitIds.filter((id) => !reopened.ids.has(id)),
          createdAt: stampAfter(next, c.blockId, now),
        });
      }
      const checkIns =
        action.minutes > 0 || newlyDone.length > 0
          ? [
              ...next.checkIns,
              {
                id: newId(),
                blockId: `manual@${now}`,
                taskId: task.id,
                status: "done" as const,
                minutesDone: Math.max(0, Math.round(action.minutes)),
                unitIds: newlyDone,
                createdAt: now,
                factor: checkInFactor(data, task.id),
              },
            ]
          : next.checkIns;
      return refresh({ ...next, checkIns }, now);
    }
    case "pin": {
      const block = data.plan.find((b) => b.id === action.blockId);
      if (!block || block.start <= now || action.start <= now) return data;
      const moved = pinBlock(block, action.start);
      // Other pins it lands on go back to the plan, which places them around it; one
      // already under way stays frozen.
      const covered = (data.pins ?? []).filter(
        (p) => p.id !== block.id && p.start > now && overlaps(p, moved),
      );
      const rest = (data.pins ?? []).filter((p) => p.id !== block.id && !covered.includes(p));
      // Two blocks of one task dropped on the same slot would share an id.
      if (rest.some((p) => p.id === moved.id)) return data;
      const gone = new Set([block.id, ...covered.map((p) => p.id)]);
      return refresh(
        { ...data, pins: [...rest, moved], plan: data.plan.filter((b) => !gone.has(b.id)) },
        now,
      );
    }
    case "pinAll": {
      // Only blocks still ahead and not pinned yet; each stays where the plan put it.
      const ahead = data.plan.filter(
        (b) => action.blockIds.includes(b.id) && b.start > now && !isPinned(b),
      );
      if (ahead.length === 0) return data;
      const moved = ahead.map((b) => pinBlock(b, b.start));
      const taken = new Set((data.pins ?? []).map((p) => p.id));
      if (moved.some((m) => taken.has(m.id))) return data;
      const gone = new Set(ahead.map((b) => b.id));
      return refresh(
        {
          ...data,
          pins: [...(data.pins ?? []), ...moved],
          plan: data.plan.filter((b) => !gone.has(b.id)),
        },
        now,
      );
    }
    case "recurrence": {
      const id = action.taskId;
      if (action.change === "deleteAll") {
        // A routine's own activity goes with its silo, or it stays behind with no way to see it.
        const owner = data.tasks.find((t) => t.id === id)?.activityId;
        const orphan =
          owner !== undefined &&
          data.activities.some((a) => a.id === owner && a.kind === "rutina") &&
          !data.tasks.some((t) => t.id !== id && t.activityId === owner);
        return refresh(
          {
            ...data,
            activities: orphan ? data.activities.filter((a) => a.id !== owner) : data.activities,
            tasks: data.tasks.filter((t) => t.id !== id),
            checkIns: data.checkIns.filter((c) => c.taskId !== id),
            plan: data.plan.filter((b) => b.taskId !== id),
            pins: (data.pins ?? []).filter((b) => b.taskId !== id),
            // Nothing of it survives, not even in the undo history.
            applied: pruneApplied(data.applied, (t) => t === id),
          },
          now,
        );
      }
      const tz = data.settings.timezone;
      const change = (t: AppTask): AppTask => {
        switch (action.change) {
          case "skipWeek":
            return { ...t, skipUntil: endOfWeek(tz, now) };
          case "pause":
            return { ...t, paused: true };
          case "resume":
            return { ...t, paused: undefined, skipUntil: undefined };
          // endFromToday
          default:
            return { ...t, status: "dropped", endedAt: now, paused: undefined };
        }
      };
      const tasks = data.tasks.map((t) => (t.id === id ? change(t) : t));
      if (action.change === "endFromToday") {
        return refresh(
          {
            ...data,
            tasks,
            // A silo that stops repeating keeps no hand-placed future blocks…
            pins: (data.pins ?? []).filter((b) => b.taskId !== id || b.end <= now),
            // …and undoing an earlier decision must not bring it back.
            applied: pruneApplied(data.applied, (t) => t === id),
          },
          now,
        );
      }
      return refresh({ ...data, tasks }, now);
    }
    case "unpin": {
      const pins = (data.pins ?? []).filter((p) => p.id !== action.blockId);
      return refresh(
        { ...data, pins, plan: data.plan.filter((b) => b.id !== action.blockId) },
        now,
      );
    }
    case "unpinAll": {
      const gone = new Set(action.blockIds);
      const pins = (data.pins ?? []).filter((p) => !gone.has(p.id));
      return refresh({ ...data, pins, plan: data.plan.filter((b) => !gone.has(b.id)) }, now);
    }
    case "replanWeek": {
      // Start over from now: keep history and the block in progress, drop the rest.
      const plan = data.plan.filter((b) => b.start <= now);
      // Asked for a new plan: a turned-down plan B no longer holds today.
      return refresh({ ...data, plan, proposals: [], tentativeHoldUntil: undefined }, now);
    }
    case "settings":
      return refresh({ ...data, settings: action.settings }, now);
    case "preferences":
      return refresh({ ...data, preferences: action.preferences }, now);
    case "saveActivity": {
      const old = data.activities.find((a) => a.id === action.activity.id);
      // A second tap on «Agregar» (a new id, the same name) does not add it twice.
      if (!old && data.activities.some((a) => sameName(a.name, action.activity.name))) return data;
      const activities = old
        ? data.activities.map((a) => (a.id === action.activity.id ? action.activity : a))
        : [...data.activities, action.activity];
      // A renamed materia keeps its weekly study: the silo is found by its title.
      const renamed = !!old && old.name !== action.activity.name;
      const study = renamed && old ? studyOf(data, old) : undefined;
      const tasks = data.tasks.map((t) => {
        if (study && t.id === study.id) return { ...t, title: studyTitle(action.activity) };
        // A routine's silo carries its name: renaming the routine renames it.
        if (
          renamed &&
          old?.kind === "rutina" &&
          t.activityId === old.id &&
          t.kind === "habit" &&
          t.title === old.name
        )
          return { ...t, title: action.activity.name };
        return t;
      });
      return refresh({ ...data, activities, tasks }, now);
    }
    case "deleteActivity": {
      const removed = removedWith(data, action.activityId);
      if (!removed) return data;
      const gone = new Set(removed.tasks.map((t) => t.id));
      return refresh(
        {
          ...data,
          activities: data.activities.filter((a) => a.id !== action.activityId),
          // The calendar must not bring it back: its events are not read as this subject.
          removedSubjects: [
            ...new Set([...(data.removedSubjects ?? []), normalize(removed.activity.name)]),
          ],
          tasks: data.tasks.filter((t) => !gone.has(t.id)),
          checkIns: data.checkIns.filter((c) => !gone.has(c.taskId)),
          plan: data.plan.filter((b) => !gone.has(b.taskId)),
          pins: (data.pins ?? []).filter((b) => !gone.has(b.taskId)),
          // Nothing of it survives, not even in the undo history.
          applied: pruneApplied(data.applied, (t) => gone.has(t)),
        },
        now,
      );
    }
    case "restoreState": {
      // A settled state put back as it was, not planned again.
      const ids = new Set((action.before.tasks ?? []).map((t) => t.id));
      const back = restoreSnapshot(data, action.before, now);
      // Its place in the history of «Deshacer» is taken: it is back already.
      return back.planHistory?.some((v) => v.gone && ids.has(v.gone.taskId))
        ? {
            ...back,
            planHistory: back.planHistory.filter((v) => !(v.gone && ids.has(v.gone.taskId))),
          }
        : back;
    }
    case "restoreActivity": {
      const { activity, index, tasks, checkIns, pins } = action.removed;
      // Back only once, and never over something made since with the same id.
      if (data.activities.some((a) => a.id === activity.id)) return data;
      const have = new Set(data.tasks.map((t) => t.id));
      const back = tasks.filter((t) => !have.has(t.id));
      const ids = new Set(back.map((t) => t.id));
      const checked = new Set(data.checkIns.map((c) => c.blockId));
      return refresh(
        {
          ...data,
          // Its place in the history of «Deshacer» is taken: it is back already.
          planHistory: data.planHistory?.filter((v) => v.removed?.activity.id !== activity.id),
          removedSubjects: data.removedSubjects?.filter((n) => n !== normalize(activity.name)),
          activities: [
            ...data.activities.slice(0, index),
            activity,
            ...data.activities.slice(index),
          ],
          tasks: [...data.tasks, ...back],
          checkIns: [
            ...data.checkIns,
            ...checkIns.filter((c) => ids.has(c.taskId) && !checked.has(c.blockId)),
          ],
          // A pinned block that is still ahead goes back to where it was pinned.
          pins: [...(data.pins ?? []), ...pins.filter((b) => ids.has(b.taskId) && b.start > now)],
        },
        now,
      );
    }
    case "savePlace": {
      const old = (data.places ?? []).find((p) => p.id === action.place.id);
      const exists = !!old;
      // A new address makes its computed times stale; manual ones are the user's.
      const travelTimes =
        old && (old.address ?? "") !== (action.place.address ?? "")
          ? (data.travelTimes ?? []).filter(
              (t) => t.manual || (t.from !== old.id && t.to !== old.id),
            )
          : data.travelTimes;
      const saved = old ? keepOldName(data.places ?? [], old, action.place) : action.place;
      let places = exists
        ? (data.places ?? []).map((p) => (p.id === saved.id ? saved : p))
        : [...(data.places ?? []), saved];
      // Only one home.
      if (action.place.isHome)
        places = places.map((p) =>
          p.id !== action.place.id && p.isHome ? { ...p, isHome: undefined } : p,
        );
      // Spots are timed from home: a new home (or address) makes the computed ones stale.
      const was = home(data);
      const moved = action.place.isHome
        ? was?.id !== action.place.id || (old?.address ?? "") !== (action.place.address ?? "")
        : // Or the home stops being one.
          was?.id === action.place.id;
      const spots = moved ? (data.spots ?? []).filter((s) => s.manual) : data.spots;
      return refresh({ ...data, places, travelTimes, spots }, now);
    }
    case "deletePlace": {
      const places = (data.places ?? []).filter((p) => p.id !== action.placeId);
      const travelTimes = (data.travelTimes ?? []).filter(
        (t) => t.from !== action.placeId && t.to !== action.placeId,
      );
      // Without that home, minutes computed from it mean nothing; typed ones stay.
      const spots =
        home(data)?.id === action.placeId ? (data.spots ?? []).filter((s) => s.manual) : data.spots;
      return refresh({ ...data, places, travelTimes, spots }, now);
    }
    case "restorePlace": {
      const back = undoPlan(data, action.only, action.now);
      if (back !== data) return back;
      const { place, now: at } = action;
      return action.times
        .filter((t) => t.manual)
        .reduce(
          (d, t) =>
            apply(d, { type: "travelTime", from: t.from, to: t.to, minutes: t.minutes, now: at }),
          apply(data, { type: "savePlace", place, now: at }),
        );
    }
    case "travelTime": {
      const others = (data.travelTimes ?? []).filter(
        (t) => !(t.from === action.from && t.to === action.to),
      );
      const minutes = Math.min(1440, Math.max(0, Math.round(action.minutes)));
      if (!Number.isFinite(minutes)) return data;
      const time = { from: action.from, to: action.to, minutes, manual: true };
      // Where it was in the list, so an edited row stays where it is.
      const at = (data.travelTimes ?? []).findIndex(
        (t) => t.from === action.from && t.to === action.to,
      );
      return refresh(
        { ...data, travelTimes: at < 0 ? [...others, time] : others.toSpliced(at, 0, time) },
        now,
      );
    }
    case "forgetTravelTime":
      return refresh(
        {
          ...data,
          travelTimes: (data.travelTimes ?? []).filter(
            (t) => !(t.from === action.from && t.to === action.to),
          ),
        },
        now,
      );
    case "classTitle": {
      const key = normalize(action.title);
      if (action.as === "event")
        return refresh(
          { ...data, notSubjects: [...new Set([...(data.notSubjects ?? []), key])] },
          now,
        );
      return refresh(
        { ...data, activities: [...data.activities, materia(data, action.title)] },
        now,
      );
    }
    case "classOf":
      return refresh(withAlias(data, action.activityId, normalize(action.title)), now);
    case "sortActivity":
      return refresh(
        {
          ...data,
          activities: data.activities.map((a) =>
            a.id === action.activityId
              ? { ...a, kind: action.as, academic: action.as === "materia" }
              : a,
          ),
          // A routine's habit has smaller limits than a materia's weekly study.
          tasks:
            action.as === "rutina"
              ? data.tasks.map((t) => (t.activityId === action.activityId ? fitRoutine(t) : t))
              : data.tasks,
        },
        now,
      );
    case "mergeActivity": {
      const from = data.activities.find((a) => a.id === action.activityId);
      if (!from || !data.activities.some((a) => a.id === action.into) || from.id === action.into)
        return data;
      const move = <T extends { activityId: string }>(x: T): T =>
        x.activityId === from.id ? { ...x, activityId: action.into } : x;
      const merged = withAlias(data, action.into, aliasFrom(from.name));
      const target = merged.activities.find((a) => a.id === action.into) as Activity;
      // One weekly study per materia: the target's wins; the other one ends here (its
      // history stays) along with its pins ahead.
      const ending =
        studyOf(merged, target) && studyOf(merged, from) ? studyOf(merged, from)?.id : undefined;
      return refresh(
        {
          ...merged,
          activities: merged.activities.filter((a) => a.id !== from.id),
          tasks: merged.tasks.map((t) => {
            const moved = move(t);
            return t.id === ending
              ? { ...moved, study: undefined, status: "dropped" as const, endedAt: now }
              : moved;
          }),
          plan: merged.plan.map(move),
          pins: merged.pins?.filter((p) => p.taskId !== ending || p.start <= now).map(move),
        },
        now,
      );
    }
    case "assignSubject": {
      const task = data.tasks.find((t) => t.id === action.taskId);
      if (!task || !data.activities.some((a) => a.id === action.activityId)) return data;
      const learned = withAlias(data, action.activityId, aliasFrom(task.title));
      return refresh(dropEmptyNoSubject(reassign(learned, task.id, action.activityId)), now);
    }
    case "newSubject": {
      const name = stripInvisible(action.name);
      if (!name) return data;
      const created = materia(data, name);
      const added = { ...data, activities: [...data.activities, created] };
      const task = action.taskId ? data.tasks.find((t) => t.id === action.taskId) : undefined;
      return refresh(task ? dropEmptyNoSubject(reassign(added, task.id, created.id)) : added, now);
    }
    case "weeklyStudy": {
      const subject = data.activities.find((a) => a.id === action.activityId);
      // At most a full week of study.
      if (!subject || !Number.isFinite(action.minutes) || action.minutes > 7 * 1440) return data;
      const study = studyOf(data, subject);
      if (action.minutes <= 0)
        return study
          ? refresh(
              {
                ...data,
                tasks: data.tasks.map((t) =>
                  t.id === study.id ? { ...t, status: "dropped" as const, endedAt: now } : t,
                ),
                // Its blocks pinned ahead go too; the past ones are history.
                pins: data.pins?.filter((p) => p.taskId !== study.id || p.start <= now),
              },
              now,
            )
          : data;
      // One-hour sessions, like the rest of the weekly silos.
      const habit: AppTask = {
        ...(study ?? {
          id: newId(),
          activityId: subject.id,
          title: studyTitle(subject),
          kind: "habit" as const,
          estimateMinutes: 0,
          priority: 2,
          status: "active" as const,
          units: [],
          sessionMinutes: 60,
          study: true,
        }),
        minMinutes: Math.round(action.minutes),
        sessionsPerWeek: Math.min(
          SESSIONS_PER_WEEK_MAX,
          Math.ceil(action.minutes / (study?.sessionMinutes ?? 60)),
        ),
      };
      const tasks = study
        ? data.tasks.map((t) => (t.id === study.id ? habit : t))
        : [...data.tasks, habit];
      return refresh({ ...data, tasks }, now);
    }
    case "saveRoutine": {
      const name = stripInvisible(action.name);
      if (!name || !validRoutine(action.sessionsPerWeek, action.sessionMinutes)) return data;
      // A second tap on «Agregar» does not add the same routine twice.
      if (data.activities.some((a) => sameName(a.name, name))) return data;
      const times = Math.round(action.sessionsPerWeek);
      const minutes = Math.round(action.sessionMinutes);
      const routine: Activity = {
        id: newId(),
        name,
        color: nextColor(data.activities),
        academic: false,
        kind: "rutina",
        maxSessionMinutes: Math.max(minutes, 30),
        minBlockMinutes: Math.min(minutes, 60),
        ...(action.validHours && { validHours: action.validHours }),
      };
      const habit: AppTask = {
        id: newId(),
        activityId: routine.id,
        title: name,
        kind: "habit",
        estimateMinutes: 0,
        minMinutes: times * minutes,
        sessionsPerWeek: times,
        sessionMinutes: minutes,
        createdAt: action.now,
        priority: 2,
        status: "active",
        units: [],
      };
      return refresh(
        { ...data, activities: [...data.activities, routine], tasks: [...data.tasks, habit] },
        now,
      );
    }
    case "spots": {
      let spots = data.spots ?? [];
      for (const r of action.results) {
        const key = spotKey(r.text);
        // What the user typed stays.
        if (spots.some((s) => s.key === key && s.manual)) continue;
        const spot =
          r.minutes === null
            ? { key, text: r.text, failed: true }
            : { key, text: r.text, minutes: Math.min(1440, Math.max(0, Math.round(r.minutes))) };
        spots = [...spots.filter((s) => s.key !== key), spot];
      }
      return refresh({ ...data, spots }, now);
    }
    case "spotMinutes": {
      // Whole minutes within a day, like every other travel time.
      if (!Number.isFinite(action.minutes) || action.minutes < 0 || !action.text.trim())
        return data;
      const key = spotKey(action.text);
      const minutes = Math.min(1440, Math.round(action.minutes));
      const spot = { key, text: action.text, minutes, manual: true };
      return refresh(
        { ...data, spots: [...(data.spots ?? []).filter((s) => s.key !== key), spot] },
        now,
      );
    }
    case "saveSpot": {
      const spot = (data.spots ?? []).find((s) => s.key === action.key);
      const at = home(data);
      const name = stripInvisible(action.name).slice(0, NAME_MAX);
      if (!spot || isBlank(name)) return data;
      // What the event says may be longer than a backup takes for an alias.
      const place: Place = {
        id: newId(),
        name,
        aliases: [spot.text.slice(0, BACKUP_TEXT_MAX)],
        address: spot.text.slice(0, ADDRESS_MAX),
      };
      const travelTimes = [...(data.travelTimes ?? [])];
      if (at && spot.minutes !== undefined) {
        const manual = !!spot.manual;
        travelTimes.push(
          { from: at.id, to: place.id, minutes: spot.minutes, manual },
          { from: place.id, to: at.id, minutes: spot.minutes, manual },
        );
      }
      return refresh(
        {
          ...data,
          places: [...(data.places ?? []), place],
          travelTimes,
          spots: (data.spots ?? []).filter((s) => s.key !== action.key),
        },
        now,
      );
    }
    case "moveEvent": {
      const event = data.events.find((e) => e.id === action.eventId);
      if (!event || action.start <= now) return data;
      const move = { eventId: event.id, from: event.start, start: action.start, end: action.end };
      return refresh(
        {
          ...data,
          movedEvents: [...(data.movedEvents ?? []).filter((m) => m.eventId !== event.id), move],
        },
        now,
      );
    }
    case "unmoveEvent":
      return refresh(
        {
          ...data,
          movedEvents: data.movedEvents?.filter((m) => m.eventId !== action.eventId),
        },
        now,
      );
    case "undoPlan":
      return undoPlan(data, action.only, now);
    case "mealChoice": {
      const rest = (data.mealChoices ?? []).filter(
        (c) => !(c.date === action.date && c.kind === action.kind),
      );
      const start =
        action.start !== undefined && Number.isFinite(action.start)
          ? Math.max(0, Math.min(1439 + 1440, Math.round(action.start)))
          : undefined;
      const choice =
        action.skip || start !== undefined
          ? [
              {
                date: action.date,
                kind: action.kind,
                // Skipped, its moved time is kept: putting it back returns it there.
                ...(action.skip
                  ? { skip: true, ...(start !== undefined ? { start } : {}) }
                  : { start }),
              },
            ]
          : [];
      // Past days' choices are of no use any more.
      const today = localParts(data.settings.timezone, now).date;
      return refresh(
        { ...data, mealChoices: [...rest, ...choice].filter((c) => c.date >= addDays(today, -1)) },
        now,
      );
    }
    case "dropSpotAddress": {
      const spot = (data.spots ?? []).find((s) => s.key === action.key);
      if (spot?.minutes === undefined) return data;
      const eventTravel = { ...data.eventTravel };
      // Minutes an event already kept for this same address stay as they are; ones
      // kept for an address it no longer has give way to these.
      for (const id of keepableEvents(data, spot.key))
        if (eventTravel[id]?.key !== spot.key)
          eventTravel[id] = { minutes: spot.minutes, key: spot.key };
      // Its text must not outlive it in the undo history either.
      const planHistory = data.planHistory?.filter((v) => !historyHasSpot(v, spot.key));
      return refresh(
        {
          ...data,
          eventTravel,
          spots: (data.spots ?? []).filter((s) => s.key !== spot.key),
          ...(planHistory && { planHistory }),
        },
        now,
      );
    }
    case "eventTravelMinutes": {
      const eventTravel = { ...data.eventTravel };
      const event = data.events.find((e) => e.id === action.eventId);
      if (action.minutes === null) delete eventTravel[action.eventId];
      else if (!event || !Number.isFinite(action.minutes) || action.minutes < 0) return data;
      else
        eventTravel[action.eventId] = {
          minutes: Math.min(1440, Math.round(action.minutes)),
          key: eventTravel[action.eventId]?.key ?? eventSpotKey(event),
        };
      return refresh({ ...data, eventTravel }, now);
    }
    case "tripMode": {
      const tripModes = { ...data.tripModes };
      if (action.mode === null) delete tripModes[action.eventId];
      else if (!data.events.some((e) => e.id === action.eventId)) return data;
      else tripModes[action.eventId] = action.mode;
      return refresh(
        { ...data, tripModes: Object.keys(tripModes).length ? tripModes : undefined },
        now,
      );
    }
    case "tripMinutes": {
      const tripMinutes = { ...data.tripMinutes };
      const event = data.events.find((e) => e.id === action.eventId);
      if (action.minutes === null) delete tripMinutes[action.eventId];
      else if (!event || !Number.isFinite(action.minutes) || action.minutes < 0) return data;
      // An answer for a start the event no longer has is stale.
      else if (action.start !== undefined && action.start !== event.start) return data;
      else {
        const minutes = Math.min(1440, Math.round(action.minutes));
        const was = tripMinutes[action.eventId];
        const fresh = was?.start === event.start ? was : undefined;
        // The way home answered first: the way there is taken to be as long until it answers.
        const next =
          action.way === "back"
            ? { minutes: fresh?.minutes ?? minutes, start: event.start, back: minutes }
            : { ...fresh, minutes, start: event.start };
        if (JSON.stringify(was) === JSON.stringify(next)) return data;
        tripMinutes[action.eventId] = next;
      }
      return refresh(
        { ...data, tripMinutes: Object.keys(tripMinutes).length ? tripMinutes : undefined },
        now,
      );
    }
    case "restoreSpot": {
      const eventTravel = { ...data.eventTravel };
      for (const [id, before] of Object.entries(action.before)) {
        const current = eventTravel[id];
        // What the deletion set goes back to what was there; what «Olvidar» removed
        // comes back; a later change of that event's minutes stays.
        const set = current?.key === action.spot.key && current.minutes === action.spot.minutes;
        if (set && before) eventTravel[id] = before;
        else if (set) delete eventTravel[id];
        else if (!current && before) eventTravel[id] = before;
      }
      const newer = (data.spots ?? []).some((s) => s.key === action.spot.key);
      return refresh(
        {
          ...data,
          eventTravel,
          spots: newer ? data.spots : [...(data.spots ?? []), action.spot],
        },
        now,
      );
    }
    case "forgetSpot": {
      // Forgetting an address also forgets the minutes events kept from it.
      const eventTravel = Object.fromEntries(
        Object.entries(data.eventTravel ?? {}).filter(([, t]) => t.key !== action.key),
      );
      return refresh(
        { ...data, eventTravel, spots: (data.spots ?? []).filter((s) => s.key !== action.key) },
        now,
      );
    }
    case "locate": {
      // Answered: a failed lookup for this text is no longer needed.
      data = { ...data, spots: (data.spots ?? []).filter((s) => s.key !== spotKey(action.text)) };
      if (!action.placeId) {
        const noTravel = [...new Set([...(data.noTravel ?? []), normalize(action.text)])];
        return refresh({ ...data, noTravel }, now);
      }
      const places = (data.places ?? []).map((p) =>
        p.id === action.placeId && !p.aliases.includes(action.text)
          ? { ...p, aliases: [...p.aliases, action.text] }
          : p,
      );
      return refresh({ ...data, places }, now);
    }
    case "review": {
      const tasks = data.tasks.map((t) =>
        t.id === action.taskId
          ? { ...t, needsReview: false, status: action.keep ? t.status : ("dropped" as const) }
          : t,
      );
      return refresh({ ...data, tasks }, now);
    }
  }
}

const STORAGE_KEY = "critical.demo.v2";
/** Demos saved before the study mark: migrated once, on the first load. */
const LEGACY_STORAGE_KEY = "critical.demo.v1";

export function loadDemo(now: number): AppData {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as AppData;
    const legacy = globalThis.localStorage?.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const data = markLegacyStudy(JSON.parse(legacy) as AppData);
      try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(data));
        // Only once the new copy is stored does the old one go.
        globalThis.localStorage?.removeItem(LEGACY_STORAGE_KEY);
      } catch {
        // Full storage: use the migrated data now and try again on the next load.
      }
      return data;
    }
  } catch {
    // Storage blocked or corrupt: start fresh.
  }
  return seedHistory(isTestDemo() ? pruebasData(now) : demoData(now), now);
}

/**
 * Plans the demo week from Monday morning, then catches up to `now` marking all
 * but the last two past blocks as done, so there is history and a short inbox.
 */
export function seedHistory(data: AppData, now: number): AppData {
  const tz = data.settings.timezone;
  const monday = zonedInstant(tz, weekStart(tz, now), 7 * 60);
  if (monday >= now) return data;
  const caught = reducer(reducer(data, { type: "refresh", now: monday }), { type: "refresh", now });
  const past = pendingConfirmations(caught, now).slice(0, -2);
  const checkIns: CheckIn[] = past.map((b) => ({
    id: `seed-${b.id}`,
    blockId: b.id,
    taskId: b.taskId,
    status: "done",
    minutesDone: (b.end - b.start) / 60_000,
    unitIds: [],
    createdAt: b.end,
    factor: checkInFactor(caught, b.taskId),
  }));
  return { ...caught, checkIns };
}

/** Stores the demo; false if the browser refused (full or blocked storage). */
function saveDemo(data: AppData): boolean {
  try {
    // Reading `localStorage` itself throws where the browser blocks storage.
    const storage = globalThis.localStorage;
    if (!storage) return false;
    const json = JSON.stringify(data);
    try {
      storage.setItem(STORAGE_KEY, json);
      storage.removeItem(LEGACY_STORAGE_KEY);
      return true;
    } catch {
      // A not-yet-migrated old copy may be what fills the storage. The data in hand is
      // already migrated, so the old copy makes room; if even that is not enough, it
      // goes back, so there is always one stored copy.
      const old = storage.getItem(LEGACY_STORAGE_KEY);
      if (old === null) return false;
      storage.removeItem(LEGACY_STORAGE_KEY);
      try {
        storage.setItem(STORAGE_KEY, json);
        return true;
      } catch {
        storage.setItem(LEGACY_STORAGE_KEY, old);
        return false;
      }
    }
  } catch {
    return false;
  }
}

export function resetDemo(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
    globalThis.localStorage?.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // ignore
  }
}

interface Store {
  data: AppData;
  now: number;
  /** `onAfter` gets the data right after the action (to know what it touched). */
  dispatch: (a: DistributiveOmit<Action, "now">, onAfter?: (after: AppData) => void) => void;
  pending: ReturnType<typeof pendingConfirmations>;
  decisions: Decisions;
  /** The current plan's verdict (feasibility, per-task deficits). */
  result: ScheduleResult;
  /** Upcoming events whose place is unknown (only once a home is saved). */
  unlocated: ReturnType<typeof unlocated>;
  /** Minimums the upcoming pins put out of reach, and those pins. */
  pinShort: ReturnType<typeof pinShortfall>;
  /** Routines the week has no room for whole. */
  routineShort: RoutineShort[];
  /** What a routine's week (the one `weekAt` is in, default this one) holds: its count. */
  routineWeek: (taskId: string, weekAt?: number) => RoutineWeek | undefined;
  /** Upcoming pins a calendar event overlaps. */
  clashes: ReturnType<typeof pinClashes>;
  /** Meals of the coming week with no room near their time. */
  missedMeals: ReturnType<typeof missedMeals>;
  inboxCount: number;
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

const StoreContext = createContext<Store | null>(null);

export function useNow(intervalMs = 60_000, fixed?: number): number {
  const [now, setNow] = useState(() => fixed ?? Date.now());
  useEffect(() => {
    if (fixed !== undefined) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, fixed]);
  return now;
}

/** Holds the app data and what is derived from it (plan verdict, inbox, clashes). */
export function StoreProvider({
  initial,
  fixedNow,
  persist = true,
  onChange,
  children,
}: {
  initial: (now: number) => AppData;
  fixedNow?: number;
  /** Save to this browser (demo mode). */
  persist?: boolean;
  /** Called after every change with the previous and new data (remote mode). */
  onChange?: (prev: AppData, next: AppData) => void;
  children: ReactNode;
}) {
  const now = useNow(60_000, fixedNow);
  // The unrefreshed seed is the baseline for persistence, so whatever the first
  // refresh adds (imported tasks and activities, the plan) gets written too.
  const [seed] = useState(() => initial(now));
  const [data, raw] = useReducer(withAfter, seed, (s) => reducer(s, { type: "refresh", now }));
  useEffect(() => {
    raw({ type: "refresh", now });
  }, [now]);
  const previous = useRef(seed);
  // A layout effect runs right after the commit, so the saves start before any repaint
  // or task freeze that could let a reload for a new version in first.
  useLayoutEffect(() => {
    // A demo edit the browser refused to store lives only in memory: no reload then.
    if (persist) hold("demo", !saveDemo(data));
    if (onChange && previous.current !== data) onChange(previous.current, data);
    // Its saves are registered now, so a reload for a new version can wait for them.
    hold("edit", false);
    previous.current = data;
  }, [data, persist, onChange]);
  // Leaving the demo (signing in instead) discards it, and with it what it was holding.
  useEffect(() => () => hold("demo", false), []);

  // The decisions replan once per option (~35 ms each in the demo): they are worked out
  // when something asks (the Bandeja) or, for the counter, right after the paint, never
  // inside the render a tap waits for.
  const plan = useMemo(() => {
    const r = refreshPlan(data, now);
    let cached: Decisions | undefined;
    return {
      r,
      peek: () => cached,
      get: () => {
        cached ??= decisions(r.input, r.result, { data, now });
        return cached;
      },
    };
  }, [data, now]);
  const counted = useRef<InboxInputs["asked"] | null>(null);
  const [settled, setSettled] = useState(plan);
  useEffect(() => {
    if (plan.peek()) {
      setSettled(plan);
      return;
    }
    const id = setTimeout(() => {
      plan.get();
      setSettled(plan);
    }, 0);
    return () => clearTimeout(id);
  }, [plan]);

  const store = useMemo<Store>(() => {
    const r = plan.r;
    const pending = pendingConfirmations(data, now);
    // Until the decisions of this plan are known the count of the last ones stays; only
    // the very first render (nothing to keep) works them out at once.
    const asked =
      (settled === plan ? plan.get() : plan.peek()) ??
      (counted.current === null ? plan.get() : undefined);
    if (asked)
      counted.current = {
        choose: asked.hasOptions,
        recommendations: asked.recommendations,
      };
    // Signed in, the server times event addresses by itself; the demo has no server.
    const where = unlocated(data, visibleEvents(data), now).map((u) =>
      persist ? { ...u, lookup: false } : u,
    );
    const pinShort = pinShortfall(data, now, r.result);
    const routineShort = routineShortfalls(data, now, r.result.blocks, r.input);
    const clashes = pinClashes(data, now, r.input);
    const meals = missedMeals(data, now);
    return {
      data,
      now,
      dispatch: (a, onAfter) => {
        // Until the effect above hands it to a save, the edit lives only in memory. An
        // action that changes nothing runs no effect, so the hold also lapses.
        hold("edit", true, 1000);
        raw(Object.assign({ ...a, now: fixedNow ?? Date.now() }, { onAfter }) as Action);
      },
      pending,
      get decisions() {
        return plan.get();
      },
      result: r.result,
      unlocated: where,
      pinShort,
      routineShort,
      routineWeek: (taskId, weekAt = now) => {
        const task = data.tasks.find((t) => t.id === taskId);
        // Only the week under way and the next one are planned: a past week has no plan to count.
        const tz = data.settings.timezone;
        const inPlan = weekAt < endOfWeek(tz, zonedInstant(tz, nextWeekStart(tz, now), 0));
        return task && inPlan
          ? routineWeek(data, now, r.result.blocks, task, undefined, weekAt)
          : undefined;
      },
      clashes,
      missedMeals: meals,
      inboxCount: asking(
        inboxCards({
          data,
          now,
          pending,
          unlocated: where,
          pinShort,
          routineShort,
          clashes,
          missedMeals: meals,
          asked: counted.current ?? { choose: false, recommendations: [] },
        }),
      ).length,
    };
  }, [data, now, fixedNow, persist, plan, settled]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}

/** A new materia named `name`, with a free colour. */
function materia(data: AppData, name: string): Activity {
  return {
    id: newId(),
    name: stripInvisible(name),
    color: nextColor(data.activities),
    academic: true,
    kind: "materia",
    maxSessionMinutes: 120,
    minBlockMinutes: 60,
  };
}

/** Teaches a materia another name it goes by (nothing if it already answers to it). */
/**
 * A renamed place keeps its old name as an alias, so the events that name it that way stay
 * linked (unless the alias is already there, another place has it, or the field is full).
 */
function keepOldName(places: readonly Place[], old: Place, next: Place): Place {
  const name = old.name;
  const taken =
    next.aliases.some((a) => samePlaceName(a, name)) || !!aliasTaken(places, name, next.id);
  const aliases = [...next.aliases, name];
  if (samePlaceName(old.name, next.name) || taken || aliases.join(", ").length > ALIASES_FIELD_MAX)
    return next;
  return { ...next, aliases };
}

function withAlias(data: AppData, activityId: string, alias: string): AppData {
  const key = normalize(alias);
  return {
    ...data,
    activities: data.activities.map((a) =>
      a.id !== activityId || !key || normalize(a.name) === key || (a.aliases ?? []).includes(key)
        ? a
        : { ...a, aliases: [...(a.aliases ?? []), key] },
    ),
  };
}

/** Moves a task, and the blocks planned or pinned for it, to another activity. */
function reassign(data: AppData, taskId: string, activityId: string): AppData {
  const move = <T extends { taskId: string; activityId: string }>(b: T): T =>
    b.taskId === taskId ? { ...b, activityId } : b;
  return {
    ...data,
    tasks: data.tasks.map((t) => (t.id === taskId ? { ...t, activityId } : t)),
    plan: data.plan.map(move),
    pins: data.pins?.map(move),
  };
}

/** "Sin materia" only exists while something waits in it. */
function dropEmptyNoSubject(data: AppData): AppData {
  const waiting = data.activities.find(isNoSubject);
  if (!waiting || data.tasks.some((t) => t.activityId === waiting.id)) return data;
  return { ...data, activities: data.activities.filter((a) => a.id !== waiting.id) };
}

/** Keeps what the plan looked like before a reorganization, so it can be undone. */
type Move = NonNullable<AppData["movedEvents"]>[number];
const sameMove = (a: Move, b: Move) =>
  a.eventId === b.eventId && a.start === b.start && a.end === b.end;

/**
 * The moved events after undoing `record`: the event goes back to the move this one
 * replaced (or its own time), but only while this decision's move still stands — not
 * if a later decision moved it again or the user put it back by hand.
 */
function undoMove(moves: AppData["movedEvents"], record: AppliedDecision) {
  if (!record.movedEventId) return moves;
  const current = moves?.find((m) => m.eventId === record.movedEventId);
  // Older records without `move`: whatever stands for the event is theirs.
  const own = current && (!record.move || sameMove(current, record.move));
  if (!own) return moves;
  return [
    ...(moves ?? []).filter((m) => m !== current),
    ...(record.previousMove ? [record.previousMove] : []),
  ];
}

/** Whether a replan moved anything: the plan, the plans B waiting or their hold. */
export function replanChanged(before: AppData, after: AppData): boolean {
  const view = (d: AppData) => JSON.stringify([d.plan, d.proposals, d.tentativeHoldUntil]);
  return view(before) !== view(after);
}

/** What the plan looked like before an action, to put back with «Deshacer». */
function planVersion(data: AppData, now: number, label: string): PlanVersion {
  return {
    at: now,
    label,
    pins: data.pins ?? [],
    today: data.plan.filter(
      (b) => b.start > now && b.start < endOfDay(data.settings.timezone, now),
    ),
    overrides: data.overrides,
    proposals: data.proposals,
    mealChoices: data.mealChoices ?? [],
    freeTimeUntil: data.freeTimeUntil,
    tentativeHoldUntil: data.tentativeHoldUntil,
    relaxContextUntil: data.relaxContextUntil,
  };
}

const pushVersion = (data: AppData, next: AppData, v: PlanVersion): AppData => ({
  ...next,
  planHistory: [...(data.planHistory ?? []), v].slice(-PLAN_HISTORY),
});

const ENDS = new Set(["deleteAll", "endFromToday"]);
export const GONE_KEYS = ["tasks", "checkIns", "plan", "pins", "applied", "activities"] as const;

/** A routine deleted or ended from today: its version keeps it as it was, to put back. */
function silo(data: AppData, action: Extract<Action, { type: "recurrence" }>, next: AppData) {
  const task = data.tasks.find((t) => t.id === action.taskId);
  if (!task) return next;
  const snap = snapshotOf(data, GONE_KEYS, [task]);
  settleSnapshot(snap, next);
  const label = `eliminar ${clipName(task.title, 24)}`;
  return pushVersion(data, next, {
    ...planVersion(data, action.now, label),
    gone: { taskId: task.id, snap },
  });
}

function versioned(data: AppData, action: Action, next: AppData): AppData {
  if (next === data) return next;
  if (action.type === "deleteActivity") {
    const removed = removedWith(data, action.activityId);
    if (!removed) return next;
    const label = `eliminar ${clipName(removed.activity.name, 24)}`;
    return pushVersion(data, next, { ...planVersion(data, action.now, label), removed });
  }
  if (action.type === "recurrence" && ENDS.has(action.change)) return silo(data, action, next);
  if (action.type === "checkIn") return answered(data, action, next);
  const label = VERSIONED[action.type];
  if (!label) return next;
  // A replan that changed nothing has nothing to undo.
  if (action.type === "replanWeek" && !replanChanged(data, next)) return next;
  return pushVersion(data, next, planVersion(data, action.now, label));
}

/** What an answer to a block is called in «Deshacer: …» (none for a retired one). */
function answerLabel(status: CheckIn["status"]): string | undefined {
  if (status === "done") return "marcar Hecho";
  if (status === "missed") return "marcar No hecho";
  return status === "partial" ? "anotar una parte" : undefined;
}

/** An answer to a block (Hecho, No hecho, a part) leaves its own «Deshacer» in the header. */
function answered(data: AppData, action: Extract<Action, { type: "checkIn" }>, next: AppData) {
  const made = next.checkIns.find((c) => !data.checkIns.some((d) => d.id === c.id));
  const label = made && answerLabel(made.status);
  if (!made || !label) return next;
  return pushVersion(data, next, { ...planVersion(data, action.now, label), checkIn: made.id });
}

/** Whether an undo version keeps the address `key` in its saved spots. */
function historyHasSpot(v: PlanVersion, key: string): boolean {
  const has = (list: unknown) =>
    Array.isArray(list) && list.some((s: { key?: string }) => s.key === key);
  return (v.saved ?? []).some((p) => p.part === "spots" && (has(p.before) || has(p.after)));
}

/** A part of the data that a save changes and «Deshacer» puts back (read and written by hand). */
interface SavedPart {
  id: string;
  get: (d: AppData) => unknown;
  set: (d: AppData, v: unknown) => AppData;
}

const savedPart = <T,>(
  id: string,
  get: (d: AppData) => T,
  set: (d: AppData, v: T) => AppData,
): SavedPart => ({ id, get, set: (d, v) => set(d, v as T) });

const SAVED_PARTS: readonly SavedPart[] = [
  savedPart(
    "settings",
    (d) => d.settings,
    (d, settings) => ({ ...d, settings }),
  ),
  savedPart(
    "mealRuns",
    (d) => d.mealRuns,
    (d, mealRuns) => ({ ...d, mealRuns }),
  ),
  savedPart(
    "places",
    (d) => d.places,
    (d, places) => ({ ...d, places }),
  ),
  savedPart(
    "travelTimes",
    (d) => d.travelTimes,
    (d, travelTimes) => ({ ...d, travelTimes }),
  ),
  savedPart(
    "spots",
    (d) => d.spots,
    (d, spots) => ({ ...d, spots }),
  ),
  savedPart(
    "eventTravel",
    (d) => d.eventTravel,
    (d, eventTravel) => ({ ...d, eventTravel }),
  ),
  savedPart(
    "tripModes",
    (d) => d.tripModes,
    (d, tripModes) => ({ ...d, tripModes }),
  ),
  savedPart(
    "tripMinutes",
    (d) => d.tripMinutes,
    (d, tripMinutes) => ({ ...d, tripMinutes }),
  ),
];

/** The saved parts that put back what a save changed, unless it was changed again since. */
function putSavedBack(data: AppData, saved: NonNullable<PlanVersion["saved"]>): AppData {
  return saved.reduce((d, s) => {
    const part = SAVED_PARTS.find((p) => p.id === s.part);
    return part && same(part.get(d), s.after) ? part.set(d, s.before) : d;
  }, data);
}

/** Takes back the last version of the undo history (`only`: that one, if it is still the last). */
function undoPlan(start: AppData, only: PlanVersion | undefined, now: number): AppData {
  const history = start.planHistory ?? [];
  const v = history.at(-1);
  if (!v || (only !== undefined && v !== only)) return start;
  // A deleted materia or rutina comes back with its silos; what a save changed goes back.
  const restored = v.removed
    ? apply(start, { type: "restoreActivity", removed: v.removed, now })
    : v.checkIn
      ? apply(start, { type: "undoCheckIn", id: v.checkIn, now })
      : start;
  const back = v.saved ? putSavedBack(restored, v.saved) : restored;
  const data = v.gone ? restoreSnapshot(back, v.gone.snap, now) : back;
  // What already started stays; today's blocks ahead and the inputs come back.
  const kept = data.plan.filter((b) => b.start <= now);
  // A task deleted since then does not come back with its blocks.
  // Nor does one that is closed, dropped or past its deadline.
  const live = new Set(data.tasks.filter((t) => isPlannable(t, now)).map((t) => t.id));
  return refresh(
    {
      ...data,
      plan: [...kept, ...v.today.filter((b) => b.start > now && live.has(b.taskId))],
      pins: v.pins.filter((b) => live.has(b.taskId)),
      overrides: v.overrides,
      proposals: v.proposals,
      // Versions from before meals were kept do not say: the choices stay as they are.
      ...(v.mealChoices ? { mealChoices: v.mealChoices } : {}),
      freeTimeUntil: v.freeTimeUntil,
      relaxContextUntil: v.relaxContextUntil,
      tentativeHoldUntil: v.tentativeHoldUntil,
      planHistory: history.slice(0, -1),
    },
    now,
  );
}

/** What a save is called in «Deshacer: …», from what it changed (none: not worth undoing). */
function saveLabel(data: AppData, action: Action): string | undefined {
  switch (action.type) {
    case "settings": {
      const [a, b] = [data.settings, action.settings];
      if (!same(a.week, b.week)) return "guardar Mi semana";
      const rules = [
        a.slotMinutes !== b.slotMinutes,
        a.travelMarginMinutes !== b.travelMarginMinutes,
        a.maxActivitiesPerDay !== b.maxActivitiesPerDay,
        a.warnSlackMinutes !== b.warnSlackMinutes,
      ];
      return rules.some(Boolean) ? "guardar Reglas" : undefined;
    }
    case "savePlace":
      return "guardar un lugar";
    case "travelTime":
    case "forgetTravelTime":
      return "cambiar minutos en auto";
    case "spotMinutes":
      return "cambiar minutos de una dirección";
    case "forgetSpot":
      return "olvidar una dirección";
    case "deletePlace": {
      const place = data.places?.find((p) => p.id === action.placeId);
      return place ? `borrar ${clipName(place.name, 24)}` : undefined;
    }
    case "eventTravelMinutes":
    case "tripMode":
    case "tripMinutes":
      return "ajustar un traslado";
    case "saveSpot":
      return "guardar un lugar";
    default:
      return undefined;
  }
}

/** Records a save in the undo history, with the parts it changed. */
function saved(data: AppData, action: Action, next: AppData): AppData {
  const label = next === data ? undefined : saveLabel(data, action);
  if (!label) return next;
  const parts = SAVED_PARTS.map((p) => ({ part: p.id, before: p.get(data), after: p.get(next) }));
  const changed = parts.filter((p) => !same(p.before, p.after));
  if (changed.length === 0) return next;
  return pushVersion(data, next, { ...planVersion(data, action.now, label), saved: changed });
}
