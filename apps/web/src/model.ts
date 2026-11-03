import type { Activity, CalendarEvent, DayOverride, PlanBlock, Settings } from "@critical/engine";

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
  /** Calendar event this task was created from (`source:externalId`). */
  sourceEventId?: string;
  /** Created automatically; waits for a quick OK in the inbox. */
  needsReview?: boolean;
}

export type CalendarRole = "busy" | "ignore" | "parcial" | "entrega" | "presentacion";

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

export interface Preferences {
  /** Effort given to tasks created from calendar events, per kind. */
  importDefaults?: Partial<Record<DetectedKind, Effort>>;
}

export interface AppData {
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
}

/** First palette colour no activity uses yet, so every subject looks different. */
export function nextColor(activities: readonly { color: string }[]): string {
  const used = new Set(activities.map((a) => a.color.toLowerCase()));
  return (
    PALETTE.find((c) => !used.has(c.toLowerCase())) ??
    (PALETTE[activities.length % PALETTE.length] as string)
  );
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
