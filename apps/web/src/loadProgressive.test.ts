import { describe, expect, it } from "vitest";
import { loadBounds, loadData, loadFirst, loadSpan, mergeChunk } from "./data.js";
import { demoData } from "./demo.js";
import { weekNo } from "./loadQueue.js";
import { firstSpan, weekSpan } from "./progressive.js";
import { diffData } from "./remote.js";
import { rowsClient } from "./testingRows.js";

const TZ = "America/Montevideo";
const NOW = Date.parse("2026-11-25T15:00:00Z");
const DAY = 86_400_000;

/** An account with years of history: `n` events, one every few hours from `from` on. */
function history(n: number, from: number) {
  return Array.from({ length: n }, (_, i) => {
    const start = from + i * 5 * 3_600_000;
    return {
      source: "google",
      external_id: `e${String(i).padStart(5, "0")}`,
      calendar_id: "c",
      title: `Evento ${i}`,
      start_at: new Date(start).toISOString(),
      end_at: new Date(start + 3_600_000).toISOString(),
      busy: true,
      all_day: false,
    };
  });
}

const tables = () => ({ calendar_events: history(2500, NOW - 400 * DAY) });

describe("loading in pieces", () => {
  it("opens with the reach of the planner only, and says where the data goes on", async () => {
    const { client, requests } = rowsClient(tables());
    const { data, bounds } = await loadFirst(client, firstSpan(TZ, NOW));
    const span = firstSpan(TZ, NOW);
    expect(data.events.length).toBeGreaterThan(50);
    expect(data.events.length).toBeLessThan(600);
    expect(data.events.every((e) => e.end > span.from && e.start < span.to)).toBe(true);
    if (!bounds) throw new Error("the account has events");
    expect(bounds.first).toBe(NOW - 400 * DAY);
    expect(bounds.last).toBeGreaterThan(NOW);
    // Not one request for the whole table, and none paged past the first 1000.
    expect(requests.filter((r) => r.table === "calendar_events").every((r) => r.from === 0)).toBe(
      true,
    );
  });

  it("loads a week with its two neighbours' overlap, and pages a week with more than 1000 rows", async () => {
    const busy = history(1200, NOW).map((e, i) => ({
      ...e,
      external_id: `b${i}`,
      start_at: new Date(NOW + i * 60_000).toISOString(),
      end_at: new Date(NOW + i * 60_000 + 30_000).toISOString(),
    }));
    const { client, requests } = rowsClient({ calendar_events: busy });
    const chunk = await loadSpan(client, weekSpan(TZ, weekNo("2026-11-23")));
    expect(chunk.events).toHaveLength(1200);
    expect(requests.filter((r) => r.table === "calendar_events").map((r) => r.from)).toEqual([
      0, 1000,
    ]);
  });

  it("reads the oldest and the newest instant, and nothing for an empty account", async () => {
    const full = rowsClient(tables());
    const b = await loadBounds(full.client);
    if (!b) throw new Error("the account has events");
    expect(b.first).toBeLessThan(NOW - 300 * DAY);
    expect(b.last).toBeGreaterThan(NOW);
    expect(await loadBounds(rowsClient({}).client)).toBeNull();
  });

  it("with every week in, it is the same data a whole load gives", async () => {
    const t = tables();
    const { client } = rowsClient(t);
    const whole = await loadData(client);
    const first = await loadFirst(client, firstSpan(TZ, NOW));
    let data = first.data;
    const from = weekNo("2025-10-06");
    for (let w = from; w <= weekNo("2027-05-01"); w++)
      data = mergeChunk(data, await loadSpan(client, weekSpan(TZ, w)));
    const ids = (d: typeof whole) => d.events.map((e) => e.id).sort();
    expect(whole.events).toHaveLength(2500);
    expect(ids(data)).toEqual(ids(whole));
  });
});

describe("merging a week", () => {
  const base = demoData(NOW);
  const event = (id: string, start = NOW) => ({
    id,
    title: id,
    start,
    end: start + 1,
    busy: true,
    allDay: false,
    source: "google" as const,
  });

  it("adds only what the data does not have, and twice is once", () => {
    const chunk = { events: [event("g:1"), event("g:1"), event("g:2")], overrides: [], blocks: [] };
    const once = mergeChunk(base, chunk);
    expect(once.events.length).toBe(base.events.length + 2);
    expect(mergeChunk(once, chunk)).toBe(once);
  });

  it("keeps what was edited on this device over the row that arrives", () => {
    const edited = { ...base, events: [{ ...event("g:1"), title: "cambiado acá" }] };
    const merged = mergeChunk(edited, { events: [event("g:1")], overrides: [], blocks: [] });
    expect(merged).toBe(edited);
  });

  it("brings blocks of a task that is still there under its materia, and drops those of a task that is gone", () => {
    const task = base.tasks.at(0);
    if (!task) throw new Error("the demo has tasks");
    const block = (id: string, taskId: string) => ({
      id,
      taskId,
      activityId: "",
      start: NOW,
      end: NOW + 1,
      level: "L1" as never,
      soft: false,
    });
    const merged = mergeChunk(
      { ...base, plan: [] },
      { events: [], overrides: [], blocks: [block("b1", task.id), block("b2", "gone")] },
    );
    expect(merged.plan.map((b) => [b.id, b.activityId])).toEqual([["b1", task.activityId]]);
  });

  it("never shows a week that has not come yet as deleted: the difference with the baseline stays empty", () => {
    const full = { ...base, events: [event("g:1"), event("g:2"), event("g:3", NOW - 90 * DAY)] };
    // The device holds the first part only, on screen and as its baseline.
    const stored = { ...full, events: full.events.slice(0, 1) };
    const nothingYet = diffData(stored, stored);
    expect(nothingYet.deletes).toEqual([]);
    // A week arrives in both copies at once: still nothing to write or delete.
    const chunk = { events: full.events.slice(1), overrides: [], blocks: [] };
    const [s2, l2] = [mergeChunk(stored, chunk), mergeChunk(stored, chunk)];
    const w = diffData(s2, l2);
    expect([w.deletes, w.upserts, w.inserts]).toEqual([[], [], []]);
    // An edit made while weeks are missing writes that edit only: no delete of the missing ones.
    const edited = { ...stored, settings: { ...stored.settings, wake: 480 } };
    expect(diffData(stored, edited).deletes).toEqual([]);
  });
});
