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

/** Google's event colours (colorId → hex). */
export const GOOGLE_COLORS: Record<string, string> = {
  "1": "#7986cb",
  "2": "#33b679",
  "3": "#8e24aa",
  "4": "#e67c73",
  "5": "#f6bf26",
  "6": "#f4511e",
  "7": "#039be5",
  "8": "#616161",
  "9": "#3f51b5",
  "10": "#0b8043",
  "11": "#d50000",
};

const rgb = (hex: string) =>
  [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

/** Nearest Google colour to an activity colour; tomato is reserved for critical. */
export function colorIdFor(hex: string, critical: boolean): string {
  if (critical) return "11";
  const [r, g, b] = rgb(hex);
  let best = "8";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [id, h] of Object.entries(GOOGLE_COLORS)) {
    if (id === "11") continue;
    const [r2, g2, b2] = rgb(h);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = id;
    }
  }
  return best;
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
export function planEvent(block: PlanBlockRow, title: string, activityColor: string) {
  const critical = block.level === "critical";
  return {
    summary: `${critical ? "🔴 " : ""}${title}`,
    start: { dateTime: block.start_at },
    end: { dateTime: block.end_at },
    colorId: colorIdFor(activityColor, critical),
    transparency: "opaque",
    extendedProperties: { private: { criticalBlock: block.id } },
  };
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
