// The steps of a Google sync, shared by the app's sync call, the webhook and the cron.
import {
  type CalendarListItem,
  choosePlanCalendar,
  diffPlan,
  PLAN_CALENDAR,
  PLAN_CALENDAR_COLOR,
  planEvent,
  toRow,
} from "./google.js";
import {
  accessToken,
  google,
  listCalendars,
  listEvents,
  stopChannel,
  watchEvents,
} from "./google-api.js";
import { type Caller, deleteByExternalId, type Env, pruneCalendars, timeZoneOf } from "./server.js";

const DAY = 86_400_000;
/** Renew a channel once it has less than this left (Google caps them at a week). */
const RENEW_BEFORE = DAY;

export interface GoogleSession {
  caller: Caller;
  token: string;
  timeZone: string;
}

/** Stores a fresh refresh token if given, then opens a session; null when never connected. */
export async function openGoogle(
  caller: Caller,
  env: Env,
  refreshToken?: unknown,
): Promise<GoogleSession | null> {
  const { uid, user, admin } = caller;
  if (typeof refreshToken === "string" && refreshToken) {
    const { error } = await admin.rpc("store_oauth_token", {
      p_user: uid,
      p_provider: "google",
      p_token: refreshToken,
    });
    if (error) throw error;
  }
  const { data: refresh } = await admin.rpc("get_oauth_token", {
    p_user: uid,
    p_provider: "google",
  });
  if (!refresh) return null;
  return {
    caller,
    token: await accessToken(env, refresh as string),
    timeZone: await timeZoneOf(user),
  };
}

export interface Imported {
  imported: number;
  /** Calendars whose events were read (and are worth watching). */
  calendarIds: string[];
  planCalendar?: CalendarListItem;
}

/** Imports events from every visible calendar except the Plan one. */
export async function importGoogle(s: GoogleSession, now: number): Promise<Imported> {
  const { token, timeZone } = s;
  const { uid, user } = s.caller;
  const from = new Date(now - 7 * DAY);
  const to = new Date(now + 28 * DAY);

  const calendars = await listCalendars(token);
  const { data: planRow } = await user
    .from("settings")
    .select("google_plan_calendar")
    .maybeSingle();
  const choice = choosePlanCalendar(calendars, planRow?.google_plan_calendar);
  // Duplicates from earlier versions (or two syncs racing) are the app's own: delete them.
  for (const id of choice.remove) {
    await google(token, `/calendars/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
  const isPlan = (c: CalendarListItem) => c.summary === PLAN_CALENDAR;
  await user.from("calendars").upsert(
    calendars
      .filter((c) => !isPlan(c))
      .map((c) => ({
        source: "google",
        external_id: c.id,
        name: c.summary,
        color: c.backgroundColor ?? null,
      })),
  );
  // Plan calendars (and anything no longer listed) must never count as busy time.
  const imported = calendars.filter((c) => !isPlan(c) && !c.hidden && c.selected !== false);
  await pruneCalendars(
    user,
    "google",
    imported.map((c) => c.id),
  );
  const rows = [];
  for (const cal of imported) {
    for (const e of await listEvents(token, cal.id, from, to)) {
      const row = toRow(uid, cal.id, e, timeZone);
      if (row) rows.push(row);
    }
  }
  if (rows.length) {
    const { error } = await user.from("calendar_events").upsert(rows);
    if (error) throw error;
  }
  const keep = new Set(rows.map((r) => r.external_id));
  const { data: stored } = await user
    .from("calendar_events")
    .select("external_id")
    .eq("source", "google")
    .gte("start_at", from.toISOString())
    .lte("start_at", to.toISOString());
  const stale = (stored ?? []).map((r) => r.external_id as string).filter((id) => !keep.has(id));
  await deleteByExternalId(user, "google", stale);
  return {
    imported: rows.length,
    calendarIds: imported.map((c) => c.id),
    planCalendar: choice.keep,
  };
}

/** Mirrors future planned blocks into the single green Plan calendar. */
export async function mirrorPlan(
  s: GoogleSession,
  now: number,
  known?: CalendarListItem,
): Promise<{ planCreated: number; planRemoved: number }> {
  const { token, timeZone } = s;
  const { uid, user } = s.caller;
  const to = new Date(now + 28 * DAY);
  let plan = known;
  const { data: planRow } = await user
    .from("settings")
    .select("google_plan_calendar")
    .maybeSingle();
  if (!plan) {
    plan = choosePlanCalendar(await listCalendars(token), planRow?.google_plan_calendar).keep;
  }
  if (!plan) {
    plan = await google<CalendarListItem>(token, "/calendars", {
      method: "POST",
      body: JSON.stringify({ summary: PLAN_CALENDAR, timeZone }),
    });
  }
  const planId = plan.id;
  if (planRow?.google_plan_calendar !== planId) {
    await user.from("settings").upsert({ user_id: uid, google_plan_calendar: planId });
  }
  if (plan.backgroundColor?.toLowerCase() !== PLAN_CALENDAR_COLOR) {
    await google(
      token,
      `/users/me/calendarList/${encodeURIComponent(planId)}?colorRgbFormat=true`,
      {
        method: "PATCH",
        body: JSON.stringify({ backgroundColor: PLAN_CALENDAR_COLOR, foregroundColor: "#ffffff" }),
      },
    );
  }
  const { data: blocks } = await user
    .from("plan_blocks")
    .select("id, task_id, start_at, end_at, level, google_event_id, tasks(title)")
    .gte("end_at", new Date(now).toISOString());
  const existing = (await listEvents(token, planId, new Date(now), to)).filter(
    (e) => !!e.extendedProperties?.private?.criticalBlock,
  );
  const diff = diffPlan(blocks ?? [], existing);
  const eventFor = (b: (typeof diff.create)[number]) => {
    const full = (blocks ?? []).find((x) => x.id === b.id) as unknown as {
      tasks?: { title?: string };
    };
    return planEvent(b, full?.tasks?.title ?? "Bloque");
  };
  const events = `/calendars/${encodeURIComponent(planId)}/events`;
  for (const b of diff.create) {
    const ev = await google<{ id: string }>(token, events, {
      method: "POST",
      body: JSON.stringify(eventFor(b)),
    });
    await user.from("plan_blocks").update({ google_event_id: ev.id }).eq("id", b.id);
  }
  for (const b of diff.update) {
    await google(token, `${events}/${b.google_event_id}`, {
      method: "PATCH",
      body: JSON.stringify(eventFor(b)),
    });
  }
  for (const id of diff.remove) {
    await google(token, `${events}/${id}`, { method: "DELETE" });
  }
  return { planCreated: diff.create.length, planRemoved: diff.remove.length };
}

interface ChannelRow {
  id: string;
  calendar_id: string;
  resource_id: string;
  expires_at: string;
}

/**
 * Keeps one push channel per imported calendar so Google tells the webhook about
 * every change; renews channels about to expire and stops the ones no longer needed.
 */
export async function watchCalendars(
  s: GoogleSession,
  calendarIds: string[],
  appUrl: string,
  now: number,
): Promise<void> {
  const { uid, admin } = s.caller;
  const { data } = await admin
    .from("google_channels")
    .select("id, calendar_id, resource_id, expires_at")
    .eq("user_id", uid);
  const rows = (data ?? []) as ChannelRow[];
  const wanted = new Set(calendarIds);
  const fresh = new Set(
    rows
      .filter((r) => wanted.has(r.calendar_id) && Date.parse(r.expires_at) - now > RENEW_BEFORE)
      .map((r) => r.calendar_id),
  );
  for (const calendarId of calendarIds) {
    if (fresh.has(calendarId)) continue;
    const id = crypto.randomUUID();
    const secret = crypto.randomUUID();
    try {
      const ch = await watchEvents(s.token, calendarId, `${appUrl}/api/google-webhook`, id, secret);
      const { error } = await admin.from("google_channels").insert({
        id: ch.id,
        user_id: uid,
        calendar_id: calendarId,
        resource_id: ch.resourceId,
        secret,
        expires_at: new Date(ch.expiration || now + 7 * DAY).toISOString(),
      });
      if (error) throw error;
    } catch (e) {
      // Some calendars (holidays, other people's) cannot be watched; the cron still polls.
      console.warn("watch", calendarId, e);
    }
  }
  // Superseded and unwanted channels.
  const keepIds = new Set<string>();
  const { data: after } = await admin
    .from("google_channels")
    .select("id, calendar_id, resource_id, expires_at")
    .eq("user_id", uid);
  const newest = new Map<string, ChannelRow>();
  for (const r of (after ?? []) as ChannelRow[]) {
    const prev = newest.get(r.calendar_id);
    if (!prev || Date.parse(r.expires_at) > Date.parse(prev.expires_at))
      newest.set(r.calendar_id, r);
  }
  for (const [cal, r] of newest) if (wanted.has(cal)) keepIds.add(r.id);
  for (const r of (after ?? []) as ChannelRow[]) {
    if (keepIds.has(r.id)) continue;
    await stopChannel(s.token, r.id, r.resource_id);
    await admin.from("google_channels").delete().eq("id", r.id);
  }
}
