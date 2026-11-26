import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { ANSWER_GUARD_MS, Inbox } from "./components/Inbox.js";
import { TaskEditor } from "./components/TaskEditor.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { pruebasData } from "./demoPruebas.js";
import { type PlanBlock, zonedInstant } from "./engine.js";
import type { AppData, AppTask } from "./model.js";
import { refreshPlan, routineShortfalls } from "./planning.js";
import { preferenceMisfits } from "./preferredHours.js";
import { StoreProvider, seedHistory } from "./store.js";
import { estimateProblem, hoursField } from "./taskForm.js";
import { type WeekFormValues, weekProblems } from "./weekForm.js";

const WED = zonedInstant(TIMEZONE, "2026-11-25", 8 * 60);
const MONDAY = zonedInstant(TIMEZONE, "2026-11-02", 17 * 60 + 50);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("1. «Rutina que no entra» cuenta los bloques de la rutina", () => {
  const gym = (d: AppData) => d.tasks.find((t) => t.activityId === "gym" && t.kind === "habit");
  const blocksOf = (d: AppData, n: number): PlanBlock[] => {
    const task = gym(d);
    const base = refreshPlan(d, WED).result.blocks.at(0);
    if (!task || !base) throw new Error("no gym or block");
    return Array.from({ length: n }, (_, i) => ({
      ...base,
      id: `g${i}`,
      taskId: task.id,
      start: WED + (10 + i) * 3_600_000,
      end: WED + (10 + i) * 3_600_000 + 30 * 60_000,
    }));
  };

  it("tres bloques en la semana son 3 de 3, aunque sean más cortos que la sesión", () => {
    const d = pruebasData(WED);
    expect(routineShortfalls(d, WED, blocksOf(d, 3))).toEqual([]);
  }, 30_000);

  it("dos bloques son «2 de 3»", () => {
    const d = pruebasData(WED);
    const found = routineShortfalls(d, WED, blocksOf(d, 2));
    expect(found.map((r) => `${r.placed} de ${r.wanted}`)).toEqual(["2 de 3"]);
  }, 30_000);

  it("la tarjeta de franja cita también la franja del miércoles, o no sale si la cumple", () => {
    const d = pruebasData(WED);
    expect(preferenceMisfits(d)).toEqual([]);
    const early: AppData = {
      ...d,
      activities: d.activities.map((a) =>
        a.id === "gym" ? { ...a, preferred: { start: 6 * 60, end: 8 * 60 } } : a,
      ),
    };
    expect(preferenceMisfits(early).map((m) => m.allowed)).toEqual(["09:00–17:00 y 17:00–20:00"]);
  }, 30_000);
});

describe("4. Mi semana: levantarse tarde no culpa al almuerzo", () => {
  const ok: WeekFormValues = {
    wake: "10:00",
    morning: "30",
    breakfast: "07:30",
    breakfastMin: "20",
    lunch: "13:00",
    lunchMin: "60",
    snack: "17:30",
    snackMin: "0",
    dinner: "21:00",
    dinnerMin: "30",
    freeFrom: "22:00",
    bed: "23:00",
  };
  it("solo se dice el desayuno, que cae antes de levantarte", () => {
    const text = weekProblems(ok).map((p) => p.message);
    expect(text.some((m) => m.startsWith("Desayuno"))).toBe(true);
    expect(text.some((m) => m.includes("no puede ir antes"))).toBe(false);
  });
  it("un almuerzo realmente antes del desayuno se sigue diciendo", () => {
    const text = weekProblems({ ...ok, wake: "07:00", lunch: "07:00" }).map((p) => p.message);
    expect(text.some((m) => m.includes("no puede ir antes que desayuno"))).toBe(true);
  });
});

describe("6 y 7. Horas de «Nueva»", () => {
  it("-5 dice un rango que el 0 no rompe", () => {
    expect(estimateProblem("-5", 0)).toContain("más de 0 a");
    expect(estimateProblem("0", 0)).toMatch(/no pueden ser 0/);
    expect(estimateProblem("1", 0)).toBeNull();
  });

  const teacher: AppTask = {
    id: "p1",
    activityId: "x",
    title: "Parcial anterior",
    kind: "deliverable",
    estimateMinutes: 780,
    minMinutes: 690,
    priority: 2,
    status: "done",
    units: [],
  };

  it("las horas propuestas llevan coma y se ven como sugeridas", () => {
    expect(hoursField(690)).toBe("11,5");
    render(
      <ToastProvider>
        <StoreProvider
          initial={(now): AppData => ({ ...demoData(now), tasks: [teacher] })}
          persist={false}
          fixedNow={WED}
        >
          <TaskEditor onClose={vi.fn()} />
        </StoreProvider>
      </ToastProvider>,
    );
    const estimate = screen.getByLabelText<HTMLInputElement>("Horas estimadas");
    const minimum = screen.getByLabelText<HTMLInputElement>("Mínimo (horas)");
    expect([estimate.value, minimum.value]).toEqual(["13", "11,5"]);
    expect(estimate.className).toBe("suggested");
    fireEvent.change(minimum, { target: { value: "10" } });
    expect(minimum.className).toBe("");
  }, 30_000);
});

describe("5. Nombre de más de 80 caracteres", () => {
  it("se dice y no se guarda cortado", () => {
    render(
      <ToastProvider>
        <StoreProvider initial={demoData} persist={false} fixedNow={WED}>
          <TaskEditor origin="silos" onClose={vi.fn()} />
        </StoreProvider>
      </ToastProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText("Parcial Física I"), {
      target: { value: "palabra ".repeat(11) },
    });
    fireEvent.change(screen.getByLabelText("Materia o actividad"), { target: { value: "new" } });
    fireEvent.click(screen.getByRole("button", { name: /^Guardar/ }));
    expect(screen.getByText("Como máximo 80 caracteres")).toBeTruthy();
    expect(screen.queryByText(/\.\.(?!\.)/)).toBeNull();
  }, 30_000);
});

describe("3, 8 y 9. Bandeja", () => {
  const open = () =>
    render(
      <App
        fixedNow={MONDAY}
        initial={(now) =>
          seedHistory({ ...demoData(now), preferences: { holidaysOff: false } }, now)
        }
      />,
    );
  const hechos = () => screen.queryAllByLabelText(/^Hecho: /);
  const partes = () =>
    screen.queryAllByRole("button").filter((b) => b.hasAttribute("aria-pressed"));
  const toBandeja = () => fireEvent.click(screen.getByRole("button", { name: /Bandeja/ }));

  it("un doble toque en ✓ no marca la parte que aparece debajo", { timeout: 30_000 }, () => {
    open();
    toBandeja();
    const first = hechos().at(0);
    if (!first) throw new Error("no block to answer");
    act(() => {
      first.click();
    });
    const part = partes().at(0);
    if (!part) throw new Error("no part shown");
    act(() => {
      part.click();
    });
    expect(part.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Anotar hecho" }).hasAttribute("disabled")).toBe(
      true,
    );
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + ANSWER_GUARD_MS + 1);
    act(() => {
      part.click();
    });
    expect(part.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Anotar hecho" }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("«Planificar así» avisa y se puede deshacer", { timeout: 30_000 }, () => {
    render(
      <ToastProvider>
        <StoreProvider initial={() => pruebasData(WED)} persist={false} fixedNow={WED}>
          <Inbox />
        </StoreProvider>
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Planificar así" }));
    expect(document.querySelector(".snack")?.textContent).toContain("planificada");
    expect(screen.queryByRole("button", { name: "Planificar así" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(screen.getByRole("button", { name: "Planificar así" })).toBeTruthy();
  });
});
