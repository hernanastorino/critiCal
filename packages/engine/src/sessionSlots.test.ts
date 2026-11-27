import { describe, expect, it } from "vitest";
import { type ScheduleInput, schedule } from "./scheduler.js";
import { activity, at, settings, task } from "./testing.js";
import { MINUTE } from "./types.js";

const now = at("2026-11-26", "13:40");
const input = (times: number, session: number): ScheduleInput => ({
  now,
  horizonEnd: at("2026-12-07", "00:00"),
  settings,
  activities: [
    activity("bici", {
      academic: false,
      // Como la crea Ajustes › Rutinas: el tope de la sesión es la sesión misma.
      maxSessionMinutes: Math.max(session, 30),
      minBlockMinutes: Math.min(session, 60),
    }),
  ],
  tasks: [
    task("bici", "bici", at("2026-11-30", "00:00"), {
      remainingMinutes: times * session,
      minRemainingMinutes: times * session,
      sessionMinutes: session,
      maxPerDayMinutes: session,
      fixedTarget: true,
    }),
  ],
  events: [],
});

describe("una sesión que no es múltiplo de la grilla (45 min en franjas de 30)", () => {
  it.each([
    [2, 45],
    [3, 45],
    [4, 45],
    [3, 75],
    [3, 60],
    [3, 15],
    [2, 75],
    [3, 100],
  ])("%d sesiones de %d min se planifican enteras, una por día", (times, session) => {
    const r = schedule(input(times, session));
    const mine = r.blocks.filter((b) => b.taskId === "bici");
    const days = new Set(mine.map((b) => new Date(b.start).toISOString().slice(0, 10)));
    expect(days.size).toBe(times);
    // Cada sesión ocupa las franjas enteras que necesita, nunca una de menos.
    const placed = mine.reduce((s, b) => s + (b.end - b.start) / MINUTE, 0);
    expect(placed).toBeGreaterThanOrEqual(times * session);
    expect(r.status.find((s) => s.taskId === "bici")?.minDeficit).toBe(0);
  });
});
