import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
let invited = true;
const tables: Record<string, unknown> = {};
const writes: { table: string; op: string; payload?: unknown }[] = [];

function query(table: string) {
  const result = { data: tables[table] ?? null, error: null };
  // A thenable query builder: awaiting any step yields `result`.
  const chain = Promise.resolve(result) as unknown as Promise<typeof result> &
    Record<string, unknown>;
  for (const m of ["select", "eq", "gte", "lte", "in", "not"]) chain[m] = () => chain;
  chain.maybeSingle = () => Promise.resolve(result);
  chain.upsert = (payload: unknown) => {
    writes.push({ table, op: "upsert", payload });
    return Promise.resolve({ error: null });
  };
  chain.update = (payload: unknown) => {
    writes.push({ table, op: "update", payload });
    return chain;
  };
  chain.delete = () => {
    writes.push({ table, op: "delete" });
    return chain;
  };
  return chain;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) =>
        token === "good"
          ? { data: { user: { id: "u1" } }, error: null }
          : { data: { user: null }, error: new Error("bad") },
    },
    // Everyone in these tests is invited unless a test says otherwise.
    rpc: (name: string, args: unknown) =>
      name === "user_invited" ? Promise.resolve({ data: invited, error: null }) : rpc(name, args),
    from: query,
  }),
}));

const { handle: google, POST: googlePost } = await import("./google-sync.js");
const { handle: icloud } = await import("./icloud-sync.js");
const { readEnv } = await import("./_lib/server.js");

const env = {
  url: "https://x.supabase.co",
  publishable: "pk",
  secret: "sk",
  googleClientId: "id",
  googleClientSecret: "secret",
};
const req = (token?: string, body: object = {}) =>
  new Request("https://app/api/x", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  rpc.mockReset();
  writes.length = 0;
  for (const k of Object.keys(tables)) delete tables[k];
});
afterEach(() => vi.unstubAllGlobals());

describe("server", () => {
  it("reads the environment itself, ignoring Vercel's extra argument", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_URL", "");
    const res = await (googlePost as (r: Request, ctx: unknown) => Promise<Response>)(req("good"), {
      waitUntil: () => {},
    });
    expect((await res.json()).missing).toContain("url");
    vi.stubEnv("VITE_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "pk");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sk");
    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "s");
    rpc.mockResolvedValue({ data: null, error: null });
    const ok = await (googlePost as (r: Request, ctx: unknown) => Promise<Response>)(req("good"), {
      waitUntil: () => {},
    });
    expect(await ok.json()).toEqual({ connected: false, error: "no_refresh_token" });
    vi.unstubAllEnvs();
  });

  it("reads its configuration from the environment", () => {
    expect(
      readEnv({
        VITE_SUPABASE_URL: "u",
        VITE_SUPABASE_PUBLISHABLE_KEY: "p",
        SUPABASE_SECRET_KEY: "s",
      }),
    ).toMatchObject({
      url: "u",
      publishable: "p",
      secret: "s",
    });
  });
});

describe("google-sync (Node)", () => {
  it("asks the client to fall back when not configured, and rejects strangers", async () => {
    const unset = await google(req("good"), { ...env, googleClientSecret: undefined });
    expect(unset.status).toBe(503);
    expect(await unset.json()).toEqual({
      error: "server_not_configured",
      missing: ["googleClientSecret"],
    });
    expect((await google(req(), env)).status).toBe(401);
    expect((await google(req("bad"), env)).status).toBe(401);
  });

  it("stores a new refresh token and reports a missing one", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const res = await google(req("good", { refreshToken: "r" }), env);
    expect(await res.json()).toEqual({ connected: false, error: "no_refresh_token" });
    expect(rpc).toHaveBeenCalledWith("store_oauth_token", {
      p_user: "u1",
      p_provider: "google",
      p_token: "r",
    });
  });

  it("surfaces Google's OAuth error code", async () => {
    rpc.mockResolvedValue({ data: "refresh", error: null });
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 }),
    );
    const res = await google(req("good"), env);
    expect(await res.json()).toEqual({
      connected: false,
      error: "token_refresh_failed",
      status: 401,
      reason: "invalid_client",
    });
  });

  it("imports events, keeps one green Plan calendar and mirrors blocks", async () => {
    rpc.mockResolvedValue({ data: "refresh", error: null });
    tables.settings = { data: { timezone: "UTC" }, google_plan_calendar: "plan2" };
    tables.plan_blocks = [
      {
        id: "b1",
        task_id: "t",
        start_at: "2026-11-03T12:00:00Z",
        end_at: "2026-11-03T13:00:00Z",
        level: "critical",
        google_event_id: null,
        tasks: { title: "Parcial" },
      },
      // Already in Google exactly like this: left alone (no write per cron run).
      {
        id: "b2",
        task_id: "t2",
        start_at: "2026-11-03T15:00:00Z",
        end_at: "2026-11-03T16:00:00Z",
        level: "ok",
        google_event_id: "g2",
        tasks: { title: "Mate" },
      },
    ];
    tables.calendar_events = [{ external_id: "old" }];
    const calls: { method: string; url: string; body?: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      calls.push({ method: init.method ?? "GET", url, body: init.body as string });
      if (url.includes("oauth2")) return Response.json({ access_token: "at" });
      // Two pages: calendars on the second must not be pruned as gone.
      if (url.includes("/users/me/calendarList?") && url.includes("pageToken=p2")) {
        return Response.json({
          items: [
            { id: "plan2", summary: "📚 Plan", backgroundColor: "#7986cb" },
            { id: "late", summary: "Facultad", hidden: true },
          ],
        });
      }
      if (url.includes("/users/me/calendarList?")) {
        return Response.json({
          items: [
            { id: "work", summary: "Trabajo" },
            { id: "plan1", summary: "📚 Plan" },
          ],
          nextPageToken: "p2",
        });
      }
      if (url.includes("/calendars/work/events")) {
        return Response.json({
          items: [
            {
              id: "e1",
              summary: "Taller",
              start: { dateTime: "2026-11-04T10:00:00Z" },
              end: { dateTime: "2026-11-04T12:00:00Z" },
            },
          ],
        });
      }
      if (url.includes("/calendars/plan2/events") && (init.method ?? "GET") === "GET")
        return Response.json({
          items: [
            {
              id: "g2",
              summary: "Mate",
              // Google answers in the calendar's zone: the same instants.
              start: { dateTime: "2026-11-03T12:00:00-03:00" },
              end: { dateTime: "2026-11-03T13:00:00-03:00" },
              colorId: "10",
              extendedProperties: { private: { criticalBlock: "b2" } },
            },
          ],
        });
      if (url.includes("/calendars/plan2/events")) return Response.json({ id: "g1" });
      return new Response(null, { status: 204 });
    });
    const res = await google(req("good"), env);
    expect(await res.json()).toEqual({
      connected: true,
      imported: 1,
      planCreated: 1,
      planRemoved: 0,
    });
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/calendars/plan1"))).toBe(
      true,
    );
    expect(
      calls.some(
        (c) =>
          c.method === "PATCH" &&
          c.url.includes("calendarList/plan2") &&
          c.body?.includes("#0b8043"),
      ),
    ).toBe(true);
    const created = calls.find(
      (c) => c.method === "POST" && c.url.includes("/calendars/plan2/events"),
    );
    expect(JSON.parse(created?.body ?? "{}")).toMatchObject({
      summary: "🔴 Parcial",
      colorId: "11",
    });
    expect(calls.some((c) => c.method === "PATCH" && c.url.includes("/events/g2"))).toBe(false);
    expect(writes.some((w) => w.table === "calendar_events" && w.op === "delete")).toBe(true);
    const listed = writes.find((w) => w.table === "calendars" && w.op === "upsert")?.payload as {
      external_id: string;
    }[];
    expect(listed.map((c) => c.external_id)).toEqual(["work", "late"]);
    // Plan calendars and vanished calendars are pruned with their events.
    expect(writes.filter((w) => w.op === "delete").map((w) => w.table)).toEqual(
      expect.arrayContaining(["calendar_events", "calendars"]),
    );
  });
});

describe("icloud-sync (Node)", () => {
  it("disconnects, rejects a bad password, and syncs", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await (await icloud(req("good", { action: "disconnect" }), env)).json()).toEqual({
      connected: false,
    });
    expect(rpc).toHaveBeenCalledWith("delete_oauth_token", { p_user: "u1", p_provider: "icloud" });

    expect(await (await icloud(req("good"), env)).json()).toEqual({
      connected: false,
      error: "not_connected",
    });
    expect(await (await icloud(req("good", { action: "connect" }), env)).json()).toEqual({
      connected: false,
      error: "missing_credentials",
    });

    rpc.mockResolvedValueOnce({ data: null, error: new Error("vault down") });
    expect((await icloud(req("good", { action: "disconnect" }), env)).status).toBe(500);

    vi.stubGlobal("fetch", async () => new Response("", { status: 401 }));
    const bad = await icloud(
      req("good", { action: "connect", appleId: "yo@icloud.com", appPassword: "aaaa-bbbb" }),
      env,
    );
    expect(await bad.json()).toEqual({
      connected: false,
      error: "icloud_auth_failed",
      status: 401,
    });
    expect(rpc).not.toHaveBeenCalledWith("store_oauth_token", expect.anything());
  });
});

describe("icloud-sync partial reads (Node)", () => {
  it("keeps stored events of a calendar with an unreadable event", async () => {
    rpc.mockResolvedValue({
      data: JSON.stringify({ appleId: "a", appPassword: "b" }),
      error: null,
    });
    tables.settings = { data: { timezone: "UTC" } };
    tables.calendar_events = [
      { external_id: "x|old|", calendar_id: "https://p01-caldav.icloud.com/1/cal/" },
    ];
    const ms = (body: string) =>
      new Response(`<multistatus xmlns="DAV:">${body}</multistatus>`, { status: 207 });
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      if (url === "https://caldav.icloud.com/")
        return ms(
          "<response><current-user-principal><href>/1/p/</href></current-user-principal></response>",
        );
      if (url.endsWith("/1/p/"))
        return ms("<response><calendar-home-set><href>/1/</href></calendar-home-set></response>");
      if (init.method === "PROPFIND") {
        return ms(
          "<response><href>/1/cal/</href><propstat><prop><displayname>Parciales</displayname><resourcetype><calendar/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>",
        );
      }
      return ms(
        "<response><calendar-data>BEGIN:VEVENT\nUID:ok\nDTSTART:20261110T120000Z\nDTEND:20261110T130000Z\nEND:VEVENT</calendar-data></response>" +
          "<response><calendar-data>BEGIN:VEVENT\nUID:bad\nDTSTART:garbage\nEND:VEVENT</calendar-data></response>",
      );
    });
    const res = await icloud(req("good"), env);
    expect(await res.json()).toMatchObject({ connected: true, imported: 1, failedCalendars: 1 });
    // Only the prune of unlisted calendars deletes; the partially read one keeps its events.
    expect(writes.filter((w) => w.table === "calendar_events" && w.op === "delete")).toHaveLength(
      1,
    );
  });
});

describe("icloud-sync incomplete listing (Node)", () => {
  it("keeps every stored calendar when the listing has a failed propstat", async () => {
    rpc.mockResolvedValue({
      data: JSON.stringify({ appleId: "a", appPassword: "b" }),
      error: null,
    });
    tables.settings = { data: { timezone: "UTC" } };
    tables.calendar_events = [];
    const ms = (body: string) =>
      new Response(`<multistatus xmlns="DAV:">${body}</multistatus>`, { status: 207 });
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      if (url === "https://caldav.icloud.com/")
        return ms(
          "<response><current-user-principal><href>/1/p/</href></current-user-principal></response>",
        );
      if (url.endsWith("/1/p/"))
        return ms("<response><calendar-home-set><href>/1/</href></calendar-home-set></response>");
      if (init.method === "PROPFIND") {
        return ms(
          "<response><href>/1/cal/</href><propstat><prop><resourcetype><calendar/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>" +
            "<response><href>/1/other/</href><propstat><prop><resourcetype/></prop><status>HTTP/1.1 500 Internal Server Error</status></propstat></response>",
        );
      }
      return ms("");
    });
    const res = await icloud(req("good"), env);
    expect(await res.json()).toMatchObject({ connected: true });
    expect(writes.some((w) => w.table === "calendars" && w.op === "delete")).toBe(false);
  });
});

describe("pruneCalendars", () => {
  it("escapes backslashes and quotes in calendar ids", async () => {
    const { pruneCalendars } = await import("./_lib/server.js");
    const seen: string[] = [];
    const chain = {
      delete: () => chain,
      eq: () => chain,
      not: (_col: string, _op: string, list: string) => {
        seen.push(list);
        return Promise.resolve({ error: null });
      },
    };
    await pruneCalendars({ from: () => chain } as never, "icloud", ["a\\b", 'c"d']);
    expect(seen[0]).toBe('("a\\\\b","c\\"d")');
  });
});
