import { describe, expect, it } from "vitest";
import { TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import { hours } from "./format.js";
import type { AppData } from "./model.js";
import { applyOption, decisions, progress, refreshPlan } from "./planning.js";
import { loadDemo, reducer } from "./store.js";

// 35.ª vuelta: «No llegás a todo» y los mínimos, en la Demo de pruebas.
const SUNDAY = zonedInstant(TIMEZONE, "2026-11-22", 10 * 60);
const TUESDAY = zonedInstant(TIMEZONE, "2026-11-24", 20 * 60);

const must = <T,>(v: T | undefined): T => {
  if (v === undefined) throw new Error("missing");
  return v;
};

const demo = (now: number): AppData => {
  localStorage.setItem(DEMO_KIND_KEY, "pruebas");
  return loadDemo(now);
};
const asked = (d: AppData, now: number) => {
  const r = refreshPlan(d, now);
  return decisions(r.input, r.result, { data: d, now });
};
const choose = (d: AppData, optionId: string, now: number) =>
  reducer(d, { type: "applyOption", optionId, now });

describe("«Deshacer» de una decisión no toca las otras", () => {
  it("keeps «Usar tiempo libre» when an earlier «No hacer» is undone", { timeout: 60_000 }, () => {
    const dropped = choose(demo(SUNDAY), "drop:entrega-corta", SUNDAY);
    const free = asked(dropped, SUNDAY).options.find((o) => o.kind === "use-free-time");
    expect(free).toBeTruthy();
    const both = choose(dropped, must(free).id, SUNDAY);
    const drop = both.applied?.find((a) => a.id.startsWith("drop:entrega-corta@"));
    const undone = reducer(both, { type: "undoDecision", id: must(drop).id, now: SUNDAY });
    // The free time stays lent, so it is neither offered again nor applied twice.
    expect(undone.freeTimeUntil).toBe(both.freeTimeUntil);
    expect(asked(undone, SUNDAY).options.some((o) => o.kind === "use-free-time")).toBe(false);
    expect(undone.applied?.filter((a) => a.id.startsWith("use-free-time@"))).toHaveLength(1);
  });

  it("gives the free time back when its own decision is undone", { timeout: 60_000 }, () => {
    const dropped = choose(demo(SUNDAY), "drop:entrega-corta", SUNDAY);
    const free = asked(dropped, SUNDAY).options.find((o) => o.kind === "use-free-time");
    const both = choose(dropped, must(free).id, SUNDAY);
    const record = both.applied?.find((a) => a.id.startsWith("use-free-time@"));
    const undone = reducer(both, { type: "undoDecision", id: must(record).id, now: SUNDAY });
    expect(undone.freeTimeUntil).toBe(dropped.freeTimeUntil);
  });
});

describe("lo que promete cada opción es lo que pasa al elegirla", () => {
  it("previews the plan that choosing it really gives", { timeout: 120_000 }, () => {
    for (const now of [SUNDAY, TUESDAY]) {
      const d = demo(now);
      const r = refreshPlan(d, now);
      for (const o of asked(d, now).options) {
        const real = refreshPlan(applyOption(d, r.input, o, now), now).result;
        const short = (x: typeof real) =>
          x.status
            .filter((s) => s.minDeficit > 0)
            .map((s) => s.taskId)
            .sort();
        expect([o.id, o.result.feasible, short(o.result)]).toEqual([
          o.id,
          real.feasible,
          short(real),
        ]);
      }
    }
  });

  it("offers nothing when only a routine that fell behind is short", { timeout: 60_000 }, () => {
    const d0 = demo(TUESDAY);
    // Everything but the routine is gone; the routine asks for more than the week has left.
    const tasks = d0.tasks.map((t) => ({
      ...t,
      status: t.kind === "habit" ? t.status : ("dropped" as const),
    }));
    const d = reducer({ ...d0, tasks }, { type: "refresh", now: TUESDAY });
    const gym = d.tasks.find((t) => t.kind === "habit");
    const heavy = reducer(d, {
      type: "saveTask",
      task: { ...(gym as AppData["tasks"][number]), sessionsPerWeek: 8, minMinutes: 8 * 90 },
      now: TUESDAY,
    });
    const r = refreshPlan(heavy, TUESDAY);
    expect(r.result.status.every((s) => s.minDeficit === 0)).toBe(true);
    expect(r.result.feasible).toBe(true);
    expect(decisions(r.input, r.result, { data: heavy, now: TUESDAY }).options).toEqual([]);
  });
});

describe("el mínimo de una opción es el que muestran las pantallas", () => {
  it("names the minimum the task is left with, in the app's format", { timeout: 120_000 }, () => {
    const d = demo(TUESDAY);
    const r = refreshPlan(d, TUESDAY);
    const options = asked(d, TUESDAY).options.filter(
      (o) => o.kind === "lower-minimum" || o.kind === "minimum-viable",
    );
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) {
      const after = applyOption(d, r.input, o, TUESDAY);
      const left = progress(after, TUESDAY).find((p) => p.task.id === o.taskId);
      expect(o.label).toContain(
        `(${o.kind === "lower-minimum" ? "mínimo " : ""}${hours(must(left).minRemainingMinutes)})`,
      );
    }
  });
});
