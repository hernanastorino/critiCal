import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoData } from "../src/demo.js";
import { clean, editedHours, prompt, syllabusTasks } from "../src/syllabus.js";

const rpc = vi.fn();
const invited = true;
const loadData = vi.fn();
const release = vi.fn(async () => {});

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (t: string) =>
        t === "jwt"
          ? { data: { user: { id: "u1" } }, error: null }
          : { data: { user: null }, error: new Error() },
    },
    // Everyone in these tests is invited unless a test says otherwise.
    rpc: (name: string, args: unknown) =>
      name === "user_invited" ? Promise.resolve({ data: invited, error: null }) : rpc(name, args),
  }),
}));
vi.mock("./_lib/server.js", async (original) => ({
  ...(await original<typeof import("./_lib/server.js")>()),
  actAs: async () => ({ uid: "u1", user: {}, admin: {}, release }),
}));
vi.mock("../src/data.js", async (original) => ({
  ...(await original<typeof import("../src/data.js")>()),
  loadData: (...a: unknown[]) => loadData(...a),
}));

const widget = await import("./widget.js");
const syllabus = await import("./syllabus.js");
const { sha256, widgetSilos } = await import("./_lib/widget.js");

const env = { url: "u", publishable: "p", secret: "s", geminiKey: "g" };
const NOW = Date.UTC(2026, 10, 4, 13);
const bearer = (token?: string, body?: object) =>
  new Request("https://app/api/x", {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

beforeEach(() => {
  rpc.mockReset();
  loadData.mockReset();
  release.mockClear();
  syllabus.reads.reset();
  syllabus.keySets.reset();
  syllabus.keyCalls.reset();
});
afterEach(() => vi.unstubAllGlobals());

describe("widget", () => {
  it("shows the silos for a valid token, ordered by deadline", async () => {
    const hash = await sha256("cw_abc");
    rpc.mockImplementation(async (_n: string, a: { p_hash: string }) => ({
      data: a.p_hash === hash ? "u1" : null,
    }));
    loadData.mockResolvedValue(demoData(NOW));
    const res = await widget.read(bearer("cw_abc"), env, NOW);
    const body = await res.json();
    expect(body.updatedAt).toBe(NOW);
    expect(body.silos.length).toBeGreaterThan(0);
    const deadlines = body.silos.map((s: { deadline: number }) => s.deadline);
    expect([...deadlines].sort((a, b) => a - b)).toEqual(deadlines);
    expect(body.silos[0]).toEqual(
      expect.objectContaining({ title: expect.any(String), color: expect.stringMatching(/^#/) }),
    );
    expect(release).toHaveBeenCalled();
    expect((await widget.read(bearer("cw_wrong"), env, NOW)).status).toBe(401);
    expect((await widget.read(bearer(), env, NOW)).status).toBe(401);
    rpc.mockResolvedValueOnce({ data: null, error: new Error("db down") });
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    expect((await widget.read(bearer("cw_abc"), env, NOW)).status).toBe(500);
    expect((await widget.read(bearer("x"), { ...env, secret: undefined }, NOW)).status).toBe(503);
  });

  it("creates a token only its hash is stored for, and revokes it", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const res = await widget.manage(bearer("jwt", { action: "create" }), env);
    const { token } = await res.json();
    expect(token).toMatch(/^cw_[A-Za-z0-9_-]{32}$/);
    expect(rpc).toHaveBeenCalledWith("set_widget_token", {
      p_user: "u1",
      p_hash: await sha256(token),
    });
    await widget.manage(bearer("jwt", { action: "revoke" }), env);
    expect(rpc).toHaveBeenLastCalledWith("revoke_widget_token", { p_user: "u1" });
    expect((await widget.manage(bearer("nope", { action: "create" }), env)).status).toBe(401);
    rpc.mockResolvedValueOnce({ data: null, error: new Error("rls") });
    const failed = await widget.manage(bearer("jwt", { action: "revoke" }), env);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ ok: false, error: "widget_failed" });
  });

  it("refuses an unknown action or body without touching the token", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    for (const body of [{ action: "rotate" }, { action: "Create" }, {}]) {
      const res = await widget.manage(bearer("jwt", body), env);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: "bad_request" });
    }
    const noBody = new Request("https://app/api/x", {
      method: "POST",
      headers: { Authorization: "Bearer jwt" },
    });
    expect((await widget.manage(noBody, env)).status).toBe(400);
    expect(rpc).not.toHaveBeenCalledWith("set_widget_token", expect.anything());
    expect(rpc).not.toHaveBeenCalledWith("revoke_widget_token", expect.anything());
  });

  it("skips silos with nothing to do", () => {
    const data = demoData(NOW);
    expect(widgetSilos(data, NOW).every((s) => s.totalMinutes > 0)).toBe(true);
  });
});

describe("syllabus", () => {
  // No key of their own unless a test stores one.
  beforeEach(() => rpc.mockResolvedValue({ data: null, error: null }));
  const answer = (json: unknown) =>
    Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }] });
  const good = {
    subject: "Física II",
    units: [
      { title: "Electrostática", hours: 10.3 },
      { title: "Circuitos", hours: 999 },
      { title: "", hours: 2 },
    ],
    assessments: [
      {
        title: "Primer parcial",
        kind: "parcial",
        date: "2026-09-20",
        hours: 12,
        units: ["Electrostática", "Inventada"],
      },
      { title: "Laboratorio", kind: "otra", date: "20/9", hours: 4, units: [] },
    ],
  };

  it("cleans what the model says", () => {
    expect(clean(good)).toEqual({
      subject: "Física II",
      units: [
        { title: "Electrostática", hours: 10.5 },
        { title: "Circuitos", hours: 200 },
      ],
      assessments: [
        {
          title: "Primer parcial",
          kind: "parcial",
          date: "2026-09-20",
          hours: 12,
          units: ["Electrostática"],
          weights: {},
        },
        {
          title: "Laboratorio",
          kind: "parcial",
          date: null,
          hours: 4,
          units: [],
          weights: {},
        },
      ],
    });
    expect(
      clean({ ...good, assessments: [{ ...good.assessments[0], date: "2026-02-31" }] })
        ?.assessments[0]?.date,
    ).toBeNull();
    expect(editedHours("1e309")).toBe(0);
    expect(editedHours("999")).toBe(200);
    expect(editedHours("-3")).toBe(0);
    expect(editedHours("2,5")).toBe(2.5);
    const dup = clean({
      subject: "X",
      units: [
        { title: "A", hours: 2 },
        { title: "A", hours: 9 },
      ],
      assessments: [{ title: "P", kind: "parcial", date: null, hours: 1, units: ["A", "A"] }],
    });
    expect(dup?.units).toEqual([{ title: "A", hours: 2 }]);
    expect(dup?.assessments[0]?.units).toEqual(["A"]);
    // Weights follow their unit, are kept within 0–100 and dropped when not numbers.
    const weighed = clean({
      subject: "X",
      units: [
        { title: "A", hours: 2 },
        { title: "B", hours: 2 },
        { title: "C", hours: 2 },
      ],
      assessments: [
        {
          title: "P",
          kind: "parcial",
          date: null,
          hours: 1,
          units: ["Z", "A", "B", "C"],
          weights: [5, 60, 150, "mucho"],
        },
        {
          title: "Q",
          kind: "parcial",
          date: null,
          hours: 1,
          units: ["A", "B", "C"],
          // Missing weights stay missing, never 0.
          weights: [null, "", []],
        },
      ],
    });
    expect(weighed?.assessments[0]?.weights).toEqual({ A: 60, B: 100 });
    expect(weighed?.assessments[1]?.weights).toEqual({});
    expect(clean(null)).toBeNull();
    expect(clean({})).toBeNull();
    expect(prompt(2027)).toContain("2027");
  });

  it("sends the PDF and falls back to the next model when one is busy", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push(String(url).split("/models/")[1] ?? "");
      expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("g");
      const body = JSON.parse(String(init.body));
      expect(body.contents[0].parts[0].inline_data).toEqual({
        mime_type: "application/pdf",
        data: "JVBERi0=",
      });
      expect(body.generationConfig.responseMimeType).toBe("application/json");
      return calls.length === 1 ? new Response("busy", { status: 429 }) : answer(good);
    });
    const res = await syllabus.handle(bearer("jwt", { pdf: "JVBERi0=" }), env, NOW);
    const out = await res.json();
    expect(calls).toEqual([
      "gemini-3.6-flash:generateContent",
      "gemini-3.5-flash-lite:generateContent",
    ]);
    expect(out).toMatchObject({
      ok: true,
      model: "gemini-3.5-flash-lite",
      syllabus: { subject: "Física II" },
    });
  });

  it("uses only the forced model when GEMINI_MODEL is set", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url).split("/models/")[1] ?? "");
      return new Response("busy", { status: 429 });
    });
    const res = await syllabus.handle(bearer("jwt", { pdf: "x" }), {
      ...env,
      geminiModel: "gemini-x",
    });
    expect(await res.json()).toEqual({ ok: false, error: "gemini_busy" });
    expect(calls).toEqual(["gemini-x:generateContent"]);
    vi.stubGlobal("fetch", async () => new Response("not found", { status: 404 }));
    const gone = await syllabus.handle(bearer("jwt", { pdf: "x" }), {
      ...env,
      geminiModel: "gemini-old",
    });
    expect(await gone.json()).toEqual({ ok: false, error: "model_unavailable" });
  });

  it("limits how many readings one person can ask for", async () => {
    vi.stubGlobal("fetch", async () => answer(good));
    for (let i = 0; i < 5; i++) {
      expect((await syllabus.handle(bearer("jwt", { pdf: "JVBERi0=" }), env, NOW)).status).toBe(
        200,
      );
    }
    const res = await syllabus.handle(bearer("jwt", { pdf: "JVBERi0=" }), env, NOW);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(await res.json()).toEqual({ ok: false, error: "rate_limited" });
    // Key management and refused files do not use it up.
    syllabus.reads.reset();
    for (let i = 0; i < 10; i++) await syllabus.handle(bearer("jwt", {}), env, NOW);
    expect((await syllabus.handle(bearer("jwt", { pdf: "JVBERi0=" }), env, NOW)).status).toBe(200);
  });

  it("refuses big or missing files and reports Gemini failures", async () => {
    expect((await syllabus.handle(bearer("jwt", {}), env)).status).toBe(400);
    const big = "A".repeat(4_100_000);
    expect((await syllabus.handle(bearer("jwt", { pdf: big }), env)).status).toBe(413);
    expect(
      (await syllabus.handle(bearer("jwt", { pdf: "x" }), { ...env, geminiKey: undefined })).status,
    ).toBe(503);
    vi.stubGlobal("fetch", async () => new Response("busy", { status: 503 }));
    expect(await (await syllabus.handle(bearer("jwt", { pdf: "x" }), env)).json()).toEqual({
      ok: false,
      error: "gemini_busy",
    });
    vi.stubGlobal("fetch", async () => new Response("bad key", { status: 400 }));
    expect((await syllabus.handle(bearer("jwt", { pdf: "x" }), env)).status).toBe(502);
    expect(await (await syllabus.handle(bearer("jwt", { pdf: "x" }), env)).json()).toEqual({
      ok: false,
      error: "gemini_error",
      status: 400,
    });
    vi.stubGlobal("fetch", async () =>
      Response.json({ candidates: [{ content: { parts: [{ text: "no json" }] } }] }),
    );
    expect(await (await syllabus.handle(bearer("jwt", { pdf: "x" }), env)).json()).toEqual({
      ok: false,
      error: "unreadable",
    });
  });

  it("turns the kept assessments into tasks with units", () => {
    let n = 0;
    const out = syllabusTasks({
      subject: "física ii",
      activities: [
        {
          id: "fis",
          name: "Física II",
          color: "#000",
          academic: true,
          maxSessionMinutes: 120,
          minBlockMinutes: 60,
        },
      ],
      assessments: [
        {
          title: "Parcial 1",
          kind: "parcial",
          date: "2026-09-20",
          units: [{ title: "Electro", minutes: 600 }],
          minutes: 0,
        },
        { title: "Informe", kind: "entrega", date: "2026-10-01", units: [], minutes: 240 },
      ],
      timeZone: "America/Montevideo",
      newId: () => `id${++n}`,
      color: "#fff",
    });
    expect(out.isNew).toBe(false);
    expect(out.activity.id).toBe("fis");
    const [parcial, informe] = out.tasks;
    expect(parcial).toMatchObject({
      title: "Parcial 1",
      estimateMinutes: 600,
      units: [{ title: "Electro", estimateMinutes: 600 }],
    });
    expect(new Date(parcial?.deadline ?? 0).toISOString()).toBe("2026-09-20T11:00:00.000Z");
    expect(informe).toMatchObject({ estimateMinutes: 240 });
    expect(new Date(informe?.deadline ?? 0).toISOString()).toBe("2026-10-02T02:59:00.000Z");
    const cpp = syllabusTasks({
      subject: "C++",
      activities: [
        {
          id: "c",
          name: "C",
          color: "#000",
          academic: true,
          maxSessionMinutes: 120,
          minBlockMinutes: 60,
        },
      ],
      assessments: [],
      timeZone: "America/Montevideo",
      newId: () => "cpp",
      color: "#111",
    });
    expect(cpp).toMatchObject({ isNew: true, activity: { name: "C++" } });
    const accents = syllabusTasks({
      subject: "fisica  II",
      activities: [
        {
          id: "f",
          name: "Física II",
          color: "#000",
          academic: true,
          maxSessionMinutes: 120,
          minBlockMinutes: 60,
        },
      ],
      assessments: [],
      timeZone: "America/Montevideo",
      newId: () => "x",
      color: "#111",
    });
    expect(accents.activity.id).toBe("f");
    const fresh = syllabusTasks({
      subject: "Química",
      activities: [],
      assessments: [],
      timeZone: "America/Montevideo",
      newId: () => "q",
      color: "#0f0",
    });
    expect(fresh).toMatchObject({ isNew: true, activity: { name: "Química", color: "#0f0" } });
  });
});

describe("own Gemini key", () => {
  beforeEach(() => rpc.mockResolvedValue({ data: null, error: null }));

  it("never falls back to the app's key when the user's cannot be read", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("vault down") });
    const used: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      used.push((init.headers as Record<string, string>)["x-goog-api-key"] ?? "");
      return new Response("busy", { status: 503 });
    });
    const res = await syllabus.handle(bearer("jwt", { pdf: "x" }), env);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "key_failed" });
    expect(used).toEqual([]);
  });

  it("reads syllabi with the user's own key when they have one", async () => {
    rpc.mockImplementation(async (name: string) => ({
      data: name === "get_oauth_token" ? "own-key" : null,
      error: null,
    }));
    const keys: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      keys.push((init.headers as Record<string, string>)["x-goog-api-key"] ?? "");
      return new Response("busy", { status: 503 });
    });
    await syllabus.handle(bearer("jwt", { pdf: "x" }), env);
    expect(keys.every((k) => k === "own-key")).toBe(true);
    // Their key works even when the app has none.
    const res = await syllabus.handle(bearer("jwt", { pdf: "x" }), {
      ...env,
      geminiKey: undefined,
    });
    expect(await res.json()).toEqual({ ok: false, error: "gemini_busy" });
  });

  it("checks a key with Gemini before storing it, and can remove it", async () => {
    const key = "fake-gemini-key-that-works-0001";
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) =>
      (init.headers as Record<string, string>)["x-goog-api-key"] === key
        ? Response.json({ models: [] })
        : new Response("bad", { status: 400 }),
    );
    const bad = await syllabus.handle(
      bearer("jwt", { action: "set_key", key: "fake-gemini-key-that-fails-0002" }),
      env,
    );
    expect(await bad.json()).toEqual({ ok: false, error: "invalid_key" });
    expect(rpc).not.toHaveBeenCalledWith("store_oauth_token", expect.anything());
    const junk = await syllabus.handle(bearer("jwt", { action: "set_key", key: "a b" }), env);
    expect(junk.status).toBe(400);
    // Newer keys carry a period: Gemini, not the format, decides.
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      asked.push((init.headers as Record<string, string>)["x-goog-api-key"] ?? "");
      return new Response("bad", { status: 400 });
    });
    await syllabus.handle(
      bearer("jwt", { action: "set_key", key: "AQ.fake-gemini-key-with-dot" }),
      env,
    );
    expect(asked).toEqual(["AQ.fake-gemini-key-with-dot"]);
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) =>
      (init.headers as Record<string, string>)["x-goog-api-key"] === key
        ? Response.json({ models: [] })
        : new Response("bad", { status: 400 }),
    );

    const ok = await syllabus.handle(bearer("jwt", { action: "set_key", key: ` ${key} ` }), env);
    expect(await ok.json()).toEqual({ ok: true, own: true, fallback: true });
    expect(rpc).toHaveBeenCalledWith("store_oauth_token", {
      p_user: "u1",
      p_provider: "gemini",
      p_token: key,
    });

    const status = await syllabus.handle(bearer("jwt", { action: "key_status" }), env);
    expect(await status.json()).toEqual({ ok: true, own: false, fallback: true });

    // Quota or an outage is not a bad key.
    vi.stubGlobal("fetch", async () => new Response("busy", { status: 429 }));
    const busy = await syllabus.handle(bearer("jwt", { action: "set_key", key }), env);
    expect(busy.status).toBe(503);
    expect(await busy.json()).toEqual({ ok: false, error: "gemini_busy" });

    const cleared = await syllabus.handle(bearer("jwt", { action: "clear_key" }), env);
    expect(await cleared.json()).toEqual({ ok: true, own: false, fallback: true });
    expect(rpc).toHaveBeenCalledWith("delete_oauth_token", { p_user: "u1", p_provider: "gemini" });
  });
});

describe("presupuesto de la clave de Gemini", () => {
  beforeEach(() => rpc.mockResolvedValue({ data: null, error: null }));

  it("set_key, which calls Google, is limited per user", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return new Response("bad", { status: 400 });
    });
    const set = () =>
      syllabus.handle(
        bearer("jwt", { action: "set_key", key: "fake-gemini-key-0000001" }),
        env,
        NOW,
      );
    for (let i = 0; i < 5; i++) expect((await set()).status).toBe(400);
    const sixth = await set();
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("Retry-After")).toBe("60");
    expect(await sixth.json()).toEqual({ ok: false, error: "rate_limited" });
    expect(calls).toBe(5);
    // A minute later there is room again.
    expect(
      (
        await syllabus.handle(
          bearer("jwt", { action: "set_key", key: "fake-gemini-key-0000001" }),
          env,
          NOW + 61_000,
        )
      ).status,
    ).toBe(400);
  });

  it("has a daily cap too", async () => {
    vi.stubGlobal("fetch", async () => new Response("bad", { status: 400 }));
    let refused = 0;
    for (let i = 0; i < 25; i++) {
      const res = await syllabus.handle(
        bearer("jwt", { action: "set_key", key: "fake-gemini-key-0000001" }),
        env,
        NOW + i * 61_000,
      );
      if (res.status === 429) refused++;
    }
    expect(refused).toBe(5);
  });

  it("key_status and clear_key spend a budget too", async () => {
    for (const action of ["key_status", "clear_key"]) {
      syllabus.keyCalls.reset();
      let last = 200;
      for (let i = 0; i < 40; i++) {
        last = (await syllabus.handle(bearer("jwt", { action }), env, NOW)).status;
        if (last === 429) break;
      }
      expect(last).toBe(429);
    }
  });

  it("every call to Google has a timeout", async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      signals.push(init.signal);
      return new Response("busy", { status: 503 });
    });
    await syllabus.handle(bearer("jwt", { pdf: "JVBERi0=" }), env, NOW);
    await syllabus.handle(
      bearer("jwt", { action: "set_key", key: "fake-gemini-key-0000001" }),
      env,
      NOW,
    );
    expect(signals.length).toBeGreaterThanOrEqual(3);
    expect(signals.every((s) => s instanceof AbortSignal)).toBe(true);
  });

  it("a Gemini that never answers is busy, not a crash", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    const res = await syllabus.handle(bearer("jwt", { pdf: "JVBERi0=" }), env, NOW);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "gemini_busy" });
  });
});
