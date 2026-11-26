import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { demoData } from "./demo.js";
import { zonedInstant } from "./engine.js";
import { decisions, refreshPlan, routineShortfalls } from "./planning.js";
import { reducer, StoreProvider, useStore } from "./store.js";
import { runningSince } from "./testing.js";

// The planner's two steps are counted, not timed: how long a tap takes depends on the
// machine and on what else it is doing, how many times it works things out does not.
vi.mock("./planning.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./planning.js")>();
  return {
    ...actual,
    decisions: vi.fn(actual.decisions),
    refreshPlan: vi.fn(actual.refreshPlan),
  };
});

afterEach(cleanup);

const MON = zonedInstant("America/Montevideo", "2026-11-02", 6 * 60);
// The demo plus routines whose franja is shorter than a session: nothing fits, so the
// Bandeja has the long list of options to check (each one replans).
let busy = runningSince(demoData(MON), MON);
for (let i = 0; i < 5; i++)
  busy = reducer(busy, {
    type: "saveRoutine",
    name: `Imposible ${i}`,
    sessionsPerWeek: 3,
    validHours: { all: { start: 7 * 60 + 10, end: 8 * 60 + 10 } },
    sessionMinutes: 60,
    now: MON,
  });
busy = runningSince(busy, MON);

let store: ReturnType<typeof useStore> | undefined;
const Probe = () => {
  store = useStore();
  return null;
};

const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 1500)));

describe("decisions do not stand in the way of a tap", () => {
  it("a move waits for the plan only; the counter catches up and is right", async () => {
    render(
      <StoreProvider initial={() => busy} persist={false} fixedNow={MON}>
        <Probe />
      </StoreProvider>,
    );
    await settle();
    const s = store;
    const block = s?.data.plan.find((b) => b.start > MON);
    if (!s || !block) throw new Error("no plan");
    const worked = vi.mocked(decisions);
    const planned = vi.mocked(refreshPlan);
    worked.mockClear();
    planned.mockClear();
    act(() => {
      s.dispatch({ type: "pin", blockId: block.id, start: block.start + 1_800_000 });
    });
    // The tap used to include working the decisions out (~700 ms here, plan ~100 ms): now
    // it is the plan alone. Nothing of the decisions is worked out until something asks.
    expect(planned).toHaveBeenCalled();
    expect(worked).not.toHaveBeenCalled();
    await settle();
    // Then the counter catches up, on its own, with the decisions of the new plan.
    expect(worked).toHaveBeenCalled();
    const now = store;
    if (!now) throw new Error("no store");
    const r = refreshPlan(now.data, MON);
    const dec = decisions(r.input, r.result, { data: now.data, now: MON });
    expect(now.decisions.options.map((o) => o.id)).toEqual(dec.options.map((o) => o.id));
    const routines = routineShortfalls(now.data, MON, r.result.blocks).length;
    expect(now.inboxCount).toBe(
      (dec.options.length > 0 ? 1 : 0) + dec.recommendations.length + routines,
    );
  }, 60_000);
});
