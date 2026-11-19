import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { demoData } from "./demo.js";
import { zonedInstant } from "./engine.js";
import { decisions, refreshPlan } from "./planning.js";
import { reducer, StoreProvider, useStore } from "./store.js";
import { runningSince } from "./testing.js";

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
    const t0 = performance.now();
    act(() => {
      s.dispatch({ type: "pin", blockId: block.id, start: block.start + 1_800_000 });
    });
    const tap = performance.now() - t0;
    await settle();
    const now = store;
    if (!now) throw new Error("no store");
    const r = refreshPlan(now.data, MON);
    const t1 = performance.now();
    const dec = decisions(r.input, r.result, { data: now.data, now: MON });
    const working = performance.now() - t1;
    // The tap used to include working the decisions out (~700 ms here, plan ~100 ms): now
    // it is the plan alone, so it takes less than the decisions do (machine-independent).
    expect(tap).toBeLessThan(working);
    expect(now.decisions.options.map((o) => o.id)).toEqual(dec.options.map((o) => o.id));
    expect(now.inboxCount).toBeGreaterThanOrEqual(
      (dec.options.length > 0 ? 1 : 0) + dec.recommendations.length,
    );
  }, 60_000);
});
