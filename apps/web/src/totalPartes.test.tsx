import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskEditor } from "./components/TaskEditor.js";
import { demoData, TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import { optionPromise } from "./friendly.js";
import { type AppData, taskTotal } from "./model.js";
import { applyOption, decisions, progress, refreshPlan, shownTotal } from "./planning.js";
import { loadDemo, reducer, StoreProvider } from "./store.js";
import { partsSummary } from "./taskForm.js";

// 45.ª vuelta, SPEC §18.18 y §18.19: con partes, el total es la suma de las partes en el
// plan, los silos, las opciones y el formulario; cada opción dice su propio pronóstico.
const instants = (): [string, number][] => [
  ["miércoles 10:00", zonedInstant(TIMEZONE, "2026-11-25", 10 * 60)],
  ["jueves 20:00", zonedInstant(TIMEZONE, "2026-11-26", 20 * 60)],
  ["domingo 10:00", zonedInstant(TIMEZONE, "2026-11-22", 10 * 60)],
  ["hoy, con la fecha real", Date.now()],
];

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const sumOf = (t: AppData["tasks"][number]) =>
  t.units.filter((u) => !u.skipped).reduce((n, u) => n + u.estimateMinutes, 0);

const loaded = (kind: "pruebas" | "demo", now: number) => {
  if (kind === "pruebas") localStorage.setItem(DEMO_KIND_KEY, "pruebas");
  else localStorage.removeItem(DEMO_KIND_KEY);
  return reducer(loadDemo(now), { type: "refresh", now });
};

describe("el total de una tarea con partes es la suma de las partes", () => {
  it("taskTotal: la suma, tope el recorte de una opción, y el estimado sin partes", () => {
    const unit = (id: string, m: number, skipped = false) => ({
      id,
      title: id,
      estimateMinutes: m,
      ...(skipped ? { skipped } : {}),
    });
    const base = { kind: "deliverable" as const, estimateMinutes: 780 };
    expect(taskTotal({ ...base, units: [unit("a", 300), unit("b", 300)] })).toBe(600);
    expect(taskTotal({ ...base, units: [unit("a", 300), unit("b", 300, true)] })).toBe(300);
    expect(
      taskTotal({ ...base, estimateMinutes: 450, units: [unit("a", 300), unit("b", 300)] }),
    ).toBe(450);
    expect(taskTotal({ ...base, units: [] })).toBe(780);
  });

  it("la Demo de pruebas: Cálculo II tiene 10h de partes y 10h de total", () => {
    const data = loaded("pruebas", zonedInstant(TIMEZONE, "2026-11-25", 10 * 60));
    const calc = data.tasks.find((t) => t.id === "parcial-calc");
    expect(calc && sumOf(calc)).toBe(600);
    expect(calc?.estimateMinutes).toBe(600);
  });

  describe.each(["pruebas", "demo"] as const)("demo %s", (kind) => {
    it.each(instants())("%s: plan, silo y opciones hablan del mismo total", (_n, now) => {
      const data = loaded(kind, now);
      for (const p of progress(data, now)) {
        if (p.task.kind === "habit" || p.task.units.length === 0) continue;
        const total = taskTotal(p.task);
        expect(p.totalMinutes, p.task.title).toBe(total);
        expect(shownTotal(p), p.task.title).toBeLessThanOrEqual(total);
        expect(p.remainingMinutes, p.task.title).toBeLessThanOrEqual(total);
      }
      const plan = refreshPlan(data, now);
      const planned = (r: typeof plan.result, id: string) =>
        r.blocks.filter((b) => b.taskId === id).reduce((n, b) => n + (b.end - b.start) / 60_000, 0);
      const free = decisions(plan.input, plan.result, { data, now }).options.find(
        (o) => o.kind === "use-free-time",
      );
      if (!free) return;
      const after = applyOption(data, plan.input, free, now);
      const again = refreshPlan(after, now);
      for (const t of data.tasks) {
        if (t.kind === "habit" || t.units.length === 0) continue;
        // Free time never makes the plan hold more than the task's total (the silo's).
        expect(planned(free.result, t.id), t.title).toBeLessThanOrEqual(taskTotal(t) + 15);
        expect(planned(again.result, t.id), t.title).toBeLessThanOrEqual(taskTotal(t) + 15);
      }
    });
  });

  it("un estimado por encima de las partes no se reserva ni se muestra", () => {
    const now = zonedInstant(TIMEZONE, "2026-11-25", 10 * 60);
    const data = loaded("pruebas", now);
    const inflated: AppData = {
      ...data,
      tasks: data.tasks.map((t) => (t.id === "parcial-calc" ? { ...t, estimateMinutes: 780 } : t)),
    };
    const p = progress(inflated, now).find((x) => x.task.id === "parcial-calc");
    expect(p?.totalMinutes).toBe(600);
    expect(p && shownTotal(p)).toBeLessThanOrEqual(600);
  });
});

describe("el formulario muestra un solo número", () => {
  it("partsSummary dice el total y que es la suma de las partes", () => {
    expect(partsSummary(270)).toBe("Total 4h30, la suma de las partes.");
    expect(partsSummary(0)).toBeNull();
  });

  it("una entrega de 6h con partes de 4h30 abre con 4h30 y el campo cerrado", () => {
    const now = zonedInstant(TIMEZONE, "2026-11-25", 10 * 60);
    const base = demoData(now).tasks.find((t) => t.kind === "deliverable");
    if (!base) throw new Error("sin entrega");
    const task = {
      ...base,
      estimateMinutes: 360,
      minMinutes: 60,
      units: [
        { id: "a", title: "A", estimateMinutes: 150 },
        { id: "b", title: "B", estimateMinutes: 120 },
      ],
    };
    render(
      <StoreProvider initial={() => demoData(now)} persist={false} fixedNow={now}>
        <TaskEditor task={task} onClose={vi.fn()} />
      </StoreProvider>,
    );
    const field = screen.getByLabelText<HTMLInputElement>("Horas estimadas");
    expect(field.disabled).toBe(true);
    expect(field.value).toBe("4,5");
    expect(screen.getByText("Total 4h30, la suma de las partes.")).toBeTruthy();
  });
});

describe("cada opción dice su propio pronóstico", () => {
  const status = [{ targetDeficit: 0 }];
  it("«Un poco de todo» no promete los mínimos", () => {
    const line = optionPromise(
      {
        kind: "proportional",
        label: "Un poco de todo (97 % de cada mínimo)",
        result: { feasible: true, status },
      },
      false,
      "otra cosa",
    );
    expect(line).toBe("Con esto cubrís el 97 % de cada mínimo, no todo.");
    expect(line).not.toMatch(/llegás a todos los mínimos/);
  });

  it.each(instants())("%s: ninguna opción de «proporcional» dice «llegás a todos»", (_n, now) => {
    for (const kind of ["pruebas", "demo"] as const) {
      const data = loaded(kind, now);
      const plan = refreshPlan(data, now);
      for (const o of decisions(plan.input, plan.result, { data, now }).options) {
        if (o.kind !== "proportional") continue;
        expect(optionPromise(o, plan.result.feasible, "no")).not.toMatch(
          /llegás a todos los mínimos/,
        );
      }
    }
  });
});

describe("«Sugerencia» usa el formato de horas de toda la app", () => {
  it.each(instants())("%s: sin «180 min» sueltos", (_n, now) => {
    for (const kind of ["pruebas", "demo"] as const) {
      const data = loaded(kind, now);
      const plan = refreshPlan(data, now);
      for (const r of decisions(plan.input, plan.result, { data, now }).recommendations) {
        expect(r.message).not.toMatch(/\d+ min\b/);
      }
    }
  });
});
