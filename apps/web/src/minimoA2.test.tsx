import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import { hours } from "./format.js";
import type { AppData } from "./model.js";
import { editedMinimum, lackText, minimumNote, needOf } from "./need.js";
import { openSheet } from "./repartir.js";
import { loadDemo, reducer } from "./store.js";

// 43.ª vuelta, decisión 13 = A2 (SPEC §18 punto 19): dos números claros. Donde se edita
// (hoja y formulario) el mínimo de la tarea, nunca mayor que el Total; en la ficha y la hoja
// del bloque, lo que falta para llegarle, nunca más que lo que falta.
const instants = (): [string, number][] => [
  ["lunes temprano", zonedInstant(TIMEZONE, "2026-11-23", 7 * 60)],
  ["miércoles 10:00", zonedInstant(TIMEZONE, "2026-11-25", 10 * 60)],
  ["jueves 20:00", zonedInstant(TIMEZONE, "2026-11-26", 20 * 60)],
  ["domingo 22:00", zonedInstant(TIMEZONE, "2026-11-29", 22 * 60)],
  ["hoy, con la fecha real", Date.now()],
];

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const demo = (kind: "pruebas" | "demo", now: number): AppData => {
  if (kind === "pruebas") localStorage.setItem(DEMO_KIND_KEY, "pruebas");
  else localStorage.removeItem(DEMO_KIND_KEY);
  return reducer(loadDemo(now), { type: "refresh", now });
};

describe.each(["pruebas", "demo"] as const)("un solo mínimo: demo %s", (kind) => {
  it.each(instants())(
    "%s: «para el mínimo» nunca pasa de «Faltan»; la hoja y el formulario coinciden",
    (_n, now) => {
      const data = demo(kind, now);
      for (const t of data.tasks) {
        const need = needOf(data, now, t.id);
        if (need) {
          expect(need.minimum, t.title).toBeLessThanOrEqual(need.left);
          const text = lackText(need, t);
          const note = /para el mínimo, (\S+)\)/.exec(text)?.[1];
          if (note) expect(need.minimum).toBeGreaterThan(0);
          expect(text.startsWith(`Faltan ${hours(need.left)}`)).toBe(true);
          if (t.minMinutes <= 0) expect(text).toBe(`Faltan ${hours(need.left)}`);
        }
        // Never above the total, in the sheet and in what the form starts from.
        if (t.estimateMinutes > 0)
          expect(editedMinimum(t), t.title).toBeLessThanOrEqual(t.estimateMinutes);
        if (t.units.length > 0) {
          const sheet = openSheet(t);
          expect(sheet.min, t.title).toBeLessThanOrEqual(sheet.total);
        }
      }
    },
  );
});

describe("la nota del mínimo", () => {
  it("lo que falta para el mínimo, cubierto, o nada con mínimo 0", () => {
    expect(minimumNote({ left: 300, minimum: 180 }, { minMinutes: 360 })).toBe(
      "para el mínimo, 3h",
    );
    expect(minimumNote({ left: 300, minimum: 0 }, { minMinutes: 360 })).toBe("mínimo cubierto");
    expect(lackText({ left: 300, minimum: 0 }, { minMinutes: 0 })).toBe("Faltan 5h");
    expect(lackText({ left: 300, minimum: 300 }, { minMinutes: 360 })).toBe(
      "Faltan 5h (para el mínimo, 5h)",
    );
    // A minimum above the total is cut to it.
    expect(editedMinimum({ minMinutes: 690, estimateMinutes: 600 })).toBe(600);
  });
});

/** The demo's Parcial Física I with two of its four parts done (what is left: 5h). */
const dosDeCuatro = (n: number): AppData => {
  const data = loadDemo(n);
  const done = (id: string) => ({ doneAt: n - 60_000, id });
  return {
    ...data,
    tasks: data.tasks.map((t) =>
      t.id === "parcial-fis"
        ? {
            ...t,
            units: t.units.map((u) =>
              u.id === "pf1" || u.id === "pf2" ? { ...u, ...done(u.id) } : u,
            ),
          }
        : t,
    ),
  };
};

const inputValue = (label: string): string => {
  const field = screen.getByLabelText(label);
  return field instanceof HTMLInputElement ? field.value : "";
};

describe("pantallas", () => {
  const open = (initial: (n: number) => AppData, title: string, now: number) => {
    localStorage.setItem("critical.mode", "demo");
    localStorage.setItem(DEMO_KIND_KEY, "pruebas");
    render(<App fixedNow={now} initial={initial} />);
    fireEvent.click(screen.getByRole("button", { name: /Silos/ }));
    const mine = [...document.querySelectorAll(".silo[data-task]")].find((e) =>
      e.textContent?.includes(title),
    );
    expect(mine).toBeDefined();
    if (mine) fireEvent.click(mine);
  };

  it("Parcial Física I con 2 de 4 partes: la ficha dice «Faltan 5h (para el mínimo, …)» y la hoja y el formulario «Mínimo 6h»", () => {
    const now = zonedInstant(TIMEZONE, "2026-11-25", 10 * 60);
    open(dosDeCuatro, "Parcial Física I", now);
    expect(screen.getByText(/Faltan 5h \(para el mínimo, 5h\)/)).toBeTruthy();
    expect(screen.queryByText(/mínimo 6h\)/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(inputValue("Mínimo (horas)")).toBe("6");
    fireEvent.click(screen.getByRole("button", { name: "Repartir tiempo" }));
    expect(screen.getByRole("slider", { name: "Mínimo" }).getAttribute("aria-valuenow")).toBe(
      "360",
    );
  });

  it("Parcial Cálculo II: la hoja y el formulario dicen lo mismo (el mínimo recortado al Total)", () => {
    const now = zonedInstant(TIMEZONE, "2026-11-25", 10 * 60);
    open(loadDemo, "Parcial Cálculo II", now);
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    const formMin = Math.round(Number(inputValue("Mínimo (horas)").replace(",", ".")) * 60);
    fireEvent.click(screen.getByRole("button", { name: "Repartir tiempo" }));
    const sheetMin = screen.getByRole("slider", { name: "Mínimo" }).getAttribute("aria-valuenow");
    expect(String(formMin)).toBe(sheetMin);
  });
});
