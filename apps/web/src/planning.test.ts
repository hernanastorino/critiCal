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

describe("more ways out in the app", () => {
  const now = zonedInstant(TIMEZONE, "2026-11-03", 8 * 60);
  const deadline = zonedInstant(TIMEZONE, "2026-11-03", 19 * 60);
  const act = {
    id: "m",
    name: "Mate",
    color: "#000",
    academic: false,
    maxSessionMinutes: 600,
    minBlockMinutes: 60,
  };
  const base = (extra: Partial<ReturnType<typeof emptyData>> = {}) => ({
    ...emptyData(),
    activities: [act],
    ...extra,
  });
  const task = (id: string, title: string, minutes: number, extra = {}) => ({
    id,
    activityId: "m",
    title,
    kind: "deliverable" as const,
    deadline,
    estimateMinutes: minutes,
    minMinutes: minutes,
    priority: 2,
    status: "active" as const,
    units: [],
    ...extra,
  });

  it("offers a smaller entrega, never a smaller exam", async () => {
    const { toEngineTasks } = await import("./planning.js");
    const d = base({
      tasks: [task("e", "TP de laboratorio", 600), task("p", "Parcial de Mate", 600)],
    });
    const [e, p] = toEngineTasks(d, now);
    expect(e?.mvpMinutes).toBe(300);
    expect(p?.mvpMinutes).toBeUndefined();
    // Exactly half (never under an hour), not rounded to slots.
    const odd = toEngineTasks(base({ tasks: [task("o", "TP de laboratorio", 210)] }), now)[0];
    expect(odd?.mvpMinutes).toBe(105);
    // Plurals and accents, and anything imported from a parcial event, are exams too.
    const more = base({
      calendars: [
        {
          id: "google:p",
          source: "google" as const,
          externalId: "p",
          name: "Parciales",
          role: "parcial" as const,
        },
      ],
      events: [
        {
          id: "ev",
          title: "Física",
          start: deadline,
          end: deadline + 3_600_000,
          busy: true,
          source: "google" as const,
          calendarId: "google:p",
        },
      ],
      tasks: [
        task("a", "Exámenes de Física", 600),
        task("b", "Finales", 600),
        task("c", "Física", 600, { sourceEventId: "ev" }),
      ],
    });
    expect(toEngineTasks(more, now).map((t) => t.mvpMinutes)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("leaves out units, marks them, and undo brings them back", async () => {
    const { reducer } = await import("./store.js");
    const { decisions, refreshPlan } = await import("./planning.js");
    const units = [
      { id: "u1", title: "Integrales", estimateMinutes: 400, weight: 60 },
      { id: "u2", title: "Series", estimateMinutes: 400, weight: 10 },
      { id: "u3", title: "Límites", estimateMinutes: 400, weight: 30 },
    ];
    const d = base({ tasks: [task("p", "Parcial de Mate", 1200, { units })] });
    const r = refreshPlan(d, now);
    const opt = decisions(r.input, r.result).options.find((o) => o.kind === "prioritize");
    expect(opt?.unitIds?.[0]).toBe("u2");
    const done = reducer(d, { type: "applyOption", optionId: opt?.id as string, now });
    expect(done.tasks[0]?.units.find((u) => u.id === "u2")?.skipped).toBe(true);
    const record = done.applied?.at(-1);
    const back = reducer(done, { type: "undoDecision", id: record?.id as string, now });
    expect(back.tasks[0]?.units.every((u) => !u.skipped)).toBe(true);
    // A unit a later decision left out stays out when undoing this one.
    const later = {
      ...done,
      tasks: done.tasks.map((t) => ({
        ...t,
        units: t.units.map((u) => (u.id === "u1" ? { ...u, skipped: true } : u)),
      })),
    };
    const undone = reducer(later, { type: "undoDecision", id: record?.id as string, now });
    expect(record?.skippedUnits).not.toContain("u1");
    expect(undone.tasks[0]?.units.map((u) => !!u.skipped)).toEqual([true, false, false]);
  });

  it("never offers to leave out a unit without a weight", async () => {
    const { toEngineTasks } = await import("./planning.js");
    const units = [
      { id: "u1", title: "Integrales", estimateMinutes: 400, weight: 60 },
      { id: "u2", title: "Series", estimateMinutes: 400 },
    ];
    const t = toEngineTasks(base({ tasks: [task("p", "Parcial de Mate", 800, { units })] }), now);
    expect(t[0]?.units?.map((u) => u.id)).toEqual(["u1"]);
  });

  it("plans a flexible event at its new time until the calendar moves it", async () => {
    const { reducer } = await import("./store.js");
    const { decisions, refreshPlan } = await import("./planning.js");
    const { isFlexible, visibleEvents } = await import("./calendars.js");
    const cafe = {
      id: "google:x",
      title: "Café con Ana #flex",
      start: zonedInstant(TIMEZONE, "2026-11-03", 9 * 60),
      // Four hours: a free stretch that long exists between meals on other days.
      end: zonedInstant(TIMEZONE, "2026-11-03", 13 * 60),
      busy: true,
      source: "google" as const,
    };
    const d = base({ events: [cafe], tasks: [task("e", "Parcial", 540)] });
    expect(isFlexible(d, cafe)).toBe(true);
    const r = refreshPlan(d, now);
    const opt = decisions(r.input, r.result).options.find((o) => o.kind === "move-event");
    expect(opt?.moveTo).toBeTruthy();
    const moved = reducer(d, { type: "applyOption", optionId: opt?.id as string, now });
    expect(moved.movedEvents).toEqual([{ eventId: "google:x", from: cafe.start, ...opt?.moveTo }]);
    expect(visibleEvents(moved)[0]).toMatchObject({ start: opt?.moveTo?.start, flexible: true });
    // Undo puts it back…
    const record = moved.applied?.at(-1);
    expect(
      reducer(moved, { type: "undoDecision", id: record?.id as string, now }).movedEvents,
    ).toEqual([]);
    // …or back to the move it replaced, when there was one.
    const earlier = { eventId: "google:x", from: cafe.start, start: cafe.start, end: cafe.end };
    const replaced = {
      ...moved,
      applied: moved.applied?.map((a) => (a === record ? { ...a, previousMove: earlier } : a)),
    };
    expect(
      reducer(replaced, { type: "undoDecision", id: record?.id as string, now }).movedEvents,
    ).toEqual([earlier]);
    // Not if the user put the event back by hand in between.
    const unmoved = reducer(replaced, { type: "unmoveEvent", eventId: "google:x", now });
    expect(
      reducer(unmoved, { type: "undoDecision", id: record?.id as string, now }).movedEvents,
    ).toEqual([]);
    // …and once the calendar shows it elsewhere, the move is over.
    const synced = reducer(
      { ...moved, events: [{ ...cafe, start: cafe.start + 3_600_000 }] },
      { type: "refresh", now },
    );
    expect(synced.movedEvents).toEqual([]);
    expect(reducer(moved, { type: "unmoveEvent", eventId: "google:x", now }).movedEvents).toEqual(
      [],
    );
  });
});

describe("breaks", () => {
  it("plan block time for study time: 60 minutes of blocks per 50 of study", async () => {
    const { applyOption, blockFactor, checkInFactor, progress, toEngineTasks } = await import(
      "./planning.js"
    );
    const now = zonedInstant(TIMEZONE, "2026-11-03", 9 * 60);
    const subject = {
      id: "m",
      name: "Física",
      color: "#0a84ff",
      academic: true,
      maxSessionMinutes: 120,
      minBlockMinutes: 60,
    };
    expect(blockFactor(subject)).toBeCloseTo(1.2);
    expect(blockFactor({ ...subject, breakMinutes: 0 })).toBe(1);
    expect(blockFactor({ ...subject, studyMinutes: 25, breakMinutes: 5 })).toBeCloseTo(1.2);
    expect(blockFactor({ ...subject, academic: false })).toBe(1);
    expect(blockFactor(undefined)).toBe(1);

    const d = {
      ...emptyData(),
      activities: [subject],
      tasks: [
        {
          id: "t",
          activityId: "m",
          title: "Parcial",
          kind: "deliverable" as const,
          deadline: now + 7 * 86_400_000,
          estimateMinutes: 300,
          minMinutes: 300,
          priority: 2,
          status: "active" as const,
          units: [],
        },
      ],
      // One hour block done: 50 minutes of study.
      checkIns: [
        {
          id: "c",
          blockId: "b",
          taskId: "t",
          status: "done" as const,
          minutesDone: 60,
          unitIds: [],
          createdAt: now - 3_600_000,
          factor: 1.2,
        },
      ],
    };
    expect(checkInFactor(d, "t")).toBeCloseTo(1.2);
    // What is left reads in study time…
    expect(progress(d, now)[0]?.remainingMinutes).toBe(250);
    // …and the planner gets the block time it needs.
    expect(toEngineTasks(d, now)[0]).toMatchObject({
      remainingMinutes: 300,
      minRemainingMinutes: 300,
    });

    // Turning breaks off later keeps the hour already done at 50 minutes of study.
    const noBreaks = { ...d, activities: [{ ...subject, breakMinutes: 0 }] };
    expect(progress(noBreaks, now)[0]?.remainingMinutes).toBe(250);
    expect(checkInFactor(noBreaks, "t")).toBeUndefined();

    // An option cutting 60 minutes of blocks takes 50 minutes of study off the task.
    const input = { tasks: toEngineTasks(d, now) } as never;
    const cut = {
      kind: "lower-minimum",
      input: { tasks: toEngineTasks(d, now).map((t) => ({ ...t, minRemainingMinutes: 240 })) },
    } as never;
    expect(applyOption(d, input, cut, now).tasks[0]?.minMinutes).toBe(250);
  });
});
