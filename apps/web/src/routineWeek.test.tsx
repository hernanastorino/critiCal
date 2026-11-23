import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Inbox } from "./components/Inbox.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, emptyData } from "./demo.js";
import { MINUTE, zonedInstant } from "./engine.js";
import type { AppData, AppTask } from "./model.js";
import { decisions, maxPerDay, refreshPlan } from "./planning.js";
import { reducer, StoreProvider } from "./store.js";
import { runningSince } from "./testing.js";

afterEach(cleanup);

const tz = "America/Montevideo";
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return zonedInstant(tz, date, h * 60 + m);
};
const MONDAY_23 = at("2026-11-23", "00:00");

/** The tester's steps on a fresh demo: a materia added and deleted, running, a home. */
function testerWeek(now: number): AppData {
  let d = reducer(demoData(now), { type: "refresh", now });
  d = reducer(d, {
    type: "saveActivity",
    activity: {
      id: "quimica",
      name: "Química",
      color: "#123456",
      academic: true,
      kind: "materia",
      maxSessionMinutes: 120,
      minBlockMinutes: 60,
    },
    now,
  });
  d = reducer(d, { type: "deleteActivity", activityId: "quimica", now });
  d = runningSince(
    reducer(d, {
      type: "saveRoutine",
      name: "Correr",
      sessionsPerWeek: 8,
      sessionMinutes: 30,
      now,
    }),
    now,
  );
  return reducer(d, {
    type: "savePlace",
    place: { id: "casa", name: "Casa", aliases: [], isHome: true },
    now,
  });
}

const minutes = (d: AppData, taskId: string, from: number, to: number) =>
  d.plan
    .filter((b) => b.taskId === taskId && b.start >= from && b.start < to)
    .reduce((sum, b) => sum + (b.end - b.start) / MINUTE, 0);

describe("a routine of 8 times a week in the demo (Tue 17/11)", () => {
  const NOW = at("2026-11-17", "10:00");
  const d = testerWeek(NOW);
  const correr = d.tasks.find((t) => t.title === "Correr") as AppTask;

  it("does not push the TP to the day it is due", () => {
    // Routines are not materias: they leave room for the TP on the weekend.
    expect(minutes(d, "tp-prog", at("2026-11-21", "00:00"), MONDAY_23)).toBeGreaterThan(0);
    expect(minutes(d, "tp-prog", MONDAY_23, at("2026-11-24", "00:00"))).toBeLessThan(480);
  });

  it("fits the 8 sessions, two on some days, and marks nothing critical", () => {
    expect(maxPerDay(correr)).toBe(60);
    expect(minutes(d, correr.id, NOW, MONDAY_23)).toBe(240);
    const r = refreshPlan(d, NOW);
    expect(r.result.feasible).toBe(true);
    expect(d.plan.filter((b) => b.end > NOW && b.level === "critical")).toEqual([]);
    expect(decisions(r.input, r.result).options.every((o) => o.kind !== "drop")).toBe(true);
  });

  it("keeps the TP on the weekend later in the day too", () => {
    const evening = at("2026-11-17", "18:00");
    const later = testerWeek(evening);
    expect(minutes(later, "tp-prog", at("2026-11-21", "00:00"), MONDAY_23)).toBeGreaterThan(0);
    // The parcial is short by then (as in the demo alone): only time it could use before
    // it, on Thursday 08:00, is critical; routines on the weekend are not.
    const run = later.tasks.find((t) => t.title === "Correr") as AppTask;
    const weekend = later.plan.filter(
      (b) => [run.id, "gym"].includes(b.taskId) && b.start >= at("2026-11-21", "00:00"),
    );
    expect(weekend.length).toBeGreaterThan(0);
    expect(weekend.filter((b) => b.level === "critical")).toEqual([]);
  });

  it("leaves one session a day for routines of up to 7", () => {
    expect(maxPerDay({ ...correr, sessionsPerWeek: 7 })).toBe(30);
    expect(maxPerDay({ ...correr, sessionsPerWeek: 14 })).toBe(60);
    expect(maxPerDay({ ...correr, maxPerDayMinutes: 90 })).toBe(90);
  });
});

describe("a routine that does not fit even alone", () => {
  // Saturday: two days left for 7 runs, one a day.
  const SAT = at("2026-11-21", "10:00");
  const data = (): AppData => {
    const base: AppData = {
      ...emptyData(),
      preferences: { holidaysOff: false },
      activities: [
        {
          id: "prog",
          name: "Programación",
          color: "#f80",
          academic: true,
          maxSessionMinutes: 120,
          minBlockMinutes: 60,
        },
      ],
      tasks: [
        {
          id: "tp",
          activityId: "prog",
          title: "TP",
          kind: "deliverable",
          deadline: at("2026-11-22", "20:00"),
          estimateMinutes: 120,
          minMinutes: 120,
          priority: 2,
          status: "active",
          units: [],
        },
      ],
    };
    return runningSince(
      reducer(base, {
        type: "saveRoutine",
        name: "Correr",
        sessionsPerWeek: 7,
        sessionMinutes: 30,
        now: SAT,
      }),
      SAT,
    );
  };

  it("plans only the runs that fit and does not report the rest as missing", () => {
    const d = data();
    const r = refreshPlan(d, SAT);
    const correr = d.tasks.find((t) => t.title === "Correr") as AppTask;
    const dec = decisions(r.input, r.result);
    // A routine behind in the week is not a cause nor a decision: what does not fit was not done.
    expect(dec.impossible).toEqual([]);
    expect(r.result.status.find((s) => s.taskId === correr.id)?.minDeficit).toBe(0);
    expect(r.result.blocks.some((b) => b.taskId === correr.id && b.level === "critical")).toBe(
      false,
    );
    expect(
      r.result.blocks.filter((b) => b.taskId === "tp").every((b) => b.level !== "critical"),
    ).toBe(true);

    render(
      <StoreProvider initial={() => d} persist={false} fixedNow={SAT}>
        <ToastProvider>
          <Inbox />
        </ToastProvider>
      </StoreProvider>,
    );
    expect(screen.queryByText("«Correr» no entra")).toBeNull();
  });
});
