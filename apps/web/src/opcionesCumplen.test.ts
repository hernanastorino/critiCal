import { afterEach, describe, expect, it } from "vitest";
import { demoData, TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import { hours } from "./format.js";
import type { AppData, AppTask } from "./model.js";
import { needOf } from "./need.js";
import { decisions, progress, refreshPlan } from "./planning.js";
import { loadDemo, reducer } from "./store.js";
import { estimateProblem, minimumProblem } from "./taskForm.js";

const PRUEBAS_NOW = zonedInstant(TIMEZONE, "2026-11-25", 10 * 60);
const DEMO_NOW = Date.UTC(2026, 10, 2, 20);

afterEach(() => localStorage.removeItem(DEMO_KIND_KEY));

const pruebas = () => {
  localStorage.setItem(DEMO_KIND_KEY, "pruebas");
  return loadDemo(PRUEBAS_NOW);
};

/** The task fields each kind of option may change (and nothing else). */
const CHANGES: Record<string, (keyof AppTask)[]> = {
  "lower-minimum": ["minMinutes"],
  "minimum-viable": ["minMinutes", "estimateMinutes"],
  proportional: ["minMinutes"],
  "minimum-only": ["estimateMinutes"],
  prioritize: ["units"],
  drop: ["status"],
  "start-earlier": ["startAfter"],
  "use-free-time": [],
  "move-event": [],
};

const FIELDS: (keyof AppTask)[] = [
  "minMinutes",
  "estimateMinutes",
  "units",
  "status",
  "startAfter",
  "skipUntil",
  "deadline",
  "title",
];

type Offered = ReturnType<typeof decisions>["options"][number];

/** (a) only what the option said changed, (c) whole minutes that the edit form accepts. */
function checkTasks(data: AppData, after: AppData, o: Offered) {
  const said = CHANGES[o.kind] ?? [];
  // A routine left out changes skipUntil.
  const allowed = o.kind === "drop" ? [...said, "skipUntil"] : said;
  for (const before of data.tasks) {
    const task = after.tasks.find((t) => t.id === before.id);
    if (!task) throw new Error(`${o.id}: ${before.id} vanished`);
    for (const f of FIELDS.filter((x) => !allowed.includes(x))) {
      expect(task[f], `${o.id}: ${before.id}.${f}`).toEqual(before[f]);
    }
    expect(Number.isInteger(task.minMinutes), `${o.id} min`).toBe(true);
    expect(Number.isInteger(task.estimateMinutes), `${o.id} estimate`).toBe(true);
    checkForm(task, before, o.id);
  }
}

function checkForm(task: AppTask, before: AppTask, id: string) {
  const touched =
    task.minMinutes !== before.minMinutes || task.estimateMinutes !== before.estimateMinutes;
  if (!touched || task.kind === "habit") return;
  const parts = task.units.reduce((n, u) => n + u.estimateMinutes, 0);
  expect(estimateProblem(String(task.estimateMinutes / 60), parts), `${id} form`).toBeNull();
  expect(
    minimumProblem(String(task.minMinutes / 60), task.estimateMinutes / 60),
    `${id} form min`,
  ).toBeNull();
}

/** (b) and (e) the minimum a label names is the one every screen then shows. */
function checkLabel(data: AppData, after: AppData, o: Offered, now: number) {
  if (!o.taskId || (o.kind !== "lower-minimum" && o.kind !== "minimum-viable")) return;
  const need = needOf(after, now, o.taskId);
  const shown = progress(after, now).find((p) => p.task.id === o.taskId);
  expect(need).toBeDefined();
  expect(o.label, o.id).toContain(hours(need?.minimum ?? -1));
  expect(shown?.minRemainingMinutes, o.id).toBe(need?.minimum);
  expect(need?.minimum, o.id).toBeLessThan(needOf(data, now, o.taskId)?.minimum ?? 0);
}

/** Walks every option offered: applies it and checks it does what it says. */
function checkAll(data: AppData, now: number): number {
  const r = refreshPlan(data, now);
  const offered = decisions(r.input, r.result, { data, now }).options;
  for (const o of offered) {
    const after = reducer(data, { type: "applyOption", optionId: o.id, now });
    checkTasks(data, after, o);
    checkLabel(data, after, o, now);
    // (d) «llegás a todos los mínimos» is true of the plan it gives.
    if (!r.result.feasible && o.result.feasible) {
      const real = refreshPlan(after, now).result;
      expect(
        real.status.filter((s) => s.minDeficit > 0),
        o.id,
      ).toEqual([]);
    }
  }
  return offered.length;
}

describe("every option of «No llegás a todo» does what it says", () => {
  it("in the demo of tests", () => {
    expect(checkAll(pruebas(), PRUEBAS_NOW)).toBeGreaterThan(0);
  }, 120_000);

  it("in the demo", () => {
    checkAll(demoData(DEMO_NOW), DEMO_NOW);
  }, 120_000);

  it("a 50 h delivery with no minimum: free time, then everything else", () => {
    const base = pruebas();
    const report = base.tasks.find((t) => t.id === "entrega-corta") as AppTask;
    const big: AppTask = {
      ...report,
      id: "prueba-x",
      title: "Prueba X",
      estimateMinutes: 3000,
      minMinutes: 0,
      startAfter: undefined,
      units: [],
    };
    const data = reducer(
      { ...base, tasks: [...base.tasks, big] },
      { type: "refresh", now: PRUEBAS_NOW },
    );
    const before = refreshPlan(data, PRUEBAS_NOW);
    const first = decisions(before.input, before.result, { data, now: PRUEBAS_NOW }).options;
    const free = first.find((o) => o.kind === "use-free-time");
    if (!free) throw new Error(`no free time offered: ${first.map((o) => o.id)}`);
    const afterFree = reducer(data, { type: "applyOption", optionId: free.id, now: PRUEBAS_NOW });
    // Nothing offered may leave it at 0 h, and free time is not offered twice or against.
    checkAll(afterFree, PRUEBAS_NOW);
    const r = refreshPlan(afterFree, PRUEBAS_NOW);
    const next = decisions(r.input, r.result, { data: afterFree, now: PRUEBAS_NOW }).options;
    expect(next.map((o) => o.kind)).not.toContain("use-free-time");
    expect(next.map((o) => o.kind)).not.toContain("minimum-only");
    for (const t of afterFree.tasks) if (t.id === "prueba-x") expect(t.estimateMinutes).toBe(3000);
  }, 120_000);
});
