// Pure helpers for Google Calendar sync. No imports, so both Deno (edge
// functions) and Vitest can load this file.

export const PLAN_CALENDAR = "📚 Plan";

export interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  transparency?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  colorId?: string;
  extendedProperties?: { private?: Record<string, string> };
}

export interface EventRow {
  user_id: string;
  source: "google";
  external_id: string;
  calendar_id: string;
  title: string;
  start_at: string;
  end_at: string;
  location: string | null;
  busy: boolean;
  tentative: boolean;
  all_day: boolean;
  link: string | null;
}

/** Converts a Google event into a calendar_events row, or null to skip it. */
export function toRow(
  userId: string,
  calendarId: string,
  e: GoogleEvent,
  timeZone: string,
): EventRow | null {
  if (e.status === "cancelled") return null;
  const allDay = !!e.start?.date && !e.start?.dateTime;
  const start = e.start?.dateTime ?? (e.start?.date ? midnight(e.start.date, timeZone) : undefined);
  const end = e.end?.dateTime ?? (e.end?.date ? midnight(e.end.date, timeZone) : undefined);
  if (!start || !end) return null;
  return {
    user_id: userId,
    source: "google",
    external_id: `${calendarId}|${e.id}`,
    calendar_id: calendarId,
    title: e.summary ?? "(sin título)",
    start_at: new Date(start).toISOString(),
    end_at: new Date(end).toISOString(),
    location: e.location ?? null,
    busy: e.transparency !== "transparent",
    tentative: e.status === "tentative",
    all_day: allDay,
    link: e.htmlLink ?? null,
  };
}

/** Local midnight of `date` in `timeZone`, as an ISO instant. */
export function midnight(date: string, timeZone: string): string {
  const naive = Date.parse(`${date}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(naive));
  const p: Record<string, string> = {};
  for (const x of parts) p[x.type] = x.value;
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
  );
  return new Date(naive - (asUtc - naive)).toISOString();
}

/** Plan blocks are Basil green, the Plan calendar's colour… */
export const PLAN_COLOR_ID = "10";
/** …and critical ones Tomato red (with a 🔴 in the title too), as the iOS widget shows. */
export const CRITICAL_COLOR_ID = "11";
export const PLAN_CALENDAR_COLOR = "#0b8043";

export interface CalendarListItem {
  id: string;
  summary: string;
  backgroundColor?: string;
  selected?: boolean;
  hidden?: boolean;
}

/**
 * Exactly one Plan calendar: the stored one if it still exists, else the first
 * found. Every other calendar named like it is a duplicate to delete.
 */
export function choosePlanCalendar(items: readonly CalendarListItem[], storedId?: string | null) {
  const plans = items.filter((c) => c.summary === PLAN_CALENDAR);
  const keep = plans.find((c) => c.id === storedId) ?? plans[0];
  return { keep, remove: plans.filter((c) => c !== keep).map((c) => c.id) };
}

export interface PlanBlockRow {
  id: string;
  task_id: string;
  start_at: string;
  end_at: string;
  level: string;
  google_event_id: string | null;
}

/** Body of the Google event that mirrors a planned block. */
export function planEvent(block: PlanBlockRow, title: string) {
  const critical = block.level === "critical";
  return {
    summary: `${critical ? "🔴 " : ""}${title}`,
    start: { dateTime: block.start_at },
    end: { dateTime: block.end_at },
    colorId: critical ? CRITICAL_COLOR_ID : PLAN_COLOR_ID,
    transparency: "opaque",
    extendedProperties: { private: { criticalBlock: block.id } },
  };
}

/** Whether a Plan event already shows `wanted`: then there is nothing to send. */
export function sameEvent(e: GoogleEvent, wanted: ReturnType<typeof planEvent>): boolean {
  const at = (x?: string) => (x ? Date.parse(x) : Number.NaN);
  return (
    e.summary === wanted.summary &&
    at(e.start?.dateTime) === at(wanted.start.dateTime) &&
    at(e.end?.dateTime) === at(wanted.end.dateTime) &&
    e.colorId === wanted.colorId &&
    (e.transparency ?? "opaque") === wanted.transparency
  );
}

export interface PlanDiff {
  create: PlanBlockRow[];
  update: PlanBlockRow[];
  /** Google event ids to delete. */
  remove: string[];
}

/**
 * What to change in the Plan calendar: blocks without an event are created,
 * blocks with one are updated, and events whose block is gone are deleted.
 */
export function diffPlan(
  blocks: readonly PlanBlockRow[],
  existing: readonly GoogleEvent[],
): PlanDiff {
  const byBlock = new Map(
    existing
      .filter((e) => e.status !== "cancelled")
      .map((e) => [e.extendedProperties?.private?.criticalBlock, e] as const),
  );
  const wanted = new Set(blocks.map((b) => b.id));
  const create: PlanBlockRow[] = [];
  const update: PlanBlockRow[] = [];
  for (const b of blocks) {
    const match = byBlock.get(b.id);
    if (match) update.push({ ...b, google_event_id: match.id });
    else create.push(b);
  }
  const remove = existing
    .filter((e) => e.status !== "cancelled")
    .filter((e) => !wanted.has(e.extendedProperties?.private?.criticalBlock ?? ""))
    .map((e) => e.id);
  return { create, update, remove };
}
