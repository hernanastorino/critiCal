import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Inbox } from "./components/Inbox.js";
import { Routines } from "./components/Preferences.js";
import { ToastProvider } from "./components/Toast.js";
import { TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY, pruebasData } from "./demoPruebas.js";
import { clearDrafts } from "./drafts.js";
import { zonedInstant } from "./engine.js";
import { routineWeekText } from "./friendly.js";
import { endOfWeek, weekStart } from "./planning.js";
import { reducer, StoreProvider, useStore } from "./store.js";

// Jueves 26/11, 13:40: la hora de la Demo de pruebas de la 39.ª vuelta.
const NOW = zonedInstant(TIMEZONE, "2026-11-26", 13 * 60 + 40);
const seen: { store?: ReturnType<typeof useStore> } = {};
const Probe = () => {
  seen.store = useStore();
  return null;
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearDrafts();
  localStorage.setItem(DEMO_KIND_KEY, "pruebas");
});
afterEach(cleanup);

const ROUTINES = [
  { name: "Bici", times: 2, minutes: 45 },
  { name: "Correr 🏃", times: 4, minutes: 45 },
];
const withRoutines = () =>
  ROUTINES.reduce(
    (d, r) =>
      reducer(d, {
        type: "saveRoutine",
        name: r.name,
        sessionsPerWeek: r.times,
        sessionMinutes: r.minutes,
        now: NOW,
      }),
    pruebasData(NOW),
  );

describe("falla 2: Bandeja, hoja del bloque y Semana dicen lo mismo", () => {
  it("la Bandeja y la hoja cuentan los bloques de data.plan, también con otras rutinas", () => {
    const onRoutine = vi.fn();
    render(
      <ToastProvider>
        <StoreProvider initial={withRoutines} persist={false} fixedNow={NOW}>
          <Probe />
          <Inbox onRoutine={onRoutine} />
        </StoreProvider>
      </ToastProvider>,
    );
    const store = seen.store;
    if (!store) throw new Error("sin store");
    const { data } = store;
    const monday = zonedInstant(TIMEZONE, weekStart(TIMEZONE, NOW), 0);
    const end = endOfWeek(TIMEZONE, NOW);
    for (const t of data.tasks.filter((x) => x.kind === "habit")) {
      const week = store.routineWeek(t.id);
      if (!week) continue;
      const planned = data.plan.filter(
        (b) => b.taskId === t.id && b.end > NOW && b.start >= monday && b.start < end,
      ).length;
      expect(week.planned, t.title).toBe(planned);
      const card = store.routineShort.find((r) => r.taskId === t.id);
      expect(card?.placed, t.title).toBe(week.placed < week.wanted ? week.placed : undefined);
      // Lo que dice la Bandeja es lo que dice la hoja del bloque.
      if (card) {
        expect(
          screen.getAllByText(`${card.name}: esta semana entra ${card.placed} de ${card.wanted}`)
            .length,
        ).toBeGreaterThan(0);
        expect(routineWeekText(week)).toBe(`Esta semana entra ${week.placed} de ${week.wanted}`);
      }
    }
  }, 90_000);
});

describe("falla 3: «Editar rutina» de la tarjeta abre la hoja de la rutina en Ajustes › Rutinas", () => {
  it("la tarjeta pide la página de Rutinas", () => {
    const onRoutine = vi.fn();
    render(
      <ToastProvider>
        <StoreProvider initial={() => pruebasData(NOW)} persist={false} fixedNow={NOW}>
          <Inbox onRoutine={onRoutine} />
        </StoreProvider>
      </ToastProvider>,
    );
    const edit = screen.getByRole("button", { name: "Editar rutina" });
    act(() => {
      fireEvent.click(edit);
    });
    expect(onRoutine).toHaveBeenCalledWith("gym", "routines");
  }, 90_000);

  it("Rutinas con la rutina pedida abre su hoja", () => {
    render(
      <StoreProvider initial={() => pruebasData(NOW)} persist={false} fixedNow={NOW}>
        <ToastProvider>
          <Routines openId="gym" />
        </ToastProvider>
      </StoreProvider>,
    );
    expect(screen.getByRole("dialog", { name: "Gym" })).toBeTruthy();
  });
});

describe("falla 4: renombrar una rutina cambia su nombre en todos lados", () => {
  it("«Correr 🏃» pasa a «Correr» en la lista, en la actividad y en la tarea", () => {
    render(
      <StoreProvider initial={withRoutines} persist={false} fixedNow={NOW}>
        <ToastProvider>
          <Probe />
          <Routines />
        </ToastProvider>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByLabelText(/^Correr 🏃,/));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Correr 🏃" })).getByText("Editar"));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Correr" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    const data = seen.store?.data;
    expect(data?.activities.some((a) => a.name === "Correr 🏃")).toBe(false);
    expect(data?.activities.some((a) => a.name === "Correr")).toBe(true);
    expect(data?.tasks.some((t) => t.title === "Correr 🏃")).toBe(false);
    expect(screen.getByLabelText(/^Correr,/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Correr 🏃,/)).toBeNull();
    expect(seen.store?.routineShort.some((r) => r.name === "Correr 🏃")).toBe(false);
  }, 90_000);
});
