import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { demoData, TIMEZONE } from "./demo.js";
import { pruebasData } from "./demoPruebas.js";
import { demoSinRutina } from "./demoSinRutina.js";
import { zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import { decisions, refreshPlan } from "./planning.js";

/**
 * The planner got faster without changing what it answers. These hashes were taken from
 * the planner before that change: the same blocks, statuses, options and recommendations
 * on the demos. If a plan changes on purpose, regenerate them with
 * `UPDATE_PLAN_SNAPSHOT=1 npx vitest run planningSnapshot` and say why in the PR.
 */
const sha = (value: unknown) =>
  createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 12);

const DEMOS: [string, (now: number) => AppData][] = [
  ["demoData", demoData],
  ["pruebas", pruebasData],
  ["sinRutina", demoSinRutina],
];
const NOWS: [string, number][] = [
  ["dom 22/11 10:00", zonedInstant(TIMEZONE, "2026-11-22", 10 * 60)],
  ["mié 25/11 09:00", zonedInstant(TIMEZONE, "2026-11-25", 9 * 60)],
];

function digest(data: AppData, now: number) {
  const plan = refreshPlan(data, now);
  const d = decisions(plan.input, plan.result, { data, now });
  const options = d.options.map((o) => ({
    id: o.id,
    kind: o.kind,
    label: o.label,
    blocks: o.result.blocks,
    status: o.result.status,
    feasible: o.result.feasible,
  }));
  return {
    blocks: sha(plan.result.blocks),
    status: sha(plan.result.status),
    meals: sha(plan.result.meals),
    feasible: plan.result.feasible,
    options: options.map((o) => `${o.id}:${sha(o)}`),
    hasOptions: d.hasOptions,
    impossible: d.impossible,
    recommendations: sha(d.recommendations),
  };
}

describe("the plan of the demos", () => {
  beforeEach(() => localStorage.clear());
  for (const [name, make] of DEMOS) {
    for (const [label, now] of NOWS) {
      it(`${name}, ${label}: the same blocks, statuses and options`, async () => {
        const out = `${JSON.stringify(digest(make(now), now), null, 2)}\n`;
        await expect(out).toMatchFileSnapshot(
          `./__plan__/${name}-${label.replace(/\W+/g, "-")}.txt`,
        );
      }, 120_000);
    }
  }
});
