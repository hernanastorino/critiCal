import { describe, expect, it } from "vitest";
import { exportJson, parseBackup } from "./backup.js";
import { importCandidate } from "./components/Backup.js";
import { demoData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import { refresh } from "./refresh.js";
import { reducer } from "./store.js";

const NOW = zonedInstant(TIMEZONE, "2026-11-03", 17 * 60 + 50);

const silo = {
  id: "t",
  title: "Parcial",
  kind: "deliverable" as const,
  deadline: zonedInstant(TIMEZONE, "2026-11-12", 8 * 60),
  estimateMinutes: 240,
  minMinutes: 120,
  priority: 2 as const,
  status: "active" as const,
  units: [
    { id: "p1", title: "P1", estimateMinutes: 120 },
    { id: "p2", title: "P2", estimateMinutes: 120 },
  ],
};

describe("importar un respaldo: las marcas huérfanas se miran con los registros nuevos", () => {
  it("una parte que declara un registro posterior al respaldo no pasa a «hecha a mano»", () => {
    const demo = demoData(NOW);
    const start: AppData = {
      ...demo,
      preferences: { holidaysOff: false },
      tasks: [{ ...silo, activityId: demo.activities[0]?.id ?? "" }],
      checkIns: [],
      plan: [],
      pins: [],
    };
    const current = reducer(start, {
      type: "checkIn",
      checkIn: { blockId: "b1", taskId: "t", status: "done", minutesDone: 120, unitIds: ["p1"] },
      now: NOW,
    });
    // A backup taken after p1 was marked, but without the record that declares it.
    const text = exportJson({ ...current, checkIns: [] }, NOW);
    const file = parseBackup(text);
    if ("error" in file) throw new Error(file.error);
    const out = refresh(importCandidate(file.data, current), NOW);
    const p1 = out.tasks[0]?.units.find((u) => u.id === "p1");
    expect(p1?.doneAt).toBeDefined();
    // Declared by the record that stands, not by hand: correcting the record reopens it.
    expect(p1?.doneByHand).toBe(false);
    const fixed = reducer(out, {
      type: "checkIn",
      checkIn: { blockId: "b1", taskId: "t", status: "missed", minutesDone: 0, unitIds: [] },
      now: NOW + 60_000,
    });
    expect(fixed.tasks[0]?.units.find((u) => u.id === "p1")?.doneAt).toBeUndefined();
  });
});
