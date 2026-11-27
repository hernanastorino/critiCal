import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Routines } from "./components/Preferences.js";
import { Silos } from "./components/Silos.js";
import { TaskEditor } from "./components/TaskEditor.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY } from "./demoPruebas.js";
import { MINUTE, zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import { blockFactor, endOfWeek, progress, weekStart } from "./planning.js";
import { loadDemo, reducer, StoreProvider } from "./store.js";
import { slotNote } from "./taskForm.js";
import { plannedVsDone } from "./week-review.js";

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

/** What the Semana shows for a task: its blocks of the real week, in study minutes. */
function blocksOf(data: AppData, taskId: string, now: number): number {
  const tz = data.settings.timezone;
  const since = zonedInstant(tz, weekStart(tz, now), 0);
  const until = endOfWeek(tz, now);
  const task = data.tasks.find((t) => t.id === taskId);
  const factor =
    task?.kind === "habit"
      ? 1
      : blockFactor(data.activities.find((a) => a.id === task?.activityId));
  return data.plan
    .filter((b) => b.taskId === taskId && b.start >= since && b.start < until)
    .reduce((sum, b) => sum + (b.end - b.start) / MINUTE / factor, 0);
}

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

describe("2. «Planificado» son solo los bloques", () => {
  it.each(instants())("%s: coincide con la suma de los bloques de la Semana", (_n, now) => {
    const data = load(now);
    for (const row of plannedVsDone(data, now)) {
      expect(row.planned, row.title).toBe(Math.round(blocksOf(data, row.taskId, now)));
    }
  });

  it.each(instants())("%s: registrar avance no suma a «planificado»", (_n, now) => {
    const before = load(now);
    const after = reducer(before, { type: "logProgress", taskId: CALC, minutes: 240, now });
    const planned = (d: AppData) => plannedVsDone(d, now).find((r) => r.taskId === CALC)?.planned;
    const done = (d: AppData) => plannedVsDone(d, now).find((r) => r.taskId === CALC)?.done ?? 0;
    expect(done(after)).toBeGreaterThan(done(before));
    expect(planned(after)).toBe(Math.round(blocksOf(after, CALC, now)));
    // The plan may take the logged time off later blocks, but never adds to «planned».
    expect(planned(after) ?? 0).toBeLessThanOrEqual(planned(before) ?? 0);
  });

  it("un avance sin bloques en la semana no inventa «planificado»", () => {
    const now = zonedInstant(TIMEZONE, "2026-11-25", 12 * 60);
    const d = load(now);
    const bare = { ...d, plan: d.plan.filter((b) => b.taskId !== CALC) };
    const after = reducer(bare, { type: "logProgress", taskId: CALC, minutes: 60, now });
    const row = plannedVsDone(after, now).find((r) => r.taskId === CALC);
    expect(row?.done).toBeGreaterThan(0);
    expect(row?.planned).toBe(Math.round(blocksOf(after, CALC, now)));
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
      expect(plannedVsDone(d, now).some((r) => r.taskId === DETECTED)).toBe(false);
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
    expect(d.plan).toEqual(before.plan);
  });
});
