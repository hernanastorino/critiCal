import { describe, expect, it } from "vitest";
import { type ScheduleInput, schedule } from "./scheduler.js";
import { activity, at, settings, task } from "./testing.js";
import { localParts } from "./time.js";
import type { PlanBlock, Task, ValidHours } from "./types.js";

// Mon 2026-11-02 … Sun 2026-11-08.
const now = at("2026-11-02", "06:00");
const horizonEnd = at("2026-11-09", "06:00");
const hm = (h: number, m = 0) => h * 60 + m;

const run = (validHours: ValidHours | undefined, over: Partial<Task> = {}) =>
  schedule({
    now,
    horizonEnd,
    settings,
    activities: [activity("correr", { academic: false, maxSessionMinutes: 180 })],
    tasks: [
      task("correr", "correr", horizonEnd, {
        remainingMinutes: 360,
        minRemainingMinutes: 360,
        sessionMinutes: 60,
        maxPerDayMinutes: 60,
        validHours,
        ...over,
      }),
    ],
    events: [],
  } satisfies ScheduleInput);

const clock = (b: PlanBlock) => {
  const s = localParts(settings.timezone, b.start);
  const e = localParts(settings.timezone, b.end);
  return {
    weekday: s.weekday,
    from: s.minuteOfDay,
    to: e.minuteOfDay === 0 ? 1440 : e.minuteOfDay,
  };
};

describe("valid hours of a routine", () => {
  const hours: ValidHours = {
    all: { start: hm(17), end: hm(19) },
    days: { 6: { start: hm(17), end: hm(20) } },
  };

  it("places the routine only inside the hours of each weekday", () => {
    const r = run(hours);
    expect(r.blocks.length).toBeGreaterThan(0);
    for (const b of r.blocks) {
      const c = clock(b);
      expect(c.from).toBeGreaterThanOrEqual(hm(17));
      expect(c.to).toBeLessThanOrEqual(c.weekday === 6 ? hm(20) : hm(19));
    }
  });

  it("uses the Saturday exception (a 20:00 end) when the weekdays are full", () => {
    // One hour a day on weekdays, so 9 sessions need three of them on Saturday.
    const r = run(
      { all: { start: hm(17), end: hm(18) }, days: { 6: { start: hm(17), end: hm(20) } } },
      { remainingMinutes: 540, minRemainingMinutes: 540, maxPerDayMinutes: 180 },
    );
    expect(r.status[0]?.minDeficit).toBe(0);
    const saturday = r.blocks.filter((b) => clock(b).weekday === 6);
    expect(saturday.some((b) => clock(b).to === hm(20))).toBe(true);
  });

  it("without hours it behaves as before (mornings are fine)", () => {
    const r = run(undefined);
    expect(r.blocks.some((b) => clock(b).from < hm(17))).toBe(true);
  });

  it("reports what does not fit instead of leaving the hours", () => {
    // A 30 min window never holds a 60 min session.
    const r = run({ all: { start: hm(17), end: hm(17, 30) } });
    expect(r.blocks).toHaveLength(0);
    expect(r.status[0]?.minDeficit).toBe(360);
  });
});
