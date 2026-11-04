import { afterEach, describe, expect, it, vi } from "vitest";

const writes: { table: string; op: string; payload: unknown }[] = [];
let places: Record<string, unknown>[] = [];
let manual: Record<string, unknown>[] = [];
let manualError: Error | null = null;

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
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

const { handle } = await import("./travel.js");
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
});

describe("event addresses", () => {
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
    expect(pauses).toEqual([1100]);
    expect(writes).toEqual([]);
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
