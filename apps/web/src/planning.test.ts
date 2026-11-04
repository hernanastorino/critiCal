import { describe, expect, it } from "vitest";
import { demoData, emptyData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import {
  dayAndTime,
  dayMonth,
  hhmmToMinutes,
  hours,
  minutesToHhmm,
  time,
  weekdayShort,
} from "./format.js";
import type { AppData, AppTask } from "./model.js";
import {
  applyOption,
  decisions,
  doneMinutes,
  endOfDay,
  pendingConfirmations,
  progress,
  refreshPlan,
  toEngineTasks,
  weekDates,
} from "./planning.js";
import { reducer, seedHistory } from "./store.js";

const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return zonedInstant(TIMEZONE, date, h * 60 + m);
};
const MON = at("2026-11-02", "17:50");

const calc: AppTask = {
  id: "t",
  activityId: "calc",
  title: "Parcial",
  kind: "deliverable",
  deadline: at("2026-11-05", "08:00"),
  estimateMinutes: 300,
  minMinutes: 180,
  priority: 2,
  status: "active",
  units: [
    { id: "a", title: "A", estimateMinutes: 120 },
    { id: "b", title: "B", estimateMinutes: 120, doneAt: 1 },
  ],
};

// 2026-11-02 is a holiday (Difuntos); these tests are about an ordinary Monday.
const base = (over: Partial<AppData> = {}): AppData => ({
  ...emptyData(),
  preferences: { holidaysOff: false },
  activities: [
    {
      id: "calc",
      name: "Cálculo",
      color: "#f80",
      academic: true,
      maxSessionMinutes: 120,
      minBlockMinutes: 60,
    },
  ],
  tasks: [calc],
  ...over,
});

describe("format", () => {
  it("formats times and durations", () => {
    expect(time(TIMEZONE, at("2026-11-02", "09:05"))).toBe("09:05");
    expect(weekdayShort(TIMEZONE, MON)).toBe("lun");
    expect(dayAndTime(TIMEZONE, MON)).toBe("lun 2/11 17:50");
    expect(dayMonth(TIMEZONE, MON)).toBe("2 nov");
    expect(hours(0)).toBe("0h");
    expect(hours(45)).toBe("45m");
    expect(hours(120)).toBe("2h");
    expect(hours(135)).toBe("2h15");
    expect(hhmmToMinutes("07:30")).toBe(450);
    expect(minutesToHhmm(1500)).toBe("01:00");
  });
});

describe("planning", () => {
  it("lists the Monday-based week", () => {
    expect(weekDates(TIMEZONE, MON)).toEqual([
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ]);
    expect(endOfDay(TIMEZONE, MON)).toBe(at("2026-11-03", "00:00"));
  });

  it("measures progress from units, check-ins and habits", () => {
    const data = base({
      tasks: [
        calc,
        {
          ...calc,
          id: "gym",
          kind: "habit",
          sessionsPerWeek: 3,
          sessionMinutes: 60,
          minMinutes: 0,
          units: [],
          deadline: undefined,
        },
        { ...calc, id: "old", status: "done" },
      ],
      checkIns: [
        {
          id: "c",
          blockId: "x",
          taskId: "t",
          status: "partial",
          minutesDone: 60,
          unitIds: [],
          createdAt: MON - 1,
        },
        {
          id: "g",
          blockId: "y",
          taskId: "gym",
          status: "done",
          minutesDone: 60,
          unitIds: [],
          createdAt: MON - 1,
        },
      ],
    });
    expect(doneMinutes(data, "t")).toBe(60);
    const [t, gym] = progress(data, MON);
    expect(t).toMatchObject({ remainingMinutes: 120, minRemainingMinutes: 120 });
    expect(gym).toMatchObject({
      totalMinutes: 180,
      remainingMinutes: 120,
      minRemainingMinutes: 120,
    });
    expect(toEngineTasks(data, MON).map((x) => x.id)).toEqual(["t", "gym"]);
    expect(toEngineTasks(data, at("2026-11-06", "08:00")).map((x) => x.id)).toEqual(["gym"]);
  });

  it("applies the learned effort ratio to units", () => {
    const data = base({
      tasks: [
        {
          ...calc,
          estimateMinutes: 2000,
          units: [...calc.units, { id: "c", title: "C", estimateMinutes: 600, doneAt: 1 }],
        },
      ],
      checkIns: [
        {
          id: "c1",
          blockId: "z",
          taskId: "t",
          status: "done",
          minutesDone: 900,
          unitIds: ["c"],
          createdAt: 0,
        },
      ],
    });
    expect(progress(data, MON)[0]?.remainingMinutes).toBeGreaterThan(120);
  });

  it("keeps history and today's blocks, and proposes when an event clashes", () => {
    const first = refreshPlan(base(), MON);
    expect(first.proposal).toBeUndefined();
    const today = first.plan.filter((b) => b.start < endOfDay(TIMEZONE, MON));
    expect(today.length).toBeGreaterThan(0);

    const later = MON + 30 * 60_000;
    const kept = refreshPlan({ ...base(), plan: first.plan }, later);
    for (const b of today)
      expect(kept.plan.some((x) => x.id === b.id && x.start === b.start)).toBe(true);

    const clash = today[0] as (typeof today)[number];
    const withEvent = base({
      plan: first.plan,
      events: [
        {
          id: "e",
          title: "Reunión",
          start: clash.start,
          end: clash.end,
          busy: true,
          source: "demo",
        },
      ],
    });
    const r = refreshPlan(withEvent, later);
    expect(r.proposal?.conflicts).toEqual([clash.id]);
    expect(r.plan.some((b) => b.id === clash.id)).toBe(true);
    expect(r.proposal?.plan.some((b) => b.id === clash.id)).toBe(false);
  });

  it("lists past blocks without check-in", () => {
    const plan = [
      { id: "p1", taskId: "t", activityId: "calc", start: MON - 7_200_000, end: MON - 3_600_000 },
      { id: "p2", taskId: "t", activityId: "calc", start: MON - 3_600_000, end: MON },
      { id: "f", taskId: "t", activityId: "calc", start: MON + 1, end: MON + 3_600_000 },
    ];
    const data = base({
      plan,
      checkIns: [
        {
          id: "c",
          blockId: "p1",
          taskId: "t",
          status: "done",
          minutesDone: 60,
          unitIds: [],
          createdAt: MON,
        },
      ],
    });
    expect(pendingConfirmations(data, MON).map((b) => b.id)).toEqual(["p2"]);
  });

  it("turns engine options back into task changes", () => {
    const tight = base({
      tasks: [
        {
          ...calc,
          deadline: at("2026-11-03", "12:00"),
          estimateMinutes: 900,
          minMinutes: 900,
          units: [],
        },
      ],
    });
    const r = refreshPlan(tight, MON);
    const d = decisions(r.input, r.result);
    expect(d.options.length).toBeGreaterThan(0);
    const byKind = (k: string) => d.options.find((o) => o.kind === k);

    const free = applyOption(tight, r.input, byKind("use-free-time") as never, MON);
    expect(free.freeTimeUntil).toBeGreaterThan(MON);
    const dropped = applyOption(tight, r.input, byKind("drop") as never, MON);
    expect(dropped.tasks[0]?.status).toBe("dropped");
    const lowered = applyOption(tight, r.input, byKind("lower-minimum") as never, MON);
    expect(lowered.tasks[0]?.minMinutes).toBeLessThan(900);
  });
});

describe("reducer", () => {
  it("records check-ins, completing units", () => {
    const data = reducer(base(), {
      type: "checkIn",
      checkIn: { blockId: "b", taskId: "t", status: "done", minutesDone: 60, unitIds: ["a"] },
      now: MON,
    });
    expect(data.checkIns).toHaveLength(1);
    expect(data.tasks[0]?.units[0]?.doneAt).toBe(MON);
  });

  it("saves tasks with new activities and day overrides", () => {
    let data = reducer(base(), {
      type: "saveTask",
      task: { ...calc, id: "n", activityId: "new" },
      activity: {
        id: "new",
        name: "Nueva",
        color: "#000",
        academic: true,
        maxSessionMinutes: 60,
        minBlockMinutes: 60,
      },
      now: MON,
    });
    expect(data.tasks).toHaveLength(2);
    expect(data.activities).toHaveLength(2);
    data = reducer(data, { type: "saveTask", task: { ...calc, title: "Renombrado" }, now: MON });
    expect(data.tasks[0]?.title).toBe("Renombrado");
    data = reducer(data, {
      type: "override",
      override: { date: "2026-11-02", wake: 600 },
      now: MON,
    });
    data = reducer(data, {
      type: "override",
      override: { date: "2026-11-02", wake: 660 },
      now: MON,
    });
    expect(data.overrides).toEqual([{ date: "2026-11-02", wake: 660 }]);
    data = reducer(data, { type: "relaxContext", until: MON + 1, now: MON });
    expect(data.relaxContextUntil).toBe(MON + 1);
    expect(reducer(data, { type: "replace", data: base(), now: MON }).tasks).toHaveLength(1);
  });

  it("accepts and rejects proposals", () => {
    const first = reducer(base(), { type: "refresh", now: MON });
    const clash = first.plan[0] as (typeof first.plan)[number];
    const withEvent = {
      ...first,
      events: [
        {
          id: "e",
          title: "x",
          start: clash.start,
          end: clash.end,
          busy: true,
          source: "demo" as const,
        },
      ],
    };
    const proposed = reducer(withEvent, { type: "refresh", now: MON + 60_000 });
    const id = proposed.proposals[0]?.id as string;
    expect(id).toBeDefined();
    const accepted = reducer(proposed, { type: "acceptProposal", id, now: MON });
    expect(accepted.proposals).toEqual([]);
    expect(accepted.plan.some((b) => b.id === clash.id)).toBe(false);
    const rejected = reducer(proposed, { type: "rejectProposal", id, now: MON });
    expect(rejected.plan.some((b) => b.id === clash.id)).toBe(false);
    expect(reducer(proposed, { type: "acceptProposal", id: "nope", now: MON })).toBe(proposed);
    expect(reducer(proposed, { type: "rejectProposal", id: "nope", now: MON })).toBe(proposed);
  });

  it("applies a chosen option", () => {
    const tight = base({
      tasks: [
        {
          ...calc,
          deadline: at("2026-11-03", "12:00"),
          estimateMinutes: 900,
          minMinutes: 900,
          units: [],
        },
      ],
    });
    const data = reducer(tight, { type: "applyOption", optionId: "use-free-time", now: MON });
    expect(data.freeTimeUntil).toBeGreaterThan(MON);
    expect(reducer(tight, { type: "applyOption", optionId: "nope", now: MON })).toBe(tight);
  });

  it("seeds demo history with two pending check-ins", () => {
    const thursday = at("2026-11-05", "18:00");
    const data = seedHistory(demoData(thursday), thursday);
    expect(data.checkIns.length).toBeGreaterThan(0);
    expect(pendingConfirmations(data, thursday)).toHaveLength(2);
    const early = at("2026-11-02", "06:00");
    expect(seedHistory(demoData(early), early).checkIns).toEqual([]);
  });
});

describe("tentative events", () => {
  it("propose a plan B when one of today falls through", async () => {
    const { refresh } = await import("./refresh.js");
    const { isTentative } = await import("./calendars.js");
    const now = zonedInstant(TIMEZONE, "2026-11-03", 9 * 60);
    const ev = (id: string, title: string, day: string, from: number, extra = {}) => ({
      id,
      title,
      start: zonedInstant(TIMEZONE, day, from * 60),
      end: zonedInstant(TIMEZONE, day, (from + 2) * 60),
      busy: true,
      source: "google" as const,
      ...extra,
    });
    const today = ev("a", "Juntada?", "2026-11-03", 15);
    const later = ev("b", "Cine", "2026-11-05", 20, { tentative: true });
    expect(isTentative(today)).toBe(true);
    expect(isTentative(later)).toBe(true);
    expect(isTentative(ev("c", "Clase", "2026-11-03", 10))).toBe(false);

    const base = { ...demoData(now), preferences: { holidaysOff: false } };
    let d = refresh({ ...base, events: [...base.events, today, later] }, now);
    expect(d.tentativeSeen?.map((s) => s.id)).toEqual(["a", "b"]);
    expect(d.proposals.filter((p) => p.id.startsWith("tentative@"))).toEqual([]);

    // Both fall through: only today's asks (later days are planned again on their own).
    d = refresh({ ...d, events: base.events }, now + 60_000);
    const asks = d.proposals.filter((p) => p.id.startsWith("tentative@"));
    expect(asks.map((p) => p.id)).toEqual(["tentative@a"]);
    expect(asks[0]?.message).toContain("«Juntada»");
    expect(asks[0]?.plan.length).toBeGreaterThan(0);
    expect(d.tentativeSeen).toEqual([]);
    // Not asked again; the waiting one gets a fresh plan B.
    const again = refresh(d, now + 120_000);
    expect(again.proposals.filter((p) => p.id.startsWith("tentative@"))).toHaveLength(1);
  });
});
