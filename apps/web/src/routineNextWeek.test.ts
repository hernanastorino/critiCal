import { describe, expect, it } from "vitest";
import { demoData } from "./demo.js";
import { localParts, MINUTE, zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import { refreshPlan } from "./planning.js";
import { reducer } from "./store.js";

const TZ = "America/Montevideo";
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return zonedInstant(TZ, date, h * 60 + m);
};
const empty = (now: number): AppData => ({
  ...demoData(now),
  activities: [],
  tasks: [],
  plan: [],
  checkIns: [],
  events: [],
  preferences: { holidaysOff: false },
});

// Sunday 22 Nov 2026: this week is the 16th–22nd, the next one the 23rd–29th.
const SUNDAY = at("2026-11-22", "12:00");
const MON = at("2026-11-23", "00:00");
const NEXT_END = at("2026-11-30", "00:00");

function gymData(now: number, times = 3, validHours?: object): AppData {
  return reducer(empty(now), {
    type: "saveRoutine",
    name: "Gym",
    sessionsPerWeek: times,
    sessionMinutes: 60,
    validHours: validHours as never,
    now,
  });
}
const gymBlocks = (d: AppData, from: number, to: number) => {
  const id = d.tasks.find((t) => t.title === "Gym")?.id;
  return d.plan.filter((b) => b.taskId === id && b.start >= from && b.start < to);
};
const days = (blocks: { start: number }[]) => blocks.map((b) => localParts(TZ, b.start).date);

describe("the plan always has this week and the whole next one with the routines", () => {
  it("on Sunday: gym 3× is placed in the next week, one a day", () => {
    const d = gymData(SUNDAY);
    const next = gymBlocks(d, MON, NEXT_END);
    expect(next.reduce((s, b) => s + (b.end - b.start) / MINUTE, 0)).toBe(180);
    expect(new Set(days(next)).size).toBe(3);
  });

  it("on a Wednesday too, and it keeps this week's share apart", () => {
    const wed = at("2026-11-18", "10:00");
    const d = gymData(wed);
    const thisWeek = gymBlocks(d, wed, MON);
    const next = gymBlocks(d, MON, NEXT_END);
    expect(thisWeek.reduce((s, b) => s + (b.end - b.start) / MINUTE, 0)).toBe(180);
    expect(next.reduce((s, b) => s + (b.end - b.start) / MINUTE, 0)).toBe(180);
  });

  it("respects the valid hours and the excluded days", () => {
    // 18:00–20:00 every day, not on Tuesday (2) nor Thursday (4).
    const d = gymData(SUNDAY, 3, {
      all: { start: 18 * 60, end: 20 * 60 },
      days: { 2: null, 4: null },
    });
    const next = gymBlocks(d, MON, NEXT_END);
    expect(next).toHaveLength(3);
    for (const b of next) {
      const p = localParts(TZ, b.start);
      expect([2, 4]).not.toContain(p.weekday);
      expect(p.minuteOfDay).toBeGreaterThanOrEqual(18 * 60);
      expect(localParts(TZ, b.end - 1).minuteOfDay).toBeLessThanOrEqual(20 * 60);
    }
  });

  it("a routine left out for this week only is back in the next one", () => {
    const d0 = gymData(SUNDAY);
    const task = d0.tasks.find((t) => t.title === "Gym");
    const d = { ...d0, tasks: d0.tasks.map((t) => ({ ...t, skipUntil: MON })), plan: [] };
    expect(task).toBeTruthy();
    const next = refreshPlan(d, SUNDAY).plan.filter((b) => b.start >= MON && b.start < NEXT_END);
    expect(next.length).toBe(3);
  });

  it("a paused routine is not placed", () => {
    const d0 = gymData(SUNDAY);
    const d = { ...d0, tasks: d0.tasks.map((t) => ({ ...t, paused: true })), plan: [] };
    expect(refreshPlan(d, SUNDAY).plan.filter((b) => b.start >= MON)).toHaveLength(0);
  });

  it("never touches the past", () => {
    const d = gymData(SUNDAY);
    expect(
      refreshPlan(d, SUNDAY).plan.filter((b) => b.start < SUNDAY - 0 && b.end > SUNDAY),
    ).toHaveLength(0);
    const earlier = at("2026-11-18", "10:00");
    expect(d.plan.some((b) => b.start < earlier)).toBe(false);
  });
});
