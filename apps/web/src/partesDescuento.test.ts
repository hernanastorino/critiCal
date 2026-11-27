import { describe, expect, it } from "vitest";
import { demoData } from "./demo.js";
import { MINUTE } from "./engine.js";
import { progress } from "./planning.js";
import { reducer } from "./store.js";

const NOW = Date.UTC(2026, 10, 25, 15, 0);

const left = (data: ReturnType<typeof demoData>) => {
  const p = progress(data, NOW).find((x) => x.task.id === "parcial-calc");
  if (!p) throw new Error("falta la tarea");
  return p;
};

describe("Guardar avance con partes", () => {
  it("marcar una parte sin minutos descuenta solo esa parte", () => {
    const data = demoData(NOW);
    expect(left(data).remainingMinutes).toBe(720);
    const after = reducer(data, {
      type: "logProgress",
      taskId: "parcial-calc",
      minutes: 0,
      unitIds: ["u1"],
      now: NOW,
    });
    const p = left(after);
    expect(p.remainingMinutes).toBe(540);
    expect(p.minRemainingMinutes).toBeLessThanOrEqual(p.remainingMinutes);
  });

  it("con minutos registrados el mínimo nunca supera lo que falta", () => {
    const after = reducer(demoData(NOW), {
      type: "logProgress",
      taskId: "parcial-calc",
      minutes: 60,
      unitIds: ["u1"],
      now: NOW + MINUTE,
    });
    const p = left(after);
    expect(p.minRemainingMinutes).toBeLessThanOrEqual(p.remainingMinutes);
  });
});
