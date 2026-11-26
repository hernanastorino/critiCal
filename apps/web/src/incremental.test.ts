import { describe, expect, it } from "vitest";
import { applyChanges, loadData, loadSince, OVERLAP_MS, rowsToData, serverNow } from "./data.js";
import { rowsClient } from "./testingRows.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-25T15:00:00Z");
const iso = (t: number) => new Date(t).toISOString();

const event = (i: number, updated = NOW - 30 * DAY, title = `Evento ${i}`) => ({
  source: "google",
  external_id: `e${String(i).padStart(5, "0")}`,
  calendar_id: "c",
  title,
  start_at: iso(NOW - 300 * DAY + i * 3_600_000 * 5),
  end_at: iso(NOW - 300 * DAY + i * 3_600_000 * 5 + 3_600_000),
  busy: true,
  all_day: false,
  updated_at: iso(updated),
});

const block = (id: string, taskId: string, updated = NOW - 30 * DAY) => ({
  id,
  task_id: taskId,
  start_at: iso(NOW + DAY),
  end_at: iso(NOW + DAY + 3_600_000),
  level: "ok",
  soft: false,
  review: false,
  updated_at: iso(updated),
});

const activity = (id: string) => ({
  id,
  name: "Física",
  color: "#fff",
  academic: true,
  max_session_minutes: 90,
  min_block_minutes: 30,
});
const task = (id: string, activityId: string) => ({
  id,
  activity_id: activityId,
  title: "Parcial",
  kind: "deliverable",
  estimate_minutes: 60,
  min_minutes: 30,
  priority: 1,
  status: "active",
});
const checkIn = (id: string, received: number) => ({
  id,
  block_id: "b1",
  task_id: "t1",
  status: "done",
  minutes_done: 30,
  unit_ids: [],
  created_at: iso(received),
  received_at: iso(received),
});

function world() {
  return {
    activities: [activity("a1"), activity("a2")],
    tasks: [task("t1", "a1")],
    calendar_events: Array.from({ length: 2500 }, (_, i) => event(i)),
    plan_blocks: [block("b1", "t1"), block("b2", "t1")],
    day_overrides: [{ date: "2026-11-20", wake: 420, bed: 1380, updated_at: iso(NOW - 5 * DAY) }],
    check_ins: [checkIn("c1", NOW - 20 * DAY)],
    deleted_rows: [] as Record<string, unknown>[],
  };
}

describe("loading only what changed", () => {
  it("brings the same data a whole load would, asking for little", async () => {
    const tables = world();
    const first = rowsClient(tables, { serverNow: () => NOW });
    const base = await loadData(first.client);
    const since = await serverNow(first.client);

    // Later, on the server: an event edited, one new, one gone, a block moved, a check-in.
    const later = NOW + 10 * 60_000;
    tables.calendar_events[3] = event(3, later, "Evento 3 cambiado");
    tables.calendar_events.push(event(2500, later));
    const gone = tables.calendar_events.splice(10, 1).at(0);
    if (!gone) throw new Error("the world has events");
    tables.plan_blocks[0] = { ...block("b1", "t1", later), soft: true };
    tables.plan_blocks.splice(1, 1);
    tables.check_ins.push(checkIn("c2", later));
    tables.deleted_rows.push(
      {
        user_id: "u",
        table_name: "calendar_events",
        row_key: `google:${gone.external_id}`,
        deleted_at: iso(later),
      },
      { user_id: "u", table_name: "plan_blocks", row_key: "b2", deleted_at: iso(later) },
    );

    const { client, requests } = rowsClient(tables);
    const fresh = await loadSince(client, base, since);
    const whole = await loadData(rowsClient(tables).client);

    const ids = (d: typeof whole) => ({
      events: d.events.map((e) => `${e.id}|${e.title}`).sort(),
      plan: d.plan.map((b) => `${b.id}|${b.soft}`).sort(),
      checkIns: d.checkIns.map((c) => c.id).sort(),
    });
    expect(ids(fresh)).toEqual(ids(whole));
    expect(fresh.events).toHaveLength(2500);
    // Only the changed rows came: no page past the first, and few rows of the big table.
    const eventRows = requests.filter((r) => r.table === "calendar_events");
    expect(eventRows.every((r) => r.from === 0)).toBe(true);
    expect(eventRows.reduce((n, r) => n + r.rows, 0)).toBe(2);
    expect(requests.filter((r) => r.table === "check_ins").reduce((n, r) => n + r.rows, 0)).toBe(1);
  });

  it("asks from a little before the mark, so a slow write is not missed", async () => {
    const tables = world();
    const since = NOW;
    tables.calendar_events[0] = event(0, since - OVERLAP_MS + 1_000, "dentro del margen");
    tables.calendar_events[1] = event(1, since - OVERLAP_MS - 1_000, "fuera del margen");
    const { client, requests } = rowsClient(tables);
    const base = rowsToData({
      settings: null,
      activities: [],
      tasks: [],
      units: [],
      checkIns: [],
      events: [],
      overrides: [],
      blocks: [],
    });
    const fresh = await loadSince(client, base, since);
    expect(fresh.events.map((e) => e.title)).toEqual(["dentro del margen"]);
    expect(requests.some((r) => r.table === "calendar_events" && r.filters["gt:updated_at"])).toBe(
      true,
    );
  });

  it("pages a big batch of changes", async () => {
    const tables = world();
    tables.calendar_events = tables.calendar_events.map((e) => ({
      ...e,
      updated_at: iso(NOW + 1),
    }));
    const { client, requests } = rowsClient(tables);
    const base = rowsToData({
      settings: null,
      activities: [],
      tasks: [],
      units: [],
      checkIns: [],
      events: [],
      overrides: [],
      blocks: [],
    });
    const fresh = await loadSince(client, base, NOW);
    expect(fresh.events).toHaveLength(2500);
    expect(requests.filter((r) => r.table === "calendar_events").map((r) => r.from)).toEqual([
      0, 1000, 2000,
    ]);
  });

  it("reads the server's clock, and refuses an answer that is not a time", async () => {
    expect(await serverNow(rowsClient({}, { serverNow: () => NOW }).client)).toBe(NOW);
    await expect(
      serverNow(rowsClient({}, { rpcError: new Error("no function") }).client),
    ).rejects.toThrow();
  });
});

describe("applyChanges", () => {
  const empty = rowsToData({
    settings: null,
    activities: [],
    tasks: [],
    units: [],
    checkIns: [],
    events: [],
    overrides: [],
    blocks: [],
  });
  const withEvents = (rows: ReturnType<typeof event>[]) => ({
    ...empty,
    events: rowsToData({ ...emptyRows, events: rows }).events,
  });
  const emptyRows = {
    settings: null,
    activities: [],
    tasks: [],
    units: [],
    checkIns: [],
    events: [],
    overrides: [],
    blocks: [],
  };
  const part = (rows: ReturnType<typeof event>[]) => withEvents(rows);

  it("replaces a changed row where it stood and adds a new one last", () => {
    const base = withEvents([event(1), event(2), event(3)]);
    const next = applyChanges(base, part([event(2, NOW, "nuevo título"), event(9)]), []);
    expect(next.events.map((e) => e.title)).toEqual([
      "Evento 1",
      "nuevo título",
      "Evento 3",
      "Evento 9",
    ]);
  });

  it("takes out what a tombstone says, but not a row that exists again", () => {
    const base = withEvents([event(1), event(2), event(3)]);
    const gone = [
      { table_name: "calendar_events", row_key: "google:e00001" },
      { table_name: "calendar_events", row_key: "google:e00002" },
      { table_name: "plan_blocks", row_key: "google:e00003" },
    ];
    const next = applyChanges(base, part([event(2, NOW)]), gone);
    expect(next.events.map((e) => e.id)).toEqual(["google:e00002", "google:e00003"]);
  });

  it("is the same twice", () => {
    const base = withEvents([event(1)]);
    const changed = part([event(1, NOW, "x"), event(2)]);
    const once = applyChanges(base, changed, []);
    expect(applyChanges(once, changed, []).events).toEqual(once.events);
  });

  it("puts the blocks under the materia their task has now, and keeps the log in order", () => {
    const rows = {
      ...emptyRows,
      activities: [activity("a1"), activity("a2")],
      tasks: [task("t1", "a2")],
      blocks: [block("b1", "t1")],
      checkIns: [checkIn("c2", NOW), checkIn("c1", NOW - DAY)],
    };
    const changed = rowsToData(rows);
    const old = rowsToData({
      ...rows,
      tasks: [task("t1", "a1")],
      blocks: [block("b1", "t1"), block("b0", "t1")],
      checkIns: [],
    });
    const next = applyChanges(old, changed, []);
    expect(next.plan.map((b) => [b.id, b.activityId])).toEqual([
      ["b1", "a2"],
      ["b0", "a2"],
    ]);
    expect(next.checkIns.map((c) => c.id)).toEqual(["c1", "c2"]);
  });
});
