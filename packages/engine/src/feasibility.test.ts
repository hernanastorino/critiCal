import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkFeasibility, type Demand } from "./feasibility.js";

const linear = (rate: number) => (t: number) => Math.max(0, t) * rate;

describe("checkFeasibility", () => {
  it("is feasible with no demands", () => {
    expect(checkFeasibility([], linear(1))).toEqual({ feasible: true, slack: {} });
  });

  it("computes cumulative slack in deadline order", () => {
    const demands: Demand[] = [
      { id: "fisica", deadline: 600, minRemaining: 200 },
      { id: "mate", deadline: 300, minRemaining: 100 },
    ];
    const r = checkFeasibility(demands, linear(0.5));
    expect(r.slack).toEqual({ mate: 50, fisica: 0 });
    expect(r.feasible).toBe(true);
  });

  it("reports the first violated deadline", () => {
    const demands: Demand[] = [
      { id: "a", deadline: 100, minRemaining: 80 },
      { id: "b", deadline: 200, minRemaining: 80 },
      { id: "c", deadline: 300, minRemaining: 10 },
    ];
    const r = checkFeasibility(demands, linear(0.5));
    expect(r.feasible).toBe(false);
    expect(r.firstViolation).toBe("a");
  });

  it("ignores negative remaining minutes", () => {
    const r = checkFeasibility([{ id: "x", deadline: 10, minRemaining: -50 }], linear(1));
    expect(r.slack.x).toBe(10);
  });

  it("property: adding demand never increases any slack", () => {
    const demandArb = fc.record({
      id: fc.uuid(),
      deadline: fc.integer({ min: 0, max: 10_000 }),
      minRemaining: fc.integer({ min: 0, max: 2_000 }),
    });
    fc.assert(
      fc.property(
        fc.uniqueArray(demandArb, { selector: (d) => d.id, maxLength: 20 }),
        demandArb,
        (ds, extra) => {
          fc.pre(!ds.some((d) => d.id === extra.id));
          const before = checkFeasibility(ds, linear(0.4));
          const after = checkFeasibility([...ds, extra], linear(0.4));
          return ds.every((d) => (after.slack[d.id] ?? 0) <= (before.slack[d.id] ?? 0));
        },
      ),
    );
  });

  it("property: feasible iff every slack is non-negative", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            deadline: fc.integer({ min: 0, max: 5_000 }),
            minRemaining: fc.integer({ min: 0, max: 1_000 }),
          }),
          { maxLength: 15 },
        ),
        (ds) => {
          const unique = [...new Map(ds.map((d) => [d.id, d])).values()];
          const r = checkFeasibility(unique, linear(0.3));
          return r.feasible === Object.values(r.slack).every((s) => s >= 0);
        },
      ),
    );
  });
});
