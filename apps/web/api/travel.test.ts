import { afterEach, describe, expect, it, vi } from "vitest";

const writes: { table: string; op: string; payload: unknown }[] = [];
let places: Record<string, unknown>[] = [];
let manual: Record<string, unknown>[] = [];
let manualError: Error | null = null;

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    rpc: async () => ({ data: true, error: null }),
    from: (table: string) => ({
      select: () => {
        const result = { data: table === "places" ? places : manual, error: null };
        return Object.assign(Promise.resolve(result), {
          eq: async () => ({ ...result, error: manualError }),
        });
      },
      update: (payload: unknown) => ({
        eq: async () => {
          writes.push({ table, op: "update", payload });
          return { error: null };
        },
      }),
      delete: () => {
        const filters: unknown[] = [];
        const chain = {
          eq: (_c: string, v: unknown) => {
            filters.push(v);
            if (filters.length === 3) {
              writes.push({ table, op: "delete", payload: filters });
              return Promise.resolve({ error: null });
            }
            return chain;
          },
        };
        return chain;
      },
      upsert: async (payload: unknown) => {
        writes.push({ table, op: "upsert", payload });
        return { error: null };
      },
    }),
  }),
}));

const { calls, config, handle, resetGeocoder } = await import("./travel.js");
const { SPOTS_TIMEOUT_MS } = await import("../src/remote.js");
const env = { url: "u", publishable: "p", secret: "s", orsKey: "ors" };
const req = (body?: unknown) =>
  new Request("https://app/api/travel", {
    method: "POST",
    headers: { Authorization: "Bearer t" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

afterEach(() => {
  vi.unstubAllGlobals();
  writes.length = 0;
  resetGeocoder();
  calls.reset();
});

describe("event addresses", () => {
  it("may run longer than the app waits for it", () => {
    expect(config.maxDuration * 1000).toBeGreaterThan(SPOTS_TIMEOUT_MS);
  });

  it("times them from home, the longer way, storing nothing", async () => {
    places = [
      { id: "casa", address: "Casa 1", lat: -34.8, lon: -56.2, is_home: true },
      { id: "facu", address: null, lat: -34.9, lon: -56.1, is_home: false },
    ];
    const pauses: number[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (String(url).includes("nominatim"))
        return Response.json(String(url).includes("Anglo") ? [{ lat: "-34.7", lon: "-56.3" }] : []);
      expect(JSON.parse(String(init?.body)).locations).toEqual([
        [-56.2, -34.8],
        [-56.3, -34.7],
      ]);
      return Response.json({
        durations: [
          [0, 600],
          [780, 0],
        ],
      });
    });
    const res = await handle(
      req({ spots: ["Instituto Anglo", "Ningún lado"] }),
      env,
      async (ms) => {
        pauses.push(ms);
      },
    );
    expect(await res.json()).toEqual({
      ok: true,
      spots: [
        { text: "Instituto Anglo", minutes: 13 },
        { text: "Ningún lado", minutes: null },
      ],
    });
    // One lookup per second, and nothing written.
    expect(pauses).toHaveLength(1);
    expect(pauses[0]).toBeGreaterThan(1000);
    expect(writes).toEqual([]);
  });

  it("looks up a home without coordinates without saving them", async () => {
    places = [{ id: "casa", address: "Casa 1", lat: null, lon: null, is_home: true }];
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).includes("nominatim")) return Response.json([{ lat: "-34.8", lon: "-56.2" }]);
      return Response.json({
        durations: [
          [0, 300],
          [300, 0],
        ],
      });
    });
    const res = await handle(req({ spots: ["Anglo"] }), env, async () => {});
    expect(await res.json()).toEqual({ ok: true, spots: [{ text: "Anglo", minutes: 5 }] });
    expect(writes).toEqual([]);
  });

  it("fails retryably when the geocoder refuses, instead of calling it not found", async () => {
    places = [{ id: "casa", address: null, lat: -34.8, lon: -56.2, is_home: true }];
    vi.stubGlobal("fetch", async () => new Response("slow down", { status: 429 }));
    const res = await handle(req({ spots: ["Anglo"] }), env, async () => {});
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, error: "travel_failed" });
  });

  it("rejects bad lists and needs a located home", async () => {
    expect((await handle(req({ spots: [] }), env)).status).toBe(400);
    expect((await handle(req({ spots: ["a", "b", "c", "d", "e"] }), env)).status).toBe(400);
    expect((await handle(req({ spots: [3] }), env)).status).toBe(400);
    places = [{ id: "facu", address: null, lat: -34.9, lon: -56.1, is_home: false }];
    expect(await (await handle(req({ spots: ["x"] }), env)).json()).toMatchObject({
      error: "no_home",
    });
    places = [{ id: "casa", address: null, lat: null, lon: null, is_home: true }];
    expect(await (await handle(req({ spots: ["x"] }), env)).json()).toMatchObject({
      error: "home_not_located",
    });
  });
});

describe("budget", () => {
  it("limits how often one person can ask, and bad requests cost nothing", async () => {
    places = [{ id: "casa", address: null, lat: null, lon: null, is_home: true }];
    for (let i = 0; i < 10; i++)
      expect((await handle(req({ spots: ["x"] }), env)).status).not.toBe(429);
    const res = await handle(req({ spots: ["x"] }), env);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(await res.json()).toMatchObject({ ok: false, error: "rate_limited" });
    calls.reset();
    for (let i = 0; i < 20; i++) await handle(req({ spots: [] }), env);
    expect((await handle(req({ spots: ["x"] }), env)).status).not.toBe(429);
  });
});

describe("travel", () => {
  it("needs the OpenRouteService key", async () => {
    const res = await handle(req(), { ...env, orsKey: undefined });
    expect(res.status).toBe(503);
    expect((await res.json()).missing).toEqual(["orsKey"]);
  });

  it("geocodes new addresses and stores computed times, never over manual ones", async () => {
    places = [
      { id: "casa", address: "Casa 1", lat: null, lon: null },
      { id: "facu", address: null, lat: -34.9, lon: -56.1 },
      { id: "gym", address: "Nowhere", lat: null, lon: null },
    ];
    manual = [{ from_place: "facu", to_place: "casa" }];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (String(url).includes("nominatim")) {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        expect(headers["User-Agent"]).toContain("critiCal");
        return Response.json(String(url).includes("Casa") ? [{ lat: "-34.8", lon: "-56.2" }] : []);
      }
      expect(JSON.parse(String(init?.body))).toEqual({
        locations: [
          [-56.2, -34.8],
          [-56.1, -34.9],
        ],
        metrics: ["duration"],
      });
      return Response.json({
        durations: [
          [0, 1490],
          [1200, 0],
        ],
      });
    });
    const pause = vi.fn(async () => {});
    const res = await handle(req(), env, pause);
    expect(await res.json()).toEqual({
      ok: true,
      geocoded: 1,
      pairs: 1,
      unroutable: [],
      ungeocoded: ["gym"],
      noAddress: [],
    });
    expect(pause).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([
      { table: "places", op: "update", payload: { lat: -34.8, lon: -56.2 } },
      {
        table: "travel_times",
        op: "upsert",
        payload: [{ from_place: "casa", to_place: "facu", minutes: 25, manual: false }],
      },
    ]);
  });

  it("with a list of trips, times only those and looks up only their places", async () => {
    places = [
      { id: "casa", address: null, lat: -34.8, lon: -56.2 },
      { id: "facu", address: null, lat: -34.9, lon: -56.1 },
      { id: "gym", address: "Rivera 1", lat: null, lon: null },
    ];
    manual = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      // The gym is in no trip asked for: its address is not looked up.
      expect(String(url)).not.toContain("nominatim");
      expect(JSON.parse(String(init?.body)).locations).toHaveLength(2);
      return Response.json({
        durations: [
          [0, 600],
          [null, 0],
        ],
      });
    });
    const res = await handle(req({ pairs: [{ from: "casa", to: "facu" }] }), env);
    // facu → casa has no route, but nobody asked for it: it is not reported nor deleted.
    expect(await res.json()).toEqual({
      ok: true,
      geocoded: 0,
      pairs: 1,
      unroutable: [],
      ungeocoded: [],
      noAddress: [],
    });
    expect(writes).toEqual([
      {
        table: "travel_times",
        op: "upsert",
        payload: [{ from_place: "casa", to_place: "facu", minutes: 10, manual: false }],
      },
    ]);
  });

  it("refuses a list of trips that is not one", async () => {
    for (const pairs of [
      [],
      "casa>facu",
      [{ from: "casa" }],
      [{ from: "casa", to: "casa" }],
      [{ from: "casa", to: 3 }],
      [null],
      [{ from: "x".repeat(81), to: "facu" }],
      Array.from({ length: 61 }, (_, i) => ({ from: "casa", to: `p${i}` })),
    ]) {
      const res = await handle(req({ pairs }), env);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: "bad_request" });
    }
  });

  it("never overwrites manual times when it cannot read them", async () => {
    places = [
      { id: "casa", address: null, lat: -34.8, lon: -56.2 },
      { id: "facu", address: null, lat: -34.9, lon: -56.1 },
    ];
    manualError = new Error("rls");
    vi.stubGlobal("fetch", async () =>
      Response.json({
        durations: [
          [0, 60],
          [60, 0],
        ],
      }),
    );
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const res = await handle(req(), env);
    expect(res.status).toBe(500);
    expect(writes).toEqual([]);
    manualError = null;
  });

  it("forgets computed times for pairs with no route", async () => {
    places = [
      { id: "casa", address: null, lat: -34.8, lon: -56.2 },
      { id: "isla", address: null, lat: -34.9, lon: -56.1 },
    ];
    manual = [{ from_place: "isla", to_place: "casa" }];
    vi.stubGlobal("fetch", async () =>
      Response.json({
        durations: [
          [0, null],
          [null, 0],
        ],
      }),
    );
    expect(await (await handle(req(), env)).json()).toEqual({
      ok: true,
      geocoded: 0,
      pairs: 0,
      unroutable: [{ from: "casa", to: "isla" }],
      ungeocoded: [],
      noAddress: [],
    });
    expect(writes).toEqual([
      { table: "travel_times", op: "delete", payload: ["casa", "isla", false] },
    ]);
    manual = [];
  });

  it("needs two located places, and reports routing failures", async () => {
    places = [{ id: "casa", address: null, lat: -34.8, lon: -56.2 }];
    expect(await (await handle(req(), env)).json()).toEqual({
      ok: true,
      geocoded: 0,
      pairs: 0,
      unroutable: [],
      ungeocoded: [],
      noAddress: [],
    });
    places = [
      { id: "casa", address: null, lat: -34.8, lon: -56.2 },
      { id: "facu", address: null, lat: -34.9, lon: -56.1 },
    ];
    vi.stubGlobal("fetch", async () => new Response("quota", { status: 429 }));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const res = await handle(req(), env);
    expect(res.status).toBe(500);
  });
});

describe("la cola de geocodificación no la acapara una sola persona", () => {
  it("una llamada a la vez por persona: la segunda en simultáneo responde 429 «busy»", async () => {
    places = [{ id: "casa", address: "Casa 1", lat: -34.8, lon: -56.2, is_home: true }];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).includes("nominatim")) {
        await gate;
        return Response.json([{ lat: "-34.7", lon: "-56.3" }]);
      }
      return Response.json({
        durations: [
          [0, 600],
          [600, 0],
        ],
      });
    });
    const first = handle(req({ spots: ["Anglo"] }), env, async () => {});
    const second = await handle(req({ spots: ["Otro"] }), env, async () => {});
    expect(second.status).toBe(429);
    expect(await second.json()).toMatchObject({ ok: false, error: "busy" });
    expect(second.headers.get("Retry-After")).toBe("5");
    release();
    expect((await first).status).toBe(200);
    // Done: it can ask again (and the refused one did not use up its budget).
    expect((await handle(req({ spots: ["Anglo"] }), env, async () => {})).status).toBe(200);
  });
});
