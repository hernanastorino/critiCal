import { describe, expect, it } from "vitest";
import { importFromCalendars } from "./calendars.js";
import { demoData } from "./demo.js";
import { addDays, localParts, MINUTE, zonedInstant } from "./engine.js";
import type { AppData, AppEvent, CheckIn } from "./model.js";
import { doneMinutes, mealTimes, withMealLog } from "./planning.js";
import { refresh } from "./refresh.js";

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
  const DAY = "2026-11-03";
  const AFTER_LUNCH = at(DAY, "16:00");

  it("writes down a meal once it is over, and not before", () => {
    const early = withMealLog(base(at(DAY, "09:00")), at(DAY, "09:00"));
    expect(early.mealLog?.some((l) => l.date === DAY && l.kind === "almuerzo")).toBeFalsy();
    const later = withMealLog(base(AFTER_LUNCH), AFTER_LUNCH);
    const lunch = later.mealLog?.find((l) => l.date === DAY && l.kind === "almuerzo");
    expect(lunch).toBeDefined();
    expect(lunch?.end).toBeLessThanOrEqual(AFTER_LUNCH);
  });

  it("a past day keeps showing where lunch was after an event lands on it", () => {
    const logged = withMealLog(base(AFTER_LUNCH), AFTER_LUNCH);
    const was = lunchOf(logged, AFTER_LUNCH, DAY)?.at;
    expect(was).toBeTruthy();
    const clash: AppEvent = {
      id: "late-news",
      title: "Algo nuevo",
      start: (was?.start ?? 0) - 10 * MINUTE,
      end: (was?.end ?? 0) + 10 * MINUTE,
      busy: true,
      source: "icloud",
    };
    const changed = { ...logged, events: [clash] };
    // Without the log the meal would move; with it, it stays where it was.
    expect(lunchOf(changed, AFTER_LUNCH, DAY)?.at).toEqual(was);
    const unlogged = { ...changed, mealLog: undefined };
    expect(lunchOf(unlogged, AFTER_LUNCH, DAY)?.at).not.toEqual(was);
  });

  it("a meal skipped later still shows where it was", () => {
    const logged = withMealLog(base(AFTER_LUNCH), AFTER_LUNCH);
    const was = lunchOf(logged, AFTER_LUNCH, DAY)?.at;
    const skipped = {
      ...logged,
      mealChoices: [{ date: DAY, kind: "almuerzo" as const, skip: true }],
    };
    expect(lunchOf(skipped, AFTER_LUNCH, DAY)?.at).toEqual(was);
  });

  it("meals that are not over yet still follow the plan", () => {
    const now = at(DAY, "09:00");
    const d = withMealLog(base(now), now);
    expect(lunchOf(d, now, DAY)?.at).toBeTruthy();
    const clash: AppEvent = {
      id: "e",
      title: "Clase",
      start: at(DAY, "12:30"),
      end: at(DAY, "14:30"),
      busy: true,
      source: "icloud",
    };
    const moved = lunchOf({ ...d, events: [clash] }, now, DAY)?.at;
    expect(moved?.start).not.toBe(at(DAY, "13:00"));
  });

  it("refresh writes the log, and keeps old entries unchanged", () => {
    const r = refresh(base(AFTER_LUNCH), AFTER_LUNCH);
    const lunch = r.mealLog?.find((l) => l.date === DAY && l.kind === "almuerzo");
    expect(lunch).toBeDefined();
    const again = refresh({ ...r, settings: { ...r.settings } }, AFTER_LUNCH + 60 * MINUTE);
    expect(again.mealLog?.find((l) => l.date === DAY && l.kind === "almuerzo")).toEqual(lunch);
  });

  it("forgets entries older than the keeping time", () => {
    const old = { date: "2026-08-01", kind: "cena" as const, start: 1, end: 2 };
    const d = withMealLog(base(AFTER_LUNCH, { mealLog: [old] }), AFTER_LUNCH);
    expect(d.mealLog?.includes(old)).toBe(false);
    expect(localParts(TZ, AFTER_LUNCH).date).toBe(DAY);
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
