// iCloud Calendar over CalDAV for the calling user.
//   { action: "connect", appleId, appPassword } → validates and stores the app-specific
//     password encrypted in Vault, then syncs.
//   { action: "disconnect" } → forgets the credentials and the imported events.
//   {} → imports events from every iCloud calendar into calendar_events.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { basicAuth, DavError, discover, fetchEvents } from "../_shared/caldav.ts";
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

    const auth = basicAuth(creds.appleId, creds.appPassword);
    let calendars: Awaited<ReturnType<typeof discover>>;
    try {
      calendars = await discover(fetch, auth);
    } catch (e) {
      console.error("icloud discover", e);
      const code = e instanceof DavError ? e.code : "icloud_unreachable";
      return json({
        connected: false,
        error: code,
        status: e instanceof DavError ? e.status : undefined,
      });
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

    await user.from("calendars").upsert(
      calendars.map((c) => ({
        source: "icloud",
        external_id: c.url,
        name: c.name,
        color: c.color ?? null,
      })),
    );

    const rows = [];
    const fetched = new Set<string>();
    for (const cal of calendars) {
      let documents: string[] = [];
      try {
        documents = await fetchEvents(fetch, auth, cal.url, Date.parse(from), Date.parse(to));
        fetched.add(cal.url);
      } catch (err) {
        // Keep this calendar's stored events: an error is not "no events".
        console.warn("skipping calendar", cal.name, err);
      }
      for (const doc of documents) {
        // One malformed event must not stop the whole sync.
        let parsed: ReturnType<typeof parseIcs> = [];
        try {
          parsed = parseIcs(doc, timeZone);
        } catch (err) {
          console.warn("skipping unparseable event", cal.name, err);
        }
        for (const e of parsed) {
          if (e.cancelled || e.end < Date.parse(from) || e.start > Date.parse(to)) continue;
          rows.push({
            source: "icloud",
            external_id: `${cal.url}|${e.uid}|${e.recurrenceId ?? ""}`,
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
    // Stable ids: uid (+ recurrence instance), so moving an event updates it in place.
    const unique = [...new Map(rows.map((r) => [r.external_id, r])).values()];
    if (unique.length) {
      const { error } = await user.from("calendar_events").upsert(unique);
      if (error) throw error;
    }
    const keep = new Set(rows.map((r) => r.external_id));
    const { data: stored } = await user
      .from("calendar_events")
      .select("external_id, calendar_id")
      .eq("source", "icloud")
      .gte("start_at", from)
      .lte("start_at", to);
    const stale = (stored ?? [])
      .filter((r) => fetched.has(r.calendar_id) && !keep.has(r.external_id))
      .map((r) => r.external_id);
    if (stale.length)
      await user.from("calendar_events").delete().eq("source", "icloud").in("external_id", stale);

    return json({
      connected: true,
      imported: unique.length,
      calendars: calendars.length,
      failedCalendars: calendars.length - fetched.size,
    });
  } catch (e) {
    console.error(e);
    return json({ connected: false, error: "sync_failed" }, 500);
  }
});
