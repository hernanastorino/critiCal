import { afterEach, describe, expect, it } from "vitest";
import { demoData, TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import { routineWeekText } from "./friendly.js";
import type { AppData, AppTask } from "./model.js";
import {
  decisions,
  endOfDay,
  pendingConfirmations,
  refreshPlan,
  routineCapacity,
  routineDaysLeft,
  routineSessions,
  routineShortfalls,
  routineWeek,
  standingCheckIns,
} from "./planning.js";
import { loadDemo, reducer } from "./store.js";

afterEach(() => {
  localStorage.removeItem(DEMO_KIND_KEY);
});

const at = (date: string, minute: number) => zonedInstant(TIMEZONE, date, minute);
const gymOf = (d: AppData): AppTask => {
  const task = d.tasks.find((t) => t.id === "gym" || t.title === "Gym");
  if (!task) throw new Error("no gym");
  return task;
};

/** A routine 3×/week of an hour, lunes a sábado de 07 a 18, made at `now`. */
function made(date: string, minute: number): { data: AppData; task: AppTask; now: number } {
  const now = at(date, minute);
  const base = loadDemo(now);
  const data = reducer(
    { ...base, activities: [], tasks: [], plan: [], checkIns: [] },
    {
      type: "saveRoutine",
      name: "Gym",
      sessionsPerWeek: 3,
      sessionMinutes: 60,
      validHours: { all: { start: 7 * 60, end: 18 * 60 }, days: { 0: null } },
      now,
    },
  );
  return { data, task: gymOf(data), now };
}

describe("la regla: mín(faltan, días posibles que quedan), una por día", () => {
  it("ejemplo 1: creada el jueves 19:00 con lun–sáb 07–18 quedan vie y sáb → 2", () => {
    const { data, task, now } = made("2026-11-26", 19 * 60);
    expect(routineDaysLeft(data, task, now)).toBe(2);
    expect(routineSessions(data, task, now)).toBe(2);
  });

  it("ejemplo 2: la misma, creada el lunes 10:00 → 3", () => {
    const { data, task, now } = made("2026-11-23", 10 * 60);
    expect(routineDaysLeft(data, task, now)).toBe(6);
    expect(routineSessions(data, task, now)).toBe(3);
  });

  it("hoy cuenta solo si queda franja para una sesión completa", () => {
    const early = made("2026-11-26", 16 * 60);
    expect(routineDaysLeft(early.data, early.task, early.now)).toBe(3);
    const late = made("2026-11-26", 17 * 60 + 30);
    expect(routineDaysLeft(late.data, late.task, late.now)).toBe(2);
  });

  it("ejemplo 3: Gym de la demo con 1 hecha el miércoles, el jueves 10:13 → 3 en la semana", () => {
    localStorage.setItem(DEMO_KIND_KEY, "pruebas");
    const now = at("2026-11-26", 10 * 60 + 13);
    const data = loadDemo(now);
    const gym = gymOf(data);
    expect(routineDaysLeft(data, gym, now)).toBe(2);
    expect(routineCapacity(data, gym, now)).toBe(3);
  });
});

/** Una materia con 168 h semanales, como la carga Ajustes › Inicio de cuatrimestre. */
function withHugeSubject(data: AppData): AppData {
  const activity = {
    id: "m168",
    name: "Física",
    color: "#cc3300",
    academic: true,
    kind: "materia" as const,
    maxSessionMinutes: 120,
    minBlockMinutes: 60,
  };
  const task: AppTask = {
    id: "t168",
    activityId: activity.id,
    title: "Estudio Física",
    study: true,
    kind: "habit",
    estimateMinutes: 0,
    minMinutes: 168 * 60,
    sessionsPerWeek: 168,
    sessionMinutes: 60,
    priority: 2,
    status: "active",
    units: [],
  };
  return { ...data, activities: [...data.activities, activity], tasks: [...data.tasks, task] };
}

// La fecha de hoy se prueba además de las fijas: lo que falla es lo que depende del día.
const today = new Date();
const REAL = [
  "real",
  new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(today),
  10 * 60 + 13,
] as const;
const DATES = [
  ["lunes temprano", "2026-11-23", 7 * 60],
  ["miércoles 12:00", "2026-11-25", 12 * 60],
  ["jueves 10:13", "2026-11-26", 10 * 60 + 13],
  ["sábado", "2026-11-28", 12 * 60],
  ["domingo 22:00", "2026-11-29", 22 * 60],
  REAL,
] as const;

describe.each(["pruebas", "demo"] as const)("un solo cálculo: demo %s", (kind) => {
  it.each(DATES)(
    "%s: con y sin la materia de 168 h, los números y el motivo coinciden",
    (_n, date, minute) => {
      if (kind === "pruebas") localStorage.setItem(DEMO_KIND_KEY, "pruebas");
      const now = at(date, minute);
      for (const data of [loadDemo(now), withHugeSubject(loadDemo(now))]) {
        const plan = refreshPlan(data, now);
        const short = routineShortfalls(data, now, plan.result.blocks, plan.input);
        const d = decisions(plan.input, plan.result, { data, now });
        for (const task of data.tasks) {
          const week = routineWeek(data, now, plan.result.blocks, task, plan.input);
          if (!week) continue;
          const listed = short.find((s) => s.taskId === task.id);
          // Lo que dice la Bandeja es lo que dicen el bloque y Ajustes.
          expect(listed?.placed, week.name).toEqual(
            week.placed < week.wanted ? week.placed : undefined,
          );
          expect(week.placed).toBeLessThanOrEqual(week.wanted);
          expect(week.placed).toBe(Math.min(week.wanted, week.done + week.planned));
          // «No entra aunque no hubiera nada más» solo con el motivo propio.
          if (
            d.noFits.includes(task.id) &&
            data.activities.find((a) => a.id === task.activityId)?.kind === "rutina"
          )
            expect(week.reason, `${week.name} es de las demás`).toBe("own");
          if (week.reason === "others") expect(d.noFits).not.toContain(task.id);
        }
      }
    },
    60_000,
  );
});

describe("la materia de 168 h no hace pasar al Gym por imposible (38.ª vuelta)", () => {
  it("el jueves 26/11: Gym entra solo, lo imposible es la materia, y hay 2 días para las 2 que faltan", () => {
    localStorage.setItem(DEMO_KIND_KEY, "pruebas");
    const now = at("2026-11-26", 10 * 60 + 13);
    const data = withHugeSubject(loadDemo(now));
    const plan = refreshPlan(data, now);
    const d = decisions(plan.input, plan.result, { data, now });
    const gym = gymOf(data);
    expect(d.impossible).toContain("t168");
    expect(d.impossible).not.toContain(gym.id);
    expect(d.noFits).not.toContain(gym.id);
    const week = routineWeek(data, now, plan.result.blocks, gym, plan.input);
    expect(week?.reason).toBe("others");
    expect(week && routineWeekText(week)).toMatch(/^Esta semana entra \d de 3$/);
  }, 60_000);
});

describe("el texto de la semana de una rutina", () => {
  it("dice lo mismo en cada pantalla", () => {
    expect(routineWeekText({ done: 1, placed: 1, wanted: 3, next: false })).toBe(
      "Esta semana entra 1 de 3",
    );
    expect(routineWeekText({ done: 1, placed: 3, wanted: 3, next: true })).toBe(
      "La semana próxima entra 3 de 3",
    );
    expect(routineWeekText({ done: 3, placed: 3, wanted: 3, next: false })).toBe(
      "Esta semana: ya está completa",
    );
  });
});

describe("la sugerencia de la Bandeja", () => {
  it("cuenta lo que da mezclar por hoy y se va al hacerlo", () => {
    const now = at("2026-11-19", 1000);
    const base = demoData(now);
    const data = reducer(
      { ...base, settings: { ...base.settings, maxActivitiesPerDay: 1 } },
      { type: "refresh", now },
    );
    const plan = refreshPlan(data, now);
    const said = decisions(plan.input, plan.result, { data, now })
      .recommendations.map((r) => r.message)
      .join(" ");
    expect(said).toMatch(/mezclás/);
    const week = (endOfDay(TIMEZONE, now) - now) / 60_000 + 14 * 24 * 60;
    for (const n of said.match(/\d+/g) ?? []) expect(Number(n)).toBeLessThanOrEqual(week);
    const done = reducer(data, { type: "relaxContext", until: endOfDay(TIMEZONE, now), now });
    const after = refreshPlan(done, now);
    expect(decisions(after.input, after.result, { data: done, now }).recommendations).toEqual([]);
  });
});

describe("cada acción deja su ↶", () => {
  it("marcar Hecho deslizando deja su versión, que lo deshace, y deshacerlo con el aviso la saca", () => {
    const now = at("2026-11-26", 15 * 60);
    const data = reducer(loadDemo(now), { type: "refresh", now });
    const block = pendingConfirmations(data, now).at(0);
    if (!block) throw new Error("sin bloque pasado");
    const done = reducer(data, {
      type: "checkIn",
      checkIn: {
        id: "c-1",
        blockId: block.id,
        taskId: block.taskId,
        status: "done",
        minutesDone: 60,
        unitIds: [],
      },
      now,
    });
    expect(done.planHistory?.at(-1)?.label).toBe("marcar Hecho");
    const back = reducer(done, { type: "undoPlan", now });
    expect(standingCheckIns(back).some((c) => c.blockId === block.id)).toBe(false);
    expect(back.planHistory?.length ?? 0).toBe(data.planHistory?.length ?? 0);
    const viaToast = reducer(done, { type: "undoCheckIn", id: "c-1", now });
    expect(viaToast.planHistory?.some((v) => v.checkIn === "c-1")).toBe(false);
  });

  it("«Usar N min» de la Bandeja deja su versión, y borrar la dirección no deja su texto", () => {
    const now = at("2026-11-26", 9 * 60);
    const base = demoData(now);
    const event = {
      id: "ev-ang",
      title: "Inglés",
      start: at("2026-11-27", 10 * 60),
      end: at("2026-11-27", 11 * 60),
      busy: true,
      location: "Instituto Anglo",
      source: "google" as const,
    };
    const data = { ...base, events: [...base.events, event] };
    const used = reducer(data, { type: "spotMinutes", text: "Instituto Anglo", minutes: 20, now });
    expect(used.planHistory?.at(-1)?.label).toBe("ajustar un traslado");
    const dropped = reducer(used, { type: "dropSpotAddress", key: "instituto anglo", now });
    expect(JSON.stringify(dropped.planHistory ?? [])).not.toContain("Instituto Anglo");
  });
});
