// Syncs Google Calendar both ways for the calling user:
// 1. stores a new refresh token if the client sends one (right after sign-in),
// 2. imports events from the user's calendars into calendar_events,
// 3. mirrors future plan_blocks into the "📚 Plan" calendar.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import {
  type CalendarListItem,
  choosePlanCalendar,
  diffPlan,
  type GoogleEvent,
  PLAN_CALENDAR,
  PLAN_CALENDAR_COLOR,
  planEvent,
  toRow,
} from "../_shared/google.ts";

const GOOGLE = "https://www.googleapis.com/calendar/v3";
const DAY = 86_400_000;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** A failure the client may see: a stable code and the upstream HTTP status, no internals. */
class SyncError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
    readonly reason?: string,
  ) {
    super(code);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

async function accessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID") ?? "",
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    // Google's OAuth error code ("invalid_client", "invalid_grant") is safe to show.
    const reason = await res
      .json()
      .then((b) => (typeof b?.error === "string" ? b.error : undefined))
      .catch(() => undefined);
    throw new SyncError("token_refresh_failed", res.status, reason);
  }
  return (await res.json()).access_token as string;
}

async function google<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${GOOGLE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok && res.status !== 410) throw new SyncError("google_api_error", res.status);
  return (res.status === 204 ? {} : await res.json()) as T;
}

async function listEvents(
  token: string,
  calendarId: string,
  from: Date,
  to: Date,
): Promise<GoogleEvent[]> {
  const out: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    const q = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: "true",
      maxResults: "250",
      ...(pageToken ? { pageToken } : {}),
    });
    const page = await google<{ items: GoogleEvent[]; nextPageToken?: string }>(
      token,
      `/calendars/${encodeURIComponent(calendarId)}/events?${q}`,
    );
    out.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const auth = req.headers.get("Authorization") ?? "";
    const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: auth } },
    });
    const { data: who, error: authError } = await user.auth.getUser();
    if (authError || !who.user) return json({ error: "unauthorized" }, 401);
    const uid = who.user.id;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    const body = req.headers.get("content-type")?.includes("json") ? await req.json() : {};
    if (typeof body.refreshToken === "string" && body.refreshToken) {
      const { error } = await admin.rpc("store_oauth_token", {
        p_user: uid,
        p_provider: "google",
        p_token: body.refreshToken,
      });
      if (error) throw error;
    }
    const { data: refresh } = await admin.rpc("get_oauth_token", {
      p_user: uid,
      p_provider: "google",
    });
    if (!refresh) return json({ connected: false, error: "no_refresh_token" });
    const token = await accessToken(refresh as string);

    const { data: settings } = await user.from("settings").select("data").maybeSingle();
    const timeZone =
      (settings?.data as { timezone?: string } | null)?.timezone ?? "America/Montevideo";
    const now = Date.now();
    const from = new Date(now - 7 * DAY);
    const to = new Date(now + 28 * DAY);

    // 1. Import events from every visible calendar except the Plan one.
    const calendars = await google<{ items: CalendarListItem[] }>(token, "/users/me/calendarList");
    const { data: planRow } = await user
      .from("settings")
      .select("google_plan_calendar")
      .maybeSingle();
    const choice = choosePlanCalendar(calendars.items, planRow?.google_plan_calendar);
    // Duplicates from earlier versions (or two syncs racing) are the app's own: delete them.
    for (const id of choice.remove) {
      await google(token, `/calendars/${encodeURIComponent(id)}`, { method: "DELETE" });
    }
    const isPlan = (c: CalendarListItem) => c.summary === PLAN_CALENDAR;
    await user.from("calendars").upsert(
      calendars.items
        .filter((c) => !isPlan(c))
        .map((c) => ({
          source: "google",
          external_id: c.id,
          name: c.summary,
          color: (c as { backgroundColor?: string }).backgroundColor ?? null,
        })),
    );
    const rows = [];
    for (const cal of calendars.items) {
      if (isPlan(cal) || cal.hidden || cal.selected === false) continue;
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
    const stale = (stored ?? []).map((r) => r.external_id).filter((id) => !keep.has(id));
    if (stale.length)
      await user.from("calendar_events").delete().eq("source", "google").in("external_id", stale);

    // 2. Mirror future planned blocks into the Plan calendar.
    let plan = choice.keep;
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
          body: JSON.stringify({
            backgroundColor: PLAN_CALENDAR_COLOR,
            foregroundColor: "#ffffff",
          }),
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
    for (const b of diff.create) {
      const ev = await google<{ id: string }>(
        token,
        `/calendars/${encodeURIComponent(planId)}/events`,
        {
          method: "POST",
          body: JSON.stringify(eventFor(b)),
        },
      );
      await user.from("plan_blocks").update({ google_event_id: ev.id }).eq("id", b.id);
    }
    for (const b of diff.update) {
      await google(token, `/calendars/${encodeURIComponent(planId)}/events/${b.google_event_id}`, {
        method: "PATCH",
        body: JSON.stringify(eventFor(b)),
      });
    }
    for (const id of diff.remove) {
      await google(token, `/calendars/${encodeURIComponent(planId)}/events/${id}`, {
        method: "DELETE",
      });
    }

    return json({
      connected: true,
      imported: rows.length,
      planCreated: diff.create.length,
      planRemoved: diff.remove.length,
    });
  } catch (e) {
    // Details stay in the function logs; the client gets a stable code only.
    console.error(e);
    if (e instanceof SyncError) {
      return json({ connected: false, error: e.code, status: e.status, reason: e.reason });
    }
    return json({ connected: false, error: "sync_failed" }, 500);
  }
});
