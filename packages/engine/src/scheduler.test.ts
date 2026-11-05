import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildSlots } from "./availability.js";
import { overlaps } from "./intervals.js";
import { infeasibilityOptions, recommendations, targetOptions } from "./options.js";
import { assignable, type ScheduleInput, type ScheduleResult, schedule } from "./scheduler.js";
import { activity, at, settings, task } from "./testing.js";
import { type CalendarEvent, MINUTE, type PlanBlock } from "./types.js";

const now = at("2026-11-02", "08:00");
const horizonEnd = at("2026-11-09", "08:00");
const base = (over: Partial<ScheduleInput> = {}): ScheduleInput => ({
  now,
  horizonEnd,
  settings,
  activities: [activity("mate"), activity("fisica"), activity("gym", { academic: false })],
  tasks: [],
  events: [],
  ...over,
});

const minutesOf = (r: ScheduleResult, taskId: string) =>
  r.blocks.filter((b) => b.taskId === taskId).reduce((s, b) => s + (b.end - b.start) / MINUTE, 0);

const ev = (
  id: string,
  start: number,
  end: number,
  over: Partial<CalendarEvent> = {},
): CalendarEvent => ({
  id,
  title: id,
  start,
  end,
  busy: true,
  ...over,
});

describe("schedule", () => {
  const long = activity("mate", { maxSessionMinutes: 600 });

  it("places the target before the deadline, outside events and free time", () => {
    const clase = ev("clase", at("2026-11-02", "08:00"), at("2026-11-02", "12:00"));
    const r = schedule(
      base({
        tasks: [
          task("p5", "mate", at("2026-11-04", "08:00"), {
            remainingMinutes: 240,
            minRemainingMinutes: 120,
          }),
        ],
        events: [
          clase,
          ev("libre", at("2026-11-02", "14:00"), at("2026-11-02", "15:00"), { busy: false }),
        ],
      }),
    );
    expect(r.feasible).toBe(true);
    expect(minutesOf(r, "p5")).toBe(240);
    for (const b of r.blocks) {
      expect(overlaps(b, clase)).toBe(false);
      expect(b.end).toBeLessThanOrEqual(at("2026-11-04", "08:00"));
      expect(b.soft).toBe(false);
      expect(b.activityId).toBe("mate");
      expect(b.id).toBe(`p5@${b.start}`);
    }
    expect(r.status[0]).toMatchObject({
      taskId: "p5",
      minDeficit: 0,
      targetDeficit: 0,
      level: "ok",
    });
  });

  it("spreads work over days instead of cramming one", () => {
    const r = schedule(
      base({
        tasks: [
          task("p", "mate", at("2026-11-06", "08:00"), {
            remainingMinutes: 480,
            minRemainingMinutes: 480,
          }),
        ],
      }),
    );
    const days = new Set(r.blocks.map((b) => new Date(b.start).toISOString().slice(0, 10)));
    expect(days.size).toBeGreaterThanOrEqual(3);
  });

  it("respects the session cap, per-day cap and fixed session length", () => {
    const r = schedule(
      base({
        activities: [
          activity("mate", { maxSessionMinutes: 60 }),
          activity("gym", { academic: false }),
        ],
        tasks: [
          task("m", "mate", at("2026-11-03", "08:00"), {
            remainingMinutes: 300,
            minRemainingMinutes: 300,
          }),
          task("g", "gym", at("2026-11-09", "08:00"), {
            remainingMinutes: 180,
            minRemainingMinutes: 180,
            sessionMinutes: 90,
            maxPerDayMinutes: 90,
          }),
        ],
      }),
    );
    for (const b of r.blocks.filter((x) => x.taskId === "m"))
      expect(b.end - b.start).toBeLessThanOrEqual(60 * MINUTE);
    const gym = r.blocks.filter((x) => x.taskId === "g");
    expect(gym).toHaveLength(2);
    expect(gym.every((b) => b.end - b.start === 90 * MINUTE)).toBe(true);
    expect(new Set(gym.map((b) => new Date(b.start).toDateString())).size).toBe(2);
  });

  it("reports deficits and criticality when minimums do not fit", () => {
    const deadline = at("2026-11-02", "13:00");
    const r = schedule(
      base({
        activities: [long],
        tasks: [task("t", "mate", deadline, { remainingMinutes: 600, minRemainingMinutes: 600 })],
      }),
    );
    expect(r.feasible).toBe(false);
    expect(r.status[0]).toMatchObject({
      scheduledMinutes: 300,
      minDeficit: 300,
      level: "critical",
    });
    expect(r.blocks.every((b) => b.level === "critical")).toBe(true);
  });

  it("marks blocks with no room to spare as critical and roomy ones as ok", () => {
    const tight = schedule(
      base({
        activities: [long],
        tasks: [
          task("t", "mate", at("2026-11-02", "13:00"), {
            remainingMinutes: 300,
            minRemainingMinutes: 300,
          }),
        ],
      }),
    );
    expect(tight.feasible).toBe(true);
    expect(tight.status[0]?.slack).toBe(0);
    expect(tight.blocks.every((b) => b.level === "critical")).toBe(true);

    const roomy = schedule(
      base({
        tasks: [
          task("t", "mate", at("2026-11-08", "13:00"), {
            remainingMinutes: 60,
            minRemainingMinutes: 60,
          }),
        ],
      }),
    );
    expect(roomy.blocks.every((b) => b.level === "ok")).toBe(true);

    const warn = schedule(
      base({
        tasks: [
          task("t", "mate", at("2026-11-02", "19:00"), {
            remainingMinutes: 420,
            minRemainingMinutes: 420,
          }),
        ],
      }),
    );
    expect(warn.status[0]?.level).toBe("warn");
  });

  it("makes every earlier block critical when some minimum does not fit", () => {
    const r = schedule(
      base({
        tasks: [
          task("easy", "fisica", at("2026-11-06", "08:00"), {
            remainingMinutes: 60,
            minRemainingMinutes: 0,
          }),
          task("hard", "mate", at("2026-11-02", "12:00"), {
            remainingMinutes: 600,
            minRemainingMinutes: 600,
          }),
        ],
      }),
    );
    expect(r.feasible).toBe(false);
    const before = r.blocks.filter((b) => b.start < at("2026-11-02", "12:00"));
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((b) => b.level === "critical")).toBe(true);
  });

  it("keeps frozen blocks and counts them as done", () => {
    const frozen: PlanBlock = {
      id: "f",
      taskId: "t",
      activityId: "mate",
      start: at("2026-11-02", "08:00"),
      end: at("2026-11-02", "09:00"),
    };
    const r = schedule(
      base({
        frozen: [frozen],
        tasks: [
          task("t", "mate", at("2026-11-03", "08:00"), {
            remainingMinutes: 120,
            minRemainingMinutes: 120,
          }),
        ],
      }),
    );
    expect(r.blocks.find((b) => b.id === "f")).toMatchObject({ frozen: true });
    expect(minutesOf(r, "t")).toBe(120);
    expect(r.status[0]?.scheduledMinutes).toBe(120);
    const others = r.blocks.filter((b) => !b.frozen);
    expect(others.every((b) => !overlaps(b, frozen))).toBe(true);
  });

  it("counts frozen blocks towards the daily caps", () => {
    const frozen: PlanBlock = {
      id: "f",
      taskId: "m",
      activityId: "mate",
      start: at("2026-11-02", "08:00"),
      end: at("2026-11-02", "09:00"),
    };
    const late: PlanBlock = {
      ...frozen,
      id: "late",
      start: at("2026-11-03", "00:30"),
      end: at("2026-11-03", "01:00"),
    };
    const r = schedule(
      base({
        settings: { ...settings, maxActivitiesPerDay: 1 },
        frozen: [frozen, late],
        tasks: [
          task("m", "mate", at("2026-11-04", "08:00"), {
            remainingMinutes: 180,
            minRemainingMinutes: 180,
            maxPerDayMinutes: 90,
          }),
          task("f", "fisica", at("2026-11-04", "08:00"), {
            remainingMinutes: 60,
            minRemainingMinutes: 60,
          }),
        ],
      }),
    );
    const monday = r.blocks.filter((b) => !b.frozen && b.start < at("2026-11-03", "08:00"));
    expect(monday.every((b) => b.activityId === "mate")).toBe(true);
    const mateMonday = monday.reduce((s, b) => s + (b.end - b.start) / MINUTE, 0);
    expect(mateMonday).toBe(0);
  });

  it("splits frozen blocks at wake-up and honours wake overrides", () => {
    const capOne = { ...settings, maxActivitiesPerDay: 1 };
    const fisica = task("f", "fisica", at("2026-11-04", "08:00"), {
      remainingMinutes: 60,
      minRemainingMinutes: 60,
    });
    const isTuesday = (b: PlanBlock) =>
      b.start >= at("2026-11-03", "06:00") && b.start < at("2026-11-04", "00:00");

    // 07:30–08:30 with an 08:00 wake: the last half hour belongs to Tuesday.
    const crossing: PlanBlock = {
      id: "x",
      taskId: "m",
      activityId: "mate",
      start: at("2026-11-03", "07:30"),
      end: at("2026-11-03", "08:30"),
    };
    const r1 = schedule(
      base({
        now: at("2026-11-03", "08:30"),
        settings: capOne,
        frozen: [crossing],
        tasks: [
          task("m", "mate", at("2026-11-04", "08:00"), {
            remainingMinutes: 0,
            minRemainingMinutes: 0,
          }),
          fisica,
        ],
      }),
    );
    expect(r1.blocks.filter((b) => !b.frozen && b.taskId === "f").some(isTuesday)).toBe(false);

    // Woke at 06:00 on Tuesday: a 06:30 block counts for Tuesday.
    const early: PlanBlock = {
      ...crossing,
      id: "e",
      start: at("2026-11-03", "06:30"),
      end: at("2026-11-03", "07:30"),
    };
    const r2 = schedule(
      base({
        now: at("2026-11-03", "07:30"),
        settings: capOne,
        overrides: [{ date: "2026-11-03", wake: 360 }],
        frozen: [early],
        tasks: [
          task("m", "mate", at("2026-11-04", "08:00"), {
            remainingMinutes: 0,
            minRemainingMinutes: 0,
          }),
          fisica,
        ],
      }),
    );
    expect(r2.blocks.filter((b) => !b.frozen && b.taskId === "f").some(isTuesday)).toBe(false);
  });

  it("only uses free time for academic work when allowed", () => {
    const deadline = at("2026-11-02", "23:59");
    const input = base({
      tasks: [task("t", "mate", deadline, { remainingMinutes: 600, minRemainingMinutes: 600 })],
    });
    expect(schedule(input).feasible).toBe(false);
    const allowed = schedule({ ...input, allowFreeTime: true });
    expect(allowed.feasible).toBe(true);
    expect(allowed.blocks.some((b) => b.soft)).toBe(true);

    const gym = schedule(
      base({
        events: [ev("dia", at("2026-11-02", "08:00"), at("2026-11-02", "19:30"))],
        tasks: [task("g", "gym", deadline, { remainingMinutes: 60, minRemainingMinutes: 60 })],
      }),
    );
    expect(gym.blocks[0]?.soft).toBe(true);
  });

  it("prefers one activity per day when the cap is 1", () => {
    const r = schedule(
      base({
        settings: { ...settings, maxActivitiesPerDay: 1 },
        tasks: [
          task("m", "mate", at("2026-11-04", "08:00"), {
            remainingMinutes: 120,
            minRemainingMinutes: 120,
          }),
          task("f", "fisica", at("2026-11-04", "08:00"), {
            remainingMinutes: 120,
            minRemainingMinutes: 120,
          }),
        ],
      }),
    );
    const byDay = new Map<string, Set<string>>();
    for (const b of r.blocks) {
      const d = new Date(b.start - 3 * 60 * MINUTE).toISOString().slice(0, 10);
      byDay.set(d, (byDay.get(d) ?? new Set()).add(b.activityId));
    }
    expect([...byDay.values()].every((s) => s.size === 1)).toBe(true);
  });

  it("honours preferred windows when possible", () => {
    const r = schedule(
      base({
        activities: [activity("mate", { preferred: { start: 8 * 60, end: 12 * 60 } })],
        tasks: [
          task("m", "mate", at("2026-11-05", "08:00"), {
            remainingMinutes: 120,
            minRemainingMinutes: 120,
          }),
        ],
      }),
    );
    for (const b of r.blocks) {
      const h = new Date(b.start - 3 * 60 * MINUTE).getUTCHours();
      expect(h).toBeGreaterThanOrEqual(8);
      expect(h).toBeLessThan(12);
    }
  });

  it("blocks travel time and reports unknown locations", () => {
    const r = schedule(
      base({
        events: [
          ev("clase", at("2026-11-02", "10:00"), at("2026-11-02", "12:00"), {
            location: "Facultad",
          }),
        ],
        travel: {
          home: "home",
          resolvePlace: (l) => (l === "Facultad" ? "facu" : undefined),
          travelMinutes: () => 30,
          marginMinutes: 10,
          returnHomeAfterMinutes: 120,
        },
        tasks: [
          task("t", "mate", at("2026-11-02", "13:00"), {
            remainingMinutes: 60,
            minRemainingMinutes: 60,
          }),
        ],
      }),
    );
    expect(r.unresolvedLocations).toEqual([]);
    expect(r.blocks[0]).toMatchObject({
      start: at("2026-11-02", "08:00"),
      end: at("2026-11-02", "09:00"),
    });
  });

  it("rejects tasks for unknown activities", () => {
    expect(() => schedule(base({ tasks: [task("t", "nope", horizonEnd)] }))).toThrow(
      /unknown activity/,
    );
  });
});

describe("options", () => {
  const tight = base({
    tasks: [
      task("m", "mate", at("2026-11-02", "19:30"), {
        remainingMinutes: 360,
        minRemainingMinutes: 360,
        priority: 2,
      }),
      task("f", "fisica", at("2026-11-02", "19:30"), {
        remainingMinutes: 360,
        minRemainingMinutes: 300,
      }),
    ],
  });

  it("offers previewed ways out when minimums do not fit", () => {
    const r = schedule(tight);
    expect(r.feasible).toBe(false);
    const opts = infeasibilityOptions(tight, r);
    const kinds = opts.map((o) => o.id);
    expect(kinds).toEqual(
      expect.arrayContaining([
        "use-free-time",
        "lower-minimum:f",
        "drop:f",
        "drop:m",
        "proportional",
      ]),
    );
    expect(opts[0]?.result.feasible).toBe(true);
    const drop = opts.find((o) => o.id === "drop:f");
    expect(drop?.input.tasks.map((t) => t.id)).toEqual(["m"]);
    expect(infeasibilityOptions(base(), schedule(base()))).toEqual([]);
  });

  it("never offers lowering a minimum to zero or a 0 % split", () => {
    const hopeless = base({
      tasks: [
        task("m", "mate", at("2026-11-02", "09:00"), {
          remainingMinutes: 600,
          minRemainingMinutes: 600,
        }),
      ],
    });
    const opts = infeasibilityOptions(hopeless, schedule(hopeless));
    expect(opts.some((o) => o.kind === "lower-minimum" && /mínimo 0/.test(o.label))).toBe(false);
    expect(opts.every((o) => !/\b0 %/.test(o.label))).toBe(true);
    expect(opts.some((o) => o.id === "drop:m")).toBe(true);
    const lower = infeasibilityOptions(
      base({
        tasks: [
          task("m", "mate", at("2026-11-02", "13:00"), {
            remainingMinutes: 330,
            minRemainingMinutes: 330,
          }),
        ],
      }),
      schedule(
        base({
          tasks: [
            task("m", "mate", at("2026-11-02", "13:00"), {
              remainingMinutes: 330,
              minRemainingMinutes: 330,
            }),
          ],
        }),
      ),
    ).find((o) => o.kind === "lower-minimum");
    expect(lower?.label).toMatch(/mínimo \d+ h/);
  });

  it("offers settling for the minimum when only the target is short", () => {
    const input = base({
      tasks: [
        task("m", "mate", at("2026-11-02", "13:00"), {
          remainingMinutes: 600,
          minRemainingMinutes: 120,
        }),
      ],
    });
    const r = schedule(input);
    expect(r.feasible).toBe(true);
    const opts = targetOptions(input, r);
    expect(opts.map((o) => o.id)).toEqual(["minimum-only", "use-free-time"]);
    expect(opts[0]?.result.status[0]?.targetDeficit).toBe(0);
    expect(targetOptions({ ...input, allowFreeTime: true }, r).map((o) => o.id)).toEqual([
      "minimum-only",
    ]);
    expect(targetOptions(base(), schedule(base()))).toEqual([]);
  });

  it("recommends mixing subjects when the daily cap blocks a minimum", () => {
    const input = base({
      settings: { ...settings, maxActivitiesPerDay: 1 },
      allowFreeTime: true,
      tasks: [
        task("m", "mate", at("2026-11-02", "23:30"), {
          remainingMinutes: 300,
          minRemainingMinutes: 300,
        }),
        task("f", "fisica", at("2026-11-02", "23:30"), {
          remainingMinutes: 60,
          minRemainingMinutes: 60,
        }),
      ],
    });
    const recs = recommendations(input, schedule(input));
    expect(recs).toHaveLength(1);
    expect(recs[0]?.id).toBe("relax-context");
    expect(recs[0]?.message).toMatch(/llegás a todos los mínimos/);
    expect(recs[0]?.result.blocks.filter((b) => b.soft)).toHaveLength(0);
    const easy = base({ tasks: [task("m", "mate", horizonEnd)] });
    expect(recommendations(easy, schedule(easy))).toEqual([]);
  });
});

describe("schedule invariants", () => {
  const arbTask = (i: number) =>
    fc
      .record({
        activity: fc.constantFrom("mate", "fisica", "gym"),
        dueHours: fc.integer({ min: 2, max: 160 }),
        min: fc.integer({ min: 0, max: 8 }).map((x) => x * 30),
        extra: fc.integer({ min: 0, max: 8 }).map((x) => x * 30),
        priority: fc.integer({ min: 1, max: 3 }),
      })
      .map((t) =>
        task(`t${i}`, t.activity, now + t.dueHours * 60 * MINUTE, {
          minRemainingMinutes: t.min,
          remainingMinutes: t.min + t.extra,
          priority: t.priority,
        }),
      );

  const arbEvent = fc
    .record({
      startH: fc.integer({ min: 0, max: 160 }),
      lenH: fc.integer({ min: 1, max: 4 }),
      busy: fc.boolean(),
    })
    .map((e) =>
      ev(`e${e.startH}`, now + e.startH * 60 * MINUTE, now + (e.startH + e.lenH) * 60 * MINUTE, {
        busy: e.busy,
      }),
    );

  const arbInput = fc
    .tuple(
      fc
        .tuple(arbTask(0), arbTask(1), arbTask(2), arbTask(3))
        .chain((ts) => fc.integer({ min: 0, max: 4 }).map((n) => ts.slice(0, n))),
      fc.array(arbEvent, { maxLength: 8 }),
      fc.boolean(),
    )
    .map(([tasks, events, allowFreeTime]) => base({ tasks, events, allowFreeTime }));

  it("never breaks hard constraints", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const r = schedule(input);
        const awake = buildSlots(settings, [], now, horizonEnd, []);
        const inAwake = (b: PlanBlock) =>
          awake.some((s) => s.start <= b.start && b.start < s.end) &&
          awake.some((s) => s.start < b.end && b.end <= s.end);
        const busy = input.events.filter((e) => e.busy);
        r.blocks.forEach((b, i) => {
          const t = input.tasks.find((x) => x.id === b.taskId);
          expect(t).toBeDefined();
          expect(b.end).toBeLessThanOrEqual(t?.deadline ?? 0);
          expect(b.start).toBeGreaterThanOrEqual(now);
          expect(inAwake(b)).toBe(true);
          expect(busy.some((e) => overlaps(e, b))).toBe(false);
          const next = r.blocks[i + 1];
          if (next) expect(next.start).toBeGreaterThanOrEqual(b.end);
          if (b.soft && b.activityId !== "gym") expect(input.allowFreeTime).toBe(true);
        });
        for (const s of r.status) {
          const t = input.tasks.find((x) => x.id === s.taskId);
          expect(s.scheduledMinutes).toBeLessThanOrEqual(
            Math.max(t?.remainingMinutes ?? 0, t?.minRemainingMinutes ?? 0),
          );
          expect(s.scheduledMinutes + s.minDeficit).toBeGreaterThanOrEqual(
            t?.minRemainingMinutes ?? 0,
          );
        }
        expect(r.feasible).toBe(r.status.every((s) => s.minDeficit === 0));
      }),
      { numRuns: 60 },
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        expect(schedule(input)).toEqual(schedule(input));
      }),
      { numRuns: 20 },
    );
  });
});

describe("more ways out", () => {
  const deadline = at("2026-11-02", "19:30");

  it("moves a flexible event to the closest free time", () => {
    const flex = ev("Café #flex", at("2026-11-02", "10:00"), at("2026-11-02", "14:00"), {
      flexible: true,
    });
    const input = base({
      tasks: [task("m", "mate", deadline, { remainingMinutes: 480, minRemainingMinutes: 480 })],
      events: [flex],
    });
    const r = schedule(input);
    expect(r.feasible).toBe(false);
    const move = infeasibilityOptions(input, r).find((o) => o.kind === "move-event");
    expect(move).toMatchObject({ eventId: "Café #flex" });
    expect(move?.label).toMatch(/^Mover «Café #flex» al /);
    const to = move?.moveTo as { start: number; end: number };
    expect(to.end - to.start).toBe(flex.end - flex.start);
    expect(to.start).not.toBe(flex.start);
    // The moved event is in the option's input, at its new time.
    expect(move?.input.events.find((e) => e.id === flex.id)).toMatchObject(to);
    // A fixed event is never offered.
    const fixed = base({ ...input, events: [{ ...flex, flexible: false }] });
    expect(infeasibilityOptions(fixed, schedule(fixed)).some((o) => o.kind === "move-event")).toBe(
      false,
    );
  });

  it("never moves a flexible event into the trip to another one", () => {
    const flex = ev("Café #flex", at("2026-11-02", "10:00"), at("2026-11-02", "14:00"), {
      flexible: true,
    });
    const clase = ev("clase", at("2026-11-02", "18:00"), at("2026-11-02", "19:00"), {
      location: "Facultad",
    });
    const travel = {
      home: "home",
      resolvePlace: (l: string) => (l === "Facultad" ? "facu" : undefined),
      travelMinutes: () => 180,
      marginMinutes: 10,
      returnHomeAfterMinutes: 120,
    };
    const input = base({
      tasks: [task("m", "mate", deadline, { remainingMinutes: 480, minRemainingMinutes: 480 })],
      events: [flex, clase],
      travel,
    });
    const move = infeasibilityOptions(input, schedule(input)).find((o) => o.kind === "move-event");
    const trip = { start: at("2026-11-02", "14:50"), end: at("2026-11-02", "18:00") };
    if (move?.moveTo) expect(overlaps(move.moveTo, trip)).toBe(false);
  });

  it("leaves out an exam's lightest units, never the heaviest", () => {
    const input = base({
      tasks: [
        task("p", "mate", deadline, {
          remainingMinutes: 900,
          minRemainingMinutes: 900,
          units: [
            { id: "u1", title: "Integrales", minutes: 300, weight: 50 },
            { id: "u2", title: "Series", minutes: 300, weight: 10 },
            { id: "u3", title: "Límites", minutes: 300, weight: 40 },
          ],
        }),
      ],
    });
    const opt = infeasibilityOptions(input, schedule(input)).find((o) => o.kind === "prioritize");
    expect(opt?.unitIds?.[0]).toBe("u2");
    expect(opt?.unitIds).not.toContain("u1");
    expect(opt?.label).toContain("«Series»");
    const t = opt?.input.tasks[0];
    expect(t?.minRemainingMinutes).toBe(900 - 300 * (opt?.unitIds?.length ?? 0));
  });

  it("offers a minimum viable version of an entrega", () => {
    const input = base({
      tasks: [
        task("e", "mate", deadline, {
          remainingMinutes: 900,
          minRemainingMinutes: 900,
          mvpMinutes: 300,
        }),
      ],
    });
    const opt = infeasibilityOptions(input, schedule(input)).find(
      (o) => o.kind === "minimum-viable",
    );
    expect(opt?.input.tasks[0]).toMatchObject({ minRemainingMinutes: 300, remainingMinutes: 300 });
    expect(opt?.label).toBe("Entregar una versión mínima de e (5 h)");
  });
});

describe("exam review", () => {
  const dayOf = (b: PlanBlock) => new Date(b.start - 3 * 3_600_000).toISOString().slice(0, 10);

  it("leans an exam's sessions towards its review days", () => {
    const exam = task("parcial", "mate", at("2026-11-09", "08:00"), {
      remainingMinutes: 180,
      minRemainingMinutes: 180,
    });
    const plain = schedule(base({ tasks: [exam] }));
    const spaced = schedule(
      base({ tasks: [{ ...exam, reviewDates: ["2026-11-05", "2026-11-08"] }] }),
    );
    expect(minutesOf(spaced, "parcial")).toBe(180);
    const on = (r: ScheduleResult) =>
      r.blocks.filter((b) => ["2026-11-05", "2026-11-08"].includes(dayOf(b))).length;
    expect(on(spaced)).toBeGreaterThan(on(plain));
  });

  it("leaves a later task the slots only it can use", () => {
    // A fits only Monday 15–17 or Tuesday 08–09 (a review day); B avoids Monday.
    const r = schedule(
      base({
        tasks: [
          task("a", "mate", at("2026-11-03", "09:00"), {
            remainingMinutes: 120,
            minRemainingMinutes: 120,
            sessionMinutes: 60,
            reviewDates: ["2026-11-03"],
          }),
          task("b", "fisica", at("2026-11-04", "08:00"), {
            remainingMinutes: 60,
            minRemainingMinutes: 60,
            sessionMinutes: 60,
            avoid: [{ start: at("2026-11-02", "00:00"), end: at("2026-11-03", "00:00") }],
          }),
        ],
        events: [
          ev("x", at("2026-11-02", "08:00"), at("2026-11-02", "15:00")),
          ev("y", at("2026-11-02", "17:00"), at("2026-11-03", "08:00")),
          ev("z", at("2026-11-03", "09:00"), at("2026-11-04", "08:00")),
        ],
      }),
    );
    expect(minutesOf(r, "a")).toBe(120);
    expect(minutesOf(r, "b")).toBe(60);
  });

  it("does not count the slots of a task already covered", () => {
    // A: Monday 08 or 09; B and C: Monday 08 or Tuesday 08. Only A at 09 fits all three.
    const hour = { remainingMinutes: 60, minRemainingMinutes: 60, sessionMinutes: 60 };
    const r = schedule(
      base({
        tasks: [
          task("a", "mate", at("2026-11-02", "10:00"), hour),
          task("b", "fisica", at("2026-11-04", "08:00"), {
            ...hour,
            avoid: [{ start: at("2026-11-02", "09:00"), end: at("2026-11-02", "10:00") }],
          }),
          task("c", "gym", at("2026-11-04", "08:00"), {
            ...hour,
            avoid: [{ start: at("2026-11-02", "09:00"), end: at("2026-11-02", "10:00") }],
          }),
        ],
        events: [
          ev("x", at("2026-11-02", "10:00"), at("2026-11-03", "08:00")),
          ev("y", at("2026-11-03", "09:00"), at("2026-11-04", "08:00")),
        ],
      }),
    );
    expect(["a", "b", "c"].map((id) => minutesOf(r, id))).toEqual([60, 60, 60]);
  });

  it("checks every group of tasks, not only deadline prefixes", () => {
    expect(assignable([60, 60], [{ tasks: [0, 1], minutes: 60 }])).toBe(false);
    expect(
      assignable(
        [120, 60, 60],
        [
          { tasks: [0, 1, 2], minutes: 120 },
          { tasks: [0], minutes: 120 },
        ],
      ),
    ).toBe(true);
    // A needs 2 h, B and C 1 h each, all on Monday 08–12; B and C avoid 10–12.
    const avoid = [{ start: at("2026-11-02", "10:00"), end: at("2026-11-02", "12:00") }];
    const r = schedule(
      base({
        tasks: [
          task("a", "mate", at("2026-11-02", "12:00"), {
            remainingMinutes: 120,
            minRemainingMinutes: 120,
            sessionMinutes: 60,
          }),
          task("b", "fisica", at("2026-11-02", "12:30"), {
            remainingMinutes: 60,
            minRemainingMinutes: 60,
            sessionMinutes: 60,
            avoid,
          }),
          task("c", "gym", at("2026-11-02", "12:30"), {
            remainingMinutes: 60,
            minRemainingMinutes: 60,
            sessionMinutes: 60,
            avoid,
          }),
        ],
        events: [ev("x", at("2026-11-02", "14:00"), at("2026-11-04", "08:00"))],
        maxActivitiesPerDay: Number.POSITIVE_INFINITY,
      }),
    );
    // A no longer grabs the morning B and C need (the old prefix check let it).
    expect(minutesOf(r, "a")).toBe(120);
    expect(r.blocks.some((b) => b.taskId === "a" && b.start === at("2026-11-02", "08:00"))).toBe(
      false,
    );
    expect(minutesOf(r, "b")).toBe(60);
  });

  it("never uses times a task must avoid", () => {
    const keep = { start: at("2026-11-03", "00:00"), end: at("2026-11-04", "00:00") };
    const r = schedule(
      base({
        tasks: [
          task("fis", "fisica", at("2026-11-05", "08:00"), {
            remainingMinutes: 240,
            minRemainingMinutes: 60,
            avoid: [keep],
          }),
        ],
      }),
    );
    expect(minutesOf(r, "fis")).toBeGreaterThan(0);
    expect(r.blocks.every((b) => b.end <= keep.start || b.start >= keep.end)).toBe(true);
  });
});
