import type { BackupRoute } from "./busRoutes.js";
import type {
  Activity,
  CalendarEvent,
  DayOverride,
  MealChoice,
  MealKind,
  PlanBlock,
  Settings,
  StartAfter,
} from "./engine.js";
import type { Snapshot } from "./store.js";

/** Activity colours, taken from the thick-line references. Red is reserved for critical. */
export const PALETTE = [
  "#FF8A00",
  "#FFC400",
  "#12A150",
  "#14C8EB",
  "#0A72FF",
  "#FF8FCF",
  "#7B5CFF",
  "#2BB3A3",
] as const;

export const CRITICAL = "#E0262E";

export interface Unit {
  id: string;
  title: string;
  estimateMinutes: number;
  /**
   * When it counts as done. A part is done when it was marked by hand (`doneByHand`) or
   * when a standing check-in declares it; then this is the hand mark's date or the
   * oldest standing record's (derived: `settleUnits`).
   */
  doneAt?: number;
  /**
   * Marked by hand (a topic that was already done, no record declares it). `false`: it
   * is done because records declare it. Unset on data from before this field: it is read
   * with the migration rule (done and no standing record declares it: by hand).
   */
  doneByHand?: boolean;
  /** How much it weighs in the exam, 0–100 (e.g. % of the grade). */
  weight?: number;
  /** Left out to make the rest fit: not studied, not counted as missing. */
  skipped?: boolean;
}

/**
 * The total of a task (SPEC §18.18): with parts, the sum of the ones not left out, whatever
 * the estimate says (an estimate above it is not hours any part holds; one below it is an
 * option's cut, which caps it). Without parts, its estimate. The one figure the plan, the
 * silos, the options and the sheet use.
 */
export function taskTotal(task: Pick<AppTask, "kind" | "estimateMinutes" | "units">): number {
  if (task.kind === "habit" || task.units.length === 0) return task.estimateMinutes;
  const parts = task.units.filter((u) => !u.skipped).reduce((n, u) => n + u.estimateMinutes, 0);
  return task.estimateMinutes > 0 ? Math.min(parts, task.estimateMinutes) : parts;
}

export interface AppTask {
  id: string;
  activityId: string;
  title: string;
  kind: "deliverable" | "habit";
  /** Deliverables only. */
  deadline?: number;
  /** Total effort (cap when there are units). */
  estimateMinutes: number;
  /** Never planned below this. */
  minMinutes: number;
  /** Habits: sessions per week of `sessionMinutes`. */
  sessionsPerWeek?: number;
  /**
   * When a habit was made: the week it was made in asks only the share of the days left
   * (SPEC §18 punto 11). Unset for the ones from before: they ask the whole week.
   */
  createdAt?: number;
  sessionMinutes?: number;
  maxPerDayMinutes?: number;
  priority: number;
  status: "active" | "done" | "dropped";
  units: Unit[];
  /** A materia's weekly study silo (one per materia), whatever its title. */
  study?: boolean;
  /** Calendar event this task was created from (`source:externalId`). */
  sourceEventId?: string;
  /** Created automatically; waits for a quick OK in the inbox. */
  needsReview?: boolean;
  /** An exam (parcial): its sessions spread over review days before the date. */
  exam?: boolean;
  /** Exams only: the day before is for its materia alone. */
  dayBeforeOnly?: boolean;
  /**
   * What its calendar event was imported as: only a change of that (a parcial retagged
   * as an entrega) re-decides `exam`; otherwise the user's choice stays.
   */
  sourceRole?: DetectedKind;
  /** Work can start only then (overrides its materia's); deliverables only. */
  startAfter?: StartAfter;
  /** Weekly silos: off until this instant (the start of the next week). */
  skipUntil?: number;
  /** Weekly silos: off until turned back on. */
  paused?: boolean;
  /** When it stopped repeating; earlier weeks stay as history. */
  endedAt?: number;
  /**
   * Set with endedAt when the import dropped it (its event stopped being an evaluation).
   * Still equal to endedAt: the user has not touched it since, so it may come back.
   */
  autoDroppedAt?: number;
  /**
   * Set when the user changes the deadline of a task that follows a calendar event: the
   * deadline the event gave it, which the user's date replaced. The import keeps the user's
   * date while the event still says that; once the event moves, it follows it again.
   */
  deadlineSyncedFrom?: number;
}

export type CalendarRole =
  | "busy"
  | "ignore"
  | "parcial"
  | "entrega"
  | "presentacion"
  | "clases"
  | "flexible";

export interface AppCalendar {
  /** `source:externalId` */
  id: string;
  source: "google" | "icloud";
  externalId: string;
  name: string;
  color?: string;
  /** Undefined means "guess from the name". */
  role?: CalendarRole;
}

export interface AppEvent extends CalendarEvent {
  source: "google" | "icloud" | "demo";
  /** The calendar says it may not happen (or its title ends in «?»). */
  tentative?: boolean;
  link?: string;
  /** `source:calendarExternalId` */
  calendarId?: string;
}

export interface CheckIn {
  id: string;
  blockId: string;
  taskId: string;
  /**
   * «retired» takes back the block's first record (the log only grows, so undoing is a new
   * record): the block counts as having none.
   */
  status: "done" | "missed" | "partial" | "retired";
  minutesDone: number;
  unitIds: string[];
  createdAt: number;
  /**
   * «undo»: written by «Deshacer» (a copy of the earlier answer): not news, no celebration.
   * «slept»: a «no hecho» the app wrote when the wake-up said the user was asleep then.
   */
  origin?: "undo" | "slept";
  /**
   * Legacy (until the 40.ª): block time per study minute. Not written nor read any more:
   * a block done counts its whole time, break included (SPEC §18.17).
   */
  factor?: number;
}

export interface Proposal {
  id: string;
  message: string;
  /** Plan to adopt if accepted. */
  plan: PlanBlock[];
  /** Today's blocks that clash with new events. */
  conflicts: string[];
  createdAt: number;
}

export type DetectedKind = "parcial" | "entrega" | "presentacion";

export interface Effort {
  estimate: number;
  min: number;
  priority: number;
}

/** Which push notifications to send (the server reads these too). */
export interface NotificationPrefs {
  /** Before each critical block. */
  critical?: boolean;
  leadMinutes?: number;
  /** When a new event clashes with today's plan. */
  proposals?: boolean;
  /** Weekly planning reminder on Sundays. */
  sunday?: boolean;
  /** Minutes since midnight. */
  sundayAt?: number;
}

export const NOTIFY_DEFAULTS: Required<NotificationPrefs> = {
  critical: true,
  leadMinutes: 10,
  proposals: true,
  sunday: true,
  sundayAt: 19 * 60,
};

export interface Preferences {
  /** Effort given to tasks created from calendar events, per kind. */
  importDefaults?: Partial<Record<DetectedKind, Effort>>;
  notifications?: NotificationPrefs;
  /** Plan Uruguay's holidays with Sunday's routine (default on). */
  holidaysOff?: boolean;
  /** Current semester (inicio de cuatrimestre), local dates. */
  semester?: { start: string; end: string };
}

export interface AppData {
  /** The signed-in user's id (from the database); absent in demo mode. */
  owner?: string;
  settings: Settings;
  activities: Activity[];
  tasks: AppTask[];
  events: AppEvent[];
  calendars?: AppCalendar[];
  checkIns: CheckIn[];
  overrides: DayOverride[];
  /** Past blocks are history; future blocks are the current plan. */
  plan: PlanBlock[];
  proposals: Proposal[];
  /** Academic work may use free time until this instant. */
  freeTimeUntil?: number;
  /** Context-switch cap relaxed until this instant. */
  relaxContextUntil?: number;
  preferences?: Preferences;
  /** Choices taken from the inbox, so they can be undone. */
  applied?: AppliedDecision[];
  /** Blocks the user moved by hand; the planner works around them. */
  pins?: PlanBlock[];
  places?: Place[];
  travelTimes?: TravelTime[];
  /** Normalized locations/titles of events that need no trip (online, at home…). */
  noTravel?: string[];
  /** Event addresses used for travel without being saved as places. */
  spots?: Spot[];
  /**
   * Driving minutes from home kept for single events after their address was deleted
   * («Eliminar lugar»): the plan still counts the trip, no address is kept. `key` is
   * the event's `spotKey` then: if the event moves elsewhere, the minutes no longer apply.
   */
  eventTravel?: Record<string, EventTravel>;
  /** How to get to one event, just that once (SPEC §15); without an entry, the place's mode. */
  tripModes?: Record<string, TravelMode>;
  /**
   * Door-to-door minutes of the bus to one event (SPEC §15), as `/api/transit` last said,
   * with the start they were worked out for: if the event moves, the figure no longer applies.
   * `back` is the way home after the event, when it was worked out apart (else it is the
   * same as the way there).
   */
  tripMinutes?: Record<string, { minutes: number; start: number; back?: number }>;
  /** That day only: a meal skipped («Hoy no») or moved by hand (minutes since midnight). */
  mealChoices?: (MealChoice & { date: string })[];
  /**
   * Where and when each meal was, once its day is over: the past is not planned again
   * (SPEC §5). One series per meal and weekday, as runs (see `MealRun`).
   */
  mealRuns?: MealRun[];
  /** The last day whose meals were written into `mealRuns` (YYYY-MM-DD). */
  mealsFrozenThrough?: string;
  /** Flexible events the user agreed to move: planned at the new time until moved. */
  movedEvents?: { eventId: string; from: number; start: number; end: number }[];
  /** Upcoming tentative events last seen, to notice one that falls through. */
  tentativeSeen?: { id: string; title: string; start: number; end: number }[];
  /** A plan B was turned down: today's blocks stay as they are until then (end of day). */
  tentativeHoldUntil?: number;
  /** What the plan looked like before each reorganization, newest last (up to 20). */
  planHistory?: PlanVersion[];
  /** Normalized titles of class-calendar events that are not a materia (a talk…). */
  notSubjects?: string[];
  /**
   * Normalized names of the materias the user deleted: their evaluation events no longer
   * bring the subject (or its tasks) back from the calendar.
   */
  removedSubjects?: string[];
  /**
   * The saved bus routes (SPEC §15) as a backup file carries them (SPEC §18.20). They live
   * in their own table: the store never holds them, only the file and the import do.
   */
  busRoutes?: BackupRoute[];
}

/**
 * Where a one-off event happens (an address in the event, or what the user typed for
 * it), with the driving time from home; kept out of the saved places on purpose.
 */
export interface Spot {
  /** `normalize(text)`: events saying the same thing share it. */
  key: string;
  /** What the event says, as written. */
  text: string;
  /** Driving minutes from home (each way); missing while not known. */
  minutes?: number;
  /** Typed by the user: never replaced by a computed time. */
  manual?: boolean;
  /** The address could not be found or reached: the inbox asks. */
  failed?: boolean;
}

export interface EventTravel {
  minutes: number;
  key: string;
}

/** How a trip is made: by car (the driving times) or by bus (SPEC §15). */
export type TravelMode = "car" | "bus";

/** A saved place (home, facu, gym…), matched against event locations and titles. */
export interface Place {
  id: string;
  name: string;
  /** Other ways it shows up in events ("Facultad de Ingeniería", "FING"). */
  aliases: string[];
  /** For geocoding (OpenStreetMap) and automatic driving times. */
  address?: string;
  lat?: number;
  lon?: number;
  isHome?: boolean;
  /** Default way to get there (SPEC §15); missing = car. */
  travelMode?: TravelMode;
}

/** Driving minutes between two places; manual times win over computed ones. */
export interface TravelTime {
  from: string;
  to: string;
  minutes: number;
  manual: boolean;
}

export interface AppliedDecision {
  id: string;
  label: string;
  at: number;
  /** Tasks as they were before the decision. */
  before: AppTask[];
  /** Tasks the decision itself dropped (records from before `after` existed). */
  dropped?: string[];
  /** Each task's status right after the decision: undo touches only tasks still there. */
  after?: Record<string, AppTask["status"]>;
  /**
   * Each task's minutes right after the decision: undo gives back only what this one
   * cut, so undoing decisions in any order adds up.
   */
  afterMinutes?: Record<string, { min: number; estimate: number }>;
  freeTimeUntil?: number;
  /** Blocks this decision added (free time): undoing takes them out of the plan again. */
  addedBlocks?: string[];
  /** Units this decision left out (prioritizing by weight): undoing brings them back. */
  skippedUnits?: string[];
  /** A flexible event this decision moved: undoing puts it back. */
  movedEventId?: string;
  /** The move of that event this decision replaced, if any: undoing restores it. */
  previousMove?: NonNullable<AppData["movedEvents"]>[number];
  /**
   * Routines this decision took out, and until when (the end of its week): a decision
   * about a routine is for that week only, the next one plans it again.
   */
  skipUntil?: Record<string, number>;
  /** «Puedo empezar» this decision set, by task: undo restores `before` while it still stands. */
  startAfter?: Record<string, StartAfter>;
  /** The move this decision made: undo touches the event only while it still stands. */
  move?: NonNullable<AppData["movedEvents"]>[number];
}

/**
 * The tasks undoing a decision would restore: still there, and not dropped since
 * (unless the decision is what dropped them).
 */
export function undoable(data: AppData, d: AppliedDecision): AppTask[] {
  return d.before.filter((b) => {
    const now = data.tasks.find((t) => t.id === b.id);
    if (!now) return false;
    // Anything that happened to the task since (finished, dropped, brought back) wins.
    if (d.after) return d.after[b.id] === now.status;
    // Older records: never finished work, and only drops the decision made itself.
    if (now.status === "done") return false;
    return now.status !== "dropped" || !!d.dropped?.includes(b.id);
  });
}

/** Forgets tasks in the undo history; a decision left with no task goes away. */
export function pruneApplied(
  applied: AppliedDecision[] | undefined,
  gone: (taskId: string) => boolean,
): AppliedDecision[] | undefined {
  return applied?.flatMap((d) => {
    const before = d.before.filter((t) => !gone(t.id));
    // A decision about free time never had tasks: it stays.
    if (d.before.length > 0 && before.length === 0) return [];
    const after =
      d.after && Object.fromEntries(Object.entries(d.after).filter(([id]) => !gone(id)));
    return [
      { ...d, before, dropped: d.dropped?.filter((id) => !gone(id)), ...(after ? { after } : {}) },
    ];
  });
}

/** First palette colour no activity uses yet, so every subject looks different. */
export function nextColor(activities: readonly { color: string }[]): string {
  const used = new Set(activities.map((a) => a.color.toLowerCase()));
  return (
    PALETTE.find((c) => !used.has(c.toLowerCase())) ??
    (PALETTE[activities.length % PALETTE.length] as string)
  );
}

/**
 * A UUID that is always the same for the same seed (cyrb128 hash), for rows that
 * several writers may create independently, like tasks imported from one event.
 */
export function stableId(seed: string): string {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  const hex = [h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1]
    .map((h) => (h >>> 0).toString(16).padStart(8, "0"))
    .join("");
  // Version 8 ("custom") and RFC 4122 variant bits, so it is a valid UUID.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${((Number.parseInt(hex[16] ?? "0", 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}`;
}

/** Gives every activity sharing a colour with an earlier one a free colour; same array if nothing changes. */
export function uniqueColors<T extends { color: string }>(activities: T[]): T[] {
  const seen: T[] = [];
  let changed = false;
  for (const a of activities) {
    if (seen.some((b) => b.color.toLowerCase() === a.color.toLowerCase())) {
      const used = [...seen, ...activities.slice(seen.length + 1)];
      const free = PALETTE.find(
        (c) => !used.some((b) => b.color.toLowerCase() === c.toLowerCase()),
      );
      if (free) {
        seen.push({ ...a, color: free });
        changed = true;
        continue;
      }
    }
    seen.push(a);
  }
  return changed ? seen : activities;
}

/**
 * The plan's own inputs before a reorganization (the plan itself is derived, so these
 * are what bring it back): pins, today's blocks, day adjustments and permissions.
 */
export interface PlanVersion {
  at: number;
  /** What changed it, for the undo button. */
  label: string;
  /** `label` before it was cut for the screen: what a screen reader says. */
  fullLabel?: string;
  pins: PlanBlock[];
  /** Today's blocks not started yet: today only changes with an OK, so they are kept. */
  today: PlanBlock[];
  overrides: DayOverride[];
  proposals: Proposal[];
  /** Meals skipped or moved for a day; older versions do not have it. */
  mealChoices?: NonNullable<AppData["mealChoices"]>;
  freeTimeUntil?: number;
  relaxContextUntil?: number;
  tentativeHoldUntil?: number;
  /** A deleted materia or rutina, with its silos: undoing this version brings it back. */
  removed?: RemovedActivity;
  /** A silo (a routine) deleted or ended from today: undoing this version puts it back as it was. */
  gone?: { taskId: string; snap: Snapshot };
  /** Progress logged on a silo: undoing this version takes back what it wrote (records, parts). */
  logged?: { taskId: string; snap: Snapshot };
  /** A check-in (Hecho / No hecho): undoing this version takes that answer back. */
  checkIn?: string;
  /** Saved parts (Mi semana, un lugar…) as they were, and right after: undoing puts back what is still as saved. */
  saved?: { part: string; before: unknown; after: unknown }[];
  /** A decision of the inbox («Elegir»): undoing this version takes that decision back. */
  decision?: string;
  /** An answer or edit: undoing it puts back only the entries it changed (`Snapshot`). */
  edit?: { snap: Snapshot };
  /**
   * The plan's inputs right after the change: an input is put back only while it still
   * stands as the change left it, so what was decided elsewhere since is never undone.
   * Versions from before this was kept do not have it: all their inputs go back.
   */
  after?: PlanInputs;
}

/** The plan's inputs that a version keeps (see `PlanVersion`). */
export type PlanInputs = Pick<
  PlanVersion,
  | "pins"
  | "today"
  | "overrides"
  | "proposals"
  | "mealChoices"
  | "freeTimeUntil"
  | "relaxContextUntil"
  | "tentativeHoldUntil"
>;

/** What `deleteActivity` takes out, kept to put it back on undo. */
export interface RemovedActivity {
  activity: Activity;
  /** Where it was in the list, to go back to the same place. */
  index: number;
  tasks: AppTask[];
  checkIns: AppData["checkIns"];
  pins: NonNullable<AppData["pins"]>;
  /** Its blocks in the plan; versions from before this was kept do not have them. */
  blocks?: PlanBlock[];
}

/**
 * From `from` on, this meal of this weekday was at `start`–`end` (minutes since the day's
 * midnight) until `to` (the last day it was so; undefined while it is the run standing).
 * `placeId`: where it was, when a place was known.
 */
export interface MealRun {
  meal: MealKind;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  from: string;
  to?: string;
  start: number;
  end: number;
  placeId?: string;
}
