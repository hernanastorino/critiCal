// iCloud Calendar over CalDAV for the calling user.
//   { action: "connect", appleId, appPassword } → validates and stores the app-specific
//     password encrypted in Vault, then syncs.
//   { action: "disconnect" } → forgets the credentials and the imported events.
//   {} → imports events from every iCloud calendar into calendar_events.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { createDAVClient } from "npm:tsdav@2.1.3";
import { parseIcs } from "../_shared/ics.ts";

const DAY = 86_400_000;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

interface Credentials {
  appleId: string;
  appPassword: string;
}

async function dav(c: Credentials) {
  return await createDAVClient({
    serverUrl: "https://caldav.icloud.com",
    credentials: { username: c.appleId, password: c.appPassword },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: who } = await user.auth.getUser();
    if (!who.user) return json({ error: "unauthorized" }, 401);
    const uid = who.user.id;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const body = req.headers.get("content-type")?.includes("json") ? await req.json() : {};

    if (body.action === "disconnect") {
      await admin.rpc("delete_oauth_token", { p_user: uid, p_provider: "icloud" });
      await user.from("calendar_events").delete().eq("source", "icloud");
      await user.from("calendars").delete().eq("source", "icloud");
      return json({ connected: false });
    }

    let creds: Credentials | null = null;
    if (body.action === "connect") {
      if (typeof body.appleId !== "string" || typeof body.appPassword !== "string") {
        return json({ connected: false, error: "missing_credentials" }, 400);
      }
      creds = { appleId: body.appleId.trim(), appPassword: body.appPassword.replace(/\s/g, "") };
    } else {
      const { data } = await admin.rpc("get_oauth_token", { p_user: uid, p_provider: "icloud" });
      if (!data) return json({ connected: false, error: "not_connected" });
      creds = JSON.parse(data as string) as Credentials;
    }

    let client: Awaited<ReturnType<typeof dav>>;
    try {
      client = await dav(creds);
    } catch {
      return json({ connected: false, error: "icloud_login_failed" });
    }
    if (body.action === "connect") {
      await admin.rpc("store_oauth_token", {
        p_user: uid,
        p_provider: "icloud",
        p_token: JSON.stringify(creds),
      });
    }

    const { data: settings } = await user.from("settings").select("data").maybeSingle();
    const timeZone =
      (settings?.data as { timezone?: string } | null)?.timezone ?? "America/Montevideo";
    const now = Date.now();
    const from = new Date(now - 7 * DAY).toISOString();
    const to = new Date(now + 60 * DAY).toISOString();

    const calendars = (await client.fetchCalendars()).filter((c) =>
      (c.components ?? ["VEVENT"]).includes("VEVENT"),
    );
    await user.from("calendars").upsert(
      calendars.map((c) => ({
        source: "icloud",
        external_id: c.url,
        name: typeof c.displayName === "string" ? c.displayName : "iCloud",
        color: (c as { calendarColor?: string }).calendarColor?.slice(0, 7) ?? null,
      })),
    );

    const rows = [];
    for (const cal of calendars) {
      const objects = await client.fetchCalendarObjects({
        calendar: cal,
        timeRange: { start: from, end: to },
        expand: true,
      });
      for (const o of objects) {
        for (const e of parseIcs(String(o.data ?? ""), timeZone)) {
          if (e.cancelled || e.end < Date.parse(from) || e.start > Date.parse(to)) continue;
          rows.push({
            source: "icloud",
            external_id: `${cal.url}|${e.uid}|${e.recurrenceId ?? e.start}`,
            calendar_id: cal.url,
            title: e.summary || "(sin título)",
            start_at: new Date(e.start).toISOString(),
            end_at: new Date(e.end).toISOString(),
            location: e.location ?? null,
            busy: e.busy,
            all_day: e.allDay,
            link: null,
          });
        }
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
      .eq("source", "icloud")
      .gte("start_at", from)
      .lte("start_at", to);
    const stale = (stored ?? []).map((r) => r.external_id).filter((id) => !keep.has(id));
    if (stale.length)
      await user.from("calendar_events").delete().eq("source", "icloud").in("external_id", stale);

    return json({ connected: true, imported: rows.length, calendars: calendars.length });
  } catch (e) {
    console.error(e);
    return json({ connected: false, error: "sync_failed" }, 500);
  }
});
