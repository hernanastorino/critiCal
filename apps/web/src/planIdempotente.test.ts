import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import { loadDemo, reducer } from "./store.js";

type Data = ReturnType<typeof loadDemo>;

// SPEC §5.7 «Estabilidad»: replanificar con los mismos datos y el mismo `now` no mueve nada.
const refresh = (d: Data, now: number) => reducer(d, { type: "refresh", now });

const DATES = [
  ["lunes 07:30", "2026-11-23", 7 * 60 + 30],
  ["martes 09:00", "2026-11-24", 9 * 60],
  ["miércoles 12:00", "2026-11-25", 12 * 60],
  ["jueves 08:00", "2026-11-26", 8 * 60],
  ["sábado 12:00", "2026-11-28", 12 * 60],
  ["domingo 22:00", "2026-11-29", 22 * 60],
] as const;

afterEach(() => {
  localStorage.removeItem(DEMO_KIND_KEY);
});

function load(kind: "pruebas" | "demo", date: string, minute: number) {
  if (kind === "pruebas") localStorage.setItem(DEMO_KIND_KEY, "pruebas");
  else localStorage.removeItem(DEMO_KIND_KEY);
  const now = zonedInstant(TIMEZONE, date, minute);
  return { now, data: loadDemo(now) };
}

describe.each(["pruebas", "demo"] as const)("refresh es idempotente: demo %s", (kind) => {
  it.each(DATES)(
    "%s: la demo ya está planificada y refresh no cambia nada",
    (_n, date, min) => {
      const { now, data } = load(kind, date, min);
      let prev = data;
      for (let i = 0; i < 3; i++) {
        const next = refresh(prev, now);
        expect(next.plan.length, `pasada ${i + 1}`).toBe(data.plan.length);
        expect(next, `pasada ${i + 1}`).toEqual(data);
        prev = next;
      }
    },
    60_000,
  );

  it("cada hora de la semana: refresh(refresh(x)) == refresh(x)", () => {
    const start = zonedInstant(TIMEZONE, "2026-11-23", 8 * 60);
    for (let h = 0; h < 7 * 24; h += 5) {
      const now = start + h * 3_600_000;
      if (kind === "pruebas") localStorage.setItem(DEMO_KIND_KEY, "pruebas");
      else localStorage.removeItem(DEMO_KIND_KEY);
      const once = refresh(loadDemo(now), now);
      expect(refresh(once, now), `hora +${h}`).toEqual(once);
    }
  }, 120_000);

  // Propiedad: para datos y `now` cualesquiera, replanificar dos veces = una vez.
  it("propiedad: tareas y hora cualesquiera, refresh² == refresh", () => {
    const monday = zonedInstant(TIMEZONE, "2026-11-23", 7 * 60 + 1);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 7 * 24 * 60 - 1 }),
        fc.array(fc.boolean(), { minLength: 40, maxLength: 40 }),
        (minutes, keep) => {
          if (kind === "pruebas") localStorage.setItem(DEMO_KIND_KEY, "pruebas");
          else localStorage.removeItem(DEMO_KIND_KEY);
          const now = monday + minutes * 60_000;
          const seeded = loadDemo(now);
          const tasks = seeded.tasks.filter((_t, i) => keep.at(i % keep.length) !== false);
          const once = refresh({ ...seeded, tasks }, now);
          expect(refresh(once, now)).toEqual(once);
        },
      ),
      { numRuns: 20 },
    );
  }, 120_000);
});

describe.each(["pruebas", "demo"] as const)(
  "refresh es idempotente con la fecha real: demo %s",
  (kind) => {
    it("hoy y mañana", () => {
      if (kind === "pruebas") localStorage.setItem(DEMO_KIND_KEY, "pruebas");
      else localStorage.removeItem(DEMO_KIND_KEY);
      for (const now of [Date.now(), Date.now() + 86_400_000]) {
        const once = refresh(loadDemo(now), now);
        expect(refresh(once, now)).toEqual(once);
      }
    }, 60_000);
  },
);
