import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Semester } from "./components/Semester.js";
import { Settings } from "./components/Settings.js";
import { ToastProvider } from "./components/Toast.js";
import { bedPassedProblem } from "./dayLength.js";
import { demoData, TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY } from "./demoPruebas.js";
import { clearDrafts } from "./drafts.js";
import { zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import { refreshPlan } from "./planning.js";
import { loadDemo, StoreProvider, useStore } from "./store.js";

afterEach(() => {
  cleanup();
  localStorage.removeItem(DEMO_KIND_KEY);
});
beforeEach(() => clearDrafts());

let latest: AppData | undefined;
function Spy() {
  latest = useStore().data;
  return null;
}

const DATES = [
  ["jueves 10:13", "2026-11-26", 10 * 60 + 13],
  ["lunes 12:00", "2026-11-23", 12 * 60],
  ["sábado 15:30", "2026-11-28", 15 * 60 + 30],
] as const;

const set = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("Ajustes → Hoy: «Me acuesto» que ya pasó", () => {
  it("is read as passed only for a same-day bedtime at or before now", () => {
    expect(bedPassedProblem("05:00", "09:30", 613)).toBe("Ya pasaron las 09:30.");
    expect(bedPassedProblem("05:00", "10:13", 613)).toBe("Ya pasaron las 10:13.");
    expect(bedPassedProblem("05:00", "10:14", 613)).toBeNull();
    // At or before waking up is after midnight: not over yet.
    expect(bedPassedProblem("08:00", "01:00", 613)).toBeNull();
    expect(bedPassedProblem("08:00", "abc", 613)).toBeNull();
  });

  it.each(DATES)("the field says it, %s", (_name, date, minute) => {
    const now = zonedInstant(TIMEZONE, date, minute);
    render(
      <StoreProvider initial={demoData} persist={false} fixedNow={now}>
        <Settings onClose={() => undefined} onReset={() => undefined} onSignOut={() => undefined} />
      </StoreProvider>,
    );
    set("Me levanté a las", "05:00");
    set("Me acuesto a las", "09:30");
    click("Reacomodar hoy");
    expect(screen.getByRole("alert").textContent).toBe("Ya pasaron las 09:30.");
    expect(screen.getByLabelText("Me acuesto a las").getAttribute("aria-invalid")).toBe("true");
  });
});

describe("el plan no deja bloques después de acostarse", () => {
  it.each(DATES)("with an early bedtime set, %s", (_name, date, minute) => {
    localStorage.setItem(DEMO_KIND_KEY, "pruebas");
    const now = zonedInstant(TIMEZONE, date, minute);
    const data = loadDemo(now);
    const bed = minute + 30;
    const next: AppData = {
      ...data,
      overrides: [...data.overrides.filter((o) => o.date !== date), { date, wake: 300, bed }],
    };
    const bedAt = zonedInstant(TIMEZONE, date, bed);
    // Nothing that starts after today's bedtime, and tomorrow's blocks are not a concern.
    const late = refreshPlan(next, now).plan.filter(
      (b) => b.start > now && b.end > bedAt && b.start < bedAt + 6 * 3600_000,
    );
    expect(late).toEqual([]);
  });
});

describe("Parciales y entregas", () => {
  const NOW = zonedInstant(TIMEZONE, "2026-11-26", 10 * 60 + 13);
  function renderSemester() {
    render(
      <ToastProvider>
        <StoreProvider initial={demoData} persist={false} fixedNow={NOW}>
          <Spy />
          <Semester />
        </StoreProvider>
      </ToastProvider>,
    );
    const subject = latest?.activities.at(0);
    if (!subject) throw new Error("no materia");
    set("De la materia", subject.id);
  }

  it("a date of today at 08:00, already over, is saved and said", () => {
    renderSemester();
    set("Fecha", "2026-11-26");
    click("Agregar");
    expect(screen.getByText(/quedó con la fecha ya vencida/)).toBeTruthy();
  });

  it("refuses an empty title", () => {
    renderSemester();
    set("Qué", "");
    set("Fecha", "2026-12-01");
    const before = latest?.tasks.length;
    click("Agregar");
    expect(screen.getByRole("alert").textContent).toBe("Poné un título.");
    expect(latest?.tasks.length).toBe(before);
  });

  it("refuses a date outside the saved cuatrimestre", () => {
    renderSemester();
    set("Empieza", "2026-08-01");
    set("Termina", "2026-12-20");
    click("Guardar fechas");
    set("Fecha", "2031-05-01");
    expect(screen.getByRole("alert").textContent).toBe("Esa fecha cae fuera del cuatrimestre.");
    const before = latest?.tasks.length;
    click("Agregar");
    expect(latest?.tasks.length).toBe(before);
    set("Fecha", "2026-12-10");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
