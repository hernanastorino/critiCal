import { describe, expect, it } from "vitest";
import { demoData } from "./demo.js";
import { zonedInstant } from "./engine.js";
import type { Place } from "./model.js";
import { reducer, removedWith } from "./store.js";

const tz = "America/Montevideo";
const NOW = zonedInstant(tz, "2026-11-04", 8 * 60);

describe("Deshacer de la cabecera cubre lo que se borra o guarda en Ajustes", () => {
  it("devuelve una materia borrada, con su silo, aunque el aviso ya se fue", () => {
    const start = demoData(NOW);
    const target = start.activities.at(0);
    if (!target) throw new Error("sin materias");
    const silos = start.tasks.filter((t) => t.activityId === target.id).length;
    const gone = reducer(start, { type: "deleteActivity", activityId: target.id, now: NOW });
    expect(gone.activities.some((a) => a.id === target.id)).toBe(false);
    expect(gone.planHistory?.at(-1)?.label).toBe(`eliminar ${target.name}`);
    const back = reducer(gone, { type: "undoPlan", now: NOW });
    expect(back.activities.map((a) => a.id)).toEqual(start.activities.map((a) => a.id));
    expect(back.tasks.filter((t) => t.activityId === target.id)).toHaveLength(silos);
    expect(back.planHistory?.length ?? 0).toBe(start.planHistory?.length ?? 0);
  });

  it("Deshacer del aviso saca la entrada de la cabecera: no queda un deshacer vacío", () => {
    const start = demoData(NOW);
    const target = start.activities.at(0);
    if (!target) throw new Error("sin materias");
    const removed = removedWith(start, target.id);
    if (!removed) throw new Error("sin removed");
    const gone = reducer(start, { type: "deleteActivity", activityId: target.id, now: NOW });
    const back = reducer(gone, { type: "restoreActivity", removed, now: NOW });
    expect(back.planHistory?.some((v) => v.removed)).toBeFalsy();
    expect(back.activities.some((a) => a.id === target.id)).toBe(true);
  });

  it("guardar Mi semana entra en el historial y se deshace", () => {
    const start = demoData(NOW);
    const settings = { ...start.settings, travelMarginMinutes: 11 };
    const saved = reducer(start, { type: "settings", settings, now: NOW });
    expect(saved.planHistory?.at(-1)?.label).toBe("guardar Mi semana");
    const back = reducer(saved, { type: "undoPlan", now: NOW });
    expect(back.settings.travelMarginMinutes).toBe(start.settings.travelMarginMinutes);
  });

  it("lo que se cambió de nuevo después no se pisa", () => {
    const start = demoData(NOW);
    const first = reducer(start, {
      type: "settings",
      settings: { ...start.settings, travelMarginMinutes: 11 },
      now: NOW,
    });
    const second = reducer(first, {
      type: "settings",
      settings: { ...first.settings, travelMarginMinutes: 12 },
      now: NOW,
    });
    // The last save goes back to the first; the older one then goes back to the start.
    const one = reducer(second, { type: "undoPlan", now: NOW });
    expect(one.settings.travelMarginMinutes).toBe(11);
    const two = reducer(one, { type: "undoPlan", now: NOW });
    expect(two.settings.travelMarginMinutes).toBe(start.settings.travelMarginMinutes);
  });

  it("guardar un lugar entra en el historial y se deshace", () => {
    const start = demoData(NOW);
    const place: Place = { id: "nuevo", name: "Biblioteca", aliases: [], address: "Rivera 1" };
    const saved = reducer(start, { type: "savePlace", place, now: NOW });
    expect(saved.planHistory?.at(-1)?.label).toBe("guardar un lugar");
    const back = reducer(saved, { type: "undoPlan", now: NOW });
    expect((back.places ?? []).some((p) => p.id === "nuevo")).toBe(false);
  });
});
