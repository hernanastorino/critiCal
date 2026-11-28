import { afterEach, describe, expect, it } from "vitest";
import { demoData, TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import type { AppTask } from "./model.js";
import { endOfWeek, refreshPlan } from "./planning.js";

afterEach(() => {
  localStorage.removeItem(DEMO_KIND_KEY);
});

// La fecha de hoy se prueba además de la fija: lo que falla es lo que depende del día.
const real = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
const MOMENTS = [
  ["lunes temprano", "2026-11-23", 7 * 60],
  ["real", real, 7 * 60],
] as const;

/** Las sesiones (en minutos) que el plan pone la semana que viene a un silo de estudio con su Total exacto. */
function planned(totalMinutes: number, date: string, minute: number) {
  const now = zonedInstant(TIMEZONE, date, minute);
  const d = demoData(now);
  const activityId = d.activities.find((a) => a.kind !== "rutina")?.id ?? "";
  const task: AppTask = {
    id: "silo-semanal",
    activityId,
    title: "Estudio Semanal",
    study: true,
    kind: "habit",
    estimateMinutes: totalMinutes,
    minMinutes: totalMinutes,
    sessionsPerWeek: Math.ceil(totalMinutes / 60),
    sessionMinutes: 60,
    priority: 2,
    status: "active",
    units: [],
  };
  const data = { ...d, tasks: [...d.tasks, task] };
  const end = endOfWeek(TIMEZONE, now);
  return refreshPlan(data, now)
    .result.blocks.filter((b) => b.taskId === task.id && b.start >= end)
    .map((b) => (b.end - b.start) / 60_000);
}

describe("silo de estudio semanal: el plan reserva lo asignado", () => {
  describe.each(MOMENTS)("%s", (_label, date, minute) => {
    it.each([
      ["4 h", 240, 240],
      ["5 h 30", 330, 330],
      // Los bloques son de 30 min: 2 h 45 sube a 3 h.
      ["2 h 45", 165, 180],
    ])("%s", (_name, total, reserved) => {
      const sessions = planned(total, date, minute);
      expect(sessions.reduce((n, m) => n + m, 0)).toBe(reserved);
    });
  });
});
