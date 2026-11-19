import { describe, expect, it } from "vitest";
import { exportJson, parseBackup } from "./backup.js";
import { importCandidate } from "./components/Backup.js";
import { diffData, rowsToData } from "./data.js";
import { demoData, TIMEZONE } from "./demo.js";
import { MINUTE, zonedInstant } from "./engine.js";
import type { AppData, AppTask, CheckIn } from "./model.js";
import { isUndoCopy, latestCheckIns, standingCheckIns } from "./planning.js";
import { refresh } from "./refresh.js";
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
/** The demo (a backup it can parse) with the Parcial silo added to its first materia. */
const base = (task: AppTask = silo): AppData => {
  const demo = demoData(MON);
  return {
    ...demo,
    preferences: { holidaysOff: false },
    tasks: [{ ...task, activityId: demo.activities[0]?.id ?? "" }],
    checkIns: [],
    plan: [],
    pins: [],
  };
};
const answer = (
  d: AppData,
  blockId: string,
  status: CheckIn["status"],
  unitIds: string[] = [],
  now = tick(),
) =>
  reducer(d, {
    type: "checkIn",
    checkIn: {
      blockId,
      taskId: "t",
      status,
      minutesDone: status === "missed" ? 0 : 120,
      unitIds: status === "missed" ? [] : unitIds,
    },
    now,
  });
const unit = (d: AppData, id: string) =>
  d.tasks.find((t) => t.id === "t")?.units.find((u) => u.id === id);
const doneIds = (d: AppData) =>
  (d.tasks.find((t) => t.id === "t")?.units ?? []).filter((u) => u.doneAt).map((u) => u.id);
const parsed = (text: string) => {
  const p = parseBackup(text);
  if ("error" in p) throw new Error(p.error);
  return p.data;
};
/** A part marked by hand, as the silo form writes it. */
const handMarked = (d: AppData, id: string): AppData => ({
  ...d,
  tasks: d.tasks.map((t) => ({
    ...t,
    units: t.units.map((u) => (u.id === id ? { ...u, doneAt: MON, doneByHand: true } : u)),
  })),
});

/** What the Backup screen stores after importing `file` over `current`. */
const imported = (file: AppData, current: AppData, now: number) =>
  refresh(importCandidate(file, current), now);

describe("17th round: a part is done by hand or declared by a record", () => {
  it("the attacker's case: R1 Hecho p1 → export → correct to No → import: p1 stays open", () => {
    const d1 = answer(base(), "b1", "done", ["p1"]);
    expect(doneIds(d1)).toEqual(["p1"]);
    const file = parsed(exportJson(d1, clock));
    const d2 = answer(d1, "b1", "missed");
    expect(doneIds(d2)).toEqual([]);
    const d3 = imported(file, d2, clock);
    expect(doneIds(d3)).toEqual([]);
    // Stable after another record: p1 does not come back nor go away on its own.
    const d4 = answer(d3, "b2", "done", ["p2"]);
    expect(doneIds(d4)).toEqual(["p2"]);
    const d5 = answer(d4, "b3", "missed");
    expect(doneIds(d5)).toEqual(["p2"]);
  });

  it("an import marks the hand marks of the file plus what the standing records declare", () => {
    const d0 = handMarked(base(), "p3");
    const file = parsed(exportJson(d0, clock));
    const d1 = answer(d0, "b1", "done", ["p1"]);
    const out = imported(file, d1, clock);
    expect(doneIds(out).sort()).toEqual(["p1", "p3"]);
    expect(unit(out, "p3")?.doneByHand).toBe(true);
  });

  it("a hand mark and a record in the same millisecond do not get mixed", () => {
    const at = tick();
    let d = handMarked(base(), "p1");
    d = answer(d, "b1", "done", ["p1"], at);
    d = answer(d, "b1", "missed", [], at + 1);
    expect(doneIds(d)).toEqual(["p1"]);
    // Also when the mark carries the very date of the record.
    let e: AppData = base();
    e = {
      ...e,
      tasks: e.tasks.map((t) => ({
        ...t,
        units: t.units.map((u) => (u.id === "p2" ? { ...u, doneAt: at + 5, doneByHand: true } : u)),
      })),
    };
    e = answer(e, "b1", "done", ["p2"], at + 5);
    e = answer(e, "b1", "missed", [], at + 9);
    expect(doneIds(e)).toEqual(["p2"]);
  });

  it("an old backup (no field) reads with the migration rule; a new one keeps the field", () => {
    const withHand = handMarked(answer(base(), "b1", "done", ["p1"]), "p3");
    const text = exportJson(withHand, clock);
    const fresh = parsed(text);
    expect(unit(fresh, "p3")?.doneByHand).toBe(true);
    expect(unit(fresh, "p1")?.doneByHand).not.toBe(true);
    // The same file as an old version wrote it: no unit carries the field.
    const old = JSON.parse(text);
    for (const t of old.data.tasks) for (const u of t.units) delete u.doneByHand;
    const legacy = parsed(JSON.stringify(old));
    expect(unit(legacy, "p3")?.doneByHand).toBe(true);
    expect(unit(legacy, "p3")?.doneAt).toBe(MON);
    expect(unit(legacy, "p1")?.doneByHand).not.toBe(true);
    expect(unit(legacy, "p1")?.doneAt).toBeDefined();
    // Correcting the record afterwards reopens p1 and never p3.
    expect(doneIds(answer(legacy, "b1", "missed"))).toEqual(["p3"]);
  });

  it("a reload from rows keeps what was marked how", () => {
    const withHand = handMarked(answer(base(), "b1", "done", ["p1"]), "p3");
    const w = diffData(base(), withHand);
    const rows = (table: string) => [
      ...w.upserts.filter((u) => u.table === table).flatMap((u) => u.rows),
      ...w.inserts.filter((u) => u.table === table).flatMap((u) => u.rows),
    ];
    const unitRows = rows("task_units");
    expect(unitRows.find((r) => r.id === "p3")?.done_by_hand).toBe(true);
    expect(unitRows.find((r) => r.id === "p1")?.done_by_hand).toBe(false);
    const back = rowsToData({
      settings: null,
      activities: [],
      tasks: rows("tasks"),
      units: unitRows,
      checkIns: rows("check_ins"),
      events: [],
      overrides: [],
      blocks: [],
    });
    const task = back.tasks.find((t) => t.id === "t");
    expect(task?.units.find((u) => u.id === "p3")?.doneByHand).toBe(true);
    expect(task?.units.find((u) => u.id === "p1")?.doneByHand).not.toBe(true);
    // And a correction afterwards leaves p3 and reopens p1.
    const settled = refresh({ ...base(), tasks: back.tasks, checkIns: back.checkIns }, clock);
    expect(doneIds(answer(settled, "b1", "missed"))).toEqual(["p3"]);
  });

  it("reopening from the silo takes the hand mark away; a record that declares it gets a correction", () => {
    const d1 = answer(base(), "b1", "done", ["p1"]);
    const marked: AppData = {
      ...d1,
      tasks: d1.tasks.map((t) => ({
        ...t,
        units: t.units.map((u) => (u.id === "p1" ? { ...u, doneByHand: true } : u)),
      })),
    };
    const d2 = reducer(marked, {
      type: "logProgress",
      taskId: "t",
      minutes: 0,
      reopenUnitIds: ["p1"],
      now: tick(),
    });
    expect(unit(d2, "p1")?.doneAt).toBeUndefined();
    expect(unit(d2, "p1")?.doneByHand).not.toBe(true);
    expect(standingCheckIns(d2).flatMap((c) => c.unitIds)).toEqual([]);
    expect(d2.checkIns.length).toBe(d1.checkIns.length + 1);
  });

  it("the visible date is the oldest record that declares it", () => {
    const at1 = tick();
    let d = answer(base(), "b1", "done", ["p1"], at1);
    d = answer(d, "b2", "done", ["p1"], tick());
    expect(unit(d, "p1")?.doneAt).toBe(at1);
  });
});

describe("17th round: a copy of «Deshacer» is told by its mark", () => {
  it("undo writes origin «undo»; the same answer repeated by hand is news", () => {
    const d1 = answer(base(), "b1", "done", ["p1"]);
    const d2 = answer(d1, "b1", "missed");
    const d3 = reducer(d2, {
      type: "undoCheckIn",
      id: latestCheckIns(d2).get("b1")?.id ?? "",
      now: tick(),
    });
    const copy = d3.checkIns.at(-1) as CheckIn;
    expect(copy.origin).toBe("undo");
    expect(isUndoCopy(d3, copy)).toBe(true);
    // Same status, minutes and parts as an earlier one, written by hand: it celebrates.
    const d4 = answer(d3, "b1", "done", ["p1"]);
    const again = d4.checkIns.at(-1) as CheckIn;
    expect(again.origin).toBeUndefined();
    expect(isUndoCopy(d4, again)).toBe(false);
  });

  it("origin travels to the database and back", () => {
    const d1 = answer(base(), "b1", "done", ["p1"]);
    const d2 = reducer(d1, {
      type: "undoCheckIn",
      id: latestCheckIns(d1).get("b1")?.id ?? "",
      now: tick(),
    });
    const w = diffData(base(), d2);
    const rows = w.inserts.filter((i) => i.table === "check_ins").flatMap((i) => i.rows);
    expect(rows.map((r) => r.origin)).toEqual([null, "undo"]);
    const back = rowsToData({
      settings: null,
      activities: [],
      tasks: [],
      units: [],
      checkIns: rows,
      events: [],
      overrides: [],
      blocks: [],
    });
    expect(back.checkIns.map((c) => c.origin)).toEqual([undefined, "undo"]);
  });
});
