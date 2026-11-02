import type { Activity, DayOverride, PlanBlock, Settings } from "@critical/engine";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { defaultSettings } from "./demo";
import type { AppData, AppEvent, AppTask, CheckIn, Proposal } from "./model";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

export const GOOGLE_SCOPES = "https://www.googleapis.com/auth/calendar";

export async function signInWithGoogle(client: SupabaseClient): Promise<void> {
  await client.auth.signInWithOAuth({
    provider: "google",
    options: {
      scopes: GOOGLE_SCOPES,
      redirectTo: window.location.origin,
      queryParams: { access_type: "offline", prompt: "consent" },
    },
  });
}

/** Runs the server sync; passes the Google refresh token right after sign-in. */
export async function syncGoogle(client: SupabaseClient, session: Session) {
  const { data, error } = await client.functions.invoke("google-sync", {
    body: { refreshToken: session.provider_refresh_token ?? null },
  });
  if (error) throw error;
  return data as { connected: boolean; imported?: number; error?: string };
}

interface State {
  proposals?: Proposal[];
  freeTimeUntil?: number;
  relaxContextUntil?: number;
}

const ms = (iso: string) => Date.parse(iso);
const iso = (t: number) => new Date(t).toISOString();

type Row = Record<string, unknown>;

export function rowsToData(r: {
  settings: Row | null;
  activities: Row[];
  tasks: Row[];
  units: Row[];
  checkIns: Row[];
  events: Row[];
  overrides: Row[];
  blocks: Row[];
}): AppData {
  const state = (r.settings?.state ?? {}) as State;
  return {
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
        units: r.units
          .filter((u) => u.task_id === t.id)
          .sort((a, b) => (a.position as number) - (b.position as number))
          .map((u) => ({
            id: u.id as string,
            title: u.title as string,
            estimateMinutes: u.estimate_minutes as number,
            doneAt: u.done_at ? ms(u.done_at as string) : undefined,
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
      }),
    ),
    events: r.events.map(
      (e): AppEvent => ({
        id: `${e.source}:${e.external_id}`,
        title: e.title as string,
        start: ms(e.start_at as string),
        end: ms(e.end_at as string),
        location: (e.location as string) ?? undefined,
        busy: e.busy as boolean,
        allDay: e.all_day as boolean,
        source: e.source as AppEvent["source"],
        link: (e.link as string) ?? undefined,
      }),
    ),
    overrides: r.overrides.map(
      (o): DayOverride => ({
        date: o.date as string,
        wake: (o.wake as number) ?? undefined,
        bed: (o.bed as number) ?? undefined,
      }),
    ),
    plan: r.blocks.map(
      (b): PlanBlock => ({
        id: b.id as string,
        taskId: b.task_id as string,
        activityId: (r.tasks.find((t) => t.id === b.task_id)?.activity_id as string) ?? "",
        start: ms(b.start_at as string),
        end: ms(b.end_at as string),
        level: b.level as PlanBlock["level"],
        soft: b.soft as boolean,
      }),
    ),
    proposals: state.proposals ?? [],
    freeTimeUntil: state.freeTimeUntil,
    relaxContextUntil: state.relaxContextUntil,
  };
}

export async function loadData(client: SupabaseClient): Promise<AppData> {
  const all = async (table: string) => {
    const { data, error } = await client.from(table).select("*");
    if (error) throw error;
    return (data ?? []) as Row[];
  };
  const [settings, activities, tasks, units, checkIns, events, overrides, blocks] =
    await Promise.all([
      client
        .from("settings")
        .select("*")
        .maybeSingle()
        .then((r) => r.data as Row | null),
      all("activities"),
      all("tasks"),
      all("task_units"),
      all("check_ins"),
      all("calendar_events"),
      all("day_overrides"),
      all("plan_blocks"),
    ]);
  return rowsToData({ settings, activities, tasks, units, checkIns, events, overrides, blocks });
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
export function diffData(prev: AppData, next: AppData): Writes {
  const upserts: Writes["upserts"] = [];
  const inserts: Writes["inserts"] = [];
  const deletes: Writes["deletes"] = [];

  const settingsChanged =
    JSON.stringify([prev.settings, prev.proposals, prev.freeTimeUntil, prev.relaxContextUntil]) !==
    JSON.stringify([next.settings, next.proposals, next.freeTimeUntil, next.relaxContextUntil]);
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
      })),
    );
    if (units.length) upserts.push({ table: "task_units", rows: units });
    const keptUnits = new Set(next.tasks.flatMap((t) => t.units.map((u) => u.id)));
    const goneUnits = prev.tasks
      .flatMap((t) => t.units.map((u) => u.id))
      .filter((id) => !keptUnits.has(id));
    if (goneUnits.length) deletes.push({ table: "task_units", ids: goneUnits });
  }

  const seen = new Set(prev.checkIns.map((c) => c.id));
  const newCheckIns = next.checkIns.filter((c) => !seen.has(c.id));
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

  const blocks = changed(prev.plan, next.plan);
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
      })),
    });
  }
  const keptBlocks = new Set(next.plan.map((b) => b.id));
  const goneBlocks = prev.plan.map((b) => b.id).filter((id) => !keptBlocks.has(id));
  if (goneBlocks.length) deletes.push({ table: "plan_blocks", ids: goneBlocks });

  return { upserts, inserts, deletes };
}

export async function applyWrites(client: SupabaseClient, w: Writes): Promise<void> {
  // Parents first: activities → tasks → units/blocks.
  const order = ["settings", "activities", "tasks", "task_units", "day_overrides", "plan_blocks"];
  for (const table of order) {
    for (const u of w.upserts.filter((x) => x.table === table)) {
      const { error } = await client.from(table).upsert(u.rows);
      if (error) throw error;
    }
  }
  for (const i of w.inserts) {
    const { error } = await client.from(i.table).insert(i.rows);
    if (error) throw error;
  }
  for (const d of w.deletes) {
    const { error } = await client.from(d.table).delete().in("id", d.ids);
    if (error) throw error;
  }
}
