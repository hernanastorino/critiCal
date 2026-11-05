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
    // From an entrega event, "final" is the last delivery (a smaller one is fine), but
    // an exam title still counts.
    const entregas = base({
      calendars: [
        {
          id: "google:e",
          source: "google" as const,
          externalId: "e",
          name: "Entregas",
          role: "entrega" as const,
        },
      ],
      events: [
        {
          id: "x1",
          title: "Entrega final del TP",
          start: deadline,
          end: deadline,
          busy: true,
          source: "google" as const,
          calendarId: "google:e",
        },
        {
          id: "x2",
          title: "Parcial de Mate",
          start: deadline,
          end: deadline,
          busy: true,
          source: "google" as const,
          calendarId: "google:e",
        },
      ],
      tasks: [
        task("f", "Entrega final del TP", 600, { sourceEventId: "x1" }),
        task("g", "Parcial de Mate", 600, { sourceEventId: "x2" }),
      ],
    });
    const [f, g] = toEngineTasks(entregas, now);
    expect(f?.mvpMinutes).toBe(300);
    expect(g?.mvpMinutes).toBeUndefined();
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

  it("undoes decisions in any order, each giving back its own cut", async () => {
    const { reducer } = await import("./store.js");
    const t0 = task("p", "Parcial de Mate", 600);
    const rec = (id: string, before: number, after: number) => ({
      id,
      label: id,
      at: now,
      before: [{ ...t0, minMinutes: before, estimateMinutes: before }],
      after: { p: "active" as const },
      afterMinutes: { p: { min: after, estimate: after } },
    });
    // 600 → 500 (d1) → 300 (d2).
    const d = base({
      tasks: [{ ...t0, minMinutes: 300, estimateMinutes: 300 }],
      applied: [rec("d1", 600, 500), rec("d2", 500, 300)],
    });
    const one = reducer(d, { type: "undoDecision", id: "d1", now });
    expect(one.tasks[0]?.minMinutes).toBe(400);
    const both = reducer(one, { type: "undoDecision", id: "d2", now });
    expect(both.tasks[0]?.minMinutes).toBe(600);
  });

  it("plans nothing for a task whose units are all left out", async () => {
    const { progress } = await import("./planning.js");
    const units = [{ id: "u", title: "Series", estimateMinutes: 400, weight: 10, skipped: true }];
    const d = base({ tasks: [task("p", "Parcial de Mate", 600, { units })] });
    expect(progress(d, now)[0]?.remainingMinutes).toBe(0);
  });

  it("weighs units by the learned effort, like what is left", async () => {
    const { toEngineTasks } = await import("./planning.js");
    const units = [
      { id: "u0", title: "Hecho", estimateMinutes: 100, weight: 5, doneAt: now - 1 },
      { id: "u1", title: "Integrales", estimateMinutes: 100, weight: 60 },
    ];
    // That unit took twice its estimate.
    const checkIns = [
      {
        id: "c",
        blockId: "b",
        taskId: "p",
        status: "done" as const,
        minutesDone: 200,
        unitIds: ["u0"],
        createdAt: now - 1,
      },
    ];
    const d = base({ tasks: [task("p", "Parcial de Mate", 600, { units })], checkIns });
    expect(toEngineTasks(d, now)[0]?.units?.[0]?.minutes).toBeGreaterThan(100);
    // Capped by the estimate, units never add up to more than what is left.
    const capped = base({
      tasks: [
        task("p", "Parcial de Mate", 300, {
          units: [...units, { id: "u2", title: "Series", estimateMinutes: 100, weight: 10 }],
        }),
      ],
      checkIns,
    });
    const [t] = toEngineTasks(capped, now);
    const sum = (t?.units ?? []).reduce((a, u) => a + u.minutes, 0);
    expect(sum).toBeLessThanOrEqual(t?.remainingMinutes ?? 0);
    expect(sum).toBeGreaterThan(0);
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
    // A longer event in the calendar keeps its new length at the new time.
    const longer = {
      ...moved,
      events: [{ ...cafe, end: cafe.end + 3_600_000 }],
    };
    const shown = visibleEvents(longer)[0];
    expect(shown?.end).toBe((opt?.moveTo?.start as number) + (cafe.end - cafe.start) + 3_600_000);
    // Moved earlier: once the new time passes, the move stays while the original is ahead.
    const early = {
      ...moved,
      movedEvents: [
        { eventId: "google:x", from: cafe.start, start: now - 7_200_000, end: now - 3_600_000 },
      ],
    };
    expect(reducer(early, { type: "refresh", now }).movedEvents).toHaveLength(1);
    // Out of order: undoing the first of two moves keeps the second, and undoing the
    // second afterwards puts the event back at its own time, not at the first move.
    const m1 = { eventId: "google:x", from: cafe.start, start: cafe.start + 1, end: cafe.end + 1 };
    const m2 = { eventId: "google:x", from: cafe.start, start: cafe.start + 2, end: cafe.end + 2 };
    const base2 = { at: now, label: "Mover", before: [], freeTimeUntil: undefined };
    const twice = {
      ...moved,
      movedEvents: [m2],
      applied: [
        { ...base2, id: "d1", movedEventId: "google:x", move: m1 },
        { ...base2, id: "d2", movedEventId: "google:x", move: m2, previousMove: m1 },
      ],
    };
    const first = reducer(twice, { type: "undoDecision", id: "d1", now });
    expect(first.movedEvents).toEqual([m2]);
    expect(reducer(first, { type: "undoDecision", id: "d2", now }).movedEvents).toEqual([]);
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

    // Today's plan while the event still stood.
    const saved = d.plan;
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
    // Meanwhile today's plan does not take the freed time: no new blocks today.
    const todayEnd = zonedInstant(TIMEZONE, "2026-11-04", 0);
    const ids = (x: typeof d) =>
      x.plan.filter((b) => b.end > now && b.start < todayEnd).map((b) => b.id);
    expect(ids(d).every((id) => saved.some((b) => b.id === id))).toBe(true);
    expect(ids(again).every((id) => saved.some((b) => b.id === id))).toBe(true);
    // Turned down, today still keeps its blocks for the rest of the day.
    const { reducer } = await import("./store.js");
    const no = reducer(again, {
      type: "rejectProposal",
      id: "tentative@a",
      now: now + 180_000,
    });
    const after = reducer(no, { type: "refresh", now: now + 240_000 });
    expect(after.proposals.some((p) => p.id.startsWith("tentative@"))).toBe(false);
    // Today's blocks are still there, all of them from before.
    expect(ids(after).length).toBeGreaterThan(0);
    expect(ids(after)).toEqual(ids(again));
    expect(ids(after).every((id) => saved.some((b) => b.id === id))).toBe(true);
    // Undoing the rejection brings plan B back without the hold.
    const back = reducer(no, { type: "undoPlan", now: now + 200_000 });
    expect(back.tentativeHoldUntil).toBeUndefined();
    expect(back.proposals.some((p) => p.id === "tentative@a")).toBe(true);
    // Asking for a new plan lifts the hold.
    expect(reducer(after, { type: "replanWeek", now: now + 300_000 }).tentativeHoldUntil).toBe(
      undefined,
    );
    // A tentative event that takes no time is not watched.
    const free = refresh(
      { ...base, events: [...base.events, ev("f", "Quizás?", "2026-11-03", 17, { busy: false })] },
      now,
    );
    expect((free.tentativeSeen ?? []).some((s) => s.id === "f")).toBe(false);
    // Unanswered, it expires with its day.
    const tomorrow = zonedInstant(TIMEZONE, "2026-11-04", 9 * 60);
    expect(refresh(again, tomorrow).proposals.some((p) => p.id.startsWith("tentative@"))).toBe(
      false,
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
