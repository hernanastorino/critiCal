import { describe, expect, it } from "vitest";
import { exportJson, parseBackup } from "./backup.js";
import { importCandidate } from "./components/Backup.js";
import { PLAN_KEYS, SORT_KEYS } from "./components/useUndoable.js";
import { diffData } from "./data.js";
import { demoData, TIMEZONE } from "./demo.js";
import { MINUTE, zonedInstant } from "./engine.js";
import type { AppData, AppTask } from "./model.js";
import { refresh } from "./refresh.js";
import { type Action, reducer, settleSnapshot, snapshotOf } from "./store.js";

const MON = zonedInstant(TIMEZONE, "2026-11-03", 17 * 60 + 50);
let clock = MON;
const tick = () => {
  clock += MINUTE;
  return clock;
};

type Doing = Action extends infer A ? (A extends { now: number } ? Omit<A, "now"> : never) : never;
const run = (d: AppData, a: Doing): AppData => reducer(d, { ...a, now: tick() } as Action);

/** What the notice does: the answer, and the snapshot the «Deshacer» will put back. */
const undoable = (
  d: AppData,
  doing: Doing,
  keys: readonly (keyof AppData)[],
  tasks: readonly AppTask[] = [],
) => {
  const before = snapshotOf(d, keys, tasks);
  const after = run(d, doing);
  settleSnapshot(before, after);
  return { after, undo: (cur: AppData) => run(cur, { type: "restoreState", before }) };
};

const silo = (id: string, activityId: string, title = id): AppTask => ({
  id,
  activityId,
  title,
  kind: "deliverable",
  deadline: zonedInstant(TIMEZONE, "2026-11-12", 8 * 60),
  estimateMinutes: 240,
  minMinutes: 120,
  priority: 2,
  status: "active",
  units: [],
});

const start = (): AppData => {
  const demo = demoData(MON);
  const d = {
    ...demo,
    preferences: { holidaysOff: false },
    tasks: [silo("a", "calc", "Parcial A"), silo("b", "fis", "Parcial B")],
    checkIns: [],
    plan: [],
    pins: [],
    applied: [],
  };
  return refresh(d, MON);
};
const need = <T>(x: T | null | undefined): T => {
  if (x === null || x === undefined) throw new Error("missing");
  return x;
};
const blockOf = (d: AppData, taskId: string) => need(d.plan.find((b) => b.taskId === taskId));
const answer = (d: AppData, taskId: string, blockId: string) =>
  run(d, {
    type: "checkIn",
    checkIn: { blockId, taskId, status: "done", minutesDone: 60, unitIds: [] },
  });

describe("18th round: «Deshacer» puts back only what the answer touched", () => {
  it("deleting a silo: what was done in between stays, the silo and its records come back", () => {
    let d = start();
    d = answer(d, "a", blockOf(d, "a").id);
    const mine = d.checkIns.filter((c) => c.taskId === "a");
    expect(mine).toHaveLength(1);
    const gone = undoable(
      d,
      { type: "recurrence", taskId: "a", change: "deleteAll" },
      ["tasks", "checkIns", "plan", "pins", "applied"],
      [need(d.tasks.find((t) => t.id === "a"))],
    );
    expect(gone.after.tasks.some((t) => t.id === "a")).toBe(false);
    // In between: a new silo, a record of another block, an edit of another silo.
    let mid = run(gone.after, { type: "saveTask", task: silo("n", "fis", "Nueva") });
    mid = answer(mid, "b", blockOf(mid, "b").id);
    const edited = need(mid.tasks.find((t) => t.id === "b"));
    mid = run(mid, { type: "saveTask", task: { ...edited, title: "Parcial B2" } });
    const back = gone.undo(mid);
    expect(back.tasks.map((t) => t.id).sort()).toEqual(["a", "b", "n"]);
    expect(back.tasks.find((t) => t.id === "b")?.title).toBe("Parcial B2");
    expect(back.checkIns.filter((c) => c.taskId === "a")).toEqual(mine);
    expect(back.checkIns.filter((c) => c.taskId === "b")).toHaveLength(1);
    // Nothing of the middle is lost, in memory or in what would be saved.
    expect(back.plan.some((b) => b.taskId === "n")).toBe(true);
    const w = diffData(mid, back);
    expect(w.deletes.filter((x) => x.table !== "plan_blocks")).toEqual([]);
  });

  it("«Eliminar de hoy en adelante» then another silo edited: both stand", () => {
    let d = start();
    const a = need(d.tasks.find((t) => t.id === "a"));
    const gone = undoable(
      d,
      { type: "recurrence", taskId: "a", change: "endFromToday" },
      ["tasks", "checkIns", "plan", "pins", "applied"],
      [a],
    );
    d = gone.after;
    const b = need(d.tasks.find((t) => t.id === "b"));
    d = run(d, { type: "saveTask", task: { ...b, estimateMinutes: 300 } });
    const back = gone.undo(d);
    expect(back.tasks.find((t) => t.id === "a")?.status).toBe("active");
    expect(back.tasks.find((t) => t.id === "b")?.estimateMinutes).toBe(300);
  });

  it("Ignorar: what was added or edited since stays, the ignored one is back", () => {
    let d = start();
    const a = need(d.tasks.find((t) => t.id === "a"));
    d = { ...d, tasks: d.tasks.map((t) => (t.id === "a" ? { ...t, needsReview: true } : t)) };
    const ignored = undoable(d, { type: "review", taskId: "a", keep: false }, PLAN_KEYS, [
      need(d.tasks.find((t) => t.id === "a")),
    ]);
    expect(ignored.after.tasks.find((t) => t.id === a.id)?.status).toBe("dropped");
    let mid = run(ignored.after, { type: "saveTask", task: silo("n", "fis", "Nueva") });
    const b = need(mid.tasks.find((t) => t.id === "b"));
    mid = run(mid, { type: "saveTask", task: { ...b, title: "Otro nombre" } });
    const back = ignored.undo(mid);
    expect(back.tasks.find((t) => t.id === "a")?.status).toBe("active");
    expect(back.tasks.find((t) => t.id === "a")?.needsReview).toBe(true);
    expect(back.tasks.find((t) => t.id === "n")).toBeDefined();
    expect(back.plan.some((b) => b.taskId === "n")).toBe(true);
    expect(back.tasks.find((t) => t.id === "b")?.title).toBe("Otro nombre");
  });

  it("an edit of the same task after the answer is not overwritten", () => {
    let d = start();
    d = { ...d, tasks: d.tasks.map((t) => (t.id === "a" ? { ...t, needsReview: true } : t)) };
    const ignored = undoable(d, { type: "review", taskId: "a", keep: false }, PLAN_KEYS, [
      need(d.tasks.find((t) => t.id === "a")),
    ]);
    const a = need(ignored.after.tasks.find((t) => t.id === "a"));
    const mid = run(ignored.after, { type: "saveTask", task: { ...a, title: "Cambiada" } });
    const back = ignored.undo(mid);
    expect(back.tasks.find((t) => t.id === "a")?.title).toBe("Cambiada");
  });

  it("Juntar: the merged materia comes back, a materia and a silo made since stay", () => {
    const d = start();
    const merged = undoable(
      d,
      { type: "mergeActivity", activityId: "fis", into: "calc" },
      SORT_KEYS,
    );
    expect(merged.after.activities.some((a) => a.id === "fis")).toBe(false);
    let mid = run(merged.after, { type: "newSubject", name: "Química" });
    mid = run(mid, { type: "saveTask", task: silo("n", "calc", "Nueva") });
    const back = merged.undo(mid);
    expect(back.activities.some((a) => a.id === "fis")).toBe(true);
    expect(back.activities.some((a) => a.name === "Química")).toBe(true);
    expect(back.tasks.find((t) => t.id === "b")?.activityId).toBe("fis");
    expect(back.tasks.find((t) => t.id === "n")?.activityId).toBe("calc");
    expect(diffData(mid, back).deletes.filter((x) => x.table !== "plan_blocks")).toEqual([]);
  });

  it("without a change in between it is as before (and a no-op answer undoes to nothing)", () => {
    const d = start();
    const merged = undoable(
      d,
      { type: "mergeActivity", activityId: "fis", into: "calc" },
      SORT_KEYS,
    );
    const back = merged.undo(merged.after);
    expect(back.activities).toEqual(d.activities);
    expect(back.tasks).toEqual(d.tasks);
  });
});

describe("18th round: a part done with no record that declares it", () => {
  const base = (): AppData => {
    const d = start();
    const t = need(d.tasks.find((x) => x.id === "a"));
    return {
      ...d,
      tasks: d.tasks.map((x) =>
        x.id === "a"
          ? {
              ...t,
              units: [
                { id: "p1", title: "P1", estimateMinutes: 120 },
                { id: "p2", title: "P2", estimateMinutes: 120 },
              ],
            }
          : x,
      ),
    };
  };
  it("an import reads it as done by hand: it does not reopen on its own", () => {
    const d = base();
    const file: AppData = {
      ...d,
      tasks: d.tasks.map((t) =>
        t.id === "a"
          ? {
              ...t,
              units: t.units.map((u) =>
                u.id === "p1" ? { ...u, doneAt: MON, doneByHand: false } : u,
              ),
            }
          : t,
      ),
    };
    const p = parseBackup(exportJson(file, MON));
    if ("error" in p) throw new Error(p.error);
    const back = refresh(importCandidate(p.data, d), MON + MINUTE);
    const p1 = back.tasks.find((t) => t.id === "a")?.units.find((u) => u.id === "p1");
    expect(p1?.doneAt).toBeDefined();
    expect(p1?.doneByHand).toBe(true);
    // Stays done after another refresh.
    const later = refresh(back, MON + 2 * MINUTE);
    expect(
      later.tasks.find((t) => t.id === "a")?.units.find((u) => u.id === "p1")?.doneAt,
    ).toBeDefined();
  });
});
