import { describe, expect, it, vi } from "vitest";
import { demoData } from "../../src/demo.js";

const writes = vi.fn();
const stored = { current: undefined as unknown };
vi.mock("../../src/data.js", async (original) => ({
  ...(await original<typeof import("../../src/data.js")>()),
  loadData: async () => stored.current,
  applyWrites: async (_client: unknown, w: unknown) => writes(w),
}));
const caller = { uid: "u1", user: {}, admin: {} };
vi.mock("./server.js", async (original) => ({
  ...(await original<typeof import("./server.js")>()),
  actAs: async () => caller,
}));
const steps = vi.hoisted(() => ({
  openGoogle: vi.fn(),
  importGoogle: vi.fn(),
  watchCalendars: vi.fn(),
  mirrorPlan: vi.fn(),
}));
vi.mock("./google-run.js", () => steps);
const icloud = vi.fn();
vi.mock("../icloud-sync.js", () => ({ syncICloudFor: (...a: unknown[]) => icloud(...a) }));

const { replan, serverSync } = await import("./replan.js");

const now = Date.UTC(2026, 10, 4, 12);
const env = { url: "u", publishable: "p", secret: "s", appUrl: "https://app" };

describe("server re-plan", () => {
  it("stores the same plan the app would compute", async () => {
    stored.current = { ...demoData(now), plan: [] };
    writes.mockClear();
    const { data } = await replan(caller as never, now);
    expect(data.plan.length).toBeGreaterThan(0);
    const w = writes.mock.calls[0]?.[0] as { upserts: { table: string }[] };
    expect(w.upserts.map((u) => u.table)).toContain("plan_blocks");
  });

  it("imports, watches, re-plans and mirrors in that order", async () => {
    stored.current = { ...demoData(now), plan: [] };
    const order: string[] = [];
    steps.openGoogle.mockImplementation(async () => {
      order.push("open");
      return { token: "t" };
    });
    steps.importGoogle.mockImplementation(async () => {
      order.push("import");
      return { calendarIds: ["a"], imported: 1 };
    });
    steps.watchCalendars.mockImplementation(async () => order.push("watch"));
    steps.mirrorPlan.mockImplementation(async () => order.push("mirror"));
    icloud.mockImplementation(async () => {
      order.push("icloud");
      return Response.json({ connected: false });
    });
    writes.mockImplementation(() => order.push("replan"));
    const r = await serverSync(env, "u1", now);
    expect(order).toEqual(["open", "import", "watch", "icloud", "replan", "mirror"]);
    expect(r).toMatchObject({ google: true, icloud: false });
  });

  it("still re-plans for iCloud-only users", async () => {
    stored.current = { ...demoData(now), plan: [] };
    steps.openGoogle.mockRejectedValue(new Error("revoked"));
    steps.mirrorPlan.mockClear();
    vi.spyOn(console, "warn").mockImplementationOnce(() => {});
    icloud.mockResolvedValue(Response.json({ connected: true }));
    const r = await serverSync({ ...env, appUrl: undefined }, "u1", now);
    expect(r).toMatchObject({ google: false, icloud: true });
    expect(steps.mirrorPlan).not.toHaveBeenCalled();
  });
});
