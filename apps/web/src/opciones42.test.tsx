import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import { hours } from "./format.js";
import type { AppData } from "./model.js";
import { applyOption, decisions, doneMinutes, refreshPlan } from "./planning.js";
import { applySheet, openSheet } from "./repartir.js";
import { loadDemo, reducer } from "./store.js";

// 42.ª vuelta: aceptar una opción desde «Repartir tiempo» (sin tocar nada) da el mismo plan
// que el pronóstico de la opción y que elegirla directo; y el mínimo es el mismo en todas
// las pantallas.
const instants = (): [string, number][] => [
  ["miércoles 10:00", zonedInstant(TIMEZONE, "2026-11-25", 10 * 60)],
  ["jueves 09:00", zonedInstant(TIMEZONE, "2026-11-26", 9 * 60)],
  ["jueves 20:00", zonedInstant(TIMEZONE, "2026-11-26", 20 * 60)],
  ["miércoles 12:00", zonedInstant(TIMEZONE, "2026-11-25", 12 * 60)],
  ["hoy, con la fecha real", Date.now()],
];
const SPLITS = ["lower-minimum", "minimum-only", "minimum-viable", "prioritize"];

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const lacks = (d: AppData, now: number) =>
  refreshPlan(d, now)
    .result.status.filter((s) => s.minDeficit > 0)
    .map((s) => s.taskId)
    .sort();

describe.each(["pruebas", "demo"] as const)("opciones desde la hoja: demo %s", (kind) => {
  it.each(instants())(
    "%s: aceptar sin tocar == elegir == pronóstico",
    (_n, now) => {
      if (kind === "pruebas") localStorage.setItem(DEMO_KIND_KEY, "pruebas");
      else localStorage.removeItem(DEMO_KIND_KEY);
      const data = reducer(loadDemo(now), { type: "refresh", now });
      const plan = refreshPlan(data, now);
      const offered = decisions(plan.input, plan.result, { data, now }).options;
      for (const o of offered) {
        if (!SPLITS.includes(o.kind)) continue;
        const task = data.tasks.find((t) => t.id === o.taskId);
        const after = applyOption(data, plan.input, o, now).tasks.find((t) => t.id === o.taskId);
        if (!task || !after) continue;
        const next = applySheet(task, openSheet(after, doneMinutes(data, task.id)));
        const viaSheet = reducer(data, { type: "applyOption", optionId: o.id, now, task: next });
        const direct = reducer(data, { type: "applyOption", optionId: o.id, now });
        const forecast = o.result.status
          .filter((s) => s.minDeficit > 0)
          .map((s) => s.taskId)
          .sort();
        expect(lacks(direct, now), `${o.label}: directo == pronóstico`).toEqual(forecast);
        expect(lacks(viaSheet, now), `${o.label}: hoja == pronóstico`).toEqual(forecast);
        expect(viaSheet.applied?.length, `${o.label}: deja su decisión`).toBe(1);
        // The sheet leaves the figures the option leaves.
        const kept = (d: AppData) => d.tasks.find((t) => t.id === task.id);
        expect(kept(viaSheet)?.minMinutes).toBe(kept(direct)?.minMinutes);
        expect(kept(viaSheet)?.estimateMinutes).toBe(kept(direct)?.estimateMinutes);
        // What it promised for its own task: its minimum is covered.
        if (o.kind === "lower-minimum" || o.kind === "minimum-viable")
          expect(lacks(viaSheet, now)).not.toContain(task.id);
      }
    },
    120_000,
  );
});

describe("el mínimo es el mismo en todas las pantallas", () => {
  it("«Bajar el mínimo» nombra el mínimo que guarda la tarea, también con horas hechas", () => {
    localStorage.setItem(DEMO_KIND_KEY, "pruebas");
    const now = zonedInstant(TIMEZONE, "2026-11-25", 10 * 60);
    const data = reducer(loadDemo(now), { type: "refresh", now });
    const plan = refreshPlan(data, now);
    for (const o of decisions(plan.input, plan.result, { data, now }).options) {
      if (o.kind !== "lower-minimum" && o.kind !== "minimum-viable") continue;
      const saved = reducer(data, { type: "applyOption", optionId: o.id, now }).tasks.find(
        (t) => t.id === o.taskId,
      );
      expect(o.label).toContain(hours(saved?.minMinutes ?? -1));
    }
  });

  it("la ficha del silo dice el mínimo de la tarea (Parcial Física I: 6h, con 1h hecha)", () => {
    localStorage.setItem("critical.mode", "demo");
    localStorage.setItem(DEMO_KIND_KEY, "pruebas");
    const now = zonedInstant(TIMEZONE, "2026-11-25", 10 * 60);
    render(<App fixedNow={now} initial={loadDemo} />);
    fireEvent.click(screen.getByRole("button", { name: /Silos/ }));
    const mine = [...document.querySelectorAll(".silo[data-task]")].find((e) =>
      e.textContent?.includes("Parcial Física I"),
    );
    expect(mine).toBeDefined();
    if (mine) fireEvent.click(mine);
    expect(screen.getByText(/mínimo 6h\)/)).toBeTruthy();
    expect(screen.queryByText(/mínimo 5h\)/)).toBeNull();
  });
});
