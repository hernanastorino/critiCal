import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Places } from "./components/Places.js";
import { TaskEditor } from "./components/TaskEditor.js";
import { ToastProvider } from "./components/Toast.js";
import { WeeklyPlan } from "./components/WeeklyPlan.js";
import { demoData, emptyData, TIMEZONE } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { zonedInstant } from "./engine.js";
import type { AppData, AppTask } from "./model.js";
import { StoreProvider, useStore } from "./store.js";

// 28.ª vuelta del agente atacante (modo demo, 375×812).
const at = (day: string, hour: number) => zonedInstant(TIMEZONE, day, hour * 60);
const NOW = at("2026-11-23", 10);
const SUNDAY = at("2026-11-22", 18);
const noop = () => undefined;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  clearDrafts();
});

let latest: AppData | undefined;
function Spy() {
  latest = useStore().data;
  return null;
}
const inside = (ui: React.ReactNode, initial: () => AppData, fixedNow = NOW) =>
  render(
    <ToastProvider>
      <StoreProvider initial={initial} persist={false} fixedNow={fixedNow}>
        <Spy />
        {ui}
      </StoreProvider>
    </ToastProvider>,
  );

describe("ALTA: la entrega con una materia nueva de nombre repetido no desaparece", () => {
  const withCalculo = (): AppData => {
    const d = demoData(NOW);
    const activities = d.activities
      .slice(0, 1)
      .map((a) => ({ ...a, id: "calc", name: "Cálculo II", kind: "materia" as const }));
    return { ...d, activities };
  };

  for (const typed of ["cálculo ii", "  cálculo   ii ", "CÁLCULO II"]) {
    it(`«${typed}» usa la materia que ya existe`, () => {
      let closed = false;
      inside(
        <TaskEditor
          onClose={() => {
            closed = true;
          }}
        />,
        withCalculo,
      );
      fireEvent.change(screen.getByLabelText("Materia o actividad"), { target: { value: "new" } });
      fireEvent.change(screen.getByLabelText("Nombre de la materia"), { target: { value: typed } });
      fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "TP final" } });
      const tasks = latest?.tasks.length ?? 0;
      const activities = latest?.activities.length ?? 0;
      fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
      expect(closed).toBe(true);
      expect(latest?.tasks.length).toBe(tasks + 1);
      // Not a second materia: the delivery is filed under «Cálculo II».
      expect(latest?.activities.length).toBe(activities);
      expect(latest?.tasks.find((t) => t.title === "TP final")?.activityId).toBe("calc");
    });
  }
});

describe("ALTA: una entrega no queda colgada de una rutina", () => {
  it("con el nombre de una rutina dice el error en el campo y no guarda", () => {
    let closed = false;
    inside(
      <TaskEditor
        onClose={() => {
          closed = true;
        }}
      />,
      () => {
        const d = demoData(NOW);
        const activities = d.activities
          .slice(0, 1)
          .map((a) => ({ ...a, id: "gym", name: "Gimnasio", kind: "rutina" as const }));
        return { ...d, activities };
      },
    );
    fireEvent.change(screen.getByLabelText("Materia o actividad"), { target: { value: "new" } });
    fireEvent.change(screen.getByLabelText("Nombre de la materia"), {
      target: { value: " gimnasio " },
    });
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "TP" } });
    const tasks = latest?.tasks.length ?? 0;
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(screen.getByText("Ya tenés una rutina con ese nombre")).toBeTruthy();
    expect(closed).toBe(false);
    expect(latest?.tasks.length).toBe(tasks);
  });
});

describe("MEDIA 1: Planificación semanal no se contradice", () => {
  const big = (id: string, title: string, deadline: number): AppTask => ({
    id,
    activityId: "a",
    title,
    kind: "deliverable",
    deadline,
    estimateMinutes: 6000,
    minMinutes: 6000,
    priority: 2,
    status: "active",
    units: [],
  });
  const data = (tasks: AppTask[]): AppData => ({
    ...emptyData(),
    activities: [
      {
        id: "a",
        name: "Mate",
        color: "#f80",
        academic: true,
        maxSessionMinutes: 120,
        minBlockMinutes: 60,
      },
    ],
    tasks,
    plan: [],
  });

  it("culpa solo a lo que vence dentro de la semana o después, y no dice «margen en todo»", () => {
    // Sunday 22/11 18:00: the week to plan is 23/11–29/11.
    inside(
      <WeeklyPlan onClose={noop} onInbox={noop} />,
      () =>
        data([
          big("antes", "Vence antes", at("2026-11-22", 22)),
          big("dentro", "Vence dentro", at("2026-11-27", 20)),
        ]),
      SUNDAY,
    );
    expect(screen.getByText("No llega al mínimo")).toBeTruthy();
    expect(screen.getByText(/Vence dentro: faltan/)).toBeTruthy();
    expect(screen.queryByText(/Vence antes/)).toBeNull();
    expect(screen.queryByText(/hay margen en todo/)).toBeNull();
  });

  it("sin nada que falte sí dice que hay margen", () => {
    inside(<WeeklyPlan onClose={noop} onInbox={noop} />, () => data([]), SUNDAY);
    expect(screen.queryByText("No llega al mínimo")).toBeNull();
    expect(screen.getByText(/hay margen en todo/)).toBeTruthy();
  });
});

describe("BAJAS", () => {
  it("horas con dígitos de ancho completo: solo el primer error", () => {
    inside(<TaskEditor onClose={noop} />, () => demoData(NOW));
    fireEvent.change(screen.getByLabelText("Horas estimadas"), { target: { value: "１２" } });
    expect(screen.getAllByText(/Poné horas de 0 a/).length).toBe(1);
    expect(screen.queryByText(/El mínimo no puede ser mayor/)).toBeNull();
  });

  it("fecha límite con año 9999: el error aparece al cambiar el campo", () => {
    inside(<TaskEditor onClose={noop} />, () => demoData(NOW));
    fireEvent.change(screen.getByLabelText("Fecha límite"), {
      target: { value: "9999-12-31T12:00" },
    });
    expect(screen.getByText(/Elegí una fecha entre el 1\/1\/2000/)).toBeTruthy();
  });

  it("un lugar con nombre invisible se ve como «Sin nombre»", () => {
    inside(<Places />, () => ({
      ...demoData(NOW),
      places: [{ id: "p1", name: "​‌", aliases: [] }],
    }));
    expect(screen.getAllByText("Sin nombre").length).toBeGreaterThan(0);
  });
});
