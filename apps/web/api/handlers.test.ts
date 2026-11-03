import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const tables: Record<string, unknown> = {};
const writes: { table: string; op: string; payload?: unknown }[] = [];

function query(table: string) {
  const result = { data: tables[table] ?? null, error: null };
  // A thenable query builder: awaiting any step yields `result`.
  const chain = Promise.resolve(result) as unknown as Promise<typeof result> &
    Record<string, unknown>;
  for (const m of ["select", "eq", "gte", "lte", "in"]) chain[m] = () => chain;
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
    rpc,
    from: query,
  }),
}));

const { POST: google } = await import("./google-sync");
const { POST: icloud } = await import("./icloud-sync");
const { readEnv } = await import("./_lib/server");

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
    expect((await google(req("good"), { ...env, googleClientSecret: undefined })).status).toBe(503);
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
    ];
    tables.calendar_events = [{ external_id: "old" }];
    const calls: { method: string; url: string; body?: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      calls.push({ method: init.method ?? "GET", url, body: init.body as string });
      if (url.includes("oauth2")) return Response.json({ access_token: "at" });
      if (url.endsWith("/users/me/calendarList")) {
        return Response.json({
          items: [
            { id: "work", summary: "Trabajo" },
            { id: "plan1", summary: "📚 Plan" },
            { id: "plan2", summary: "📚 Plan", backgroundColor: "#7986cb" },
          ],
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
        return Response.json({ items: [] });
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
      colorId: "10",
    });
    expect(writes.some((w) => w.table === "calendar_events" && w.op === "delete")).toBe(true);
    expect(writes.some((w) => w.table === "calendars" && w.op === "upsert")).toBe(true);
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
