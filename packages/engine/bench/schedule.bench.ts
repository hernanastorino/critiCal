// Mide `schedule` con la demo y con casos grandes (SPEC §18.8).
// Bun:  bun run bench           (en packages/engine, o `bun run bench` en la raíz)
// Node: bun run bench:node      (empaqueta con `bun build` y corre el resultado con node)
import { type ScheduleInput, schedule } from "../src/scheduler.js";
import { activity, at, settings, task } from "../src/testing.js";

const runtime = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.versions.node}`;

function scenario(
  name: string,
  activities: number,
  tasks: number,
  days: number,
): [string, ScheduleInput] {
  const now = at("2026-11-02", "08:00");
  const horizonEnd = now + days * 24 * 3600_000;
  const acts = Array.from({ length: activities }, (_, i) =>
    activity(`a${i}`, { academic: i % 4 !== 3, maxSessionMinutes: 120 }),
  );
  const ts = Array.from({ length: tasks }, (_, i) =>
    task(`t${i}`, `a${i % activities}`, now + ((i % days) + 1) * 24 * 3600_000, {
      remainingMinutes: 60 + (i % 5) * 60,
      minRemainingMinutes: 60,
      priority: 1 + (i % 3),
    }),
  );
  return [name, { now, horizonEnd, settings, activities: acts, tasks: ts, events: [] }];
}

const cases = [
  scenario("demo (3 materias, 6 tareas, 14 días)", 3, 6, 14),
  scenario("mediano (8 materias, 40 tareas, 30 días)", 8, 40, 30),
  scenario("grande (15 materias, 150 tareas, 90 días)", 15, 150, 90),
  scenario("enorme (30 materias, 500 tareas, 180 días)", 30, 500, 180),
];

const pct = (xs: number[], p: number) =>
  xs[Math.min(xs.length - 1, Math.floor(xs.length * p))] as number;

console.log(`Motor — schedule() en ${runtime}`);
for (const [name, input] of cases) {
  for (let i = 0; i < 3; i++) schedule(input); // calentamiento
  const times: number[] = [];
  const budget = performance.now() + 5000;
  while (times.length < 30 && performance.now() < budget) {
    const t0 = performance.now();
    schedule(input);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  console.log(
    `${name}: mediana ${pct(times, 0.5).toFixed(2)} ms · p95 ${pct(times, 0.95).toFixed(2)} ms · ${times.length} corridas`,
  );
}
