import { describe, expect, it } from "vitest";
import { SORT_KEYS } from "./components/useUndoable.js";
import { demoData, TIMEZONE } from "./demo.js";
import { MINUTE, zonedInstant } from "./engine.js";
import type { AppData, AppTask } from "./model.js";
import { refresh } from "./refresh.js";
import { type Action, leftAfterUndo, reducer, settleSnapshot, snapshotOf } from "./store.js";

const MON = zonedInstant(TIMEZONE, "2026-11-03", 17 * 60 + 50);
let clock = MON;
const tick = () => {
  clock += MINUTE;
  return clock;
};

type Doing = Action extends infer A ? (A extends { now: number } ? Omit<A, "now"> : never) : never;
const run = (d: AppData, a: Doing): AppData => reducer(d, { ...a, now: tick() } as Action);

const undoable = (d: AppData, doing: Doing) => {
  const before = snapshotOf(d, SORT_KEYS, []);
  const after = run(d, doing);
  settleSnapshot(before, after);
  return {
    after,
    before,
    undo: (cur: AppData) => run(cur, { type: "restoreState", before }),
  };
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

const start = (): AppData =>
  refresh(
    {
      ...demoData(MON),
      preferences: { holidaysOff: false },
      tasks: [silo("a", "calc", "Parcial A"), silo("b", "fis", "Parcial B")],
      checkIns: [],
      plan: [],
      pins: [],
      applied: [],
    },
    MON,
  );
const need = <T>(x: T | null | undefined): T => {
  if (x === null || x === undefined) throw new Error("missing");
  return x;
};

describe("19th round: «Deshacer» goes field by field", () => {
  it("Juntar, then the moved silo renamed: it goes back to its materia with the new name", () => {
    const d = start();
    const merged = undoable(d, { type: "mergeActivity", activityId: "calc", into: "fis" });
    const moved = need(merged.after.tasks.find((t) => t.id === "a"));
    expect(moved.activityId).toBe("fis");
    const mid = run(merged.after, { type: "saveTask", task: { ...moved, title: "Parcial A2" } });
    const back = merged.undo(mid);
    const a = need(back.tasks.find((t) => t.id === "a"));
    expect(a.activityId).toBe("calc");
    expect(a.title).toBe("Parcial A2");
    expect(back.activities.some((x) => x.id === "calc")).toBe(true);
    expect(leftAfterUndo(back, merged.before)).toEqual([]);
  });

  it("Materia / Rutina, then the materia renamed: the type is back with the new name", () => {
    const d = start();
    const was = need(d.activities.find((x) => x.id === "calc"));
    const as = was.kind === "materia" ? "rutina" : "materia";
    const sorted = undoable(d, { type: "sortActivity", activityId: "calc", as });
    const mid = run(sorted.after, {
      type: "saveActivity",
      activity: {
        ...need(sorted.after.activities.find((x) => x.id === "calc")),
        name: "Cálculo 2",
      },
    });
    const back = sorted.undo(mid);
    const now = need(back.activities.find((x) => x.id === "calc"));
    expect(now.kind).toBe(was.kind);
    expect(now.name).toBe("Cálculo 2");
  });

  it("a field changed again after the answer is not overwritten and is reported", () => {
    const d = start();
    const merged = undoable(d, { type: "mergeActivity", activityId: "calc", into: "fis" });
    const moved = need(merged.after.tasks.find((t) => t.id === "a"));
    const mid = run(merged.after, { type: "saveTask", task: { ...moved, activityId: "prog" } });
    const back = merged.undo(mid);
    expect(need(back.tasks.find((t) => t.id === "a")).activityId).toBe("prog");
    expect(leftAfterUndo(back, merged.before).join(" ")).toContain("la materia");
  });
});
