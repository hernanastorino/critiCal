import { afterEach, describe, expect, it, vi } from "vitest";
import { zonedInstant } from "../../src/engine.js";
import { dueNotes } from "./notify.js";
import { notifyUser, subscribedUsers } from "./push.js";
import { parseDsn, report } from "./report.js";

const sendNotification = vi.hoisted(() => vi.fn());
vi.mock("web-push", () => ({ default: { sendNotification } }));

const tz = "America/Montevideo";
const MIN = 60_000;
const now = zonedInstant(tz, "2026-11-04", 10 * 60); // a Wednesday, 10:00

describe("due notifications", () => {
  const block = (id: string, inMinutes: number) => ({
    id,
    start: now + inMinutes * MIN,
    title: "Física",
  });

  it("warns before critical blocks within the lead time only", () => {
    const notes = dueNotes({
      now,
      timeZone: tz,
      critical: [block("a", 8), block("b", 25), block("c", -5)],
    });
    expect(notes).toEqual([
      expect.objectContaining({ key: "critical:a", title: "🔴 En 8 min: Física" }),
    ]);
    expect(
      dueNotes({ now, timeZone: tz, prefs: { leadMinutes: 30 }, critical: [block("b", 25)] }),
    ).toHaveLength(1);
    expect(
      dueNotes({ now, timeZone: tz, prefs: { critical: false }, critical: [block("a", 8)] }),
    ).toEqual([]);
  });

  it("tells about a clash with today's plan once per set of blocks", () => {
    const proposal = {
      id: "p",
      message: "Un evento nuevo pisa Física.",
      plan: [],
      conflicts: ["y", "x"],
      createdAt: 0,
    };
    const [note] = dueNotes({ now, timeZone: tz, critical: [], proposal });
    expect(note).toMatchObject({ key: "proposal:x,y", body: proposal.message });
    expect(
      dueNotes({ now, timeZone: tz, prefs: { proposals: false }, critical: [], proposal }),
    ).toEqual([]);
  });

  it("reminds of the weekly planning on Sunday evening", () => {
    const sunday = (h: number) => zonedInstant(tz, "2026-11-08", h * 60);
    expect(dueNotes({ now: sunday(18), timeZone: tz, critical: [] })).toEqual([]);
    expect(dueNotes({ now: sunday(19.5), timeZone: tz, critical: [] })).toEqual([
      expect.objectContaining({ key: "sunday:2026-11-08" }),
    ]);
    expect(dueNotes({ now: sunday(23), timeZone: tz, critical: [] })).toEqual([]);
    expect(
      dueNotes({ now: sunday(9), timeZone: tz, prefs: { sundayAt: 8 * 60 }, critical: [] }),
    ).toHaveLength(1);
    expect(dueNotes({ now, timeZone: tz, critical: [] })).toEqual([]);
  });
});

function admin(tables: Record<string, unknown[]>, claimed: (key: string) => boolean) {
  const deleted: unknown[] = [];
  const from = (table: string) => {
    const result = { data: tables[table] ?? [], error: null };
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gt", "lte"]) chain[m] = () => chain;
    chain.maybeSingle = async () => ({ data: (tables[table] ?? [])[0] ?? null });
    chain.delete = () => ({
      eq: async (_c: string, v: unknown) => {
        deleted.push(v);
        return { error: null };
      },
    });
    // biome-ignore lint/suspicious/noThenProperty: a thenable query builder, like supabase-js.
    chain.then = (ok: (r: unknown) => unknown) => Promise.resolve(result).then(ok);
    return chain;
  };
  const rpc = vi.fn(async (_n: string, a: { p_key: string }) => ({ data: claimed(a.p_key) }));
  return { client: { from, rpc } as never, deleted, rpc };
}

describe("sending", () => {
  const env = { vapidPublic: "pub", vapidPrivate: "priv", appUrl: "https://app" };
  const tables = {
    push_subscriptions: [
      { id: "s1", user_id: "u1", endpoint: "https://push/1", keys: { p256dh: "k", auth: "a" } },
      { id: "s2", user_id: "u1", endpoint: "https://push/2", keys: { p256dh: "k", auth: "a" } },
    ],
    settings: [{ data: { timezone: tz }, state: {} }],
    plan_blocks: [
      { id: "b1", start_at: new Date(now + 5 * MIN).toISOString(), tasks: { title: "Mate" } },
    ],
  };

  it("sends each due note once to every device and forgets dead ones", async () => {
    sendNotification.mockReset();
    sendNotification.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith("/2")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    });
    const db = admin(tables, () => true);
    const sent = await notifyUser(env, db.client, "u1", now);
    expect(sent).toEqual(["critical:b1"]);
    expect(sendNotification).toHaveBeenCalledTimes(2);
    const [, payload, options] = sendNotification.mock.calls[0] ?? [];
    expect(JSON.parse(payload as string)).toMatchObject({
      title: "🔴 En 5 min: Mate",
      tag: "critical:b1",
    });
    expect(options).toMatchObject({ vapidDetails: { subject: "https://app", publicKey: "pub" } });
    expect(db.deleted).toEqual(["s2"]);
  });

  it("skips notes already sent, and everything without keys or devices", async () => {
    sendNotification.mockReset();
    expect(await notifyUser(env, admin(tables, () => false).client, "u1", now)).toEqual([]);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(await notifyUser({}, admin(tables, () => true).client, "u1", now)).toEqual([]);
    expect(await notifyUser(env, admin({}, () => true).client, "u1", now)).toEqual([]);
  });

  it("lists each subscribed user once", async () => {
    expect(await subscribedUsers(admin(tables, () => true).client)).toEqual(["u1"]);
  });

  it("leaves out users no longer invited", async () => {
    const client = {
      from: () => ({
        select: async () => ({ data: [{ user_id: "u1" }, { user_id: "gone" }], error: null }),
      }),
      rpc: async (_n: string, a: { p_user: string }) => ({ data: a.p_user !== "gone" }),
    };
    expect(await subscribedUsers(client as never)).toEqual(["u1"]);
  });

  it("tries a failed invitation lookup again, and never lets an unknown answer through", async () => {
    const calls: string[] = [];
    const client = {
      from: () => ({
        select: async () => ({ data: [{ user_id: "flaky" }, { user_id: "down" }], error: null }),
      }),
      rpc: async (_n: string, a: { p_user: string }) => {
        calls.push(a.p_user);
        const first = calls.filter((c) => c === a.p_user).length === 1;
        if (a.p_user === "down" || first) return { data: null, error: new Error("busy") };
        return { data: true, error: null };
      },
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await subscribedUsers(client as never)).toEqual(["flaky"]);
    expect(log).toHaveBeenCalledWith("push invited lookup", "down", expect.any(Error));
    log.mockRestore();
  });
});

describe("error reports", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parse the DSN", () => {
    expect(parseDsn("https://abc@o1.ingest.sentry.io/42")).toEqual({
      url: "https://o1.ingest.sentry.io/api/42/envelope/",
      key: "abc",
    });
    expect(parseDsn("nope")).toBeNull();
  });

  it("are sent as an envelope, never throwing", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await report({ sentryDsn: "https://abc@o1.ingest.sentry.io/42" }, new Error("boom"), "cron");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://o1.ingest.sentry.io/api/42/envelope/");
    const [, , event] = String(init.body).split("\n");
    expect(JSON.parse(event ?? "{}")).toMatchObject({
      tags: { function: "cron" },
      exception: { values: [{ type: "Error", value: "boom" }] },
    });
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    await expect(
      report({ sentryDsn: "https://abc@o1.ingest.sentry.io/42" }, "x", "y"),
    ).resolves.toBeUndefined();
    await expect(report({}, new Error("ignored"), "y")).resolves.toBeUndefined();
    const sent = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", sent);
    await report(
      { sentryDsn: "https://abc@o1.ingest.sentry.io/42" },
      { message: "permission denied", code: "42501" },
      "widget",
    );
    const [, init2] = sent.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init2.body).split("\n")[2] ?? "{}").exception.values[0]).toMatchObject(
      {
        type: "42501",
        value: "permission denied",
      },
    );
    // An Error subclass with a code (like PostgrestError) is filed under its code too.
    const coded = Object.assign(new Error("rls"), { name: "PostgrestError", code: "42501" });
    await report({ sentryDsn: "https://abc@o1.ingest.sentry.io/42" }, coded, "widget");
    const [, init3] = sent.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init3.body).split("\n")[2] ?? "{}").exception.values[0]).toMatchObject(
      {
        type: "42501",
        value: "rls",
      },
    );
  });
});
