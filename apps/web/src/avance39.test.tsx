import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Silos } from "./components/Silos.js";
import { maxLogMinutes } from "./components/TaskDetail.js";
import { ToastProvider } from "./components/Toast.js";
import { TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import { latestCheckIns, mealTimes } from "./planning.js";
import { loadDemo, reducer, StoreProvider } from "./store.js";
import { weekLeft } from "./week-review.js";

// Medias de la 39.ª vuelta del agente atacante: Avance y ↶ de «ajustar el día».
const DATES = [
  ["jueves 09:00", "2026-11-26", 9 * 60],
  ["jueves 12:00", "2026-11-26", 12 * 60],
  ["miércoles 12:00", "2026-11-25", 12 * 60],
  ["sábado", "2026-11-28", 12 * 60],
] as const;
const CALC = "parcial-calc";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("critical.mode", "demo");
  localStorage.setItem(DEMO_KIND_KEY, "pruebas");
});
afterEach(cleanup);

const load = (now: number): AppData => reducer(loadDemo(now), { type: "refresh", now });
/** Fixed dates plus the real clock: a test of a fixed date does not see what today does. */
const instants = (): [string, number][] => [
  ...DATES.map(([name, date, minute]): [string, number] => [
    name,
    zonedInstant(TIMEZONE, date, minute),
  ]),
  ["hoy, con la fecha real", Date.now()],
];

const logged = (d: AppData, now: number, minutes: number) =>
  reducer(d, { type: "logProgress", taskId: CALC, minutes, now });
const state = (d: AppData, now: number) =>
  JSON.stringify([
    weekLeft(d, now),
    [...latestCheckIns(d).values()]
      .filter((c) => c.status !== "retired")
      .map((c) => [c.blockId, c.status]),
    d.tasks.find((t) => t.id === CALC)?.units,
  ]);

describe("Avance: ↶ lo deshace", () => {
  it.each(instants())("%s: el registro deja su versión y ↶ devuelve lo de antes", (_n, now) => {
    const before = load(now);
    const after = logged(before, now, 120);
    expect(after.planHistory?.at(-1)?.label).toBe("registrar avance");
    expect(state(after, now)).not.toBe(state(before, now));
    const back = reducer(after, { type: "undoPlan", now });
    expect(state(back, now)).toBe(state(before, now));
    expect(back.planHistory ?? []).toHaveLength(before.planHistory?.length ?? 0);
  });

  it("dos avances se deshacen de a uno, el último primero", () => {
    const now = zonedInstant(TIMEZONE, "2026-11-26", 9 * 60);
    const zero = load(now);
    const one = logged(zero, now, 60);
    const two = logged(one, now + 60_000, 30);
    const back = reducer(two, { type: "undoPlan", now: now + 60_000 });
    expect(state(back, now)).toBe(state(one, now));
    expect(back.planHistory?.at(-1)?.label).toBe("registrar avance");
  });

  it("un avance sin nada que anotar no deja versión", () => {
    const now = zonedInstant(TIMEZONE, "2026-11-26", 9 * 60);
    const d = load(now);
    expect(logged(d, now, 0).planHistory?.length ?? 0).toBe(d.planHistory?.length ?? 0);
  });
});

describe("Avance: tope del día", () => {
  it.each(instants())("%s: el tope son las horas despierto, no 24 h", (_n, now) => {
    const max = maxLogMinutes(load(now), now);
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThan(1440);
  });

  it("no guarda 1440 min y sí lo que entra en el día, con su Deshacer", () => {
    const now = zonedInstant(TIMEZONE, "2026-11-26", 9 * 60);
    render(
      <StoreProvider initial={() => load(now)} persist={false} fixedNow={now}>
        <ToastProvider>
          <Silos />
        </ToastProvider>
      </StoreProvider>,
    );
    const total = () => document.querySelector(`[data-task="${CALC}"] .total`)?.textContent;
    const week = () => screen.getByText("Esta semana: falta / asignado").parentElement?.textContent;
    const before = [total(), week()];
    fireEvent.click(screen.getByLabelText(/^Parcial Cálculo II/));
    const sheet = within(screen.getByRole("dialog", { name: "Parcial Cálculo II" }));
    const field = sheet.getByLabelText(/^Le dediqué/);
    fireEvent.change(field, { target: { value: "1440" } });
    expect(sheet.getByRole("alert").textContent).toMatch(
      /^Poné minutos de 0 a \d+, solo cifras\.$/,
    );
    fireEvent.click(sheet.getByRole("button", { name: "Guardar avance" }));
    expect(screen.queryByText(/^Avance guardado/)).toBeNull();
    fireEvent.change(field, { target: { value: "120" } });
    fireEvent.click(sheet.getByRole("button", { name: "Guardar avance" }));
    expect(screen.getByText(/^Avance guardado: 2h/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect([total(), week()]).toEqual(before);
  });
});

describe("«ajustar el día»: ↶ lo devuelve todo", () => {
  const override = { date: "2026-11-26", wake: 11 * 60, bed: 15 * 60 };
  const day = (hm: number) => zonedInstant(TIMEZONE, "2026-11-26", hm);
  const slept = (d: AppData) =>
    [...latestCheckIns(d).values()].filter((c) => c.origin === "slept" && c.status === "missed");

  it("lo que cerró como «dormías» vuelve a estar abierto", () => {
    const now = day(9 * 60);
    const d = load(now);
    const set = reducer(d, { type: "override", override, now });
    expect(slept(set).length).toBeGreaterThan(0);
    const back = reducer(set, { type: "undoPlan", now });
    expect(slept(back)).toHaveLength(0);
    expect(back.overrides).toEqual(d.overrides);
  });

  it("el desayuno no queda encima de un bloque que ya empezó", () => {
    const now = day(12 * 60);
    const set = reducer(load(now), { type: "override", override, now });
    const start = zonedInstant(TIMEZONE, "2026-11-26", 0);
    const meals = mealTimes(set, now, start, start + 86_400_000);
    const started = set.plan.filter((b) => b.start >= start && b.start <= now);
    expect(started.length).toBeGreaterThan(0);
    for (const m of meals.flatMap((x) => (x.at ? [x.at] : [])))
      for (const b of started) expect(m.start < b.end && b.start < m.end).toBe(false);
  });
});
