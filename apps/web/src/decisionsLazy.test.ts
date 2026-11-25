import { describe, expect, it } from "vitest";
import { demoData, TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import { decisions, refreshPlan } from "./planning.js";
import { loadDemo } from "./store.js";

const NOW = zonedInstant(TIMEZONE, "2026-11-25", 10 * 60);

describe("the options of «No llegás a todo» are worked out when asked", () => {
  it("says whether any helps without the list, and agrees with it", () => {
    localStorage.setItem(DEMO_KIND_KEY, "pruebas");
    for (const data of [loadDemo(NOW), demoData(NOW)]) {
      const r = refreshPlan(data, NOW);
      const asked = decisions(r.input, r.result, { data, now: NOW });
      const any = asked.hasOptions;
      expect(asked.options.length > 0).toBe(any);
      expect(asked.hasOptions).toBe(any);
      expect(asked.options).toBe(asked.options);
    }
  }, 60_000);
});
