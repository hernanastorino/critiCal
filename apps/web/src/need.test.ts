import { describe, expect, it } from "vitest";
import { TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import { hours } from "./format.js";
import { improves, needOf, shortfall } from "./need.js";
import { applyOption, decisions, progress, refreshPlan } from "./planning.js";
import { loadDemo } from "./store.js";

// Wednesday 25/11 in the tests' demo: «Informe corto SD» (10 h, minimum 9 h) does not fit.
const NOW = zonedInstant(TIMEZONE, "2026-11-25", 10 * 60);
const REPORT = "entrega-corta";

function demo() {
  localStorage.setItem(DEMO_KIND_KEY, "pruebas");
  return loadDemo(NOW);
}

function plan() {
  const data = demo();
  const r = refreshPlan(data, NOW);
  return { data, r, asked: decisions(r.input, r.result, { data, now: NOW }) };
}

describe("needOf", () => {
  it("names what the plan reserves, and a minimum never above it", () => {
    const data = demo();
    for (const p of progress(data, NOW)) {
      const need = needOf(data, NOW, p.task.id);
      expect(need?.left).toBe(p.remainingMinutes);
      expect(need?.minimum).toBeLessThanOrEqual(need?.left ?? 0);
    }
    expect(needOf(data, NOW, REPORT)).toEqual({ left: 600, minimum: 540 });
    expect(needOf(data, NOW, "no-such-task")).toBeUndefined();
  }, 30_000);
});

describe("shortfall", () => {
  it("counts the lack in study minutes, not in block minutes", () => {
    const { data, r } = plan();
    const block = r.result.status.find((s) => s.taskId === REPORT)?.minDeficit ?? 0;
    expect(block).toBeGreaterThan(0);
    const lack = shortfall(data, r.result).get(REPORT) ?? 0;
    // 50 study + 10 break: 1.2 block minutes for each study minute.
    expect(lack).toBe(Math.ceil(block / 1.2));
    expect(lack).toBeLessThan(block);
  }, 30_000);
});

describe("the options of «No llegás a todo»", () => {
  it("offer only what improves the plan", () => {
    const { r, asked } = plan();
    expect(r.result.feasible).toBe(false);
    expect(asked.options.length).toBeGreaterThan(0);
    for (const o of asked.options) expect(improves(r.result, o.result)).toBe(true);
    expect(improves(r.result, r.result)).toBe(false);
  }, 30_000);

  it("name the minimum the screens then show", () => {
    const { data, r, asked } = plan();
    for (const o of asked.options.filter(
      (x) => x.kind === "lower-minimum" || x.kind === "minimum-viable",
    )) {
      const after = applyOption(data, r.input, o, NOW);
      const minimum = needOf(after, NOW, o.taskId ?? "")?.minimum ?? 0;
      expect(o.label).toContain(hours(minimum));
    }
  }, 30_000);

  it("promise what choosing them gives: the plan, and no block still critical for it", () => {
    const { data, r, asked } = plan();
    const smaller = asked.options.find((o) => o.kind === "minimum-viable" && o.taskId === REPORT);
    if (!smaller) throw new Error("no «versión mínima» offered");
    const after = applyOption(data, r.input, smaller, NOW);
    // The session of today that the routine kept stays put in a stored plan; the option is
    // judged on a fresh plan, as the forecast is.
    const fresh = { ...after, plan: after.plan.filter((b) => b.taskId !== "gym") };
    const real = refreshPlan(fresh, NOW);
    expect(real.result.feasible).toBe(smaller.result.feasible);
    expect([...shortfall(after, real.result)]).toEqual([...shortfall(after, smaller.result)]);
    expect(real.result.feasible).toBe(true);
    expect(real.plan.filter((b) => b.end > NOW && b.level === "critical")).toEqual([]);
    // Ficha and plan agree: what it asked is what it has.
    expect(needOf(after, NOW, REPORT)?.minimum).toBe(270);
  }, 30_000);
});
