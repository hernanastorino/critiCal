import { describe, expect, it, vi } from "vitest";
import { demoData } from "./demo.js";
import { applyWrites, diffData, loadData, rowsToData, syncGoogle, syncICloud } from "./remote.js";
import { session, stubApi } from "./testing.js";

const NOW = Date.UTC(2026, 10, 2, 20, 50);

function fakeClient(tables: Record<string, unknown[]>, settings: unknown = null) {
  const calls: { op: string; table: string; payload?: unknown }[] = [];
  const builder = (table: string) => ({
    select: () =>
      Object.assign(Promise.resolve({ data: tables[table] ?? [], error: null }), {
        maybeSingle: () => Promise.resolve({ data: settings, error: null }),
      }),
    upsert: (rows: unknown) => {
      calls.push({ op: "upsert", table, payload: rows });
      return Promise.resolve({ error: null });
    },
    insert: (rows: unknown) => {
      calls.push({ op: "insert", table, payload: rows });
      return Promise.resolve({ error: null });
    },
    delete: () => ({
      in: (_col: string, ids: unknown) => {
        calls.push({ op: "delete", table, payload: ids });
        return Promise.resolve({ error: null });
      },
    }),
  });
  const client = {
    from: builder,
    auth: session,
    invoke: vi.fn(async () => ({ data: { connected: true }, error: null })),
  };
  stubApi(client.invoke);
  return { client: client as never, calls, invoke: client.invoke };
}

describe("sync calls", () => {
  it("calls the site's sync functions with the user's token", async () => {
    const client = { auth: session } as never;
    const fetchMock = vi.fn(async () => Response.json({ connected: true, imported: 5 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await syncICloud(client, { action: "disconnect" })).toEqual({
      connected: true,
      imported: 5,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/icloud-sync",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
      }),
    );

    vi.stubGlobal("fetch", async () => new Response("oops", { status: 500 }));
    expect(await syncICloud(client)).toEqual({
      connected: false,
      error: "sync_failed",
      status: 500,
    });
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("offline");
    });
    expect(await syncICloud(client)).toEqual({ connected: false, error: "unreachable" });
    const signedOut = { auth: { getSession: async () => ({ data: { session: null } }) } } as never;
    expect(await syncICloud(signedOut)).toEqual({ connected: false, error: "unauthorized" });
    vi.unstubAllGlobals();
  });
});

describe("remote", () => {
  it("round-trips rows into app data", () => {
    const data = rowsToData({
      settings: { data: { warnSlackMinutes: 100 }, state: { freeTimeUntil: 5 } },
      activities: [
        {
          id: "a",
          name: "Mate",
          color: "#f80",
          academic: true,
          max_session_minutes: 90,
          min_block_minutes: 60,
          preferred_start: 480,
          preferred_end: 720,
        },
      ],
      tasks: [
        {
          id: "t",
          activity_id: "a",
          title: "P",
          kind: "deliverable",
          deadline: "2026-11-05T11:00:00Z",
          estimate_minutes: 300,
          min_minutes: 120,
          priority: 2,
          status: "active",
        },
      ],
      units: [
        { id: "u2", task_id: "t", title: "B", estimate_minutes: 60, position: 1 },
        {
          id: "u1",
          task_id: "t",
          title: "A",
          estimate_minutes: 60,
          position: 0,
          done_at: "2026-11-02T10:00:00Z",
        },
      ],
      checkIns: [
        {
          id: "c",
          block_id: "b",
          task_id: "t",
          status: "done",
          minutes_done: 60,
          unit_ids: ["u1"],
          created_at: "2026-11-02T10:00:00Z",
        },
      ],
      events: [
        {
          source: "google",
          external_id: "cal|e",
          title: "Clase",
          start_at: "2026-11-03T12:00:00Z",
          end_at: "2026-11-03T14:00:00Z",
          busy: true,
          all_day: false,
          link: "https://x",
        },
      ],
      overrides: [{ date: "2026-11-02", wake: 600, bed: null }],
      blocks: [
        {
          id: "b",
          task_id: "t",
          start_at: "2026-11-02T12:00:00Z",
          end_at: "2026-11-02T13:00:00Z",
          level: "critical",
          soft: false,
        },
      ],
    });
    expect(data.settings.warnSlackMinutes).toBe(100);
    expect(data.settings.timezone).toBe("America/Montevideo");
    expect(data.freeTimeUntil).toBe(5);
    expect(data.activities[0]?.preferred).toEqual({ start: 480, end: 720 });
    expect(data.tasks[0]?.units.map((u) => u.id)).toEqual(["u1", "u2"]);
    expect(data.events[0]).toMatchObject({ id: "google:cal|e", link: "https://x" });
    expect(data.plan[0]).toMatchObject({ activityId: "a", level: "critical" });
    expect(data.overrides[0]).toEqual({ date: "2026-11-02", wake: 600, bed: undefined });
  });

  it("writes only what changed, parents first", async () => {
    const prev = demoData(NOW);
    const next = {
      ...prev,
      freeTimeUntil: 1,
      tasks: prev.tasks.map((t, i) =>
        i === 0 ? { ...t, title: "Cambiado", units: t.units.slice(1) } : t,
      ),
      checkIns: [
        {
          id: "c",
          blockId: "b",
          taskId: "gym",
          status: "done" as const,
          minutesDone: 90,
          unitIds: [],
          createdAt: NOW,
        },
      ],
      overrides: [{ date: "2026-11-02", wake: 600 }],
      plan: [
        {
          id: "b1",
          taskId: "gym",
          activityId: "gym",
          start: NOW,
          end: NOW + 3_600_000,
          level: "ok" as const,
        },
      ],
    };
    const w = diffData(
      { ...prev, plan: [{ id: "old", taskId: "gym", activityId: "gym", start: 0, end: 1 }] },
      next,
    );
    expect(w.upserts.map((u) => u.table)).toEqual([
      "settings",
      "tasks",
      "task_units",
      "day_overrides",
      "plan_blocks",
    ]);
    expect(w.upserts.find((u) => u.table === "tasks")?.rows).toHaveLength(1);
    expect(w.deletes).toEqual([
      { table: "task_units", ids: ["u1"] },
      { table: "plan_blocks", ids: ["old"] },
    ]);
    expect(w.inserts[0]?.rows[0]).toMatchObject({ id: "c", minutes_done: 90 });
    expect(diffData(prev, prev)).toEqual({ upserts: [], inserts: [], deletes: [] });

    const withActivity = {
      ...prev,
      activities: [
        ...prev.activities,
        { ...prev.activities[0], id: "z" } as (typeof prev.activities)[number],
      ],
    };
    expect(diffData(prev, withActivity).upserts[0]?.table).toBe("activities");

    const { client, calls } = fakeClient({});
    await applyWrites(client, w);
    expect(calls.map((c) => `${c.op}:${c.table}`)).toEqual([
      "upsert:settings",
      "upsert:tasks",
      "upsert:task_units",
      "upsert:day_overrides",
      "upsert:plan_blocks",
      "upsert:check_ins",
      "delete:task_units",
      "delete:plan_blocks",
    ]);
  });

  it("loads all tables and calls the sync function", async () => {
    const { client, invoke } = fakeClient({ activities: [], tasks: [] }, { data: {}, state: {} });
    const data = await loadData(client);
    expect(data.tasks).toEqual([]);
    const session = { provider_refresh_token: "r" } as never;
    const [a, b] = await Promise.all([syncGoogle(client, session), syncGoogle(client, session)]);
    expect(a).toBe(b);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("google-sync", { body: { refreshToken: "r" } });
    await syncGoogle(client, session);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("fails rather than falling back to default settings", async () => {
    const boom = new Error("settings unreadable");
    const client = {
      from: () => ({
        select: () =>
          Object.assign(Promise.resolve({ data: [], error: null }), {
            maybeSingle: () => Promise.resolve({ data: null, error: boom }),
          }),
      }),
    };
    await expect(loadData(client as never)).rejects.toBe(boom);
  });
});
