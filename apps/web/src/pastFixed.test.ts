import { describe, expect, it } from "vitest";
import { importFromCalendars } from "./calendars.js";
import { diffData, rowsToData } from "./data.js";
import { demoData } from "./demo.js";
import { addDays, MINUTE, weekdayOf, zonedInstant } from "./engine.js";
import type { AppData, AppEvent, CheckIn } from "./model.js";
import { doneMinutes, freezeMeals, mealTimes, runAt } from "./planning.js";
import { reducer } from "./store.js";

const TZ = "America/Montevideo";
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return zonedInstant(TZ, date, h * 60 + m);
};
const base = (now: number, over: Partial<AppData> = {}): AppData => ({
  ...demoData(now),
  events: [],
  preferences: { holidaysOff: false },
  ...over,
});
const lunchOf = (d: AppData, now: number, date: string) =>
  mealTimes(d, now, at(date, "00:00"), at(addDays(date, 1), "00:00")).find(
    (m) => m.kind === "almuerzo",
  );

describe("the meals of the past are not worked out again (SPEC §5)", () => {
  // Tuesday 3rd is the day that is over; "today" is the Wednesday 4th.
  const DAY = "2026-11-03";
  const TODAY = at("2026-11-04", "09:00");
  const lunchRuns = (d: AppData) =>
    (d.mealRuns ?? []).filter((r) => r.meal === "almuerzo" && r.weekday === weekdayOf(DAY));

  it("writes down yesterday, once, and not today", () => {
    const d = freezeMeals(base(TODAY), TODAY);
    expect(d.mealsFrozenThrough).toBe("2026-11-03");
    expect(lunchRuns(d)).toHaveLength(1);
    // The first catch-up goes back 60 days: its first Tuesday opens the run.
    expect(lunchRuns(d)[0]?.from).toBe("2026-09-08");
    expect(lunchRuns(d)[0]?.to).toBeUndefined();
    expect(d.mealRuns?.every((r) => r.from <= DAY)).toBe(true);
    // Already frozen through yesterday: nothing changes.
    expect(freezeMeals(d, TODAY + 60 * MINUTE)).toBe(d);
  });

  it("a past day keeps showing where lunch was after an event lands on it", () => {
    const d = freezeMeals(base(TODAY), TODAY);
    const was = lunchOf(d, TODAY, DAY)?.at;
    const clash: AppEvent = {
      id: "late-news",
      title: "Algo nuevo",
      start: (was?.start ?? 0) - 10 * MINUTE,
      end: (was?.end ?? 0) + 10 * MINUTE,
      busy: true,
      source: "icloud",
    };
    expect(lunchOf({ ...d, events: [clash] }, TODAY, DAY)?.at).toEqual(was);
    // Without the runs the meal would have moved.
    expect(lunchOf({ ...d, events: [clash], mealRuns: [] }, TODAY, DAY)?.at).not.toEqual(was);
  });

  it("the same time every week stays a single open run", () => {
    const now = at("2026-11-18", "09:00");
    const d = freezeMeals({ ...base(now), mealsFrozenThrough: "2026-10-31" }, now);
    const tuesday = (d.mealRuns ?? []).filter(
      (r) => r.meal === "almuerzo" && r.weekday === weekdayOf(DAY),
    );
    expect(tuesday).toHaveLength(1);
    expect(tuesday[0]?.to).toBeUndefined();
  });

  it("one day apart closes the run the day before and reopens after it", () => {
    const now = at("2026-11-12", "09:00");
    const clash: AppEvent = {
      id: "x",
      title: "Clase",
      start: at("2026-11-10", "12:30"),
      end: at("2026-11-10", "14:30"),
      busy: true,
      source: "icloud",
    };
    // Frozen through Monday the 2nd; the 3rd and the 10th are Tuesdays, the 10th with a class.
    const d = freezeMeals(
      { ...base(now, { events: [clash] }), mealsFrozenThrough: "2026-11-02" },
      now,
    );
    const tuesdays = (d.mealRuns ?? [])
      .filter((r) => r.meal === "almuerzo" && r.weekday === 2)
      .sort((a, b) => a.from.localeCompare(b.from));
    expect(tuesdays.map((r) => [r.from, r.to])).toEqual([
      ["2026-11-03", "2026-11-09"],
      ["2026-11-10", undefined],
    ]);
    expect(runAt(d.mealRuns ?? [], "almuerzo", "2026-11-03")?.start).not.toBe(
      runAt(d.mealRuns ?? [], "almuerzo", "2026-11-10")?.start,
    );
  });

  it("days passed while the app was closed are written with the settings from before a change", () => {
    const old = base(TODAY, { mealsFrozenThrough: "2026-10-31" });
    const lunchBefore = lunchOf(old, TODAY, DAY)?.at;
    const settings = {
      ...old.settings,
      week: old.settings.week.map((w) => ({
        ...w,
        meals: w.meals.map((m) => ({ ...m, start: m.start + 120, end: m.end + 120 })),
      })),
    };
    const after = reducer(old, { type: "settings", settings, now: TODAY });
    const run = runAt(after.mealRuns ?? [], "almuerzo", DAY);
    const midnight = at(DAY, "00:00");
    expect(run && midnight + run.start * MINUTE).toBe(lunchBefore?.start);
  });

  it("a fresh demo: opening, moving lunch and looking at yesterday and days before shows the old times", () => {
    // Nothing was ever frozen (no mealsFrozenThrough, no runs): the user's own case.
    const fresh = base(TODAY);
    expect(fresh.mealsFrozenThrough).toBeUndefined();
    const days = ["2026-11-03", "2026-11-02", "2026-10-30", "2026-10-21"];
    const was = days.map((d) => lunchOf(fresh, TODAY, d)?.at);
    const settings = {
      ...fresh.settings,
      week: fresh.settings.week.map((w) => ({
        ...w,
        meals: w.meals.map((m) => ({ ...m, start: m.start + 120, end: m.end + 120 })),
      })),
    };
    const after = reducer(fresh, { type: "settings", settings, now: TODAY });
    days.forEach((d, i) => {
      expect(lunchOf(after, TODAY, d)?.at).toEqual(was[i]);
    });
    // Today and what comes do follow the change.
    expect(lunchOf(after, TODAY, "2026-11-04")?.at).not.toEqual(
      lunchOf(fresh, TODAY, "2026-11-04")?.at,
    );
  });

  it("meals of today are still worked out", () => {
    const d = freezeMeals(base(TODAY), TODAY);
    expect(lunchOf(d, TODAY, "2026-11-04")?.at).toBeTruthy();
  });
});

describe("an event deleted from the calendar keeps the time already spent on it", () => {
  it("drops its task, but its check-ins stay", () => {
    const now = at("2026-11-03", "10:00");
    const exam: AppEvent = {
      id: "p1",
      title: "Parcial Física",
      start: at("2026-11-10", "10:00"),
      end: at("2026-11-10", "12:00"),
      busy: true,
      source: "icloud",
      calendarId: "icloud:p",
    };
    const d = base(now, {
      calendars: [{ id: "icloud:p", source: "icloud", externalId: "p", name: "Parciales" }],
      events: [exam],
      tasks: [],
      checkIns: [],
    });
    const first = importFromCalendars(d, now, (s) => `id:${s}`);
    const task = first.tasks.find((t) => t.sourceEventId === "p1");
    expect(task?.status).toBe("active");
    const spent: CheckIn = {
      id: "c1",
      blockId: "b1",
      taskId: task?.id ?? "",
      status: "done",
      minutesDone: 60,
      createdAt: now - 60 * MINUTE,
    } as CheckIn;
    const withTime = { ...first, checkIns: [spent] };
    const gone = importFromCalendars({ ...withTime, events: [] }, now, (s) => `id:${s}`);
    expect(gone.tasks.find((t) => t.sourceEventId === "p1")?.status).toBe("dropped");
    expect(gone.checkIns).toEqual([spent]);
    expect(doneMinutes(gone, task?.id ?? "")).toBe(60);
  });
});

describe("meal runs travel to the database and back", () => {
  it("are written as meal_runs rows, the closing of a run too, and read back", () => {
    const now = at("2026-11-12", "09:00");
    const frozen = freezeMeals(base(now), now);
    const writes = diffData(base(now), frozen);
    const rows = writes.upserts.find((u) => u.table === "meal_runs")?.rows ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("from_date");
    const back = rowsToData({
      settings: null,
      activities: [],
      tasks: [],
      units: [],
      checkIns: [],
      events: [],
      overrides: [],
      blocks: [],
      mealRuns: rows,
    });
    expect(back.mealRuns).toEqual(frozen.mealRuns);
    // Closing a run changes its row (same key), not a new one.
    const first = frozen.mealRuns?.[0];
    const closed = {
      ...frozen,
      mealRuns: [{ ...(first as NonNullable<typeof first>), to: "2026-11-30" }],
    };
    const again = diffData(frozen, closed).upserts.find((u) => u.table === "meal_runs");
    expect(again?.rows).toHaveLength(1);
  });

  it("a copy with two runs under the same key never differs from itself (no endless save)", () => {
    const run = { meal: "almuerzo", weekday: 1, from: "2026-11-01", start: 720, end: 780 } as const;
    const data = {
      ...demoData(Date.parse("2026-11-04T15:00:00Z")),
      mealRuns: [run, { ...run, to: "2026-11-10" }],
    } as AppData;
    const writes = diffData(data, data);
    expect(writes.upserts.filter((u) => u.table === "meal_runs")).toEqual([]);
  });
});
