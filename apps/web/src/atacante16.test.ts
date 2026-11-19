import { describe, expect, it } from "vitest";
import { withNewerUnits } from "./components/Backup.js";
import { diffData, loadData } from "./data.js";
import { emptyData, TIMEZONE } from "./demo.js";
import { MINUTE, zonedInstant } from "./engine.js";
import type { AppData, AppTask, CheckIn } from "./model.js";
import { isUndoCopy, latestCheckIns, standingCheckIns } from "./planning.js";
import { reducer } from "./store.js";

const MON = zonedInstant(TIMEZONE, "2026-11-03", 17 * 60 + 50);
let clock = MON;
const tick = () => {
  clock += MINUTE;
  return clock;
};

const silo: AppTask = {
  id: "t",
  activityId: "calc",
  title: "Parcial",
  kind: "deliverable",
  deadline: zonedInstant(TIMEZONE, "2026-11-12", 8 * 60),
  estimateMinutes: 360,
  minMinutes: 180,
  priority: 2,
  status: "active",
  units: [
    { id: "p1", title: "P1", estimateMinutes: 120 },
    { id: "p2", title: "P2", estimateMinutes: 120 },
    { id: "p3", title: "P3", estimateMinutes: 120 },
  ],
};
const base = (task: AppTask = silo): AppData => ({
  ...emptyData(),
  preferences: { holidaysOff: false },
  activities: [
    {
      id: "calc",
      name: "Cálculo",
      color: "#f80",
      academic: true,
      maxSessionMinutes: 120,
      minBlockMinutes: 60,
    },
  ],
  tasks: [task],
});
const answer = (d: AppData, blockId: string, status: CheckIn["status"], unitIds: string[] = []) =>
  reducer(d, {
    type: "checkIn",
    checkIn: {
      blockId,
      taskId: "t",
      status,
      minutesDone: status === "missed" ? 0 : 120,
      unitIds: status === "missed" ? [] : unitIds,
    },
    now: tick(),
  });
const unit = (d: AppData, id: string) =>
  d.tasks.find((t) => t.id === "t")?.units.find((u) => u.id === id);

describe("16th round: marks by hand are not marks by a record", () => {
  it("«llevo hechos» + minutes: a later record does not reopen the topics", () => {
    const bare: AppTask = { ...silo, units: [] };
    let d = reducer(base(bare), {
      type: "logProgress",
      taskId: "t",
      minutes: 60,
      topics: 3,
      topicsDone: 2,
      now: tick(),
    });
    expect((d.tasks[0]?.units ?? []).filter((u) => u.doneAt).length).toBe(2);
    d = answer(d, "b1", "done");
    d = answer(d, "b2", "missed");
    expect((d.tasks[0]?.units ?? []).filter((u) => u.doneAt).length).toBe(2);
  });
});

describe("16th round: reopening a part never edits a record", () => {
  it("adds a correction and leaves the old records as they were", () => {
    const d1 = answer(base(), "b1", "done", ["p1", "p2"]);
    const before = JSON.stringify(d1.checkIns);
    const d2 = reducer(d1, {
      type: "logProgress",
      taskId: "t",
      minutes: 0,
      reopenUnitIds: ["p1"],
      now: tick(),
    });
    expect(unit(d2, "p1")?.doneAt).toBeUndefined();
    expect(unit(d2, "p2")?.doneAt).toBeDefined();
    expect(JSON.stringify(d2.checkIns.slice(0, d1.checkIns.length))).toBe(before);
    // A reload rebuilds the parts from what stands: p1 is still not declared.
    expect(standingCheckIns(d2).flatMap((c) => c.unitIds)).toEqual(["p2"]);
    const w = diffData(d1, d2);
    expect(w.upserts.some((u) => u.table === "check_ins")).toBe(false);
    expect(w.inserts.filter((i) => i.table === "check_ins")[0]?.rows).toHaveLength(1);
  });
});

describe("16th round: Deshacer copies are not news", () => {
  it("a copy written by undo is recognised, a real answer is not", () => {
    const d1 = answer(base(), "b1", "done", ["p1"]);
    const d2 = answer(d1, "b1", "missed");
    const d3 = reducer(d2, {
      type: "undoCheckIn",
      id: latestCheckIns(d2).get("b1")?.id ?? "",
      now: tick(),
    });
    const copy = latestCheckIns(d3).get("b1") as CheckIn;
    expect(isUndoCopy(d3, copy)).toBe(true);
    expect(isUndoCopy(d3, d3.checkIns[0] as CheckIn)).toBe(false);
    expect(isUndoCopy(d3, latestCheckIns(d2).get("b1") as CheckIn)).toBe(false);
  });
});

describe("16th round: loading past the 1000-row cap", () => {
  it("asks for the rest of check_ins by range", async () => {
    const rows = Array.from({ length: 2300 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      block_id: `b${i}`,
      task_id: "t",
      status: "done",
      minutes_done: 10,
      unit_ids: [],
      created_at: new Date(MON + i * MINUTE).toISOString(),
      block_factor: null,
    }));
    const ranges: number[] = [];
    const client = {
      from: (table: string) => ({
        select: () => {
          let range: [number, number] | undefined;
          const run = () => {
            const all = table === "check_ins" ? rows : [];
            const page = range ? all.slice(range[0], range[1] + 1) : all.slice(0, 1000);
            return Promise.resolve({ data: page, error: null });
          };
          const q = {
            order: () => q,
            range: (a: number, b: number) => {
              range = [a, b];
              if (table === "check_ins") ranges.push(a);
              return q;
            },
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
            // biome-ignore lint/suspicious/noThenProperty: a query builder is awaitable
            then: (f: (v: unknown) => unknown) => run().then(f),
          };
          return q;
        },
      }),
    };
    const data = await loadData(client as never);
    expect(data.checkIns).toHaveLength(2300);
    expect(ranges).toEqual([1000, 2000]);
  });
});

describe("16th round: importing a backup", () => {
  it("does not mark parts with a record a later correction replaced", () => {
    const d1 = answer(base(), "b1", "done", ["p1"]);
    const d2 = answer(d1, "b1", "missed");
    // The backup was taken before both; the current copy has them as newer records.
    const file = base();
    const tasks = withNewerUnits(file, d2.checkIns, d2);
    expect(tasks[0]?.units.every((u) => !u.doneAt)).toBe(true);
    // A record that stands still marks.
    const marked = withNewerUnits(file, d1.checkIns, d1);
    expect(marked[0]?.units.find((u) => u.id === "p1")?.doneAt).toBeDefined();
  });
});
