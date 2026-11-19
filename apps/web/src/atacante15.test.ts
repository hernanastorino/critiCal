import { describe, expect, it } from "vitest";
import { exportJson, parseBackup } from "./backup.js";
import { diffData, rowsToData } from "./data.js";
import { demoData, emptyData, TIMEZONE } from "./demo.js";
import { MINUTE, type PlanBlock, zonedInstant } from "./engine.js";
import type { AppData, AppTask, CheckIn } from "./model.js";
import { doneMinutes, progress, standingCheckIns, weekStart } from "./planning.js";
import { reducer } from "./store.js";
import { plannedVsDone } from "./week-review.js";

const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return zonedInstant(TIMEZONE, date, h * 60 + m);
};
const MON = at("2026-11-03", "17:50");

const silo: AppTask = {
  id: "t",
  activityId: "calc",
  title: "Parcial",
  kind: "deliverable",
  deadline: at("2026-11-12", "08:00"),
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

const base = (): AppData => ({
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
  tasks: [silo],
});

type Status = CheckIn["status"];
let clock = MON;
const tick = () => {
  clock += MINUTE;
  return clock;
};
const answer = (d: AppData, blockId: string, status: Status, unitIds: string[] = []) =>
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
const undo = (d: AppData, blockId: string) =>
  reducer(d, { type: "undoCheckIn", blockId, now: tick() });
const unit = (d: AppData, id: string) =>
  d.tasks.find((t) => t.id === "t")?.units.find((u) => u.id === id);
const left = (d: AppData) => progress(d, MON).find((p) => p.task.id === "t")?.remainingMinutes;

describe("15th round: the parts follow the standing record", () => {
  it("correcting «Hecho (p1)» to «No» reopens p1 and Faltan is as before", () => {
    const d0 = base();
    const before = left(d0);
    const d1 = answer(d0, "b1", "done", ["p1"]);
    expect(unit(d1, "p1")?.doneAt).toBeDefined();
    expect(left(d1)).toBeLessThan(before as number);
    const d2 = answer(d1, "b1", "missed");
    expect(unit(d2, "p1")?.doneAt).toBeUndefined();
    expect(left(d2)).toBe(before);
  });

  it("correcting «Hecho (p1)» to «Parcial (p2)» leaves p1 open and p2 marked", () => {
    const d2 = answer(answer(base(), "b1", "done", ["p1"]), "b1", "partial", ["p2"]);
    expect(unit(d2, "p1")?.doneAt).toBeUndefined();
    expect(unit(d2, "p2")?.doneAt).toBeDefined();
  });

  it("keeps a part another block's record or a manual mark still declares", () => {
    let d = answer(base(), "b2", "done", ["p1"]);
    d = answer(d, "b1", "done", ["p1", "p2"]);
    d = answer(d, "b1", "missed");
    // p1 stays: block b2 still declares it. p2 goes back.
    expect(unit(d, "p1")?.doneAt).toBeDefined();
    expect(unit(d, "p2")?.doneAt).toBeUndefined();
    // A part marked by hand in the silo is not taken by a record that named it.
    const manual: AppData = {
      ...base(),
      tasks: [{ ...silo, units: silo.units.map((u) => (u.id === "p3" ? { ...u, doneAt: 5 } : u)) }],
    };
    const e = answer(answer(manual, "b3", "done", ["p3"]), "b3", "missed");
    expect(unit(e, "p3")?.doneAt).toBe(5);
  });

  it("undoing a correction keeps what the earlier record still declares", () => {
    const d1 = answer(base(), "b1", "done", ["p1"]);
    const afterDone = left(d1);
    const d3 = undo(answer(d1, "b1", "partial", ["p1"]), "b1");
    const stands = standingCheckIns(d3).filter((c) => c.blockId === "b1");
    expect(stands.map((c) => c.status)).toEqual(["done"]);
    expect(unit(d3, "p1")?.doneAt).toBeDefined();
    expect(left(d3)).toBe(afterDone);
  });

  it("undoing the first record reopens its parts", () => {
    const d0 = base();
    const d2 = undo(answer(d0, "b1", "done", ["p1"]), "b1");
    expect(unit(d2, "p1")?.doneAt).toBeUndefined();
    expect(standingCheckIns(d2)).toHaveLength(0);
    expect(left(d2)).toBe(left(d0));
  });
});

describe("15th round: undoing only adds records", () => {
  const rows = (w: ReturnType<typeof diffData>) =>
    w.inserts.filter((i) => i.table === "check_ins").flatMap((i) => i.rows);
  /** What a reload builds from the rows, in whatever order they come back. */
  const reload = (r: Record<string, unknown>[]): CheckIn[] =>
    rowsToData({
      settings: null,
      activities: [],
      tasks: [],
      units: [],
      checkIns: [...r].reverse(),
      events: [],
      overrides: [],
      blocks: [],
    }).checkIns;

  it("undoing the first record inserts one «retired» row and never deletes", () => {
    const d1 = answer(base(), "b1", "done", ["p1"]);
    const d2 = undo(d1, "b1");
    const w = diffData(d1, d2);
    expect(w.deletes.some((x) => x.table === "check_ins")).toBe(false);
    expect(rows(w)).toHaveLength(1);
    const back = reload([...rows(diffData(base(), d1)), ...rows(w)]);
    expect(standingCheckIns({ ...d2, checkIns: back })).toHaveLength(0);
  });

  it("undoing a correction inserts a copy of the earlier record", () => {
    const d2 = answer(answer(base(), "b1", "done", ["p1"]), "b1", "missed");
    const d3 = undo(d2, "b1");
    const w = diffData(d2, d3);
    expect(w.deletes.some((x) => x.table === "check_ins")).toBe(false);
    expect(rows(w)).toHaveLength(1);
    const back = reload([...rows(diffData(base(), d2)), ...rows(w)]);
    const stands = standingCheckIns({ ...d3, checkIns: back });
    expect(stands.map((c) => [c.status, c.unitIds])).toEqual([["done", ["p1"]]]);
  });

  it("undoing twice by the same record does nothing more", () => {
    const d1 = answer(base(), "b1", "done", ["p1"]);
    const id = d1.checkIns[0]?.id;
    const d2 = reducer(d1, { type: "undoCheckIn", id, now: clock + 1 });
    expect(reducer(d2, { type: "undoCheckIn", id, now: clock + 2 })).toBe(d2);
    expect(undo(d2, "b1")).toBe(d2);
  });
});

describe("15th round: which record stands", () => {
  const rec = (id: string, createdAt: number, status: Status = "done"): CheckIn => ({
    id,
    blockId: "b1",
    taskId: "t",
    status,
    minutesDone: status === "missed" ? 0 : 60,
    unitIds: [],
    createdAt,
  });

  it("is the newest by date even when the array is out of order", () => {
    const d = { ...base(), checkIns: [rec("new", 20, "missed"), rec("old", 10, "done")] };
    expect(standingCheckIns(d).map((c) => c.id)).toEqual(["new"]);
  });

  it("breaks a tie by id", () => {
    const d = { ...base(), checkIns: [rec("b", 10), rec("a", 10, "missed")] };
    expect(standingCheckIns(d).map((c) => c.id)).toEqual(["b"]);
  });
});

describe("15th round: a block belongs to the week it was planned in", () => {
  const block = {
    id: "old",
    taskId: "t",
    activityId: "calc",
    start: at("2026-10-30", "10:00"),
    end: at("2026-10-30", "12:00"),
  } as PlanBlock;

  it("correcting last week's block does not add to this week", () => {
    const d = { ...answer(base(), "old", "done", ["p1"]), plan: [block] };
    const since = zonedInstant(TIMEZONE, weekStart(TIMEZONE, MON), 0);
    expect(doneMinutes(d, "t", since)).toBe(0);
    expect(doneMinutes(d, "t", block.start)).toBe(120);
    const row = plannedVsDone(d, MON).find((r) => r.taskId === "t");
    expect(row?.done ?? 0).toBe(0);
  });
});

describe("15th round: the backup keeps corrections and retired records", () => {
  it("round-trips them and the same records stand", () => {
    const demo = demoData(MON);
    const full = {
      ...demo,
      tasks: [{ ...silo, activityId: demo.activities[0]?.id ?? "" }, ...demo.tasks],
    };
    let d = answer(answer(full, "b1", "done", ["p1"]), "b1", "partial", ["p2"]);
    d = undo(answer(d, "b2", "done", ["p3"]), "b2");
    const back = parseBackup(exportJson(d, clock));
    if ("error" in back) throw new Error(back.error);
    expect(back.data.checkIns.map((c) => c.status)).toEqual(d.checkIns.map((c) => c.status));
    expect(standingCheckIns(back.data).map((c) => c.status)).toEqual(["partial"]);
    expect(
      back.data.tasks.find((t) => t.title === "Parcial")?.units.map((u) => u.doneAt !== undefined),
    ).toEqual([false, true, false]);
  });
});
