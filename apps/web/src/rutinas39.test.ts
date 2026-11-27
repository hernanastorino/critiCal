import { afterEach, describe, expect, it } from "vitest";
import { TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import type { AppData, AppTask } from "./model.js";
import {
  decisions,
  endOfWeek,
  refreshPlan,
  routineShortfalls,
  routineWeek,
  weekStart,
} from "./planning.js";
import { loadDemo, reducer } from "./store.js";
import { plannedVsDone } from "./week-review.js";

afterEach(() => {
  localStorage.removeItem(DEMO_KIND_KEY);
});

// La fecha de hoy se prueba además de las fijas: lo que falla es lo que depende del día.
const real = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
interface Moment {
  label: string;
  date: string;
  minute: number;
}
const THURSDAY: Moment = { label: "jueves 13:40", date: "2026-11-26", minute: 13 * 60 + 40 };
const REAL: Moment = { label: "real 13:40", date: real, minute: 13 * 60 + 40 };

const taskOf = (d: AppData, name: string): AppTask => {
  const t = d.tasks.find((x) => x.title === name);
  if (!t) throw new Error(`no ${name}`);
  return t;
};

/** La demo de pruebas con una rutina creada como la crea Ajustes › Rutinas. */
function made(name: string, times: number, minutes: number, at: Moment, days?: boolean) {
  localStorage.setItem(DEMO_KIND_KEY, "pruebas");
  const now = zonedInstant(TIMEZONE, at.date, at.minute);
  const data = reducer(loadDemo(now), {
    type: "saveRoutine",
    name,
    sessionsPerWeek: times,
    sessionMinutes: minutes,
    // «Lunes a sábado menos jueves», de 08 a 20.
    validHours: days
      ? { all: { start: 8 * 60, end: 20 * 60 }, days: { 0: null, 4: null } }
      : undefined,
    now,
  });
  return { data, now, task: taskOf(data, name) };
}

const COMBOS = [
  [2, 45, false],
  [3, 45, false],
  [4, 45, true],
  [2, 60, false],
  [3, 60, true],
  [4, 60, false],
  [3, 75, false],
] as const;

describe("falla 1: una rutina de 45 min creada un jueves por la tarde se planifica", () => {
  describe.each([THURSDAY, REAL])("$label", (at) => {
    it.each(COMBOS)(
      "%d veces de %d min (días permitidos: %s): la semana siguiente entra completa",
      (times, minutes, days) => {
        const { data, now, task } = made("Bici", times, minutes, at, days);
        const plan = refreshPlan(data, now);
        const next = routineWeek(data, now, plan.result.blocks, task, plan.input, now + 7 * 864e5);
        expect(next?.placed).toBe(times);
        expect(next?.reason).toBeUndefined();
        // Una por día como mucho.
        const days7 = plan.result.blocks
          .filter((b) => b.taskId === task.id)
          .map((b) => new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(b.start));
        const perDay = new Map<string, number>();
        for (const d of days7) perDay.set(d, (perDay.get(d) ?? 0) + 1);
        // Un bloque por franja de 30 min: dos franjas hacen una sesión de 45–60 min.
        const slots = Math.ceil(minutes / 30);
        for (const n of perDay.values()) expect(n).toBeLessThanOrEqual(slots);
        // «Aunque no hubiera nada más» solo si es cierto: con la semana vacía, nunca.
        const week = routineWeek(data, now, plan.result.blocks, task, plan.input);
        if (week?.reason === "own") expect(week.placed).toBeLessThan(week.wanted);
        const d = decisions(plan.input, plan.result, { data, now });
        if (d.noFits.includes(task.id)) expect(week?.reason).toBe("own");
      },
      60_000,
    );
  });

  it("jueves 13:40: Bici 2×45 y Correr 4×45 (lun–sáb menos jue) entran, y no están en la Bandeja", () => {
    for (const [name, times, days] of [
      ["Bici", 2, false],
      ["Correr", 4, true],
    ] as const) {
      const { data, now, task } = made(name, times, 45, THURSDAY, days);
      const plan = refreshPlan(data, now);
      const week = routineWeek(data, now, data.plan, task, plan.input);
      expect(week?.placed, name).toBe(week?.wanted);
      expect(routineShortfalls(data, now, data.plan, plan.input).map((r) => r.name)).not.toContain(
        name,
      );
      const next = routineWeek(data, now, data.plan, task, plan.input, now + 7 * 864e5);
      expect(next?.placed, `${name} la semana siguiente`).toBe(times);
    }
  }, 60_000);
});

describe("falla 2: todas las pantallas leen el plan que muestra la Semana", () => {
  it.each([THURSDAY, REAL])(
    "$label: Gym, con otras rutinas creadas, cuenta los bloques de data.plan",
    (at) => {
      localStorage.setItem(DEMO_KIND_KEY, "pruebas");
      const now = zonedInstant(TIMEZONE, at.date, at.minute);
      let data = loadDemo(now);
      const gym = taskOf(data, "Gym");
      for (const [name, times, minutes] of [
        [undefined, 0, 0],
        ["Bici", 2, 45],
        ["Correr", 4, 45],
        ["Leer", 3, 60],
      ] as const) {
        if (name) {
          data = reducer(data, {
            type: "saveRoutine",
            name,
            sessionsPerWeek: times,
            sessionMinutes: minutes,
            now,
          });
        }
        const plan = refreshPlan(data, now);
        const monday = zonedInstant(TIMEZONE, weekStart(TIMEZONE, now), 0);
        const end = endOfWeek(TIMEZONE, now);
        const shown = data.plan.filter(
          (b) => b.taskId === gym.id && b.end > now && b.start >= monday && b.start < end,
        );
        const week = routineWeek(data, now, data.plan, gym, plan.input);
        expect(week?.planned).toBe(shown.length);
        // La Bandeja, la hoja del bloque y Silos leen los mismos bloques.
        const card = routineShortfalls(data, now, data.plan, plan.input).find(
          (r) => r.taskId === gym.id,
        );
        expect(card?.placed).toBe(week && week.placed < week.wanted ? week.placed : undefined);
        const ended = data.plan
          .filter((b) => b.taskId === gym.id && b.start >= monday && b.end <= now)
          .reduce((sum, b) => sum + (b.end - b.start) / 60000, 0);
        expect(plannedVsDone(data, now).find((r) => r.taskId === gym.id)?.planned ?? 0).toBe(ended);
      }
    },
    90_000,
  );
});
