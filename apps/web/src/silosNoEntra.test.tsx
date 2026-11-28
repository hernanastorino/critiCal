import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Inbox } from "./components/Inbox.js";
import { Silos } from "./components/Silos.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import { optionsTitle, siloWeekText } from "./friendly.js";
import type { AppData, AppTask } from "./model.js";
import { decisions, focusWeekAt, progress, refreshPlan, siloWeekFit } from "./planning.js";
import { loadDemo, reducer, StoreProvider } from "./store.js";

// SPEC §18 punto 19: un silo cuya semana no aguanta lo asignado lo dice, y el título de
// las opciones distingue «llegás a los mínimos» de «no llegás a todo».
const real = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
const MOMENTS = [
  ["fecha fija", "2026-11-27", 22 * 60],
  ["fecha real", real, 22 * 60],
] as const;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
  localStorage.setItem(DEMO_KIND_KEY, "pruebas");
});
afterEach(() => {
  cleanup();
  localStorage.removeItem(DEMO_KIND_KEY);
});

function withIngles(now: number, total: number): { data: AppData; task: AppTask } {
  const d = loadDemo(now);
  const activityId = d.activities.find((a) => a.kind !== "rutina")?.id ?? "";
  const task: AppTask = {
    id: "ingles",
    activityId,
    title: "Estudio Inglés",
    study: true,
    kind: "habit",
    estimateMinutes: total,
    minMinutes: total,
    sessionsPerWeek: Math.ceil(total / 60),
    sessionMinutes: 60,
    priority: 2,
    status: "active",
    units: [],
  };
  return { data: { ...d, tasks: [...d.tasks, task] }, task };
}

function fitOf(data: AppData, task: AppTask, now: number) {
  const plan = refreshPlan(data, now).result;
  const p = progress(data, now, focusWeekAt(data, now)).find((x) => x.task.id === task.id);
  if (!p) throw new Error("sin silo");
  return siloWeekFit(data, now, p, plan);
}

describe.each(MOMENTS)("silo que no entra: %s", { timeout: 30_000 }, (_n, date, minute) => {
  const now = zonedInstant(TIMEZONE, date, minute);

  it("5h30 con poca semana: dice cuánto entra", () => {
    const { data, task } = withIngles(now, 330);
    const fit = fitOf(data, task, now);
    expect(fit?.of).toBe(330);
    expect(fit?.placed).toBeLessThan(330);
    render(
      <ToastProvider>
        <StoreProvider initial={() => data} persist={false} fixedNow={now}>
          <Silos />
        </StoreProvider>
      </ToastProvider>,
    );
    expect(screen.getByText(siloWeekText(fit?.placed ?? 0, 330))).toBeTruthy();
  });

  it("la Bandeja ofrece algo aplicable a Inglés", () => {
    const { data, task } = withIngles(now, 330);
    const plan = refreshPlan(data, now);
    const d = decisions(plan.input, plan.result, { data, now });
    expect(
      d.options.some(
        (o) =>
          o.taskId === task.id ||
          o.result.status.some((s) => s.taskId === task.id && s.targetDeficit === 0),
      ),
    ).toBe(true);
  });

  it("con lugar de sobra no dice nada", () => {
    const { data, task } = withIngles(now, 30);
    expect(fitOf(data, task, now)).toBeUndefined();
  });
});

describe("título de las opciones", { timeout: 30_000 }, () => {
  it("según la etapa", () => {
    expect(optionsTitle(false)).toBe("No llegás a todo");
    expect(optionsTitle(true)).toBe("Llegás a los mínimos, no a todo");
  });
});

describe.each(MOMENTS)("título en la Bandeja: %s", { timeout: 30_000 }, (_n, date, minute) => {
  const now = zonedInstant(TIMEZONE, date, minute);
  const bandeja = (change: (t: AppTask) => AppTask) => {
    const d = loadDemo(now);
    const data = { ...d, tasks: d.tasks.map((t) => (t.id === "parcial-calc" ? change(t) : t)) };
    render(
      <ToastProvider>
        <StoreProvider initial={() => data} persist={false} fixedNow={now}>
          <Inbox />
        </StoreProvider>
      </ToastProvider>,
    );
  };

  it("sin llegar a un mínimo: «No llegás a todo»", () => {
    bandeja((t) => ({ ...t, minMinutes: 6000, estimateMinutes: 6000, units: [] }));
    expect(screen.getByText("No llegás a todo · elegí")).toBeTruthy();
  }, 30_000);

  it("el título sigue la etapa del plan, en cualquier día", () => {
    bandeja((t) => ({ ...t, minMinutes: 60, estimateMinutes: 6000, units: [] }));
    const d = loadDemo(now);
    const plan = refreshPlan(
      {
        ...d,
        tasks: d.tasks.map((t) =>
          t.id === "parcial-calc" ? { ...t, minMinutes: 60, estimateMinutes: 6000, units: [] } : t,
        ),
      },
      now,
    );
    const other = optionsTitle(!plan.result.feasible);
    expect(screen.queryByText(`${other} · elegí`)).toBeNull();
  });
});

describe("título en la Bandeja: segunda etapa", { timeout: 30_000 }, () => {
  it("con los mínimos adentro y el estimado corto: «Llegás a los mínimos, no a todo»", () => {
    const at = zonedInstant(TIMEZONE, "2026-11-18", 12 * 60);
    const base = reducer(demoData(at), { type: "refresh", now: at });
    const data = reducer(
      {
        ...base,
        checkIns: [
          {
            id: "c1",
            blockId: "b1",
            taskId: "parcial-calc",
            status: "done" as const,
            minutesDone: 390,
            createdAt: at - 3_600_000,
            unitIds: ["u1"],
          },
        ],
      },
      { type: "refresh", now: at },
    );
    render(
      <StoreProvider initial={() => data} persist={false} fixedNow={at}>
        <ToastProvider>
          <Inbox />
        </ToastProvider>
      </StoreProvider>,
    );
    expect(screen.getByText("Llegás a los mínimos, no a todo · elegí")).toBeTruthy();
    expect(screen.queryByText("No llegás a todo · elegí")).toBeNull();
  });
});
