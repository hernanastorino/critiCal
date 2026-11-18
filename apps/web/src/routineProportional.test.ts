import { describe, expect, it } from "vitest";
import { edited, errorOf, NOW, roundTrip } from "./atacante11Kit.js";
import { diffData, rowsToData } from "./data.js";
import { demoData } from "./demo.js";
import { MINUTE, zonedInstant } from "./engine.js";
import type { AppData, AppTask } from "./model.js";
import { progress, toEngineTasks } from "./planning.js";
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
});

/** A routine made on `now`: a gym three times a week, an hour each. */
function gymMadeOn(now: number, times = 3): AppData {
  return reducer(empty(now), {
    type: "saveRoutine",
    name: "Gym",
    sessionsPerWeek: times,
    sessionMinutes: 60,
    now,
  });
}
const gym = (d: AppData): AppTask => {
  const task = d.tasks.find((t) => t.title === "Gym");
  if (!task) throw new Error("no gym");
  return task;
};
const asked = (d: AppData, now: number) =>
  progress(d, now).find((p) => p.task.id === gym(d).id)?.totalMinutes;
const planned = (d: AppData, from: number, to: number) =>
  d.plan
    .filter((b) => b.taskId === gym(d).id && b.start >= from && b.start < to)
    .reduce((sum, b) => sum + (b.end - b.start) / MINUTE, 0);

describe("a routine made mid-week asks only the share of the days left", () => {
  // Week of Mon 2026-11-16 to Sun 2026-11-22.
  const SATURDAY = at("2026-11-21", "10:00");
  const NEXT_MONDAY = at("2026-11-23", "00:30");

  it("gym 3× made on Saturday asks 1 session this week", () => {
    const d = gymMadeOn(SATURDAY);
    expect(asked(d, SATURDAY)).toBe(60);
    expect(planned(d, SATURDAY, at("2026-11-23", "00:00"))).toBe(60);
  });

  it("the next week asks all of it again", () => {
    const d = reducer(gymMadeOn(SATURDAY), { type: "refresh", now: NEXT_MONDAY });
    expect(asked(d, NEXT_MONDAY)).toBe(180);
    expect(planned(d, NEXT_MONDAY, at("2026-11-30", "00:00"))).toBe(180);
  });

  it.each([
    ["Monday", "2026-11-16", 3],
    ["Wednesday", "2026-11-18", 3],
    ["Thursday", "2026-11-19", 2],
    ["Friday", "2026-11-20", 2],
    ["Sunday", "2026-11-22", 1],
  ])("made on %s (3×)", (_day, date, sessions) => {
    const now = at(date, "10:00");
    expect(asked(gymMadeOn(now), now)).toBe(sessions * 60);
  });

  it("rounds up, so a once-a-week routine made late still has its session", () => {
    expect(asked(gymMadeOn(SATURDAY, 1), SATURDAY)).toBe(60);
  });

  it("never asks more than a day holds (14× made on Sunday: two sessions)", () => {
    const d = gymMadeOn(at("2026-11-22", "08:00"), 14);
    expect(asked(d, at("2026-11-22", "08:00"))).toBe(120);
  });

  it("what was done this week comes off the share", () => {
    const d = gymMadeOn(at("2026-11-19", "10:00"));
    const done: AppData = {
      ...d,
      checkIns: [
        {
          id: "c1",
          blockId: "b1",
          taskId: gym(d).id,
          status: "done",
          minutesDone: 60,
          unitIds: [],
          createdAt: at("2026-11-19", "18:00"),
        },
      ],
    };
    const left = progress(done, at("2026-11-20", "08:00")).find((p) => p.task.id === gym(d).id);
    expect(left?.remainingMinutes).toBe(60);
  });

  it("the engine task carries the share, not the whole week", () => {
    const d = gymMadeOn(SATURDAY);
    const t = toEngineTasks(d, SATURDAY).find((x) => x.id === gym(d).id);
    expect(t?.remainingMinutes).toBe(60);
  });

  it("a routine from before this (no creation date) keeps asking the whole week", () => {
    const d = gymMadeOn(SATURDAY);
    const old: AppData = {
      ...d,
      tasks: d.tasks.map((t) => ({ ...t, createdAt: undefined })),
    };
    expect(asked(old, SATURDAY)).toBe(180);
  });

  it("a weekly study silo is not prorated", () => {
    const d = gymMadeOn(SATURDAY);
    const silo: AppData = { ...d, tasks: d.tasks.map((t) => ({ ...t, study: true })) };
    expect(asked(silo, SATURDAY)).toBe(180);
  });
});

describe("the creation date is kept", () => {
  const SATURDAY = at("2026-11-21", "10:00");

  it("goes to and comes from the database", () => {
    const d = gymMadeOn(SATURDAY);
    const row = diffData(empty(SATURDAY), d).upserts.find((u) => u.table === "tasks")?.rows[0];
    expect(row?.created_at).toBe(new Date(SATURDAY).toISOString());
    const back = rowsToData({
      settings: null,
      activities: [],
      tasks: [{ ...row }],
      units: [],
      checkIns: [],
      events: [],
      overrides: [],
      blocks: [],
    });
    expect(back.tasks[0]?.createdAt).toBe(SATURDAY);
  });

  it("travels in a backup, and a bad date is refused", () => {
    const r = roundTrip(gymMadeOn(NOW));
    expect(errorOf(r)).toBe("");
    const back = "data" in r ? r.data.tasks.find((t) => t.title === "Gym") : undefined;
    expect(back?.createdAt).toBe(NOW);
    expect(errorOf(edited([["tasks.0.createdAt", "ayer"]]))).toMatch(/creaci/i);
  });
});
