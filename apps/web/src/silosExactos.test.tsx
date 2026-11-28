import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActivitySettings } from "./components/Preferences.js";
import { Semester } from "./components/Semester.js";
import { TaskEditor } from "./components/TaskEditor.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY } from "./demoPruebas.js";
import { clearDrafts } from "./drafts.js";
import { zonedInstant } from "./engine.js";
import type { AppData, AppTask } from "./model.js";
import { endOfWeek, progress, refreshPlan } from "./planning.js";
import { StoreProvider, useStore } from "./store.js";
import { studyOf } from "./subjects.js";

// SPEC §18.17: lo asignado de un silo de estudio semanal es exacto (5,5 h = 5h30, no 6 h) por
// cada camino que lo crea o lo edita. Fecha fija y fecha real: lo que falla depende del día.
const real = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
const MOMENTS = [
  ["fecha fija", "2026-11-23", 7 * 60],
  ["fecha real", real, 7 * 60],
] as const;
// [lo que se escribe, minutos asignados, minutos que reserva el plan (bloques de 30)].
const HOURS = [
  ["4", 240, 240],
  ["5,5", 330, 330],
  ["5.5", 330, 330],
  ["2,75", 165, 180],
] as const;

let latest: AppData | undefined;
function Probe() {
  latest = useStore().data;
  return null;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
  latest = undefined;
});
afterEach(() => {
  cleanup();
  clearDrafts();
  localStorage.removeItem(DEMO_KIND_KEY);
});

const inside = (now: number, ui: React.ReactNode, initial = demoData) =>
  render(
    <ToastProvider>
      <StoreProvider initial={initial} persist={false} fixedNow={now}>
        {ui}
        <Probe />
      </StoreProvider>
    </ToastProvider>,
  );

/** Lo que muestra el silo («falta» y «asignado») y lo que reserva el plan la semana que viene. */
function check(now: number, task: AppTask | undefined, assigned: number, reserved: number) {
  expect(task).toBeDefined();
  expect(task?.estimateMinutes).toBe(assigned);
  expect(task?.minMinutes).toBe(assigned);
  const data = latest;
  if (!data || !task) return;
  const shown = progress(data, now).find((p) => p.task.id === task.id);
  expect(shown?.totalMinutes).toBe(assigned);
  expect(shown?.remainingMinutes).toBe(assigned);
  const end = endOfWeek(TIMEZONE, now);
  const blocks = refreshPlan(data, now).result.blocks.filter(
    (b) => b.taskId === task.id && b.start >= end,
  );
  expect(blocks.reduce((n, b) => n + (b.end - b.start) / 60_000, 0)).toBe(reserved);
}

const firstMateria = (d: AppData) => d.activities.find((a) => a.academic && a.kind !== "rutina");

describe.each(MOMENTS)("silo semanal exacto (%s)", (_label, date, minute) => {
  const now = zonedInstant(TIMEZONE, date, minute);

  it.each(HOURS)("Agregar materia con %s h", (typed, assigned, reserved) => {
    inside(now, <Semester />);
    fireEvent.change(screen.getByPlaceholderText("Física II"), { target: { value: "Química" } });
    fireEvent.change(screen.getByLabelText("Estudio semanal (h)"), { target: { value: typed } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar materia" }));
    const subject = latest?.activities.find((a) => a.name === "Química");
    check(now, latest && subject && studyOf(latest, subject), assigned, reserved);
  });

  it.each(HOURS)("editar la materia con %s h", async (typed, assigned, reserved) => {
    inside(now, <ActivitySettings />);
    const name = (latest && firstMateria(latest)?.name) ?? "";
    fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
    fireEvent.change(screen.getByLabelText(/Estudio semanal/), { target: { value: typed } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Guardar/ }));
    });
    const subject = latest?.activities.find((a) => a.name === name);
    check(now, latest && subject && studyOf(latest, subject), assigned, reserved);
  });

  it.each(HOURS)(
    "la tarea de estudio de %s h guardada en su formulario no se pisa",
    async (_typed, assigned, reserved) => {
      const start = (n: number): AppData => {
        const d = demoData(n);
        const activityId = (firstMateria(d) ?? d.activities[0])?.id ?? "";
        const silo: AppTask = {
          id: "silo-exacto",
          activityId,
          title: "Estudio exacto",
          study: true,
          kind: "habit",
          estimateMinutes: assigned,
          minMinutes: assigned,
          sessionsPerWeek: Math.ceil(assigned / 60),
          sessionMinutes: 60,
          priority: 2,
          status: "active",
          units: [],
        };
        return {
          ...d,
          tasks: [...d.tasks.filter((t) => t.activityId !== activityId || !t.study), silo],
        };
      };
      const task = start(now).tasks.find((t) => t.id === "silo-exacto");
      inside(now, <TaskEditor task={task} onClose={() => undefined} />, start);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^Guardar/ }));
      });
      check(
        now,
        latest?.tasks.find((t) => t.id === "silo-exacto"),
        assigned,
        reserved,
      );
    },
  );
});

describe.each(MOMENTS)(
  "silo de estudio viejo, solo con minMinutes (%s)",
  (_label, date, minute) => {
    const now = zonedInstant(TIMEZONE, date, minute);

    it("5,5 h guardadas solo en minMinutes dicen faltan 5h30 y reservan 330 min", () => {
      const d = demoData(now);
      const activityId = (firstMateria(d) ?? d.activities[0])?.id ?? "";
      const silo: AppTask = {
        id: "silo-viejo",
        activityId,
        title: "Estudio viejo",
        study: true,
        kind: "habit",
        estimateMinutes: 0,
        minMinutes: 330,
        sessionsPerWeek: 6,
        sessionMinutes: 60,
        priority: 2,
        status: "active",
        units: [],
      };
      inside(now, null, () => ({
        ...d,
        tasks: [...d.tasks.filter((t) => t.activityId !== activityId || !t.study), silo],
      }));
      const old = latest?.tasks.find((t) => t.id === "silo-viejo");
      expect(old?.estimateMinutes).toBe(0);
      const data = latest;
      if (!data) return;
      const shown = progress(data, now).find((p) => p.task.id === "silo-viejo");
      expect(shown?.totalMinutes).toBe(330);
      expect(shown?.remainingMinutes).toBe(330);
      const end = endOfWeek(TIMEZONE, now);
      const blocks = refreshPlan(data, now).result.blocks.filter(
        (b) => b.taskId === "silo-viejo" && b.start >= end,
      );
      expect(blocks.reduce((n, b) => n + (b.end - b.start) / 60_000, 0)).toBe(330);
    });
  },
);
