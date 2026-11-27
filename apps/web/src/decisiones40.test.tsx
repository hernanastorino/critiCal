import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Routines } from "./components/Preferences.js";
import { Silos } from "./components/Silos.js";
import { TaskEditor } from "./components/TaskEditor.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import { progress } from "./planning.js";
import { loadDemo, reducer, StoreProvider } from "./store.js";
import { slotNote } from "./taskForm.js";
import { weekLeft } from "./week-review.js";

// Decisiones del 2026-11-27 (SPEC §18.14): redondeo de rutinas, «planificado» y lo detectado.
const DATES = [
  ["lunes temprano", "2026-11-23", 7 * 60],
  ["miércoles 12:00", "2026-11-25", 12 * 60],
  ["jueves 09:00", "2026-11-26", 9 * 60],
  ["sábado", "2026-11-28", 12 * 60],
] as const;
const instants = (): [string, number][] => [
  ...DATES.map(([name, date, minute]): [string, number] => [
    name,
    zonedInstant(TIMEZONE, date, minute),
  ]),
  ["hoy, con la fecha real", Date.now()],
];

const DETECTED = "parcial-nuevo";
const CALC = "parcial-calc";
const NOTE = "Se planifica en bloques de 30 min: 60 min";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("critical.mode", "demo");
  localStorage.setItem(DEMO_KIND_KEY, "pruebas");
});
afterEach(cleanup);

const load = (now: number): AppData => reducer(loadDemo(now), { type: "refresh", now });

describe("1. Rutinas que no son múltiplo de 30", () => {
  it("slotNote dice los minutos que se reservan, solo si no es múltiplo", () => {
    expect(slotNote(45, 30)).toBe(NOTE);
    expect(slotNote(100, 30)).toBe("Se planifica en bloques de 30 min: 120 min");
    expect(slotNote(60, 30)).toBeNull();
    expect(slotNote(0, 30)).toBeNull();
    expect(slotNote(Number.NaN, 30)).toBeNull();
  });

  it("Ajustes › Rutinas: la línea aparece junto a «Minutos» y desaparece con un múltiplo", () => {
    render(
      <ToastProvider>
        <StoreProvider initial={demoData} persist={false}>
          <Routines />
        </StoreProvider>
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Crear rutina nueva" }));
    expect(screen.queryByText(NOTE)).toBeNull();
    fireEvent.change(screen.getByLabelText("Minutos"), { target: { value: "45" } });
    expect(screen.getByText(NOTE)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Minutos"), { target: { value: "90" } });
    expect(screen.queryByText(/Se planifica en bloques/)).toBeNull();
  });

  it("la hoja de la rutina dice lo mismo", () => {
    const data = demoData(zonedInstant(TIMEZONE, "2026-11-25", 12 * 60));
    const gym = data.tasks.find((t) => t.id === "gym");
    if (!gym) throw new Error("the demo has a Gym routine");
    render(
      <ToastProvider>
        <StoreProvider initial={() => data} persist={false}>
          <TaskEditor task={gym} onClose={() => undefined} />
        </StoreProvider>
      </ToastProvider>,
    );
    fireEvent.change(screen.getByLabelText("Minutos por vez"), { target: { value: "45" } });
    expect(screen.getByText(NOTE)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Minutos por vez"), { target: { value: "60" } });
    expect(screen.queryByText(NOTE)).toBeNull();
  });
});

describe("2. Un silo arranca lleno y se vacía con el avance (41.ª)", () => {
  const row = (d: AppData, now: number) => weekLeft(d, now).find((r) => r.taskId === CALC);

  it.each(instants())("%s: sin avance, falta todo lo asignado", (_n, now) => {
    const r = row(load(now), now);
    expect(r).toBeDefined();
    expect(r?.left).toBe(r?.assigned);
  });

  it.each(instants())("%s: registrar avance baja lo que falta y no toca lo asignado", (_n, now) => {
    // Without parts, what is left is the estimate minus what was logged.
    const loaded = load(now);
    const before = {
      ...loaded,
      tasks: loaded.tasks.map((t) => (t.id === CALC ? { ...t, units: [] } : t)),
    };
    const after = reducer(before, { type: "logProgress", taskId: CALC, minutes: 60, now });
    expect(row(after, now)?.assigned).toBe(row(before, now)?.assigned);
    expect(row(after, now)?.left).toBeLessThan(row(before, now)?.left ?? 0);
  });

  it.each(instants())("%s: saltear un bloque no cambia lo asignado", (_n, now) => {
    const before = load(now);
    const block = before.plan.find((b) => b.taskId === CALC && b.start > now);
    if (!block) throw new Error("the demo has a block ahead");
    const after = reducer(before, {
      type: "checkIn",
      checkIn: {
        blockId: block.id,
        taskId: CALC,
        status: "missed",
        minutesDone: 0,
        unitIds: [],
      },
      now,
    });
    expect(row(after, now)?.assigned).toBe(row(before, now)?.assigned);
  });

  it("una tarea de 2h dice 2h / 2h sin avance y 0h / 2h completada", () => {
    const now = zonedInstant(TIMEZONE, "2026-11-25", 12 * 60);
    const d = load(now);
    const task = d.tasks.find((t) => t.id === CALC);
    if (!task) throw new Error("the demo has the task");
    const two = { ...task, estimateMinutes: 120, minMinutes: 60, units: [] };
    const one = {
      ...d,
      tasks: d.tasks.map((t) => (t.id === CALC ? two : t)),
      checkIns: [],
    };
    expect(row(one, now)).toMatchObject({ left: 120, assigned: 120 });
    const full = reducer(one, { type: "logProgress", taskId: CALC, minutes: 120, now });
    expect(row(full, now)).toMatchObject({ left: 0, assigned: 120 });
  });

  it("Silos lo muestra como «falta / asignado», con el descanso adentro", () => {
    const now = zonedInstant(TIMEZONE, "2026-11-25", 12 * 60);
    const d = load(now);
    render(
      <ToastProvider>
        <StoreProvider initial={() => d} persist={false} fixedNow={now}>
          <Silos />
        </StoreProvider>
      </ToastProvider>,
    );
    expect(screen.getByText("Esta semana: falta / asignado")).toBeTruthy();
    expect(screen.queryByText(/hecho \/ planificado/)).toBeNull();
  });
});

describe("3. Lo detectado espera a que lo aceptes", () => {
  const countBlocks = (d: AppData) => d.plan.filter((b) => b.taskId === DETECTED).length;
  const ids = (d: AppData, now: number) => progress(d, now).map((p) => p.task.id);

  it.each(instants())(
    "%s: sin bloques, sin silo, sin «planificado» (el widget sale de lo mismo)",
    (_n, now) => {
      const d = load(now);
      expect(d.tasks.find((t) => t.id === DETECTED)?.needsReview).toBe(true);
      expect(countBlocks(d)).toBe(0);
      expect(ids(d, now)).not.toContain(DETECTED);
      expect(weekLeft(d, now).some((r) => r.taskId === DETECTED)).toBe(false);
    },
  );

  it("Silos no lo muestra ni como silo apagado", () => {
    const now = zonedInstant(TIMEZONE, "2026-11-25", 12 * 60);
    render(
      <ToastProvider>
        <StoreProvider initial={() => load(now)} persist={false} fixedNow={now}>
          <Silos />
        </StoreProvider>
      </ToastProvider>,
    );
    expect(screen.queryByText(/del calendario/)).toBeNull();
  });

  it.each(instants())("%s: «Planificar así» lo suma al plan y a Silos", (_n, now) => {
    const d = reducer(load(now), { type: "review", taskId: DETECTED, keep: true, now });
    expect(d.tasks.find((t) => t.id === DETECTED)?.needsReview).toBe(false);
    expect(ids(d, now)).toContain(DETECTED);
  });

  it.each(instants())("%s: «Ignorar» no deja rastro en el plan", (_n, now) => {
    const before = load(now);
    const d = reducer(before, { type: "review", taskId: DETECTED, keep: false, now });
    expect(d.tasks.find((t) => t.id === DETECTED)?.status).toBe("dropped");
    expect(countBlocks(d)).toBe(0);
    expect(ids(d, now)).not.toContain(DETECTED);
    expect(d.plan).toEqual(reducer(before, { type: "refresh", now }).plan);
  });
});
