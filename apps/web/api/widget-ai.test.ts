import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoData } from "../src/demo.js";
import { clean, editedHours, prompt, syllabusTasks } from "../src/syllabus.js";

const rpc = vi.fn();
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
    rpc,
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

  it("skips silos with nothing to do", () => {
    const data = demoData(NOW);
    expect(widgetSilos(data, NOW).every((s) => s.totalMinutes > 0)).toBe(true);
  });
});

describe("syllabus", () => {
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
        },
        { title: "Laboratorio", kind: "parcial", date: null, hours: 4, units: [] },
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
