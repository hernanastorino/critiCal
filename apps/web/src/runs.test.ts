import { describe, expect, it } from "vitest";
import type { PlanBlock } from "./engine.js";
import { blockRuns } from "./runs.js";

const block = (id: string, start: number, end: number, activityId = "a"): PlanBlock =>
  ({ id, taskId: "t", activityId, start, end }) as PlanBlock;

describe("blockRuns", () => {
  it("joins blocks of one activity that touch", () => {
    const runs = blockRuns([block("2", 60, 120), block("1", 0, 60), block("3", 120, 150)]);
    expect(runs.map((r) => r.map((b) => b.id))).toEqual([["1", "2", "3"]]);
  });

  it("keeps apart a gap, an overlap or another activity", () => {
    const runs = blockRuns([
      block("1", 0, 60),
      block("2", 61, 100),
      block("3", 100, 160, "b"),
      block("4", 90, 100),
    ]);
    expect(runs.map((r) => r.map((b) => b.id))).toEqual([["1"], ["2"], ["4"], ["3"]]);
  });

  it("splits where the caller says they differ", () => {
    const runs = blockRuns([block("1", 0, 60), block("2", 60, 120)], (a) => a.id !== "1");
    expect(runs).toHaveLength(2);
  });
});
