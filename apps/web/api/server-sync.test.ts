import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppData, Proposal } from "../src/model.js";

const rpc = vi.fn();
const rows: Record<string, unknown[]> = {};
const ops: { table: string; op: string; payload?: unknown }[] = [];
const auth = {
  getUser: vi.fn(),
  admin: { getUserById: vi.fn(), generateLink: vi.fn(), signOut: vi.fn() },
  verifyOtp: vi.fn(),
};

function query(table: string) {
  let filtered = rows[table] ?? [];
  const chain = {
    select: () => chain,
    eq: (col: string, v: unknown) => {
      filtered = filtered.filter((r) => (r as Record<string, unknown>)[col] === v);
      return chain;
    },
    maybeSingle: () => Promise.resolve({ data: filtered[0] ?? null, error: null }),
    insert: (payload: unknown) => {
      ops.push({ table, op: "insert", payload });
      rows[table] = [...(rows[table] ?? []), payload];
      return Promise.resolve({ error: null });
    },
    delete: () => ({
      eq: (col: string, v: unknown) => {
        ops.push({ table, op: "delete", payload: v });
        rows[table] = (rows[table] ?? []).filter((r) => (r as Record<string, unknown>)[col] !== v);
        return Promise.resolve({ error: null });
      },
    }),
    // biome-ignore lint/suspicious/noThenProperty: a thenable query builder, like supabase-js.
    then: (ok: (r: unknown) => unknown) =>
      Promise.resolve({ data: filtered, error: null }).then(ok),
  };
  return chain;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: (_url: string, key: string, opts?: { global?: { headers?: object } }) => ({
    key,
    headers: opts?.global?.headers,
    auth,
    rpc,
    from: query,
  }),
}));

const serverSync = vi.fn();
vi.mock("./_lib/replan.js", async (original) => ({
  ...(await original<typeof import("./_lib/replan.js")>()),
  serverSync: (...args: unknown[]) => serverSync(...args),
}));

const { handle: webhook } = await import("./google-webhook.js");
const { handle: cron } = await import("./cron.js");
const { actAs, readEnv } = await import("./_lib/server.js");
const { newProposal } = await import("./_lib/replan.js");
const { watchCalendars } = await import("./_lib/google-run.js");

const env = {
  url: "https://x.supabase.co",
  publishable: "pk",
  secret: "sk",
  googleClientId: "id",
  googleClientSecret: "secret",
};

const notify = (headers: Record<string, string>) =>
  new Request("https://app/api/google-webhook", { method: "POST", headers });

beforeEach(() => {
  rpc.mockReset();
  serverSync.mockReset();
  ops.length = 0;
  for (const k of Object.keys(rows)) delete rows[k];
  rows.google_channels = [{ id: "ch1", user_id: "u1", secret: "s3cret" }];
});
afterEach(() => vi.unstubAllGlobals());

describe("google-webhook", () => {
  it("rejects unknown or forged channels", async () => {
    expect((await webhook(notify({}), env)).status).toBe(400);
    const forged = notify({ "x-goog-channel-id": "ch1", "x-goog-channel-token": "nope" });
    expect((await webhook(forged, env)).status).toBe(404);
    const unknown = notify({ "x-goog-channel-id": "zz", "x-goog-channel-token": "s3cret" });
    expect((await webhook(unknown, env)).status).toBe(404);
    expect(serverSync).not.toHaveBeenCalled();
  });

  it("needs the Google credentials", async () => {
    const res = await webhook(notify({}), { ...env, googleClientSecret: undefined });
    expect(res.status).toBe(503);
  });

  it("only acknowledges the first message of a channel", async () => {
    const res = await webhook(
      notify({
        "x-goog-channel-id": "ch1",
        "x-goog-channel-token": "s3cret",
        "x-goog-resource-state": "sync",
      }),
      env,
    );
    expect(await res.json()).toEqual({ ok: true });
    expect(serverSync).not.toHaveBeenCalled();
  });

  const change = () =>
    notify({
      "x-goog-channel-id": "ch1",
      "x-goog-channel-token": "s3cret",
      "x-goog-resource-state": "exists",
    });

  it("syncs the channel's user on a change", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    serverSync.mockResolvedValue({ proposal: { id: "p" } });
    const res = await webhook(change(), env);
    expect(await res.json()).toEqual({ ok: true, proposal: true });
    expect(rpc).toHaveBeenCalledWith("claim_sync", { p_user: "u1", p_gap: "20 seconds" });
    expect(serverSync).toHaveBeenCalledWith(env, "u1");
    expect(rpc).toHaveBeenCalledWith("finish_sync", { p_user: "u1" });
  });

  it("defers a burst to the running sync and survives failures", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await (await webhook(change(), env)).json()).toEqual({ ok: true, deferred: true });
    rpc.mockResolvedValueOnce({ data: true, error: null });
    serverSync.mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const res = await webhook(change(), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false });
  });
});

describe("cron", () => {
  const tick = (key?: string) =>
    new Request("https://app/api/cron", {
      method: "POST",
      headers: key ? { "x-cron-key": key } : {},
    });

  it("refuses calls without the database's key", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect((await cron(tick(), env)).status).toBe(401);
    expect((await cron(tick("guess"), env)).status).toBe(401);
    expect((await cron(tick("k"), { ...env, secret: undefined })).status).toBe(503);
  });

  it("syncs each connected user that is due", async () => {
    rpc.mockImplementation(async (name: string, args: { p_user?: string }) => {
      if (name === "check_cron_key") return { data: true, error: null };
      if (name === "connected_users") return { data: ["u1", "u2", "u3"], error: null };
      return { data: args.p_user !== "u2", error: null };
    });
    serverSync.mockImplementation(async (_env: unknown, uid: string) => {
      if (uid === "u3") throw new Error("expired");
      return {};
    });
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const res = await cron(tick("k"), env);
    expect(await res.json()).toEqual({ ok: true, synced: 1, notified: 0 });
    expect(serverSync.mock.calls.map((c) => c[1])).toEqual(["u1", "u3"]);
    const finished = rpc.mock.calls.filter((c) => c[0] === "finish_sync").map((c) => c[1].p_user);
    expect(finished).toEqual(["u1", "u3"]);
  });
});

describe("acting as a user", () => {
  it("redeems a one-time link for a session that RLS treats as the user", async () => {
    auth.admin.getUserById.mockResolvedValue({ data: { user: { email: "a@b.c" } }, error: null });
    auth.admin.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "h" } },
      error: null,
    });
    auth.verifyOtp.mockResolvedValue({ data: { session: { access_token: "jwt" } }, error: null });
    const caller = await actAs(env, "u1");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "h" });
    expect(caller.uid).toBe("u1");
    expect((caller.user as unknown as { headers: object }).headers).toEqual({
      Authorization: "Bearer jwt",
    });
    await caller.release?.();
    expect(auth.admin.signOut).toHaveBeenCalledWith("jwt", "local");
  });

  it("fails without an email or a session", async () => {
    auth.admin.getUserById.mockResolvedValue({ data: { user: {} }, error: null });
    await expect(actAs(env, "u1")).rejects.toThrow("user_without_email");
    auth.admin.getUserById.mockResolvedValue({ data: { user: { email: "a@b.c" } }, error: null });
    auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: null });
    await expect(actAs(env, "u1")).rejects.toThrow("no_session");
  });

  it("only knows the public origin in production", () => {
    const vercel = { VERCEL_PROJECT_PRODUCTION_URL: "critical-cal.vercel.app" };
    expect(readEnv({ ...vercel, VERCEL_ENV: "production" }).appUrl).toBe(
      "https://critical-cal.vercel.app",
    );
    expect(readEnv({ ...vercel, VERCEL_ENV: "preview" }).appUrl).toBeUndefined();
  });
});

describe("new proposals", () => {
  const proposal = (id: string, conflicts: string[]): Proposal => ({
    id,
    message: "",
    plan: [],
    conflicts,
    createdAt: 0,
  });
  const data = (proposals: Proposal[]) => ({ proposals }) as AppData;

  it("are reported once, however often the plan is recomputed", () => {
    const first = proposal("conflict@1", ["a", "b"]);
    expect(newProposal(data([]), data([first]))).toBe(first);
    expect(newProposal(data([first]), data([proposal("conflict@2", ["b", "a"])]))).toBeUndefined();
    const other = proposal("conflict@3", ["c"]);
    expect(newProposal(data([first]), data([other]))).toBe(other);
  });
});

describe("push channels", () => {
  const DAY = 86_400_000;
  const now = Date.UTC(2026, 10, 4);
  const session = () => ({
    token: "t",
    timeZone: "America/Montevideo",
    caller: { uid: "u1", user: {}, admin: { from: query } } as never,
  });

  it("watches new calendars, keeps fresh channels and stops the rest", async () => {
    rows.google_channels = [
      {
        id: "keep",
        user_id: "u1",
        calendar_id: "a",
        resource_id: "r1",
        expires_at: new Date(now + 5 * DAY).toISOString(),
      },
      {
        id: "old",
        user_id: "u1",
        calendar_id: "b",
        resource_id: "r2",
        expires_at: new Date(now + DAY / 2).toISOString(),
      },
      {
        id: "gone",
        user_id: "u1",
        calendar_id: "x",
        resource_id: "r3",
        expires_at: new Date(now + 5 * DAY).toISOString(),
      },
    ];
    const calls: { url: string; body: Record<string, string> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? "{}"));
      calls.push({ url, body });
      if (url.endsWith("/watch")) {
        if (url.includes("/calendars/holidays/")) return new Response("", { status: 403 });
        return new Response(
          JSON.stringify({
            id: body.id,
            resourceId: `res-${body.id}`,
            expiration: String(now + 7 * DAY),
          }),
        );
      }
      return new Response(null, { status: 204 });
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await watchCalendars(session(), ["a", "b", "c", "holidays"], "https://app", now);

    const watched = calls.filter((c) => c.url.endsWith("/watch"));
    expect(watched.map((c) => decodeURIComponent(c.url.split("/calendars/")[1] ?? ""))).toEqual([
      "b/events/watch",
      "c/events/watch",
      "holidays/events/watch",
    ]);
    expect(watched[0]?.body).toMatchObject({
      type: "web_hook",
      address: "https://app/api/google-webhook",
    });
    const stopped = calls.filter((c) => c.url.endsWith("/channels/stop")).map((c) => c.body.id);
    expect(stopped.sort()).toEqual(["gone", "old"]);
    const left = (rows.google_channels as { calendar_id: string }[]).map((r) => r.calendar_id);
    expect(left.sort()).toEqual(["a", "b", "c"]);
  });
});
