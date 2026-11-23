import { describe, expect, it } from "vitest";
import { exportJson, parseBackup } from "./backup.js";
import { demoData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import { UNITS_PER_TASK_MAX } from "./limits.js";
import type { AppData } from "./model.js";

const NOW = zonedInstant(TIMEZONE, "2026-11-03", 12 * 60);
const task = (over: Record<string, unknown>) =>
  ({
    id: "t",
    title: "Parcial",
    kind: "deliverable",
    deadline: zonedInstant(TIMEZONE, "2026-11-12", 8 * 60),
    estimateMinutes: 240,
    minMinutes: 120,
    priority: 2,
    status: "active",
    units: [],
    ...over,
  }) as never;
const withTask = (t: never): string => {
  const demo = demoData(NOW);
  const data: AppData = {
    ...demo,
    tasks: [{ ...(t as object), activityId: demo.activities[0]?.id ?? "" } as never],
    plan: [],
    pins: [],
    checkIns: [],
  };
  return exportJson(data, NOW);
};
const errorOf = (text: string) => {
  const r = parseBackup(text);
  return "error" in r ? r.error : null;
};

describe("importador: los textos que se repiten en el mensaje", () => {
  it("sin caracteres de dirección ni invisibles", () => {
    const err = errorOf(
      withTask(task({ title: "\u202EPar\u200Bcial\u2066\u0007X", estimateMinutes: -5 })),
    );
    expect(err).toBeTruthy();
    expect(err).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    expect(err).toContain("Par cial");
  });
});

describe("importador: tope de partes por tarea", () => {
  const units = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `u${i}`, title: `P${i}`, estimateMinutes: 1 }));
  it("pasa con el tope y avisa claro al pasarse", () => {
    expect(errorOf(withTask(task({ units: units(UNITS_PER_TASK_MAX) })))).toBeNull();
    const err = errorOf(withTask(task({ units: units(UNITS_PER_TASK_MAX + 1) })));
    expect(err).toContain(`más de ${UNITS_PER_TASK_MAX} partes`);
    expect(err).toContain("Parcial");
  });
});
