import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Inbox } from "./components/Inbox.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData } from "./demo.js";
import { zonedInstant } from "./engine.js";
import type { AppData, AppTask } from "./model.js";
import { decisions, refreshPlan } from "./planning.js";
import { reducer, StoreProvider, useStore } from "./store.js";
import { plannedVsDone } from "./week-review.js";

afterEach(cleanup);

// The tester's demo: Wednesday 18/11 at 00:21.
const NOW = zonedInstant("America/Montevideo", "2026-11-18", 21);
const demo = () => reducer(demoData(NOW), { type: "refresh", now: NOW });

const withRoutine = (d: AppData) =>
  reducer(d, {
    type: "saveRoutine",
    name: "Leer",
    sessionsPerWeek: 14,
    sessionMinutes: 60,
    now: NOW,
  });

const withFormulas = (d: AppData) =>
  reducer(d, {
    type: "saveTask",
    task: {
      id: "formulas",
      activityId: "calc",
      title: "Repasar fórmulas",
      kind: "habit",
      estimateMinutes: 14 * 1440,
      minMinutes: 14 * 1440,
      sessionsPerWeek: 14,
      sessionMinutes: 1440,
      priority: 2,
      status: "active",
      units: [],
    },
    now: NOW,
  });

const shortIds = (r: { status: { taskId: string; minDeficit: number }[] }) =>
  r.status
    .filter((s) => s.minDeficit > 0)
    .map((s) => s.taskId)
    .sort();

const minimumOf = (d: AppData, id: string) => d.tasks.find((t) => t.id === id)?.minMinutes;

describe("an activity that does not fit even alone", () => {
  const d = withFormulas(withRoutine(demo()));
  const r = refreshPlan(d, NOW);
  const dec = decisions(r.input, r.result);

  it("is told apart and forces no cuts on the rest", () => {
    expect(dec.impossible).toContain("formulas");
    expect(dec.options.some((o) => o.kind === "proportional")).toBe(false);
    const others = ["parcial-calc", "informe-fis", "tp-prog", "gym"];
    expect(dec.options.filter((o) => others.includes(o.taskId ?? ""))).toEqual([]);
  });

  it("does what each option says once chosen", () => {
    for (const o of dec.options) {
      const after = reducer(d, { type: "applyOption", optionId: o.id, now: NOW });
      const next = refreshPlan(after, NOW);
      expect(shortIds(next.result), o.label).toEqual(shortIds(o.result));
      expect(minimumOf(after, "parcial-calc"), o.label).toBe(minimumOf(d, "parcial-calc"));
      expect(minimumOf(after, "informe-fis"), o.label).toBe(minimumOf(d, "informe-fis"));
    }
  });
});

describe("a routine of 14 × 60 in the demo", () => {
  const d = withRoutine(demo());
  const leer = d.tasks.find((t) => t.title === "Leer") as AppTask;

  it("is no longer critical once its minimum is lowered, nor asked about again", () => {
    expect(d.plan.some((b) => b.taskId === leer.id && b.level === "critical")).toBe(true);
    const r = refreshPlan(d, NOW);
    const lower = decisions(r.input, r.result).options.find(
      (o) => o.id === `lower-minimum:${leer.id}`,
    );
    expect(lower?.label).toBe("Dedicarle menos a Leer (mínimo 10 h)");
    expect(lower?.result.feasible).toBe(true);
    const after = reducer(d, { type: "applyOption", optionId: lower?.id as string, now: NOW });
    // It reaches every minimum, as it said: nothing critical, nothing left to decide.
    expect(after.plan.filter((b) => b.end > NOW && b.level === "critical")).toEqual([]);
    const next = refreshPlan(after, NOW);
    expect(next.result.feasible).toBe(true);
    expect(decisions(next.input, next.result).options).toEqual([]);
  });

  it("names the activity when only its objective is short", () => {
    // A materia with an objective beyond its minimum that does not fit by Friday.
    const tight = reducer(d, {
      type: "saveTask",
      task: {
        ...(d.tasks.find((t) => t.id === "informe-fis") as AppTask),
        minMinutes: 60,
        estimateMinutes: 6000,
        units: [],
      },
      now: NOW,
    });
    const lowered = reducer(tight, {
      type: "applyOption",
      optionId: `lower-minimum:${leer.id}`,
      now: NOW,
    });
    const r = refreshPlan(lowered, NOW);
    expect(decisions(r.input, r.result).options.map((o) => o.label)).toEqual([
      "Quedarme con el mínimo de Informe Lab Física",
      "Usar tiempo libre para llegar al objetivo de Informe Lab Física",
    ]);
  });
});

describe("planned vs done this week", () => {
  it("counts study time on both sides, work logged outside the plan included", () => {
    const d = reducer(demo(), {
      type: "logProgress",
      taskId: "informe-fis",
      minutes: 120,
      now: NOW,
    });
    const row = plannedVsDone(d, NOW).find((x) => x.taskId === "informe-fis");
    // 120 min of block are 1 h 40 of study with 50/10 breaks, as the silo counts them.
    expect(row).toMatchObject({ planned: 100, done: 100 });
  });
});

function Count() {
  const { inboxCount, decisions: d } = useStore();
  return (
    <output data-testid="count">
      {inboxCount}/{d.options.length}/{d.recommendations.length}
    </output>
  );
}

describe("the Bandeja's count", () => {
  it("counts «No llegás a todo» once, whatever its options", () => {
    const d = withFormulas(withRoutine(demo()));
    render(
      <StoreProvider initial={() => d} persist={false} fixedNow={NOW}>
        <ToastProvider>
          <Count />
          <Inbox />
        </ToastProvider>
      </StoreProvider>,
    );
    const [count, options, recs] = (screen.getByTestId("count").textContent ?? "")
      .split("/")
      .map(Number) as [number, number, number];
    expect(options).toBeGreaterThan(1);
    expect(count).toBe(1 + recs);
    expect(screen.getByText("No llegás a todo · elegí")).toBeTruthy();
  });
});
