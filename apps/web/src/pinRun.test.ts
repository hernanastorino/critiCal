import { describe, expect, it } from "vitest";
import { demoData } from "./demo.js";
import { isPinned } from "./planning.js";
import { reducer } from "./store.js";

const NOW = Date.UTC(2026, 10, 2, 20);

describe("«Fijar acá» on a run of blocks (SPEC §18.12)", () => {
  const start = () => reducer(demoData(NOW), { type: "refresh", now: NOW });

  it("pins every block still ahead where it is, in one step back", () => {
    const d = start();
    const ahead = d.plan.filter((b) => b.start > NOW && !isPinned(b)).slice(0, 2);
    expect(ahead).toHaveLength(2);
    const pinned = reducer(d, { type: "pinAll", blockIds: ahead.map((b) => b.id), now: NOW });
    for (const b of ahead)
      expect(pinned.pins?.some((p) => p.taskId === b.taskId && p.start === b.start)).toBe(true);
    const back = reducer(pinned, { type: "undoPlan", now: NOW });
    expect(back.pins ?? []).toEqual(d.pins ?? []);
  });

  it("leaves a block already under way or past alone", () => {
    const d = start();
    const past = d.plan.find((b) => b.start <= NOW);
    if (!past) return;
    expect(reducer(d, { type: "pinAll", blockIds: [past.id], now: NOW })).toBe(d);
  });
});
