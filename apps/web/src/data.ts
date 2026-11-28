import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultSettings } from "./demo.js";
import type { Activity, DayOverride, PlanBlock, Settings } from "./engine.js";
import type {
  AppCalendar,
  AppData,
  AppEvent,
  AppliedDecision,
  AppTask,
  CalendarRole,
  CheckIn,
  MealRun,
  Place,
  Preferences,
  Proposal,
  Spot,
  TravelTime,
} from "./model.js";
import { habitsAsRoutines } from "./subjects.js";

// Database rows <-> AppData. No browser globals: the server functions use it too.

interface State {
  pins?: PlanBlock[];
  applied?: AppliedDecision[];
  preferences?: Preferences;
  proposals?: Proposal[];
  freeTimeUntil?: number;
  relaxContextUntil?: number;
  noTravel?: string[];
  spots?: Spot[];
  eventTravel?: AppData["eventTravel"];
  tripModes?: AppData["tripModes"];
  tripMinutes?: AppData["tripMinutes"];
  mealChoices?: AppData["mealChoices"];
  mealsFrozenThrough?: string;
  notSubjects?: string[];
  removedSubjects?: string[];
  movedEvents?: AppData["movedEvents"];
  tentativeSeen?: AppData["tentativeSeen"];
  tentativeHoldUntil?: number;
  planHistory?: AppData["planHistory"];
}

const ms = (iso: string) => Date.parse(iso);
const iso = (t: number) => new Date(t).toISOString();

type Row = Record<string, unknown>;

export const eventOf = (e: Row): AppEvent => ({
  id: `${e.source}:${e.external_id}`,
  title: e.title as string,
  start: ms(e.start_at as string),
  end: ms(e.end_at as string),
  location: (e.location as string) ?? undefined,
  busy: e.busy as boolean,
  tentative: (e.tentative as boolean) || undefined,
  allDay: e.all_day as boolean,
  source: e.source as AppEvent["source"],
  link: (e.link as string) ?? undefined,
  calendarId: e.calendar_id ? `${e.source}:${e.calendar_id}` : undefined,
});

export const overrideOf = (o: Row): DayOverride => ({
  date: o.date as string,
  wake: (o.wake as number) ?? undefined,
  bed: (o.bed as number) ?? undefined,
});

export const blockOf = (b: Row, activityId: string): PlanBlock => ({
  id: b.id as string,
  taskId: b.task_id as string,
  activityId,
  start: ms(b.start_at as string),
  end: ms(b.end_at as string),
  level: b.level as PlanBlock["level"],
  soft: b.soft as boolean,
  review: b.review === true ? true : undefined,
});

export function rowsToData(r: {
  settings: Row | null;
  activities: Row[];
  tasks: Row[];
  units: Row[];
  checkIns: Row[];
  events: Row[];
  overrides: Row[];
  blocks: Row[];
  calendars?: Row[];
  places?: Row[];
  travelTimes?: Row[];
  mealRuns?: Row[];
}): AppData {
  const state = (r.settings?.state ?? {}) as State;
  const loaded: AppData = {
    owner: (r.settings?.user_id as string) ?? undefined,
    settings: { ...defaultSettings, ...((r.settings?.data as Partial<Settings>) ?? {}) },
    activities: r.activities.map(
      (a): Activity => ({
        id: a.id as string,
        name: a.name as string,
        color: a.color as string,
        academic: a.academic as boolean,
        maxSessionMinutes: a.max_session_minutes as number,
        minBlockMinutes: a.min_block_minutes as number,
        preferred:
          a.preferred_start != null && a.preferred_end != null
            ? { start: a.preferred_start as number, end: a.preferred_end as number }
            : undefined,
        kind: (a.kind as Activity["kind"]) ?? undefined,
        aliases: (a.aliases as string[] | null)?.length ? (a.aliases as string[]) : undefined,
        studyMinutes: (a.study_minutes as number | null) ?? undefined,
        breakMinutes: (a.break_minutes as number | null) ?? undefined,
        startAfter: (a.start_after as Activity["startAfter"] | null) ?? undefined,
        validHours: (a.valid_hours as Activity["validHours"] | null) ?? undefined,
      }),
    ),
    tasks: r.tasks.map(
      (t): AppTask => ({
        id: t.id as string,
        activityId: t.activity_id as string,
        title: t.title as string,
        kind: t.kind as AppTask["kind"],
        deadline: t.deadline ? ms(t.deadline as string) : undefined,
        estimateMinutes: (t.estimate_minutes as number) ?? 0,
        minMinutes: t.min_minutes as number,
        sessionsPerWeek: (t.sessions_per_week as number) ?? undefined,
        sessionMinutes: (t.session_minutes as number) ?? undefined,
        maxPerDayMinutes: (t.max_per_day_minutes as number) ?? undefined,
        priority: t.priority as number,
        status: t.status as AppTask["status"],
        sourceEventId: (t.source_event_id as string) ?? undefined,
        needsReview: (t.needs_review as boolean) || undefined,
        exam: (t.exam as boolean) || undefined,
        dayBeforeOnly: (t.day_before_only as boolean) || undefined,
        sourceRole: (t.source_role as AppTask["sourceRole"] | null) ?? undefined,
        study: (t.study as boolean) || undefined,
        skipUntil: t.skip_until ? ms(t.skip_until as string) : undefined,
        paused: (t.paused as boolean) || undefined,
        endedAt: t.ended_at ? ms(t.ended_at as string) : undefined,
        autoDroppedAt: t.auto_dropped_at ? ms(t.auto_dropped_at as string) : undefined,
        startAfter: (t.start_after as AppTask["startAfter"] | null) ?? undefined,
        createdAt: t.created_at ? ms(t.created_at as string) : undefined,
        deadlineSyncedFrom: t.deadline_synced_from
          ? ms(t.deadline_synced_from as string)
          : undefined,
        units: r.units
          .filter((u) => u.task_id === t.id)
          .sort((a, b) => (a.position as number) - (b.position as number))
          .map((u) => ({
            id: u.id as string,
            title: u.title as string,
            estimateMinutes: u.estimate_minutes as number,
            doneAt: u.done_at ? ms(u.done_at as string) : undefined,
            // Rows from before the column read as unset: the migration rule applies.
            doneByHand: u.done_by_hand === undefined || !u.done_at ? undefined : !!u.done_by_hand,
            weight: (u.weight as number | null) ?? undefined,
            skipped: (u.skipped as boolean) || undefined,
          })),
      }),
    ),
    checkIns: r.checkIns.map(
      (c): CheckIn => ({
        id: c.id as string,
        blockId: c.block_id as string,
        taskId: c.task_id as string,
        status: c.status as CheckIn["status"],
        minutesDone: c.minutes_done as number,
        unitIds: (c.unit_ids as string[]) ?? [],
        createdAt: ms(c.created_at as string),
        origin: c.origin === "undo" || c.origin === "slept" ? c.origin : undefined,
        factor: (c.block_factor as number | null) ?? undefined,
      }),
    ),
    events: r.events.map(eventOf),
    overrides: r.overrides.map(overrideOf),
    plan: r.blocks.map((b) =>
      blockOf(b, (r.tasks.find((t) => t.id === b.task_id)?.activity_id as string) ?? ""),
    ),
    calendars: (r.calendars ?? []).map(
      (c): AppCalendar => ({
        id: `${c.source}:${c.external_id}`,
        source: c.source as AppCalendar["source"],
        externalId: c.external_id as string,
        name: c.name as string,
        color: (c.color as string) ?? undefined,
        role: (c.role as CalendarRole) ?? undefined,
      }),
    ),
    places: (r.places ?? []).map(
      (p): Place => ({
        id: p.id as string,
        name: p.name as string,
        aliases: (p.aliases as string[]) ?? [],
        address: (p.address as string) ?? undefined,
        lat: (p.lat as number) ?? undefined,
        lon: (p.lon as number) ?? undefined,
        isHome: (p.is_home as boolean) || undefined,
        travelMode: p.travel_mode === "bus" ? "bus" : undefined,
      }),
    ),
    travelTimes: (r.travelTimes ?? []).map(
      (t): TravelTime => ({
        from: t.from_place as string,
        to: t.to_place as string,
        minutes: t.minutes as number,
        manual: t.manual as boolean,
      }),
    ),
    noTravel: state.noTravel,
    spots: state.spots,
    eventTravel: state.eventTravel,
    tripModes: state.tripModes,
    tripMinutes: state.tripMinutes,
    mealChoices: state.mealChoices,
    mealsFrozenThrough: state.mealsFrozenThrough,
    mealRuns: (r.mealRuns ?? []).map(
      (m): MealRun => ({
        meal: m.meal as MealRun["meal"],
        weekday: m.weekday as number,
        from: m.from_date as string,
        to: (m.to_date as string) ?? undefined,
        start: m.start_minutes as number,
        end: m.end_minutes as number,
        placeId: (m.place_id as string) ?? undefined,
      }),
    ),
    notSubjects: state.notSubjects,
    removedSubjects: state.removedSubjects,
    movedEvents: state.movedEvents,
    tentativeSeen: state.tentativeSeen,
    tentativeHoldUntil: state.tentativeHoldUntil,
    planHistory: state.planHistory,
    proposals: state.proposals ?? [],
    preferences: state.preferences,
    applied: state.applied,
    pins: state.pins,
    freeTimeUntil: state.freeTimeUntil,
    relaxContextUntil: state.relaxContextUntil,
  };
  // A habit made the old way (its own kind-less activity) is read as the routine it is.
  return habitsAsRoutines(loaded);
}

/** Rows the server returns per request (`max_rows` in supabase/config.toml). */
const PAGE = 1000;

/** A stretch of time, as instants and as the local dates it covers (`toDate` excluded). */
export interface Span {
  from: number;
  to: number;
  fromDate: string;
  toDate: string;
}

/** Rows of the tables that grow with the years, for one stretch of time. */
export interface Chunk {
  events: AppEvent[];
  overrides: DayOverride[];
  /** With no `activityId`: it comes from the task when the chunk is merged. */
  blocks: PlanBlock[];
}

type Narrow = (q: Filterable) => Filterable;
// The query builder is thenable and chainable; only what is used here is typed.
interface Filterable {
  order: (col: string) => Filterable;
  range: (from: number, to: number) => Filterable;
  gt: (col: string, v: string) => Filterable;
  gte: (col: string, v: string) => Filterable;
  lt: (col: string, v: string) => Filterable;
  then: PromiseLike<{ data: unknown; error: unknown }>["then"];
}

/** Every row of a table, `PAGE` at a time (see `loadData`), optionally narrowed. */
async function allRows(
  client: SupabaseClient,
  table: string,
  order: string[],
  narrow: Narrow = (q) => q,
): Promise<Row[]> {
  const query = () =>
    narrow(
      order.reduce(
        (q, col) => q.order(col),
        client.from(table).select("*") as unknown as Filterable,
      ),
    );
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await (from === 0 ? query() : query().range(from, from + PAGE - 1));
    if (error) throw error;
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

const overlapping =
  (span: Span): Narrow =>
  (q) =>
    q.lt("start_at", iso(span.to)).gt("end_at", iso(span.from));

const EVENT_ORDER = ["source", "external_id"];
const BLOCK_ORDER = ["id"];
const OVERRIDE_ORDER = ["date"];
const onDates =
  (span: Span): Narrow =>
  (q) =>
    q.gte("date", span.fromDate).lt("date", span.toDate);

/** The rows of the growing tables inside `span`. */
export async function loadSpan(client: SupabaseClient, span: Span): Promise<Chunk> {
  const [events, blocks, overrides] = await Promise.all([
    allRows(client, "calendar_events", EVENT_ORDER, overlapping(span)),
    allRows(client, "plan_blocks", BLOCK_ORDER, overlapping(span)),
    allRows(client, "day_overrides", OVERRIDE_ORDER, onDates(span)),
  ]);
  return {
    events: events.map(eventOf),
    blocks: blocks.map((b) => blockOf(b, "")),
    overrides: overrides.map(overrideOf),
  };
}

/** The oldest and newest instant (ms) the growing tables hold, or null when they are empty. */
export async function loadBounds(
  client: SupabaseClient,
): Promise<{ first: number; last: number } | null> {
  const edge = async (table: string, col: string, ascending: boolean) => {
    const { data, error } = await client.from(table).select(col).order(col, { ascending }).limit(1);
    if (error) throw error;
    const row = (data as unknown as Row[] | null)?.at(0);
    // Only `col` is selected: its value is the row's only one.
    const v = row ? Object.values(row).at(0) : undefined;
    return typeof v === "string" ? (col === "date" ? Date.parse(`${v}T00:00:00Z`) : ms(v)) : null;
  };
  const found = (
    await Promise.all(
      [
        ["calendar_events", "start_at"],
        ["plan_blocks", "start_at"],
        ["day_overrides", "date"],
      ].flatMap(([t, c]) => [
        edge(t as string, c as string, true),
        edge(t as string, c as string, false),
      ]),
    )
  ).filter((v): v is number => v !== null && Number.isFinite(v));
  return found.length ? { first: Math.min(...found), last: Math.max(...found) } : null;
}

/** What narrows each table that grows with the years (none: the whole table). */
interface Narrowing {
  events?: Narrow;
  overrides?: Narrow;
  blocks?: Narrow;
  checkIns?: Narrow;
}

/** The rows of every table: the small ones whole, the growing ones as `narrow` says. */
async function fetchTables(client: SupabaseClient, narrow: Narrowing) {
  const all = (table: string, order: string[]) => allRows(client, table, order);
  const [
    settings,
    activities,
    tasks,
    units,
    checkIns,
    events,
    overrides,
    blocks,
    calendars,
    places,
    travelTimes,
    mealRuns,
  ] = await Promise.all([
    client
      .from("settings")
      .select("*")
      .maybeSingle()
      .then((r) => {
        // Defaults here would be written back over the real settings.
        if (r.error) throw r.error;
        return r.data as Row | null;
      }),
    all("activities", ["id"]),
    all("tasks", ["id"]),
    all("task_units", ["id"]),
    // The newest record of a block is the one that stands: oldest first.
    allRows(client, "check_ins", ["created_at", "id"], narrow.checkIns),
    allRows(client, "calendar_events", EVENT_ORDER, narrow.events),
    allRows(client, "day_overrides", OVERRIDE_ORDER, narrow.overrides),
    allRows(client, "plan_blocks", BLOCK_ORDER, narrow.blocks),
    all("calendars", ["source", "external_id"]),
    all("places", ["id"]),
    all("travel_times", ["from_place", "to_place"]),
    all("meal_runs", ["meal", "weekday", "from_date"]),
  ]);
  return {
    settings,
    activities,
    tasks,
    units,
    checkIns,
    events,
    overrides,
    blocks,
    calendars,
    places,
    travelTimes,
    mealRuns,
  };
}

/** Every table whole except the growing ones, which are asked for `span` only. */
async function loadWith(client: SupabaseClient, span: Span | null): Promise<AppData> {
  return rowsToData(
    await fetchTables(
      client,
      span
        ? { events: overlapping(span), overrides: onDates(span), blocks: overlapping(span) }
        : {},
    ),
  );
}

export function loadData(client: SupabaseClient): Promise<AppData> {
  // The server returns at most `max_rows` (1000) per request: past that the newest rows
  // would be lost, and for check-ins those are the corrections. A full first page means
  // there may be more, so the rest is asked by range until a page comes back short.
  return loadWith(client, null);
}

/** Before this long without a sync the tombstones may be gone: everything is loaded instead. */
export const TOMBSTONES_MS = 14 * 86_400_000;
/** Changes are asked for from a little before the last sync: a slow write may land after it. */
export const OVERLAP_MS = 2 * 60_000;

/** The server's clock, in ms (never this device's: the marks of a sync are in its time). */
export async function serverNow(client: SupabaseClient): Promise<number> {
  const { data, error } = await client.rpc("server_now");
  if (error) throw error;
  const at = Date.parse(String(data));
  if (!Number.isFinite(at)) throw new Error("server_now");
  return at;
}

/**
 * `base` brought up to date with what changed since `since` (server ms): the small tables
 * whole, the rows of the growing ones changed or received after it, and what was deleted.
 * Throws if the answer cannot be trusted; the caller loads everything instead.
 */
export async function loadSince(
  client: SupabaseClient,
  base: AppData,
  since: number,
): Promise<AppData> {
  const from = iso(since - OVERLAP_MS);
  const [rows, gone] = await Promise.all([
    fetchTables(client, {
      events: (q) => q.gt("updated_at", from),
      overrides: (q) => q.gt("updated_at", from),
      blocks: (q) => q.gt("updated_at", from),
      checkIns: (q) => q.gt("received_at", from),
    }),
    allRows(client, "deleted_rows", ["deleted_at", "table_name", "row_key"], (q) =>
      q.gt("deleted_at", from),
    ),
  ]);
  return applyChanges(base, rowsToData(rows), gone);
}

/**
 * Puts `changed` (the small tables whole, and only the changed rows of the growing ones)
 * over `base`: a row that changed replaces its old one where it stood, a new one goes
 * last, and what `gone` (tombstones) says was deleted leaves, unless it exists again.
 * Weeks that have not come in yet get their changed rows too, without being marked loaded.
 */
export function applyChanges(base: AppData, changed: AppData, gone: Row[]): AppData {
  const keysOf = (table: string) =>
    new Set(gone.filter((g) => g.table_name === table).map((g) => String(g.row_key)));
  const merge = <T>(old: T[], news: T[], key: (r: T) => string, deleted: Set<string>): T[] => {
    const fresh = new Map(news.map((r) => [key(r), r]));
    const kept = old
      .filter((r) => fresh.has(key(r)) || !deleted.has(key(r)))
      .map((r) => fresh.get(key(r)) ?? r);
    const had = new Set(old.map(key));
    return [...kept, ...news.filter((r) => !had.has(key(r)))];
  };
  const activityOf = new Map(changed.tasks.map((t) => [t.id, t.activityId]));
  return {
    ...changed,
    events: merge(base.events, changed.events, (e) => e.id, keysOf("calendar_events")),
    overrides: merge(base.overrides, changed.overrides, (o) => o.date, keysOf("day_overrides")),
    plan: merge(base.plan, changed.plan, (b) => b.id, keysOf("plan_blocks")).map((b) => ({
      ...b,
      activityId: activityOf.get(b.taskId) ?? b.activityId,
    })),
    // The log only grows: what arrives is added, nothing is removed.
    checkIns: merge(base.checkIns, changed.checkIns, (c) => c.id, new Set()).sort(
      (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    ),
  };
}

/**
 * What it takes to open the app: every small table and every check-in (the plan counts
 * all of them), and the calendar, the plan and the day overrides of `span` only. The rest
 * arrives later, week by week (`loadQueue.ts`).
 */
export async function loadFirst(
  client: SupabaseClient,
  span: Span,
): Promise<{ data: AppData; bounds: { first: number; last: number } | null }> {
  const [data, bounds] = await Promise.all([loadWith(client, span), loadBounds(client)]);
  return { data, bounds };
}

/**
 * Adds the rows of `chunk` the data does not have yet (by id): what is already there,
 * edited on this device or newer, stays. A block whose task is gone is left out.
 */
export function mergeChunk(data: AppData, chunk: Chunk): AppData {
  // Weeks overlap (an event across midnight Sunday comes with both), so a row seen
  // once while filtering is not taken twice.
  const fresh = <T>(rows: T[], seen: Set<string>, key: (r: T) => string) =>
    rows.filter((r) => {
      const k = key(r);
      return !seen.has(k) && !!seen.add(k);
    });
  const events = fresh(chunk.events, new Set(data.events.map((e) => e.id)), (e) => e.id);
  const overrides = fresh(
    chunk.overrides,
    new Set(data.overrides.map((o) => o.date)),
    (o) => o.date,
  );
  const activityOf = new Map(data.tasks.map((t) => [t.id, t.activityId]));
  const blocks = fresh(chunk.blocks, new Set(data.plan.map((b) => b.id)), (b) => b.id)
    .filter((b) => activityOf.has(b.taskId))
    .map((b) => ({ ...b, activityId: activityOf.get(b.taskId) ?? "" }));
  if (!events.length && !overrides.length && !blocks.length) return data;
  return {
    ...data,
    events: [...data.events, ...events],
    overrides: [...data.overrides, ...overrides],
    plan: [...data.plan, ...blocks],
  };
}

const changed = <T extends { id: string }>(before: T[], after: T[]) => {
  const old = new Map(before.map((x) => [x.id, JSON.stringify(x)]));
  return after.filter((x) => old.get(x.id) !== JSON.stringify(x));
};

export interface Writes {
  upserts: { table: string; rows: Row[] }[];
  deletes: { table: string; ids: string[] }[];
  inserts: { table: string; rows: Row[] }[];
}

/** Rows to write so the database matches `next`, given it matched `prev`. */
/**
 * Drops from `local` the subjects and tasks another device deleted (in `before`, this
 * device's baseline, but no longer on the server), with everything that hangs from them.
 * Calendar events come from the server's copy (only the server writes them), so a stale
 * event cannot import a deleted task again. Returns `local` itself when nothing was
 * deleted elsewhere.
 */
export function withoutDeleted(before: AppData, server: AppData, local: AppData): AppData {
  const subjects = new Set(server.activities.map((a) => a.id));
  const goneSubjects = new Set(
    before.activities.filter((a) => !subjects.has(a.id)).map((a) => a.id),
  );
  const tasks = new Set(server.tasks.map((t) => t.id));
  const goneTasks = new Set(
    before.tasks.filter((t) => !tasks.has(t.id) || goneSubjects.has(t.activityId)).map((t) => t.id),
  );
  if (!goneSubjects.size && !goneTasks.size) return local;
  const kept = local.tasks.filter((t) => !goneTasks.has(t.id) && !goneSubjects.has(t.activityId));
  const ids = new Set(kept.map((t) => t.id));
  return {
    ...local,
    activities: local.activities.filter((a) => !goneSubjects.has(a.id)),
    tasks: kept,
    events: server.events,
    plan: local.plan.filter((b) => ids.has(b.taskId)),
    pins: local.pins?.filter((b) => ids.has(b.taskId)),
    checkIns: local.checkIns.filter((c) => ids.has(c.taskId)),
  };
}

/** A write that points at a row another device deleted (Postgres foreign key violation). */
export const isMissingParent = (e: unknown) =>
  typeof e === "object" && !!e && (e as { code?: unknown }).code === "23503";

/**
 * A write the database refuses for what it says: a bad value or a missing parent (Postgres
 * classes 22 and 23, with letters too: `22P02`) or a permission it will not give (`42501`,
 * row-level security). Trying it again changes nothing.
 */
export const isPermanent = (e: unknown) =>
  typeof e === "object" &&
  !!e &&
  /^(2[23][0-9A-Z]{3}|42501)$/.test(String((e as { code?: unknown }).code));

export function diffData(prev: AppData, next: AppData): Writes {
  const upserts: Writes["upserts"] = [];
  const inserts: Writes["inserts"] = [];
  const deletes: Writes["deletes"] = [];

  const settingsChanged =
    JSON.stringify([
      prev.settings,
      prev.proposals,
      prev.freeTimeUntil,
      prev.relaxContextUntil,
      prev.preferences,
      prev.applied,
      prev.pins,
      prev.noTravel,
      prev.spots,
      prev.eventTravel,
      prev.tripModes,
      prev.tripMinutes,
      prev.mealChoices,
      prev.mealsFrozenThrough,
      prev.notSubjects,
      prev.removedSubjects,
      prev.movedEvents,
      prev.tentativeSeen,
      prev.tentativeHoldUntil,
      prev.planHistory,
    ]) !==
    JSON.stringify([
      next.settings,
      next.proposals,
      next.freeTimeUntil,
      next.relaxContextUntil,
      next.preferences,
      next.applied,
      next.pins,
      next.noTravel,
      next.spots,
      next.eventTravel,
      next.tripModes,
      next.tripMinutes,
      next.mealChoices,
      next.mealsFrozenThrough,
      next.notSubjects,
      next.removedSubjects,
      next.movedEvents,
      next.tentativeSeen,
      next.tentativeHoldUntil,
      next.planHistory,
    ]);
  if (settingsChanged) {
    upserts.push({
      table: "settings",
      rows: [
        {
          data: next.settings,
          state: {
            proposals: next.proposals,
            freeTimeUntil: next.freeTimeUntil,
            relaxContextUntil: next.relaxContextUntil,
            preferences: next.preferences,
            applied: next.applied,
            pins: next.pins,
            noTravel: next.noTravel,
            spots: next.spots,
            eventTravel: next.eventTravel,
            tripModes: next.tripModes,
            tripMinutes: next.tripMinutes,
            mealChoices: next.mealChoices,
            mealsFrozenThrough: next.mealsFrozenThrough,
            notSubjects: next.notSubjects,
            removedSubjects: next.removedSubjects,
            movedEvents: next.movedEvents,
            tentativeSeen: next.tentativeSeen,
            tentativeHoldUntil: next.tentativeHoldUntil,
            planHistory: next.planHistory,
          },
        },
      ],
    });
  }

  const acts = changed(prev.activities, next.activities);
  if (acts.length) {
    upserts.push({
      table: "activities",
      rows: acts.map((a) => ({
        id: a.id,
        name: a.name,
        color: a.color,
        academic: a.academic,
        max_session_minutes: a.maxSessionMinutes,
        min_block_minutes: a.minBlockMinutes,
        preferred_start: a.preferred?.start ?? null,
        preferred_end: a.preferred?.end ?? null,
        kind: a.kind ?? null,
        aliases: a.aliases ?? [],
        study_minutes: a.studyMinutes ?? null,
        break_minutes: a.breakMinutes ?? null,
        start_after: a.startAfter ?? null,
        valid_hours: a.validHours ?? null,
      })),
    });
  }

  const tasks = changed(prev.tasks, next.tasks);
  if (tasks.length) {
    upserts.push({
      table: "tasks",
      rows: tasks.map((t) => ({
        id: t.id,
        activity_id: t.activityId,
        title: t.title,
        kind: t.kind,
        deadline: t.deadline ? iso(t.deadline) : null,
        estimate_minutes: t.estimateMinutes,
        min_minutes: t.minMinutes,
        sessions_per_week: t.sessionsPerWeek ?? null,
        session_minutes: t.sessionMinutes ?? null,
        max_per_day_minutes: t.maxPerDayMinutes ?? null,
        priority: t.priority,
        status: t.status,
        source_event_id: t.sourceEventId ?? null,
        needs_review: !!t.needsReview,
        exam: !!t.exam,
        day_before_only: !!t.dayBeforeOnly,
        source_role: t.sourceRole ?? null,
        study: !!t.study,
        skip_until: t.skipUntil ? iso(t.skipUntil) : null,
        paused: !!t.paused,
        ended_at: t.endedAt ? iso(t.endedAt) : null,
        auto_dropped_at: t.autoDroppedAt ? iso(t.autoDroppedAt) : null,
        start_after: t.startAfter ?? null,
        // Only a date the app knows: the database sets its own for a row it has not seen.
        ...(t.createdAt !== undefined && { created_at: iso(t.createdAt) }),
        deadline_synced_from: t.deadlineSyncedFrom ? iso(t.deadlineSyncedFrom) : null,
      })),
    });
    const units = tasks.flatMap((t) =>
      t.units.map((u, i) => ({
        id: u.id,
        task_id: t.id,
        title: u.title,
        estimate_minutes: u.estimateMinutes,
        position: i,
        done_at: u.doneAt ? iso(u.doneAt) : null,
        done_by_hand: !!u.doneAt && u.doneByHand === true,
        weight: u.weight ?? null,
        skipped: !!u.skipped,
      })),
    );
    if (units.length) upserts.push({ table: "task_units", rows: units });
    const keptUnits = new Set(next.tasks.flatMap((t) => t.units.map((u) => u.id)));
    const goneUnits = prev.tasks
      .flatMap((t) => t.units.map((u) => u.id))
      .filter((id) => !keptUnits.has(id));
    if (goneUnits.length) deletes.push({ table: "task_units", ids: goneUnits });
  }

  // A deleted silo takes its units, blocks and check-ins along (FK cascade).
  const keptTasks = new Set(next.tasks.map((t) => t.id));
  const goneTasks = prev.tasks.map((t) => t.id).filter((id) => !keptTasks.has(id));
  if (goneTasks.length) deletes.push({ table: "tasks", ids: goneTasks });
  // A subject no longer there (restoring a backup) takes its tasks along (FK cascade).
  const keptActivities = new Set(next.activities.map((a) => a.id));
  const goneActivities = prev.activities.map((a) => a.id).filter((id) => !keptActivities.has(id));
  if (goneActivities.length) deletes.push({ table: "activities", ids: goneActivities });

  const roles = changed(prev.calendars ?? [], next.calendars ?? []);
  if (roles.length) {
    upserts.push({
      table: "calendars",
      rows: roles.map((c) => ({
        source: c.source,
        external_id: c.externalId,
        name: c.name,
        color: c.color ?? null,
        role: c.role ?? null,
      })),
    });
  }

  const seen = new Set(prev.checkIns.map((c) => c.id));
  // Nothing is written for a task this copy no longer has (its parent row may be gone).
  const live = new Set(next.tasks.map((t) => t.id));
  const newCheckIns = next.checkIns.filter((c) => !seen.has(c.id) && live.has(c.taskId));
  if (newCheckIns.length) {
    inserts.push({
      table: "check_ins",
      rows: newCheckIns.map((c) => ({
        id: c.id,
        block_id: c.blockId,
        task_id: c.taskId,
        status: c.status,
        minutes_done: c.minutesDone,
        unit_ids: c.unitIds,
        created_at: iso(c.createdAt),
        block_factor: c.factor ?? null,
        origin: c.origin ?? null,
      })),
    });
  }

  const overrides = next.overrides.filter(
    (o) => JSON.stringify(prev.overrides.find((p) => p.date === o.date)) !== JSON.stringify(o),
  );
  if (overrides.length) {
    upserts.push({
      table: "day_overrides",
      rows: overrides.map((o) => ({ date: o.date, wake: o.wake ?? null, bed: o.bed ?? null })),
    });
  }
  const keptDays = new Set(next.overrides.map((o) => o.date));
  const goneDays = prev.overrides.map((o) => o.date).filter((d) => !keptDays.has(d));
  if (goneDays.length) deletes.push({ table: "day_overrides", ids: goneDays });

  const places = changed(prev.places ?? [], next.places ?? []);
  if (places.length) {
    upserts.push({
      table: "places",
      rows: places.map((p) => ({
        id: p.id,
        name: p.name,
        aliases: p.aliases,
        address: p.address ?? null,
        lat: p.lat ?? null,
        lon: p.lon ?? null,
        is_home: !!p.isHome,
        travel_mode: p.travelMode ?? "car",
      })),
    });
  }
  // Removing a place removes its travel times too (FK cascade).
  const keptPlaces = new Set((next.places ?? []).map((p) => p.id));
  const gonePlaces = (prev.places ?? []).map((p) => p.id).filter((id) => !keptPlaces.has(id));
  if (gonePlaces.length) deletes.push({ table: "places", ids: gonePlaces });

  const runKey = (m: MealRun) => `${m.meal}|${m.weekday}|${m.from}`;
  const oldRuns = new Map((prev.mealRuns ?? []).map((m) => [runKey(m), JSON.stringify(m)]));
  // One row per key (the last one stands), so a copy never differs from itself.
  const newRuns = new Map((next.mealRuns ?? []).map((m) => [runKey(m), m]));
  const runs = [...newRuns.values()].filter((m) => oldRuns.get(runKey(m)) !== JSON.stringify(m));
  if (runs.length) {
    upserts.push({
      table: "meal_runs",
      rows: runs.map((m) => ({
        meal: m.meal,
        weekday: m.weekday,
        from_date: m.from,
        to_date: m.to ?? null,
        start_minutes: m.start,
        end_minutes: m.end,
        place_id: m.placeId ?? null,
      })),
    });
  }

  const pair = (t: TravelTime) => `${t.from}>${t.to}`;
  const oldTimes = new Map((prev.travelTimes ?? []).map((t) => [pair(t), JSON.stringify(t)]));
  const times = (next.travelTimes ?? []).filter(
    (t) =>
      keptPlaces.has(t.from) && keptPlaces.has(t.to) && oldTimes.get(pair(t)) !== JSON.stringify(t),
  );
  if (times.length) {
    upserts.push({
      table: "travel_times",
      rows: times.map((t) => ({
        from_place: t.from,
        to_place: t.to,
        minutes: t.minutes,
        manual: t.manual,
      })),
    });
  }
  // Times dropped while both places remain (a moved address); a removed place takes its
  // own along. Keyed "from>to": travel_times has no single id.
  const nextPairs = new Set((next.travelTimes ?? []).map(pair));
  // A computed time is deleted only while it is still computed: a manual time another
  // device wrote meanwhile survives. Manual ones go only when the user dropped them.
  const goneTimes = (prev.travelTimes ?? [])
    .filter((t) => keptPlaces.has(t.from) && keptPlaces.has(t.to) && !nextPairs.has(pair(t)))
    .map((t) => `${pair(t)}>${t.manual ? "manual" : "computed"}`);
  if (goneTimes.length) deletes.push({ table: "travel_times", ids: goneTimes });

  const blocks = changed(prev.plan, next.plan).filter((b) => live.has(b.taskId));
  if (blocks.length) {
    upserts.push({
      table: "plan_blocks",
      rows: blocks.map((b) => ({
        id: b.id,
        task_id: b.taskId,
        start_at: iso(b.start),
        end_at: iso(b.end),
        level: b.level ?? "ok",
        soft: !!b.soft,
        review: !!b.review,
      })),
    });
  }
  const keptBlocks = new Set(next.plan.map((b) => b.id));
  const goneBlocks = prev.plan.map((b) => b.id).filter((id) => !keptBlocks.has(id));
  if (goneBlocks.length) deletes.push({ table: "plan_blocks", ids: goneBlocks });

  return { upserts, inserts, deletes };
}

/**
 * Ids per delete. They travel in the URL (`id=in.(â€¦)`), and a long list is refused
 * (414); the browser reports that like a lost connection. Plan block ids are ~50 chars.
 */
export const DELETE_BATCH = 40;

/** Deletes rows by `column` in batches small enough for the URL. */
async function deleteIn(
  client: SupabaseClient,
  table: string,
  column: string,
  ids: string[],
): Promise<void> {
  for (let i = 0; i < ids.length; i += DELETE_BATCH) {
    const { error } = await client
      .from(table)
      .delete()
      .in(column, ids.slice(i, i + DELETE_BATCH));
    if (error) throw error;
  }
}

/** Parents first: activities â†’ tasks â†’ units/blocks. */
const WRITE_ORDER = [
  "settings",
  "calendars",
  "activities",
  "tasks",
  "task_units",
  "day_overrides",
  "places",
  "travel_times",
  "meal_runs",
  "plan_blocks",
];

export async function applyWrites(client: SupabaseClient, w: Writes): Promise<void> {
  for (const table of WRITE_ORDER) {
    for (const u of w.upserts.filter((x) => x.table === table)) {
      const { error } = await client.from(table).upsert(u.rows);
      if (error) throw error;
    }
  }
  for (const i of w.inserts) {
    // Rows that already landed (an attempt whose answer was lost) are skipped one by
    // one; the rest of the batch is still written.
    const { error } = await client
      .from(i.table)
      .upsert(i.rows, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw error;
  }
  for (const d of w.deletes) {
    if (d.table === "day_overrides") {
      // Keyed by date, not id.
      await deleteIn(client, d.table, "date", d.ids);
      continue;
    }
    if (d.table === "travel_times") {
      for (const id of d.ids) {
        const [from, to, kind] = id.split(">");
        let query = client.from(d.table).delete().eq("from_place", from).eq("to_place", to);
        if (kind === "computed") query = query.eq("manual", false);
        const { error } = await query;
        if (error) throw error;
      }
      continue;
    }
    await deleteIn(client, d.table, "id", d.ids);
  }
}

/**
 * The same writes, one row at a time, for when the batch was refused for good: what the
 * database takes is written, and what it refuses is returned (with its error), so one
 * bad row does not hold every save after it. A failure that is not permanent (the
 * network) still throws, and the whole thing is tried again later.
 */
export async function applyWritesEach(
  client: SupabaseClient,
  w: Writes,
): Promise<{ table: string; error: unknown }[]> {
  const refused: { table: string; error: unknown }[] = [];
  const each = async (table: string, rows: Row[], options?: object) => {
    for (const row of rows) {
      const { error } = await client.from(table).upsert([row], options);
      if (!error) continue;
      if (!isPermanent(error)) throw error;
      refused.push({ table, error });
    }
  };
  for (const table of WRITE_ORDER)
    for (const u of w.upserts.filter((x) => x.table === table)) await each(table, u.rows);
  for (const i of w.inserts)
    await each(i.table, i.rows, { onConflict: "id", ignoreDuplicates: true });
  // Deletes have nothing the database could refuse but the network.
  await applyWrites(client, { upserts: [], inserts: [], deletes: w.deletes });
  return refused;
}
