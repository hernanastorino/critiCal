import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WeeklyPlan } from "./components/WeeklyPlan.js";
import { emptyData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import { focusWeekAt, progress } from "./planning.js";
import { StoreProvider, useStore } from "./store.js";
import { weekPlan, weekToPlan } from "./week-review.js";

afterEach(cleanup);

const seen: { data?: AppData } = {};
function Spy() {
  seen.data = useStore().data;
  return null;
}

const at = (date: string, minutes: number) => zonedInstant(TIMEZONE, date, minutes);
// Sunday 2026-11-22; the Parcial is due on Tuesday 2026-11-24.
const SUNDAY = at("2026-11-22", 18 * 60);

const data = (): AppData => ({
  ...emptyData(),
  activities: [
    {
      id: "a",
      name: "Mate",
      color: "#f80",
      academic: true,
      maxSessionMinutes: 120,
      minBlockMinutes: 60,
    },
    {
      id: "g",
      name: "Gym",
      color: "#0a0",
      academic: false,
      maxSessionMinutes: 60,
      minBlockMinutes: 30,
    },
  ],
  tasks: [
    {
      id: "t",
      activityId: "a",
      title: "Parcial",
      kind: "deliverable",
      deadline: at("2026-11-24", 20 * 60),
      estimateMinutes: 120,
      minMinutes: 60,
      priority: 2,
      status: "active",
      units: [],
    },
    {
      id: "h",
      activityId: "g",
      title: "Gym",
      kind: "habit",
      sessionsPerWeek: 3,
      sessionMinutes: 60,
      estimateMinutes: 0,
      minMinutes: 0,
      priority: 1,
      status: "active",
      units: [],
    },
  ],
  plan: [
    {
      id: "b1",
      taskId: "t",
      activityId: "a",
      start: at("2026-11-23", 600),
      end: at("2026-11-23", 720),
      level: "critical",
    },
  ],
});

describe("Planificación semanal: siempre la semana que viene", () => {
  it("un domingo muestra el lunes a domingo próximos con el Parcial", () => {
    expect(weekToPlan(data(), SUNDAY)).toEqual([
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
    ]);
    const days = weekPlan(data(), weekToPlan(data(), SUNDAY));
    expect(days[0]).toMatchObject({ minutes: 120, critical: 1 });

    render(
      <StoreProvider fixedNow={SUNDAY} initial={data} persist={false}>
        <WeeklyPlan onClose={() => {}} onInbox={() => {}} />
      </StoreProvider>,
    );
    expect(screen.getByText(/Parcial/)).toBeTruthy();
    expect(screen.queryByText(/hay margen en todo/)).toBeNull();
  });
});

describe("Silos y widget: la semana en curso hasta planear la siguiente", () => {
  it("antes de planear, la semana en curso; después, la siguiente", () => {
    const d = data();
    expect(focusWeekAt(d, SUNDAY)).toBe(SUNDAY);
    const before = progress(d, SUNDAY, focusWeekAt(d, SUNDAY)).find((p) => p.task.id === "h");
    expect(before?.deadline).toBe(at("2026-11-23", 0));

    const planned = { ...d, settings: { ...d.settings, weekPlannedFor: "2026-11-23" } };
    const week = focusWeekAt(planned, SUNDAY);
    const after = progress(planned, SUNDAY, week).find((p) => p.task.id === "h");
    expect(after?.deadline).toBe(at("2026-11-30", 0));
    expect(after?.totalMinutes).toBe(180);
  });

  it("un «planeada» de otra semana no cambia nada", () => {
    const d = data();
    const old = { ...d, settings: { ...d.settings, weekPlannedFor: "2026-11-16" } };
    expect(focusWeekAt(old, SUNDAY)).toBe(SUNDAY);
  });

  it("Cerrar resumen deja la semana siguiente como planeada", () => {
    seen.data = undefined;
    render(
      <StoreProvider fixedNow={SUNDAY} initial={data} persist={false}>
        <WeeklyPlan onClose={() => {}} onInbox={() => {}} />
        <Spy />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByText("Cerrar resumen"));
    expect((seen as { data?: AppData }).data?.settings.weekPlannedFor).toBe("2026-11-23");
  });
});
