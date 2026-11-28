import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { Repartir } from "./components/Repartir.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import type { AppData, AppTask } from "./model.js";
import { fitOf } from "./repartir.js";
import { loadDemo, reducer, StoreProvider } from "./store.js";

// 45.ª vuelta (SPEC §18 punto 18): «Repartir tiempo» en una entrega nueva sin materia no
// tira la app; y bajar el Total por debajo del mínimo lo dice.
const instants = (): [string, number][] => [
  ["lunes temprano", zonedInstant(TIMEZONE, "2026-11-23", 7 * 60)],
  ["miércoles 12:00", zonedInstant(TIMEZONE, "2026-11-25", 12 * 60)],
  ["domingo 22:00", zonedInstant(TIMEZONE, "2026-11-29", 22 * 60)],
  ["hoy, con la fecha real", Date.now()],
];

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

const orphan = (now: number, activityId: string): AppTask => ({
  id: "huerfana",
  activityId,
  title: "Nueva",
  kind: "deliverable",
  deadline: now + 5 * 86_400_000,
  estimateMinutes: 240,
  minMinutes: 0,
  priority: 2,
  status: "active",
  units: [],
});

const setKind = (kind: "pruebas" | "demo") => {
  localStorage.setItem("critical.mode", "demo");
  if (kind === "pruebas") localStorage.setItem(DEMO_KIND_KEY, "pruebas");
};

describe.each(["pruebas", "demo"] as const)("sin materia: demo %s", (kind) => {
  it.each(instants())("%s: fitOf no se rompe con una materia que no existe", (_n, now) => {
    setKind(kind);
    const data = reducer(loadDemo(now), { type: "refresh", now });
    for (const id of ["", "new", "no-existe"]) {
      expect(() => fitOf(data, now, orphan(now, id))).not.toThrow();
    }
  });

  it("Silos › Nueva › sin materia o con «+ Nueva…» › Repartir tiempo abre la hoja", () => {
    const now = zonedInstant(TIMEZONE, "2026-11-25", 12 * 60);
    setKind(kind);
    render(
      <App fixedNow={now} initial={(n) => reducer(loadDemo(n), { type: "refresh", now: n })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Silos/ }));
    fireEvent.click(screen.getByRole("button", { name: "Nueva actividad" }));
    fireEvent.change(screen.getByLabelText("Horas estimadas"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Mínimo (horas)"), { target: { value: "0" } });
    for (const pick of ["", "new"]) {
      fireEvent.change(screen.getByLabelText("Materia o actividad"), { target: { value: pick } });
      fireEvent.click(screen.getByRole("button", { name: "Repartir tiempo" }));
      expect(screen.getByRole("dialog", { name: "Repartir tiempo" })).toBeTruthy();
      expect(screen.queryByText(/Algo falló/)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Aceptar reparto" }));
      expect(screen.queryByRole("dialog", { name: "Repartir tiempo" })).toBeNull();
    }
  });
});

describe("un error dentro de la hoja", () => {
  it("la cierra con un aviso y la app sigue en pie", () => {
    vi.spyOn(console, "error").mockImplementation(vi.fn());
    const onClose = vi.fn();
    const broken = { ...orphan(Date.now(), ""), units: null } as unknown as AppTask;
    render(
      <ToastProvider>
        <StoreProvider initial={demoData} persist={false}>
          <p>la app</p>
          <Repartir task={broken} onAccept={vi.fn()} onClose={onClose} />
        </StoreProvider>
      </ToastProvider>,
    );
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByText("la app")).toBeTruthy();
    expect(screen.getByText(/No pude abrir el reparto/)).toBeTruthy();
  });
});

describe("Total por debajo del mínimo", () => {
  const now = zonedInstant(TIMEZONE, "2026-11-25", 12 * 60);
  const task: AppTask = {
    ...orphan(now, ""),
    estimateMinutes: 240,
    minMinutes: 120,
    units: [
      { id: "a", title: "Uno", estimateMinutes: 120 },
      { id: "b", title: "Dos", estimateMinutes: 120 },
    ],
  };
  const initial = (n: number): AppData => {
    const d = demoData(n);
    const activityId = d.activities.find((a) => a.kind !== "rutina")?.id ?? "";
    return { ...d, tasks: [...d.tasks, { ...task, activityId }] };
  };
  const total = () => screen.getByRole("slider", { name: "Total" });

  it("avisa que baja, el rótulo es el elegido, y vuelve al subir", () => {
    render(
      <ToastProvider>
        <StoreProvider initial={initial} persist={false} fixedNow={now}>
          <Repartir task={{ ...task, activityId: "" }} onAccept={vi.fn()} onClose={vi.fn()} />
        </StoreProvider>
      </ToastProvider>,
    );
    const note = () => document.querySelector(".rep-lowered");
    expect(note()?.getAttribute("aria-live")).toBe("polite");
    expect(note()?.textContent).toBe("");
    // 4 h → 1 h: el mínimo de 2 h baja a 1 h, y el rótulo sigue diciendo el elegido.
    fireEvent.change(total(), { target: { value: "60" } });
    expect(note()?.textContent).toBe("El mínimo baja a 1h");
    expect(screen.getByText("Mínimo 2h")).toBeTruthy();
    fireEvent.change(total(), { target: { value: "180" } });
    expect(note()?.textContent).toBe("");
    expect(screen.getByText("Mínimo 2h")).toBeTruthy();
  });
});
