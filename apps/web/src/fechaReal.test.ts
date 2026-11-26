import { afterEach, describe, expect, it } from "vitest";
import { TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import {
  decisions,
  endOfWeek,
  onlyImpossibleLeft,
  refreshPlan,
  routineShortfalls,
  weekStart,
} from "./planning.js";
import { loadDemo } from "./store.js";

// Los tests de fecha fija no ven lo que pasa con la fecha de hoy: se prueba en varias.
const DATES = [
  ["lunes temprano", "2026-11-23", 7 * 60],
  ["miércoles 12:00", "2026-11-25", 12 * 60],
  ["jueves 08:00", "2026-11-26", 8 * 60],
  ["sábado", "2026-11-28", 12 * 60],
  ["domingo 22:00", "2026-11-29", 22 * 60],
] as const;

afterEach(() => {
  localStorage.removeItem(DEMO_KIND_KEY);
});

function load(kind: "pruebas" | "demo", date: string, minute: number) {
  if (kind === "pruebas") localStorage.setItem(DEMO_KIND_KEY, "pruebas");
  else localStorage.removeItem(DEMO_KIND_KEY);
  const now = zonedInstant(TIMEZONE, date, minute);
  const data: AppData = loadDemo(now);
  return { data, now, plan: refreshPlan(data, now) };
}

type Loaded = ReturnType<typeof load>;

/** (a) Sin título «no entra» si una opción deja entrar esa tarea. */
function checkTitle({ data, now, plan }: Loaded) {
  const d = decisions(plan.input, plan.result, { data, now });
  const reached = (o: (typeof d.options)[number], id: string) =>
    o.kind !== "drop" && o.result.status.some((s) => s.taskId === id && s.minDeficit === 0);
  for (const id of d.noFits) {
    expect(
      d.options.some((o) => reached(o, id)),
      `título de ${id}`,
    ).toBe(false);
    expect(d.options.some((o) => o.kind !== "drop" && o.result.feasible)).toBe(false);
  }
  for (const o of d.options) {
    if (o.kind === "drop" || o.kind === "start-earlier") continue;
    if (!o.taskId || !d.impossible.includes(o.taskId)) continue;
    expect(reached(o, o.taskId), `${o.label} deja su tarea sin entrar`).toBe(true);
  }
}

/** (b) Nada promete «llegás a todo menos X» sin mejorar a X: su propia opción lo hace entrar. */
function checkPromise({ data, now, plan }: Loaded) {
  const d = decisions(plan.input, plan.result, { data, now });
  const before = new Map(plan.result.status.map((s) => [s.taskId, s.minDeficit]));
  for (const o of d.options) {
    if (o.kind === "drop" || !onlyImpossibleLeft(o, d.impossible)) continue;
    const better = o.result.status.some((s) => s.minDeficit < (before.get(s.taskId) ?? 0));
    expect(better, `${o.label} no mejora ningún déficit`).toBe(true);
    if (o.kind === "lower-minimum" || o.kind === "minimum-viable") {
      const own = o.result.status.find((s) => s.taskId === o.taskId);
      expect(own?.minDeficit, o.label).toBe(0);
    }
  }
}

/** (c) «entra N de M»: N son las sesiones de la semana entera, pasadas y futuras. */
function checkCount({ data, now, plan }: Loaded) {
  const tz = data.settings.timezone;
  const monday = zonedInstant(tz, weekStart(tz, now), 0);
  const end = endOfWeek(tz, now);
  const blocks = [
    ...data.plan.filter((b) => b.end <= now),
    ...plan.result.blocks.filter((b) => b.end > now),
  ].filter((b) => b.start >= monday && b.start < end);
  for (const r of routineShortfalls(data, now, plan.result.blocks)) {
    const ids = new Set(
      blocks
        .filter((b) => data.tasks.find((t) => t.id === b.taskId)?.activityId === r.activityId)
        .map((b) => b.id),
    );
    expect(r.placed, `${r.name} esta semana`).toBe(Math.min(r.wanted, ids.size));
  }
}

describe.each(["pruebas", "demo"] as const)("fecha real: demo %s", (kind) => {
  it.each(DATES)(
    "%s: título, opciones y Rutina que no entra dicen lo mismo",
    (_n, date, min) => {
      const loaded = load(kind, date, min);
      checkTitle(loaded);
      checkPromise(loaded);
      checkCount(loaded);
    },
    60_000,
  );
});
