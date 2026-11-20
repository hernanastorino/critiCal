import { describe, expect, it } from "vitest";
import { countStep } from "./components/CountUp.js";

describe("numbers that count to the new value (SPEC §14)", () => {
  it("start at the old value and end at the new one, in whole minutes", () => {
    expect(countStep(600, 540, 0)).toBe(600);
    expect(countStep(600, 540, 1)).toBe(540);
    expect(countStep(600, 540, 2)).toBe(540);
    expect(countStep(600, 540, -1)).toBe(600);
    expect(Number.isInteger(countStep(600, 541, 0.37))).toBe(true);
  });

  it("ease out: most of the way is covered early, going up or down", () => {
    expect(countStep(0, 100, 0.5)).toBeGreaterThan(80);
    expect(countStep(100, 0, 0.5)).toBeLessThan(20);
  });
});
