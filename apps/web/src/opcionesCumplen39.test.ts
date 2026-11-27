import { afterEach, describe, expect, it } from "vitest";
import { TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY } from "./demoPruebas.js";
import { type PlanOption, zonedInstant } from "./engine.js";
import { optionLine } from "./friendly.js";
import type { AppData } from "./model.js";
import { decisions, onlyImpossibleLeft, refreshPlan } from "./planning.js";
import { loadDemo, reducer } from "./store.js";

// «No llegás a todo» (39.ª vuelta): cada opción ofrecida, aplicada, cumple lo que promete,
// también después de elegir otra («Usar tiempo libre para llegar» primero).
const DATES = [
  ["jueves 09:00", "2026-11-26", 9 * 60],
  ["jueves 20:00", "2026-11-26", 20 * 60],
  ["miércoles 12:00", "2026-11-25", 12 * 60],
] as const;
const STEPS = 3;

afterEach(() => {
  localStorage.removeItem(DEMO_KIND_KEY);
});

const instants = (): [string, number][] => [
  ...DATES.map(([name, date, minute]): [string, number] => [
    name,
    zonedInstant(TIMEZONE, date, minute),
  ]),
  ["jueves 09:07 con segundos", zonedInstant(TIMEZONE, "2026-11-26", 9 * 60 + 7) + 23_000],
  ["jueves 15:41 con segundos", zonedInstant(TIMEZONE, "2026-11-26", 15 * 60 + 41) + 51_000],
  ["hoy, con la fecha real", Date.now()],
];

function start(kind: "pruebas" | "demo", now: number): AppData {
  if (kind === "pruebas") localStorage.setItem(DEMO_KIND_KEY, "pruebas");
  else localStorage.removeItem(DEMO_KIND_KEY);
  return reducer(loadDemo(now), { type: "refresh", now });
}

/** Ids of what the plan still lacks a minimum of. */
const short = (r: { status: { taskId: string; minDeficit: number }[] }) =>
  r.status.filter((s) => s.minDeficit > 0).map((s) => s.taskId);

/** What an option said, checked against the plan that choosing it really gives. */
function keepsPromise(data: AppData, now: number, o: PlanOption, minimumsMet: boolean) {
  const plan = refreshPlan(data, now);
  const impossible = decisions(plan.input, plan.result, { data, now }).impossible;
  const lacking = short(
    refreshPlan(reducer(data, { type: "applyOption", optionId: o.id, now }), now).result,
  );
  const own = o.taskId;
  if ((o.kind === "lower-minimum" || o.kind === "minimum-viable") && own)
    expect(lacking, `${o.label}: su propia tarea tiene que entrar`).not.toContain(own);
  const names = lacking.flatMap((id) => data.tasks.find((t) => t.id === id)?.title ?? []);
  const line = optionLine(o, minimumsMet, onlyImpossibleLeft(o, impossible) ? names : null);
  if (line.includes("todos los mínimos")) expect(lacking, `${o.label}: ${line}`).toEqual([]);
  if (line.includes("todo menos")) {
    expect(lacking.length, `${o.label}: ${line}`).toBeGreaterThan(0);
    expect(lacking.every((id) => impossible.includes(id))).toBe(true);
  }
  // The card shows the plan it gives: the same lacks as choosing it.
  expect([...short(o.result)].sort(), o.label).toEqual([...lacking].sort());
}

describe.each(["pruebas", "demo"] as const)("opciones que cumplen: demo %s", (kind) => {
  it.each(instants())(
    "%s: cada opción, aplicada, cumple lo que promete",
    (_name, now) => {
      let data = start(kind, now);
      for (let step = 0; step < STEPS; step++) {
        const plan = refreshPlan(data, now);
        const offered = decisions(plan.input, plan.result, { data, now }).options;
        for (const o of offered) keepsPromise(data, now, o, plan.result.feasible);
        const next = offered.find((o) => o.kind !== "drop");
        if (!next) break;
        data = reducer(data, { type: "applyOption", optionId: next.id, now });
      }
    },
    120_000,
  );
});
