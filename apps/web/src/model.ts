import type { Activity, CalendarEvent, DayOverride, PlanBlock, Settings } from "./engine.js";

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
  doneAt?: number;
  /** How much it weighs in the exam, 0–100 (e.g. % of the grade). */
  weight?: number;
  /** Left out to make the rest fit: not studied, not counted as missing. */
  skipped?: boolean;
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
  link?: string;
  /** `source:calendarExternalId` */
  calendarId?: string;
}

export interface CheckIn {
  id: string;
  blockId: string;
  taskId: string;
  status: "done" | "missed" | "partial";
  minutesDone: number;
  unitIds: string[];
  createdAt: number;
  /**
   * Block time per study minute when it was recorded (breaks included; see blockFactor).
   * Missing on older check-ins, which had no breaks: 1.
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
  /** Flexible events the user agreed to move: planned at the new time until moved. */
  movedEvents?: { eventId: string; from: number; start: number; end: number }[];
  /** What the plan looked like before each reorganization, newest last (up to 20). */
  planHistory?: PlanVersion[];
  /** Normalized titles of class-calendar events that are not a materia (a talk…). */
  notSubjects?: string[];
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
  freeTimeUntil?: number;
  /** Units this decision left out (prioritizing by weight): undoing brings them back. */
  skippedUnits?: string[];
  /** A flexible event this decision moved: undoing puts it back. */
  movedEventId?: string;
  /** The move of that event this decision replaced, if any: undoing restores it. */
  previousMove?: NonNullable<AppData["movedEvents"]>[number];
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
  pins: PlanBlock[];
  /** Today's blocks not started yet: today only changes with an OK, so they are kept. */
  today: PlanBlock[];
  overrides: DayOverride[];
  proposals: Proposal[];
  freeTimeUntil?: number;
  relaxContextUntil?: number;
}
