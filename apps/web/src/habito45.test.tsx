import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Silos } from "./components/Silos.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import type { AppData, AppTask } from "./model.js";
import { decisions, refreshPlan } from "./planning.js";
import { loadDemo, reducer, StoreProvider } from "./store.js";
import { habitsAsRoutines } from "./subjects.js";
import { weekLeft } from "./week-review.js";

afterEach(() => {
  cleanup();
  localStorage.removeItem(DEMO_KIND_KEY);
});

const SATURDAY = zonedInstant(TIMEZONE, "2026-11-28", 12 * 60);
const DATES = [
  ["lunes", "2026-11-23"],
  ["miércoles", "2026-11-25"],
  ["viernes", "2026-11-27"],
  ["sábado", "2026-11-28"],
  ["domingo", "2026-11-29"],
] as const;
const HOURS = [7 * 60, 12 * 60, 17 * 60, 21 * 60];

function withCorrer(kind: "demo" | "pruebas", now: number): AppData {
  if (kind === "pruebas") localStorage.setItem(DEMO_KIND_KEY, "pruebas");
  return reducer(loadDemo(now), {
    type: "saveRoutine",
    name: "Correr",
    sessionsPerWeek: 4,
    sessionMinutes: 45,
    now,
  });
}

/** What «Nueva › Hábito semanal» saved before it was a routine: its own activity with no kind. */
function legacyCorrer(now: number): AppData {
  const base = loadDemo(now);
  const task: AppTask = {
    id: "correr",
    activityId: "correr-act",
    title: "Correr",
    kind: "habit",
    estimateMinutes: 180,
    minMinutes: 180,
    sessionsPerWeek: 4,
    sessionMinutes: 45,
    createdAt: now,
    priority: 2,
    status: "active",
    units: [],
  };
  return {
    ...base,
    activities: [
      ...base.activities,
      {
        id: "correr-act",
        name: "Correr",
        color: "#FFC400",
        academic: false,
        maxSessionMinutes: 120,
        minBlockMinutes: 60,
      },
    ],
    tasks: [...base.tasks, task],
  };
}

describe("«Hábito semanal» es una rutina (45.ª vuelta)", () => {
  it("el formulario de Silos es el de Rutinas y guarda con saveRoutine", () => {
    render(
      <StoreProvider initial={() => loadDemo(SATURDAY)} persist={false} fixedNow={SATURDAY}>
        <ToastProvider>
          <Silos />
        </ToastProvider>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByLabelText("Nueva actividad"));
    fireEvent.click(screen.getByText("Hábito semanal"));
    expect(screen.queryByLabelText("Materia o actividad")).toBeNull();
    expect(screen.queryByLabelText("Minutos por vez")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Gimnasio"), { target: { value: "Correr" } });
    fireEvent.change(screen.getByLabelText("Veces/sem."), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Minutos"), { target: { value: "45" } });
    // El mismo aviso de bloques de 30 que en Ajustes › Rutinas.
    expect(screen.getByText(/Se planifica en bloques de 30 min: 60 min/)).toBeTruthy();
    fireEvent.click(screen.getByText("Agregar rutina"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cerrar el formulario de rutina con cambios pregunta antes de descartar", () => {
    render(
      <StoreProvider initial={() => loadDemo(SATURDAY)} persist={false} fixedNow={SATURDAY}>
        <ToastProvider>
          <Silos />
        </ToastProvider>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByLabelText("Nueva actividad"));
    fireEvent.click(screen.getByText("Hábito semanal"));
    fireEvent.change(screen.getByPlaceholderText("Gimnasio"), { target: { value: "Correr" } });
    fireEvent.click(screen.getByLabelText("Cerrar"));
    expect(screen.getByText("¿Descartar los cambios?")).toBeTruthy();
    fireEvent.click(screen.getByText("Seguir editando"));
    expect(screen.queryByText("¿Descartar los cambios?")).toBeNull();
    fireEvent.click(screen.getByLabelText("Cerrar"));
    fireEvent.click(screen.getByText("Descartar"));
    // Descartado: al abrir de nuevo no queda el borrador.
    fireEvent.click(screen.getByLabelText("Nueva actividad"));
    fireEvent.click(screen.getByText("Hábito semanal"));
    expect((screen.getByPlaceholderText("Gimnasio") as HTMLInputElement).value).toBe("");
  });

  it("un hábito del camino viejo se lee como rutina, con los límites de una rutina", () => {
    const old = legacyCorrer(SATURDAY);
    const read = habitsAsRoutines(old);
    const act = read.activities.find((a) => a.id === "correr-act");
    expect(act?.kind).toBe("rutina");
    expect(act?.maxSessionMinutes).toBe(45);
    expect(act?.minBlockMinutes).toBe(45);
    // Lo que ya era materia o rutina queda igual, y leerlo dos veces no cambia nada.
    expect(read.activities.find((a) => a.id === "calc")).toEqual(
      old.activities.find((a) => a.id === "calc"),
    );
    expect(habitsAsRoutines(read)).toBe(read);
  });

  it("el hábito viejo queda con la misma semana que una rutina hecha con saveRoutine", () => {
    const viejo = habitsAsRoutines(legacyCorrer(SATURDAY));
    const nuevo = withCorrer("demo", SATURDAY);
    const blocks = (d: AppData) =>
      refreshPlan(d, SATURDAY)
        .plan.filter((b) => d.tasks.find((t) => t.id === b.taskId)?.title === "Correr")
        .map((b) => (b.end - b.start) / 60_000);
    expect(blocks(viejo)).toEqual(blocks(nuevo));
  });

  it("una materia con otras tareas, o con su estudio, no se vuelve rutina", () => {
    const base = legacyCorrer(SATURDAY);
    const withEntrega = {
      ...base,
      tasks: [
        ...base.tasks,
        { ...base.tasks.at(-1), id: "tp", kind: "deliverable" as const, deadline: SATURDAY + 9e8 },
      ] as AppTask[],
    };
    expect(habitsAsRoutines(withEntrega).activities.find((a) => a.id === "correr-act")?.kind).toBe(
      undefined,
    );
    const study = {
      ...base,
      tasks: base.tasks.map((t) => (t.id === "correr" ? { ...t, study: true } : t)),
    };
    expect(habitsAsRoutines(study).activities.find((a) => a.id === "correr-act")?.kind).toBe(
      undefined,
    );
  });

  it("el silo dice lo que ocupa: 2 de 45 en bloques de 30 son 2 de 1 h", () => {
    const data = withCorrer("demo", SATURDAY);
    const { plan } = refreshPlan(data, SATURDAY);
    const row = weekLeft({ ...data, plan }, SATURDAY).find((r) => r.title === "Correr");
    const blocks = plan.filter(
      (b) => data.tasks.find((t) => t.id === b.taskId)?.title === "Correr",
    );
    const thisWeek = blocks.slice(0, 2).reduce((n, b) => n + (b.end - b.start) / 60_000, 0);
    expect(row?.assigned).toBe(120);
    expect(row?.left).toBe(120);
    expect(row?.assigned).toBe(thisWeek);
  });

  it("una rutina de minutos exactos dice lo mismo que pidió", () => {
    const now = SATURDAY;
    const data = reducer(loadDemo(now), {
      type: "saveRoutine",
      name: "Nadar",
      sessionsPerWeek: 2,
      sessionMinutes: 60,
      now,
    });
    const { plan } = refreshPlan(data, now);
    const row = weekLeft({ ...data, plan }, now).find((r) => r.title === "Nadar");
    expect(row?.assigned).toBe(120);
  });
});

describe("la Bandeja no ofrece «No hacer» una rutina que no alcanza", () => {
  it("sábado 07:00 con Correr recién creada: sin «No hacer Correr»", () => {
    const now = zonedInstant(TIMEZONE, "2026-11-28", 7 * 60);
    const data = withCorrer("demo", now);
    const plan = refreshPlan(data, now);
    expect(plan.result.feasible).toBe(false);
    const d = decisions(plan.input, plan.result, { data, now });
    expect(d.options.some((o) => o.label === "No hacer Correr")).toBe(false);
    expect(d.options.length).toBeGreaterThan(0);
  });

  const cases = ["demo", "pruebas"].flatMap((kind) =>
    DATES.flatMap(([label, date]) => HOURS.map((minute) => [kind, label, date, minute] as const)),
  );
  it.each(cases)(
    "%s, %s %s %i: «No hacer Correr» solo si el plan entra",
    (kind, _l, date, minute) => {
      const now = zonedInstant(TIMEZONE, date, minute);
      const data = withCorrer(kind === "demo" ? "demo" : "pruebas", now);
      const plan = refreshPlan(data, now);
      const d = decisions(plan.input, plan.result, { data, now });
      const correr = data.tasks.find((t) => t.title === "Correr")?.id;
      for (const o of d.options) {
        if (o.kind === "drop" && o.taskId === correr && !plan.result.feasible) {
          expect(o.result.feasible).toBe(true);
        }
      }
    },
    30_000,
  );

  it("con la fecha real, ninguna «No hacer» de una rutina promete menos de lo que dice", () => {
    const now = Date.now();
    const data = reducer(demoData(now), {
      type: "saveRoutine",
      name: "Correr",
      sessionsPerWeek: 4,
      sessionMinutes: 45,
      now,
    });
    const plan = refreshPlan(data, now);
    const d = decisions(plan.input, plan.result, { data, now });
    const correr = data.tasks.find((t) => t.title === "Correr")?.id;
    for (const o of d.options) {
      if (o.kind === "drop" && o.taskId === correr && !plan.result.feasible) {
        expect(o.result.feasible).toBe(true);
      }
    }
  });
});
