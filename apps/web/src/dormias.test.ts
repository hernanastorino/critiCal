import { describe, expect, it } from "vitest";
import { demoData, TIMEZONE } from "./demo.js";
import type { PlanBlock } from "./engine.js";
import { zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import { pendingConfirmations, sleptBlockIds, standingCheckIns } from "./planning.js";
import { reducer } from "./store.js";

// «Dormías» (SPEC «El pasado no se recalcula»): 2026-11-23.
const at = (hour: number) => zonedInstant(TIMEZONE, "2026-11-23", hour * 60);
const NOW = at(10.5);

function withBlocks(): AppData {
  const d = demoData(NOW);
  const task = d.tasks[0];
  const block = (id: string, from: number, to: number): PlanBlock => ({
    id,
    taskId: task.id,
    activityId: task.activityId,
    start: at(from),
    end: at(to),
  });
  return {
    ...d,
    plan: [
      ...d.plan.filter((b) => b.end <= at(0)),
      block("m1", 8, 9),
      block("m2", 9, 10),
      block("t1", 10, 10.5),
    ],
  };
}

const woke = (d: AppData, hour: number, now = NOW) =>
  reducer(d, { type: "override", now, override: { date: "2026-11-23", wake: hour * 60, bed: 0 } });

describe("dormías", () => {
  it("me levanté a las 10:00: los bloques de 08:00–10:00 quedan «dormías» y el trabajo se replanifica desde ahí", () => {
    const d = woke(withBlocks(), 10);
    expect([...sleptBlockIds(d)].sort()).toEqual(["m1", "m2"]);
    const log = d.checkIns.filter((c) => c.origin === "slept");
    expect(log.every((c) => c.status === "missed" && c.minutesDone === 0)).toBe(true);
    // No van a «¿Cómo te fue?»; el bloque de las 10:00 sigue pendiente de respuesta.
    expect(pendingConfirmations(d, NOW).map((b) => b.id)).toEqual(["t1"]);
    // Siguen en el historial (no se borran).
    expect(d.plan.filter((b) => b.end <= NOW && b.id.startsWith("m")).length).toBe(2);
    // Nada nuevo antes de las 10:00 de hoy después de ahora.
    expect(d.plan.some((b) => b.start > NOW && b.start < at(10))).toBe(false);
  });

  it("un bloque con registro previo no se toca", () => {
    let d = withBlocks();
    d = reducer(d, {
      type: "checkIn",
      now: NOW,
      checkIn: {
        blockId: "m1",
        taskId: d.tasks[0]?.id ?? "",
        status: "done",
        minutesDone: 60,
        unitIds: [],
      },
    });
    d = woke(d, 10);
    expect([...sleptBlockIds(d)]).toEqual(["m2"]);
    expect(standingCheckIns(d).find((c) => c.blockId === "m1")?.status).toBe("done");
  });

  it("no se puede responder ni deshacer un «dormías»", () => {
    const d = woke(withBlocks(), 10);
    const before = d.checkIns.length;
    const task = d.tasks[0]?.id ?? "";
    const again = reducer(d, {
      type: "checkIn",
      now: NOW,
      checkIn: { blockId: "m1", taskId: task, status: "done", minutesDone: 60, unitIds: [] },
    });
    expect(again.checkIns.length).toBe(before);
    const slept = d.checkIns.find((c) => c.origin === "slept");
    const undone = reducer(d, { type: "undoCheckIn", id: slept?.id ?? "", now: NOW });
    expect(undone.checkIns.length).toBe(before);
  });

  it("corregir la hora hacia atrás retira los «dormías» que ya no corresponden", () => {
    let d = woke(withBlocks(), 10);
    d = woke(d, 9, NOW + 60_000);
    // 09:00: el de 08:00 sigue dormido, el de 09:00 vuelve a «¿Cómo te fue?».
    expect([...sleptBlockIds(d)]).toEqual(["m1"]);
    expect(pendingConfirmations(d, NOW).map((b) => b.id)).toEqual(["m2", "t1"]);
    const retired = d.checkIns.filter((c) => c.status === "retired");
    expect(retired.length).toBe(1);
    expect(retired[0]?.origin).toBe("undo");
    // Solo se agregó: los registros «dormías» siguen en el log.
    expect(d.checkIns.filter((c) => c.origin === "slept").length).toBe(2);
    d = woke(d, 7, NOW + 120_000);
    expect(sleptBlockIds(d).size).toBe(0);
  });
});
