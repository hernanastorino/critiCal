import { describe, expect, it } from "vitest";
import {
  dayTypeOf,
  hhmm,
  inArea,
  isoWeekday,
  parseHhmm,
  type SavedRoute,
  staleReason,
  type TransitOption,
} from "./transit.js";

describe("days and times", () => {
  it("tells the schedule family of a date", () => {
    expect(dayTypeOf("2026-11-09")).toBe(1); // Monday
    expect(dayTypeOf("2026-11-13")).toBe(1); // Friday
    expect(dayTypeOf("2026-11-14")).toBe(2);
    expect(dayTypeOf("2026-11-15")).toBe(3);
    expect(isoWeekday("2026-11-09")).toBe(1);
    expect(isoWeekday("2026-11-15")).toBe(7);
  });

  it("formats minutes of the day, wrapping past midnight", () => {
    expect(hhmm(0)).toBe("00:00");
    expect(hhmm(545)).toBe("09:05");
    expect(hhmm(1450)).toBe("00:10");
    expect(hhmm(-10)).toBe("23:50");
  });

  it("reads HH:MM and nothing else", () => {
    expect(parseHhmm("09:05")).toBe(545);
    expect(parseHhmm("24:00")).toBeNull();
    expect(parseHhmm("9:05")).toBeNull();
    expect(parseHhmm("09:60")).toBeNull();
  });

  it("knows the service area", () => {
    expect(inArea({ lat: -34.9, lon: -56.2 })).toBe(true);
    expect(inArea({ lat: -34.6, lon: -56.0 })).toBe(true);
    expect(inArea({ lat: -31.4, lon: -58.0 })).toBe(false);
    expect(inArea({ lat: Number.NaN, lon: -56 })).toBe(false);
  });
});

describe("when a saved route is out of date", () => {
  const option = { legs: [] } as unknown as TransitOption;
  const route: SavedRoute = {
    weekday: 2,
    time_minutes: 540,
    mode: "arrive",
    feed_version: "stm:a|dnt:b",
    plan: { option, dayType: 1, validTo: "2026-12-25" },
  };
  const tuesday = { date: "2026-11-10", timeMinutes: 540 };

  it("holds when nothing changed", () => {
    expect(staleReason(route, tuesday, "stm:a|dnt:b")).toBeNull();
    expect(
      staleReason({ ...route, weekday: null }, { ...tuesday, date: "2026-11-11" }, "stm:a|dnt:b"),
    ).toBeNull();
  });

  it("goes stale when the schedules changed", () => {
    expect(staleReason(route, tuesday, "stm:a|dnt:c")).toBe("feed");
  });

  it("goes stale when the event or trip time moved", () => {
    expect(staleReason(route, { ...tuesday, timeMinutes: 600 }, "stm:a|dnt:b")).toBe("time");
  });

  it("goes stale when the schedule does not run that day", () => {
    // Another weekday, a holiday on the weekday, and a Saturday asked for a weekday plan.
    expect(staleReason(route, { ...tuesday, date: "2026-11-11" }, "stm:a|dnt:b")).toBe("day");
    expect(staleReason(route, { ...tuesday, dayType: 3 }, "stm:a|dnt:b")).toBe("day");
    expect(
      staleReason({ ...route, weekday: null }, { ...tuesday, date: "2026-11-14" }, "stm:a|dnt:b"),
    ).toBe("day");
  });

  it("goes stale when the schedules ended before that day", () => {
    expect(staleReason(route, { ...tuesday, date: "2026-12-29" }, "stm:a|dnt:b")).toBe("expired");
    expect(
      staleReason({ ...route, weekday: null }, { ...tuesday, date: "2026-12-29" }, "stm:a|dnt:b"),
    ).toBe("expired");
  });
});
