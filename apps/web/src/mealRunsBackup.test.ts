import { describe, expect, it } from "vitest";
import { exportJson, parseBackup } from "./backup.js";
import { demoData } from "./demo.js";
import { freezeMeals } from "./planning.js";

const NOW = Date.parse("2026-11-22T15:00:00Z");
const good = freezeMeals(demoData(NOW), NOW);
const run = { meal: "almuerzo", weekday: 1, from: "2026-11-02", start: 720, end: 780 };
const withRuns = (over: Record<string, unknown>) =>
  JSON.stringify({
    app: "critiCal",
    version: 2,
    exportedAt: NOW,
    data: { ...JSON.parse(exportJson(good, NOW)).data, ...over },
  });

describe("backup: past meals are checked like the rest", () => {
  it("a file with its own frozen meals comes back as it was", () => {
    const back = parseBackup(exportJson(good, NOW));
    expect("data" in back && back.data.mealRuns).toEqual(good.mealRuns);
  });

  it.each([
    ["not a list", { mealRuns: "x" }],
    ["null", { mealRuns: null }],
    ["a run with no fields", { mealRuns: [{ x: 1 }] }],
    ["a run that is not a record", { mealRuns: [3] }],
    ["an unknown meal", { mealRuns: [{ ...run, meal: "brunch" }] }],
    ["a weekday out of range", { mealRuns: [{ ...run, weekday: 7 }] }],
    ["a date that does not exist", { mealRuns: [{ ...run, from: "2026-13-45" }] }],
    ["a run that ends before it starts", { mealRuns: [{ ...run, to: "2026-10-01" }] }],
    ["minutes that are not whole", { mealRuns: [{ ...run, start: 720.5 }] }],
    ["an end before the start", { mealRuns: [{ ...run, end: 700 }] }],
    ["two open runs of one series", { mealRuns: [run, { ...run, from: "2026-11-09" }] }],
    ["a frozen date that does not exist", { mealsFrozenThrough: "2026-13-45" }],
    ["a frozen date that is not text", { mealsFrozenThrough: 5 }],
  ])("refuses %s", (_, over) => {
    const r = parseBackup(withRuns(over));
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toMatch(/comidas? pasadas?/);
  });

  it("accepts valid runs", () => {
    const r = parseBackup(
      withRuns({ mealRuns: [run, { ...run, from: "2026-10-01", to: "2026-11-01" }] }),
    );
    expect("data" in r).toBe(true);
  });
});
