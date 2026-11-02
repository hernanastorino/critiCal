import { describe, expect, it } from "vitest";
import { buildSlots } from "./availability";
import { merge, minutes, overlaps, subtract } from "./intervals";
import { effortRatio, remainingFromUnits } from "./learning";
import { at, settings, TZ } from "./testing";
import { addDays, localDates, localParts, offsetAt, weekdayOf, zonedInstant } from "./time";
import { travelBuffers } from "./travel";

const H = 3_600_000;

describe("time", () => {
  it("converts Montevideo local times to instants", () => {
    expect(zonedInstant(TZ, "2026-11-02", 480)).toBe(Date.UTC(2026, 10, 2, 11));
    expect(zonedInstant(TZ, "2026-11-02", 1440 + 60)).toBe(Date.UTC(2026, 10, 3, 4));
    expect(offsetAt(TZ, Date.UTC(2026, 10, 2))).toBe(-3 * H);
  });

  it("handles DST transitions", () => {
    // New York springs forward on 2026-03-08.
    expect(zonedInstant("America/New_York", "2026-03-07", 600)).toBe(Date.UTC(2026, 2, 7, 15));
    expect(zonedInstant("America/New_York", "2026-03-09", 600)).toBe(Date.UTC(2026, 2, 9, 14));
  });

  it("reads local parts", () => {
    expect(localParts(TZ, at("2026-11-02", "10:30"))).toMatchObject({
      date: "2026-11-02",
      weekday: 1,
      minuteOfDay: 630,
    });
  });

  it("lists local dates in a range", () => {
    expect(localDates(TZ, at("2026-11-02", "23:00"), at("2026-11-04", "01:00"))).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
    ]);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekdayOf("2026-11-08")).toBe(0);
  });
});

describe("intervals", () => {
  it("merges and subtracts", () => {
    expect(
      merge([
        { start: 5, end: 8 },
        { start: 0, end: 3 },
        { start: 2, end: 4 },
        { start: 9, end: 9 },
      ]),
    ).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 8 },
    ]);
    expect(
      subtract(
        [{ start: 0, end: 10 }],
        [
          { start: 2, end: 3 },
          { start: 5, end: 12 },
          { start: 20, end: 30 },
        ],
      ),
    ).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ]);
    expect(subtract([{ start: 0, end: 10 }], [{ start: -5, end: 15 }])).toEqual([]);
    expect(overlaps({ start: 0, end: 5 }, { start: 5, end: 6 })).toBe(false);
    expect(overlaps({ start: 0, end: 5 }, { start: 4, end: 6 })).toBe(true);
    expect(minutes({ start: 0, end: H })).toBe(60);
  });
});

describe("buildSlots", () => {
  const from = at("2026-11-02", "00:00");
  const to = at("2026-11-03", "00:00");

  it("covers awake time minus meals, marking free time", () => {
    const slots = buildSlots(settings, [], from, to, []);
    expect(slots).toHaveLength(29);
    expect(slots.filter((s) => s.soft)).toHaveLength(8);
    expect(slots[0]).toMatchObject({
      start: at("2026-11-02", "08:00"),
      date: "2026-11-02",
      minuteOfDay: 480,
    });
  });

  it("removes busy time and applies overrides", () => {
    const busy = [{ start: at("2026-11-02", "10:00"), end: at("2026-11-02", "11:00") }];
    expect(buildSlots(settings, [], from, to, busy)).toHaveLength(27);
    const late = buildSlots(settings, [{ date: "2026-11-02", wake: 600, bed: 60 }], from, to, []);
    expect(late[0]?.start).toBe(at("2026-11-02", "10:00"));
    expect(late).toHaveLength(25);
  });

  it("keeps after-midnight time on the previous logical day", () => {
    const night = buildSlots(
      settings,
      [{ date: "2026-11-01", bed: 120 }],
      at("2026-11-02", "00:00"),
      at("2026-11-02", "03:00"),
      [],
    );
    expect(night.map((s) => s.date)).toEqual([
      "2026-11-01",
      "2026-11-01",
      "2026-11-01",
      "2026-11-01",
    ]);
    expect(night.every((s) => s.soft)).toBe(true);
  });

  it("throws without settings for a weekday", () => {
    expect(() => buildSlots({ ...settings, week: [] }, [], from, to, [])).toThrow(/No settings/);
  });
});

describe("travelBuffers", () => {
  const places: Record<string, string> = { "Facultad de Ingeniería": "facu", Gym: "gym" };
  const times: Record<string, number> = {
    "home>facu": 20,
    "facu>home": 25,
    "facu>gym": 15,
    "gym>home": 10,
  };
  const opts = {
    home: "home",
    resolvePlace: (l: string) => places[l],
    travelMinutes: (a: string, b: string) => times[`${a}>${b}`],
    marginMinutes: 10,
    returnHomeAfterMinutes: 120,
  };
  const ev = (id: string, s: string, e: string, location?: string) => ({
    id,
    title: id,
    start: at("2026-11-02", s),
    end: at("2026-11-02", e),
    location,
    busy: true,
  });

  it("chains trips between close events and returns home", () => {
    const r = travelBuffers(
      [ev("gym", "13:00", "14:00", "Gym"), ev("clase", "10:00", "12:00", "Facultad de Ingeniería")],
      opts,
    );
    expect(r.unresolved).toEqual([]);
    expect(r.busy).toEqual([
      { start: at("2026-11-02", "09:30"), end: at("2026-11-02", "10:00") },
      { start: at("2026-11-02", "12:35"), end: at("2026-11-02", "13:00") },
      { start: at("2026-11-02", "14:00"), end: at("2026-11-02", "14:10") },
    ]);
  });

  it("goes home between distant events and flags unknown places", () => {
    const r = travelBuffers(
      [
        ev("a", "08:00", "09:00", "Facultad de Ingeniería"),
        ev("b", "15:00", "16:00", "Facultad de Ingeniería"),
        ev("c", "17:00", "18:00", "Casa de Ana"),
        ev("d", "19:00", "20:00"),
      ],
      opts,
    );
    expect(r.unresolved).toEqual(["c"]);
    expect(r.busy).toHaveLength(4);
    expect(r.busy[1]).toEqual({ start: at("2026-11-02", "09:00"), end: at("2026-11-02", "09:25") });
  });

  it("treats unknown travel times as zero and skips trips to the same place", () => {
    const r = travelBuffers([ev("a", "08:00", "09:00", "Gym"), ev("b", "09:30", "10:00", "Gym")], {
      ...opts,
      travelMinutes: () => undefined,
    });
    expect(r.busy).toEqual([
      { start: at("2026-11-02", "07:50"), end: at("2026-11-02", "08:00") },
      { start: at("2026-11-02", "10:00"), end: at("2026-11-02", "10:00") },
    ]);
  });
});

describe("learning", () => {
  it("shrinks the effort ratio towards 1 and clamps it", () => {
    expect(effortRatio([], "mate")).toBe(1);
    const samples = [
      { activityId: "fisica", estimatedMinutes: 600, actualMinutes: 900 },
      { activityId: "mate", estimatedMinutes: 60, actualMinutes: 30 },
      { activityId: "fisica", estimatedMinutes: 0, actualMinutes: 50 },
    ];
    expect(effortRatio(samples, "fisica")).toBeCloseTo(1020 / 720);
    expect(effortRatio([{ activityId: "x", estimatedMinutes: 10, actualMinutes: 9000 }], "x")).toBe(
      2,
    );
    expect(effortRatio([{ activityId: "x", estimatedMinutes: 9000, actualMinutes: -1 }], "x")).toBe(
      0.5,
    );
  });

  it("computes remaining minutes from pending units", () => {
    expect(
      remainingFromUnits(
        [
          { estimateMinutes: 60, done: true },
          { estimateMinutes: 45, done: false },
          { estimateMinutes: 30, done: false },
        ],
        1.2,
      ),
    ).toBe(90);
  });
});
