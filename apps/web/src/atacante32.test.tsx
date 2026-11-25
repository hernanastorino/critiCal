import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { Routines } from "./components/Preferences.js";
import { Silos } from "./components/Silos.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { hours } from "./format.js";
import { forgetImport } from "./importUndo.js";
import type { AppData } from "./model.js";
import { blockFactor, progress, refreshPlan, toEngineTasks } from "./planning.js";
import { reducer, StoreProvider, useStore } from "./store.js";

// Hallazgos de la 32.ª vuelta del agente atacante.
const NOW = Date.UTC(2026, 10, 2, 20);
const seen: { store?: ReturnType<typeof useStore> } = {};
const Probe = () => {
  seen.store = useStore();
  return null;
};
const casa = { id: "casa", name: "Casa", aliases: ["Hogar"], isHome: true, address: "Rivera 1234" };
const fing = { id: "fing", name: "FING", aliases: ["Facultad"] };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearDrafts();
  forgetImport();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(cleanup);

const openSettingsPage = (name: RegExp) => {
  fireEvent.click(screen.getByLabelText("Ajustes"));
  fireEvent.click(screen.getByRole("button", { name }));
};

describe("Lugares: alias repetido", () => {
  const places = () => ({ ...demoData(NOW), places: [casa, fing] });

  it("al agregar un lugar nuevo avisa y no guarda, como al editar", () => {
    render(<App fixedNow={NOW} initial={places} />);
    openSettingsPage(/^Lugares y traslados/);
    fireEvent.click(screen.getByRole("button", { name: "Agregar lugar" }));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Biblioteca" } });
    fireEvent.change(screen.getByLabelText(/^Alias/), { target: { value: "Sala, facultad" } });
    expect(screen.getByRole("alert").textContent).toMatch(/«facultad» ya es el nombre o un alias/);
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(screen.queryByRole("button", { name: /^Editar Biblioteca/ })).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Alias/), { target: { value: "Sala" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(screen.getByRole("button", { name: /^Editar Biblioteca/ })).toBeTruthy();
  });

  it("un alias igual al nombre del propio lugar no se guarda", () => {
    render(<App fixedNow={NOW} initial={places} />);
    openSettingsPage(/^Lugares y traslados/);
    fireEvent.click(screen.getByRole("button", { name: "Agregar lugar" }));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Biblioteca" } });
    fireEvent.change(screen.getByLabelText(/^Alias/), { target: { value: "biblioteca, Sala" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    fireEvent.click(screen.getByRole("button", { name: /^Editar Biblioteca/ }));
    expect(screen.getByLabelText(/^Alias/)).toHaveProperty("value", "Sala");
  });
});

describe("Mi semana: error al guardar", () => {
  it("lleva el foco a la comida que cae dormido, no a un error fuera de pantalla", () => {
    render(<App fixedNow={NOW} initial={() => demoData(NOW)} />);
    openSettingsPage(/^Mi semana/);
    fireEvent.change(screen.getByLabelText("Me acuesto"), { target: { value: "18:00" } });
    fireEvent.change(screen.getByLabelText("Nada de estudio desde"), {
      target: { value: "17:30" },
    });
    fireEvent.change(screen.getByLabelText("Cena"), { target: { value: "21:00" } });
    fireEvent.click(screen.getByRole("button", { name: /^Guardar para/ }));
    expect(screen.getByRole("alert").textContent).toMatch(/Cena a las 21:00 cae/);
    expect(document.activeElement).toBe(screen.getByLabelText("Cena"));
    expect(screen.getByLabelText("Cena").getAttribute("aria-invalid")).toBe("true");
  });
});

describe("Rutinas: desactivar", () => {
  const start = (): AppData => reducer(demoData(NOW), { type: "refresh", now: NOW });
  const open = () => {
    render(
      <StoreProvider initial={start} persist={false} fixedNow={NOW}>
        <ToastProvider>
          <Probe />
          <Routines />
        </ToastProvider>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByLabelText(/^Gym,/));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Gym" })).getByText("Desactivar…"));
  };
  const gym = () => seen.store?.data.tasks.find((t) => t.title === "Gym");

  it("«Hasta que lo reactive» no manda a un silo que no existe y se puede deshacer", () => {
    open();
    expect(screen.queryByText(/desde este silo/)).toBeNull();
    fireEvent.click(screen.getByText("Hasta que lo reactive"));
    expect(gym()?.paused).toBe(true);
    expect(screen.getByText("Gym en pausa")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(gym()?.paused).toBeFalsy();
  });

  it("«Solo esta semana» también se puede deshacer", () => {
    open();
    fireEvent.click(screen.getByText("Solo esta semana"));
    expect(gym()?.skipUntil).toBeGreaterThan(NOW);
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(gym()?.skipUntil).toBeUndefined();
  });
});

describe("Casillas y filas con nombre", () => {
  it("las casillas de Notificaciones nombran su texto", () => {
    render(<App fixedNow={NOW} initial={() => demoData(NOW)} />);
    openSettingsPage(/^Notificaciones/);
    for (const name of [
      "Cuando un evento nuevo cambia el plan de hoy",
      "Planificación semanal del domingo",
    ])
      expect(screen.getByRole("checkbox", { name })).toBeTruthy();
  });

  it("las filas «Planificación semanal» e «Inicio de cuatrimestre» de Ajustes tienen nombre", () => {
    render(<App fixedNow={NOW} initial={() => demoData(NOW)} />);
    fireEvent.click(screen.getByLabelText("Ajustes"));
    for (const name of ["Inicio de cuatrimestre", "Planificación semanal"])
      expect(screen.getByRole("button", { name }).getAttribute("aria-label")).toBe(name);
  });
});

describe("Lo que la SPEC dice que es así", () => {
  // Lunes 23/11 10:00 en Montevideo; el parcial vence el jueves 26/11 08:00.
  const monday = Date.UTC(2026, 10, 23, 13);

  it("«Faltan» es lo que el plan reserva: las partes por el ratio aprendido (SPEC §13, aprendizaje)", () => {
    let d = reducer(demoData(monday), { type: "refresh", now: monday });
    const deadline = Date.UTC(2026, 10, 26, 11);
    d = {
      ...d,
      tasks: d.tasks.map((t) => (t.id === "parcial-calc" ? { ...t, deadline } : t)),
    };
    d = reducer(d, { type: "refresh", now: monday });
    d = reducer(d, {
      type: "pin",
      blockId: d.plan.find((b) => b.taskId === "tp-prog" && b.start > monday)?.id ?? "",
      start: Date.UTC(2026, 10, 26, 11),
      now: monday,
    });
    d = reducer(d, {
      type: "logProgress",
      taskId: "parcial-calc",
      minutes: 60,
      unitIds: ["u1"],
      now: monday,
    });
    const shown = progress(d, monday).find((p) => p.task.id === "parcial-calc");
    const planned = toEngineTasks(d, monday).find((t) => t.id === "parcial-calc");
    // «Faltan» y lo que se planifica son lo mismo: las partes por el ratio aprendido.
    expect(shown?.remainingMinutes).toBeLessThan(420);
    const k = blockFactor(d.activities.find((a) => a.id === shown?.task.activityId));
    expect(planned?.remainingMinutes).toBe(Math.ceil((shown?.remainingMinutes ?? 0) * k));
    // El silo dice lo mismo que lo que el plan reserva.
    render(
      <StoreProvider initial={() => d} persist={false} fixedNow={monday}>
        <Silos />
      </StoreProvider>,
    );
    expect(
      document.querySelector("[data-task='parcial-calc']")?.getAttribute("aria-label"),
    ).toContain(`faltan ${hours(shown?.remainingMinutes ?? 0)}`);
    const { result } = refreshPlan(d, monday);
    const status = result.status.find((s) => s.taskId === "parcial-calc");
    expect(status?.minDeficit).toBe(0);
    const blocks = result.blocks.filter((b) => b.taskId === "parcial-calc");
    const minutes = blocks.reduce((sum, b) => sum + (b.end - b.start) / 60000, 0);
    expect(minutes).toBeGreaterThanOrEqual(planned?.minRemainingMinutes ?? Infinity);
  });

  it("el motor pone las sesiones de repaso en los días que la SPEC dice (7, 3 y 1 días antes)", () => {
    let d = reducer(demoData(monday), { type: "refresh", now: monday });
    d = reducer(d, {
      type: "saveTask",
      now: monday,
      activity: {
        id: "fis2",
        name: "Física II",
        color: "#123456",
        academic: true,
        kind: "materia",
        maxSessionMinutes: 120,
        minBlockMinutes: 60,
      },
      task: {
        id: "pf2",
        activityId: "fis2",
        title: "Parcial Física II",
        kind: "deliverable",
        deadline: Date.UTC(2026, 10, 28, 23),
        estimateMinutes: 240,
        minMinutes: 180,
        priority: 2,
        status: "active",
        units: [],
        exam: true,
      },
    });
    const days = new Set(
      d.plan
        .filter((b) => b.taskId === "pf2")
        .map((b) => new Date(b.start - 3 * 3600_000).toISOString().slice(0, 10)),
    );
    // Los repasos que quedan por delante son el 25/11 (3 días antes) y el 27/11 (el día anterior).
    expect(days.has("2026-11-27")).toBe(true);
  });
});
