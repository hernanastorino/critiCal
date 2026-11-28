import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Backup } from "./components/Backup.js";
import { formOf, switchDays } from "./components/Preferences.js";
import { ActivitySettings } from "./components/Subjects.js";
import { TaskEditor } from "./components/TaskEditor.js";
import { ToastProvider } from "./components/Toast.js";
import { WeeklyPlan } from "./components/WeeklyPlan.js";
import { demoData, TIMEZONE } from "./demo.js";
import { clearDrafts, hasPageDrafts, hasSettingsDrafts } from "./drafts.js";
import { zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import { progress } from "./planning.js";
import { reducer, StoreProvider, seedHistory } from "./store.js";
import { runningSince } from "./testing.js";
import { type WeekFormValues, weekProblems } from "./weekForm.js";

const MON = zonedInstant(TIMEZONE, "2026-11-02", 6 * 60);

beforeEach(() => {
  localStorage.clear();
  clearDrafts();
});
afterEach(() => {
  cleanup();
  clearDrafts();
  vi.restoreAllMocks();
});

const ok: WeekFormValues = {
  wake: "07:00",
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

describe("Mi semana: marcar y desmarcar un día", () => {
  const week = demoData(MON).settings.week.map((d, i) =>
    i === 6 ? { ...d, wake: d.wake + 120, bed: d.bed + 60 } : d,
  );
  const monday = week.at(1);
  if (!monday) throw new Error("no monday");
  const draft = { days: [1, 2, 3, 4, 5], form: formOf(monday), held: {} };

  it("marcar y desmarcar S vuelve al mismo borrador (no hay nada que descartar)", () => {
    const withSat = switchDays(draft, [1, 2, 3, 4, 5, 6], week);
    const back = switchDays(withSat, [1, 2, 3, 4, 5], week);
    // As text, like the draft's own «dirty» check: the same keys in the same order.
    expect(JSON.stringify(back)).toBe(JSON.stringify(draft));
  });

  it("al sumar un día se ven los valores de ese día", () => {
    const withSat = switchDays(draft, [1, 2, 3, 4, 5, 6], week);
    expect(withSat.form.wake).not.toBe(draft.form.wake);
    expect(withSat.days).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("lo escrito se conserva y se comparte con el día que se suma", () => {
    const typed = { ...draft, form: { ...draft.form, morning: "99" } };
    const withSat = switchDays(typed, [1, 2, 3, 4, 5, 6], week);
    expect(withSat.form.morning).toBe("99");
  });
});

describe("Mi semana: los errores usan el nombre que ve la persona", () => {
  it("la duración de una comida se llama «Dura (min)» de esa comida", () => {
    const found = weekProblems({ ...ok, breakfastMin: "999", dinnerMin: "2,5" });
    const text = found.map((p) => p.message).join(" ");
    expect(text).toContain("«Dura (min)» del desayuno");
    expect(text).toContain("«Dura (min)» de la cena");
    expect(text).not.toContain("Dura (min), ");
  });
});

describe("Exportar JSON avisa", () => {
  it("muestra «Respaldo exportado» al tocar el botón", () => {
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    render(
      <ToastProvider>
        <StoreProvider initial={demoData} persist={false} fixedNow={MON}>
          <Backup />
        </StoreProvider>
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Exportar JSON" }));
    expect(document.querySelector(".snack")?.textContent).toBe("Respaldo exportado");
    vi.unstubAllGlobals();
  });
});

describe("Hecho sin partes", () => {
  it("no mueve «Faltan» ni el mínimo (son las partes las que cuentan)", {
    timeout: 60_000,
  }, () => {
    const now = zonedInstant(TIMEZONE, "2026-11-03", 15 * 60);
    const d = seedHistory(demoData(now), now);
    const withParts = progress(d, now).find(
      (p) => p.task.units.length > 0 && p.minRemainingMinutes > 0,
    );
    if (!withParts) throw new Error("no task with parts");
    const block = d.plan.find(
      (b) => b.taskId === withParts.task.id && !d.checkIns.some((c) => c.blockId === b.id),
    );
    if (!block) throw new Error("no block");
    const done = reducer(d, {
      type: "checkIn",
      now,
      checkIn: {
        id: "c-sin-partes",
        blockId: block.id,
        taskId: block.taskId,
        status: "done",
        minutesDone: 30,
        unitIds: [],
      },
    });
    const after = progress(done, now).find((p) => p.task.id === withParts.task.id);
    expect(after?.remainingMinutes).toBe(withParts.remainingMinutes);
    expect(after?.minRemainingMinutes).toBe(withParts.minRemainingMinutes);
  });
});

describe("Nueva actividad", () => {
  const open = () =>
    render(
      <ToastProvider>
        <StoreProvider initial={demoData} persist={false} fixedNow={MON}>
          <TaskEditor origin="silos" onClose={vi.fn()} />
        </StoreProvider>
      </ToastProvider>,
    );
  it("no elige la materia por la persona: pide elegirla", () => {
    open();
    const select = screen.getByLabelText("Materia o actividad");
    expect(select).toHaveProperty("value", "");
    fireEvent.change(screen.getByPlaceholderText("Parcial Física I"), {
      target: { value: "Parcial 1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Guardar/ }));
    expect(screen.getByText("Elegí la materia")).toBeTruthy();
  });

  it("con una materia elegida ya no pide nada", () => {
    open();
    fireEvent.change(screen.getByLabelText("Materia o actividad"), { target: { value: "new" } });
    expect(screen.queryByText("Elegí la materia")).toBeNull();
  });

  it("avisa que 130 h no entran en 3 días (se puede guardar igual)", () => {
    open();
    fireEvent.change(screen.getByLabelText("Horas estimadas"), { target: { value: "130" } });
    expect(screen.getByText(/No entran 130h antes de esa fecha/)).toBeTruthy();
  });

  it("un nombre de más de 80 caracteres se dice, no se corta en silencio", () => {
    open();
    const long = "A".repeat(81);
    fireEvent.change(screen.getByPlaceholderText("Parcial Física I"), { target: { value: long } });
    expect(screen.getByPlaceholderText("Parcial Física I")).toHaveProperty("value", long);
    expect(screen.getByText("Como máximo 80 caracteres")).toBeTruthy();
  });
});

describe("Planificación semanal de la semana próxima", () => {
  it("no cuenta como «no entran» lo que vencía antes de esa semana", { timeout: 30_000 }, () => {
    const base = demoData(MON);
    const act = base.activities.find((a) => a.kind !== "rutina");
    if (!act) throw new Error("no materia");
    const due = (iso: string) => zonedInstant(TIMEZONE, iso, 23 * 60);
    const huge = (id: string, iso: string): AppData["tasks"][number] => ({
      id,
      activityId: act.id,
      title: id,
      kind: "deliverable",
      deadline: due(iso),
      estimateMinutes: 100 * 60,
      minMinutes: 90 * 60,
      priority: 2,
      status: "active",
      units: [],
    });
    const build = (iso: string): AppData =>
      runningSince({ ...base, tasks: [...base.tasks, huge("enorme", iso)] }, MON);
    const text = (iso: string) => {
      const view = render(
        <StoreProvider initial={() => build(iso)} persist={false} fixedNow={MON}>
          <WeeklyPlan onClose={vi.fn()} onInbox={vi.fn()} />
        </StoreProvider>,
      );
      const said = document.body.textContent ?? "";
      view.unmount();
      return said;
    };
    // Due on Wednesday of the current week: over before the week being planned starts.
    expect(text("2026-11-04")).not.toMatch(/No llegás a todo/);
    // Due in the planned week: it is part of that plan.
    expect(text("2026-11-12")).toMatch(/No llegás a todo|No llega al mínimo/);
  });
});

describe("una materia eliminada mientras se editaba", () => {
  it("no deja nada por descartar en Ajustes (ni el nombre ni las horas escritas)", () => {
    render(
      <StoreProvider initial={demoData} persist={false} fixedNow={MON}>
        <ToastProvider>
          <ActivitySettings />
        </ToastProvider>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Física I/ }));
    fireEvent.change(screen.getByLabelText("Nombre de la materia"), {
      target: { value: "Física I bis" },
    });
    fireEvent.change(screen.getByLabelText("Estudio semanal (h), además de las evaluaciones"), {
      target: { value: "9" },
    });
    expect(hasSettingsDrafts()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /^Eliminar/ }));
    expect(hasSettingsDrafts()).toBe(false);
    expect(hasPageDrafts("subjects")).toBe(false);
    expect(sessionStorage.getItem("critical.drafts")).toBeNull();
  });
});
