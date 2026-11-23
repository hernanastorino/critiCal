import { describe, expect, it } from "vitest";
import { learnedHours, learnedNote, median } from "./learnedDefaults.js";
import type { AppTask } from "./model.js";

const t = (o: Partial<AppTask>): AppTask => ({
  id: Math.random().toString(),
  activityId: "mat",
  title: "x",
  kind: "deliverable",
  estimateMinutes: 240,
  minMinutes: 120,
  priority: 2,
  status: "active",
  units: [],
  ...o,
});

describe("valores por defecto aprendidos (SPEC §18.1)", () => {
  it("la mediana: el del medio, o el promedio de los dos del medio a 15 min", () => {
    expect(median([60, 600, 120])).toBe(120);
    expect(median([60, 130])).toBe(90);
    expect(median([60, 100])).toBe(75);
  });

  it("sin historia no propone nada", () => {
    expect(learnedHours([], true, "mat")).toBeNull();
    expect(learnedHours([t({ exam: false })], true, "mat")).toBeNull();
  });

  it("usa los parciales de la misma materia antes que los de todas", () => {
    const tasks = [
      t({ exam: true, activityId: "mat", estimateMinutes: 600, minMinutes: 300 }),
      t({ exam: true, activityId: "otra", estimateMinutes: 120, minMinutes: 60 }),
    ];
    expect(learnedHours(tasks, true, "mat")).toEqual({
      estimateMinutes: 600,
      minMinutes: 300,
      source: "subject",
      from: 1,
    });
  });

  it("sin historia de la materia usa todos los de ese tipo", () => {
    const tasks = [
      t({ exam: true, activityId: "a", estimateMinutes: 600, minMinutes: 300 }),
      t({ exam: true, activityId: "b", estimateMinutes: 300, minMinutes: 120 }),
      t({ exam: true, activityId: "c", estimateMinutes: 480, minMinutes: 240 }),
    ];
    const l = learnedHours(tasks, true, "nueva");
    expect(l).toMatchObject({ estimateMinutes: 480, minMinutes: 240, source: "kind", from: 3 });
  });

  it("no mezcla parciales con entregas, ni cuenta hábitos, silos de estudio ni descartadas", () => {
    const tasks = [
      t({ exam: false, estimateMinutes: 60, minMinutes: 30 }),
      t({ exam: true, kind: "habit" }),
      t({ exam: true, study: true }),
      t({ exam: true, status: "dropped" }),
    ];
    expect(learnedHours(tasks, true, "mat")).toBeNull();
    expect(learnedHours(tasks, false, "mat")?.estimateMinutes).toBe(60);
  });

  it("las hechas sí enseñan, y se puede saltear la que se edita", () => {
    const done = t({ id: "d", exam: true, status: "done", estimateMinutes: 90, minMinutes: 45 });
    expect(learnedHours([done], true, "mat")?.estimateMinutes).toBe(90);
    expect(learnedHours([done], true, "mat", "d")).toBeNull();
  });

  it("el mínimo nunca pasa de las horas", () => {
    const tasks = [
      t({ exam: true, estimateMinutes: 60, minMinutes: 60 }),
      t({ exam: true, estimateMinutes: 600, minMinutes: 600 }),
    ];
    const l = learnedHours(tasks, true, "mat");
    expect(l && l.minMinutes <= l.estimateMinutes).toBe(true);
  });

  it("dice de dónde sale, sin cifras ni urgencia", () => {
    const l = { estimateMinutes: 1, minMinutes: 1, from: 2 };
    expect(learnedNote({ ...l, source: "subject" }, true)).toBe(
      "Como tus parciales anteriores de esta materia.",
    );
    expect(learnedNote({ ...l, source: "kind" }, false)).toBe("Como tus entregas anteriores.");
  });
});
