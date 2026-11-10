import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeFetch } from "./_lib/fake-providers.js";
import { limiter } from "./_lib/rate.js";
import { importSource } from "./_lib/transit/import.js";
import { resetTransitCache } from "./_lib/transit/store.js";

interface Row {
  source: string;
  version: string;
  built_at: string;
  valid_to: string | null;
  stats: Record<string, number>;
  payload: string;
}
let rows: Row[] = [];
let failReads = false;

const admin = {
  auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
  rpc: async (name: string, args: { p_key?: string }) => ({
    data: name === "check_cron_key" ? args.p_key === "good-key" : true,
    error: null,
  }),
  from: () => ({
    select: (cols: string) => {
      const pick = () => {
        if (failReads) return { data: null, error: new Error("db down") };
        return {
          data: rows.map((r) =>
            Object.fromEntries(cols.split(",").map((c) => [c.trim(), r[c.trim() as keyof Row]])),
          ),
          error: null,
        };
      };
      return Object.assign(Promise.resolve(pick()), {
        eq: (_c: string, v: string) => ({
          maybeSingle: async () => ({
            data: rows.find((r) => r.source === v) ?? null,
            error: null,
          }),
        }),
      });
    },
    upsert: async (row: Row) => {
      rows = [...rows.filter((r) => r.source !== row.source), row];
      return { error: null };
    },
  }),
};
vi.mock("@supabase/supabase-js", () => ({ createClient: () => admin }));

const { handle, parsePlan, plans } = await import("./transit.js");
const env = { url: "u", publishable: "p", secret: "s", orsKey: "ors" };
const NOW = Date.parse("2026-11-10T12:00:00Z");
const call = (
  body: unknown,
  headers: Record<string, string> = { Authorization: "Bearer t" },
  e = env,
) =>
  handle(
    new Request("https://app/api/transit", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    e,
    NOW,
  );
const plan = (extra: Record<string, unknown> = {}) => ({
  action: "plan",
  from: { lat: -34.849, lon: -56.162 },
  to: { lat: -34.849, lon: -56.058 },
  date: "2026-11-10",
  time: "09:00",
  mode: "arrive",
  ...extra,
});

/** The stored feeds: the invented metropolitan one, through the real importer. */
async function seed() {
  const r = await importSource(
    admin as never,
    "dnt",
    fakeFetch(fetch, () => NOW),
  );
  expect(r.ok).toBe(true);
}

beforeEach(() => {
  rows = [];
  failReads = false;
  resetTransitCache();
  plans.reset();
});
afterEach(() => vi.unstubAllGlobals());

describe("who may ask", () => {
  it("needs a signed-in, invited caller and a configured server", async () => {
    expect((await call({ action: "status" }, {})).status).toBe(401);
    expect(
      (await call({ action: "status" }, { Authorization: "Bearer t" }, { url: "u" } as never))
        .status,
    ).toBe(503);
  });

  it("refuses a huge body without reading it", async () => {
    const big = { action: "status", pad: "x".repeat(5000) };
    expect((await call(big, { Authorization: "Bearer t", "content-length": "5100" })).status).toBe(
      413,
    );
    // Without a declared length it is cut off while reading.
    expect((await call(big)).status).toBe(413);
    expect((await call(big, { "x-cron-key": "good-key" })).status).toBe(413);
  });

  it("only knows its actions", async () => {
    expect((await call({ action: "what" })).status).toBe(400);
    expect((await call({})).status).toBe(400);
  });
});

describe("status", () => {
  it("says there is no feed before the first import, then which versions are stored", async () => {
    expect(await (await call({ action: "status" })).json()).toEqual({ ok: true, feed: null });
    await seed();
    const body = await (await call({ action: "status" })).json();
    expect(body.feed.sources).toHaveLength(1);
    expect(body.feed.version).toMatch(/^dnt:[0-9a-f]{12}$/);
    expect(body.feed.validTo).toBe("2099-12-31");
  });

  it("reports a database failure as an error, not as an empty feed", async () => {
    failReads = true;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await call({ action: "status" });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("transit_failed");
  });
});

describe("checking a request", () => {
  const ok = plan();
  it("accepts a well-formed one", () => {
    expect(parsePlan(ok, NOW)).toMatchObject({ date: "2026-11-10", mode: "arrive" });
    expect(parsePlan(plan({ dayType: 3 }), NOW)).toMatchObject({ dayType: 3 });
  });

  it.each([
    ["no points", { from: null }],
    ["text coordinates", { to: { lat: "-34.9", lon: "-56.1" } }],
    ["a bad mode", { mode: "later" }],
    ["a bad time", { time: "25:00" }],
    ["a bad date", { date: "2026-02-30" }],
    ["a text date", { date: 20261110 }],
    ["a date long past", { date: "2026-01-01" }],
    ["a date too far ahead", { date: "2028-01-01" }],
    ["a bad day type", { dayType: 4 }],
  ])("refuses %s", (_name, extra) => {
    expect(parsePlan(plan(extra), NOW)).toBe("bad_request");
  });

  it("refuses points outside Montevideo, Canelones and San José", () => {
    expect(parsePlan(plan({ to: { lat: -31.4, lon: -58 } }), NOW)).toBe("out_of_area");
    expect(parsePlan(plan({ from: { lat: Number.NaN, lon: -56 } }), NOW)).toBe("out_of_area");
  });
});

describe("planning", () => {
  it("answers 503 until the schedules are imported", async () => {
    const res = await call(plan());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("feed_unavailable");
  });

  it("returns the bus options with the feed's version and the attribution", async () => {
    await seed();
    vi.stubGlobal(
      "fetch",
      fakeFetch(fetch, () => NOW),
    );
    const res = await call(plan());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.options.length).toBeGreaterThan(0);
    expect(body.options[0].arriveMin).toBeLessThanOrEqual(540);
    expect(body.options[0].legs[0].source).toBe("route");
    expect(body.walkOnly).toBeNull();
    expect(body.dayType).toBe(1);
    expect(body.feed.version).toMatch(/^dnt:/);
    expect(body.attribution).toMatch(/Intendencia de Montevideo/);
  });

  it("keeps the straight-line walk when there is no routing key or it fails", async () => {
    await seed();
    const first = async (e: typeof env | Omit<typeof env, "orsKey">) => {
      const res = await handle(
        new Request("https://app/api/transit", {
          method: "POST",
          headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
          body: JSON.stringify(plan()),
        }),
        e,
        NOW,
      );
      return (await res.json()).options[0].legs[0].source;
    };
    expect(await first({ url: "u", publishable: "p", secret: "s" })).toBe("estimate");
    plans.reset();
    vi.stubGlobal("fetch", async () => new Response("", { status: 500 }));
    expect(await first(env)).toBe("estimate");
    plans.reset();
    vi.stubGlobal("fetch", async () => Response.json({}));
    expect(await first(env)).toBe("estimate");
    plans.reset();
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    expect(await first(env)).toBe("estimate");
    plans.reset();
    vi.stubGlobal("fetch", async () => Response.json({ durations: [[null], [null]] }));
    expect(await first(env)).toBe("estimate");
  });

  it("reads the schedule of the day type asked for", async () => {
    await seed();
    vi.stubGlobal(
      "fetch",
      fakeFetch(fetch, () => NOW),
    );
    const sunday = await (await call(plan({ dayType: 3 }))).json();
    expect(sunday.dayType).toBe(3);
    expect(sunday.options.length).toBeGreaterThan(0);
  });

  it("offers the walk when it is short, and says when no stop is near", async () => {
    await seed();
    vi.stubGlobal(
      "fetch",
      fakeFetch(fetch, () => NOW),
    );
    const near = await (
      await call(plan({ from: { lat: -34.849, lon: -56.162 }, to: { lat: -34.849, lon: -56.158 } }))
    ).json();
    expect(near.walkOnly).toEqual({ minutes: expect.any(Number), meters: expect.any(Number) });
    expect(near.walkOnly.minutes).toBeLessThanOrEqual(25);
    const lost = await call(
      plan({ from: { lat: -35.1, lon: -56.8 }, to: { lat: -35.1, lon: -56.5 } }),
    );
    expect(lost.status).toBe(422);
    expect((await lost.json()).error).toBe("no_stops_near");
    // No stop near either end, but close enough to walk: an answer, not an error.
    const walk = await (
      await call(plan({ from: { lat: -35.1, lon: -56.8 }, to: { lat: -35.1, lon: -56.799 } }))
    ).json();
    expect(walk).toMatchObject({ ok: true, options: [] });
    expect(walk.walkOnly.minutes).toBeGreaterThan(0);
  });

  it("returns an empty list when no bus gets there in time", async () => {
    await seed();
    vi.stubGlobal(
      "fetch",
      fakeFetch(fetch, () => NOW),
    );
    const body = await (await call(plan({ time: "06:05" }))).json();
    expect(body.options).toEqual([]);
  });

  it("limits how often one person can ask", async () => {
    await seed();
    vi.stubGlobal(
      "fetch",
      fakeFetch(fetch, () => NOW),
    );
    for (let i = 0; i < 10; i++) expect((await call(plan())).status).toBe(200);
    const res = await call(plan());
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("rate_limited");
    // A bad request does not use up the budget.
    plans.reset();
    for (let i = 0; i < 20; i++) await call(plan({ mode: "x" }));
    expect((await call(plan())).status).toBe(200);
  });

  it("caches the network between requests, and reloads it when the feed changes", async () => {
    await seed();
    vi.stubGlobal(
      "fetch",
      fakeFetch(fetch, () => NOW),
    );
    await call(plan());
    rows = [];
    // Still cached: no new read of the payloads is needed within the freshness window.
    expect((await call(plan())).status).toBe(200);
    resetTransitCache();
    expect((await call(plan())).status).toBe(503);
  });
});

describe("the weekly import", () => {
  const cron = (body: unknown, key = "good-key") => call(body, { "x-cron-key": key });

  it("needs the cron key, and a configured server", async () => {
    expect((await cron({}, "wrong")).status).toBe(401);
    expect((await call({}, { "x-cron-key": "good-key" }, { url: "u" } as never)).status).toBe(503);
  });

  it("imports each source on its own: one failing keeps the other", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      fakeFetch(fetch, () => NOW),
    );
    const res = await cron({});
    const body = await res.json();
    expect(body.ok).toBe(false);
    const by = Object.fromEntries(body.results.map((r: { source: string }) => [r.source, r]));
    expect(by.dnt.ok).toBe(true);
    expect(by.stm.ok).toBe(false);
    expect(rows.map((r) => r.source)).toEqual(["dnt"]);
    expect(rows[0]?.stats.patterns).toBeGreaterThan(0);
  });

  it("can be asked for one source", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch(fetch, () => NOW),
    );
    const body = await (await cron({ source: "dnt" })).json();
    expect(body).toMatchObject({ ok: true, results: [{ source: "dnt", ok: true }] });
  });

  it("refuses a download that shrank the feed or is too small", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch(fetch, () => NOW),
    );
    await seed();
    rows[0] = { ...(rows[0] as Row), stats: { patterns: 100_000 } };
    const shrunk = await importSource(
      admin as never,
      "dnt",
      fakeFetch(fetch, () => NOW),
    );
    expect(shrunk).toMatchObject({ ok: false, error: "feed_shrunk" });
    rows = [];
    const small = await importSource(
      admin as never,
      "stm",
      async () => new Response("", { status: 503 }),
    );
    expect(small).toMatchObject({ ok: false, error: "download_503" });
  });
});

describe("request budget", () => {
  it("counts per minute and per day, per person", () => {
    const l = limiter(2, 3);
    const t = 1_000_000;
    expect(l.take("a", t)).toBe(true);
    expect(l.take("a", t + 1)).toBe(true);
    expect(l.take("a", t + 2)).toBe(false);
    expect(l.take("b", t + 2)).toBe(true);
    expect(l.take("a", t + 61_000)).toBe(true);
    expect(l.take("a", t + 122_000)).toBe(false);
    expect(l.take("a", t + 86_400_001)).toBe(true);
  });
});
