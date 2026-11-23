import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Silos } from "./components/Silos.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { pruebasData } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import { refreshPlan } from "./planning.js";
import { StoreProvider } from "./store.js";
import { plannedVsDone } from "./week-review.js";

afterEach(cleanup);

// Sunday 2026-11-22, 10:00: the week to come is next Monday to Sunday.
const SUNDAY = zonedInstant(TIMEZONE, "2026-11-22", 10 * 60);
const WEDNESDAY = zonedInstant(TIMEZONE, "2026-11-25", 20 * 60);

const silos = (initial: () => AppData, now: number) =>
  render(
    <StoreProvider initial={initial} persist={false} fixedNow={now}>
      <ToastProvider>
        <Silos />
      </ToastProvider>
    </StoreProvider>,
  );

const gymBlocks = (plan: { taskId: string; start: number }[], from: number) =>
  plan.filter((b) => b.taskId === "gym" && b.start >= from);

describe("Silos: las rutinas no son silos", () => {
  it("Gym (a routine) is not among the silos, but the materias' tasks are", () => {
    silos(() => pruebasData(SUNDAY), SUNDAY);
    expect(document.querySelector('[data-task="gym"]')).toBeNull();
    expect(document.querySelector('[data-task="parcial-calc"]')).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Gym:/ })).toBeNull();
  }, 30_000);

  it("a routine switched off is not shown faded either", () => {
    silos(() => {
      const d = demoData(SUNDAY);
      return { ...d, tasks: d.tasks.map((t) => (t.id === "gym" ? { ...t, paused: true } : t)) };
    }, SUNDAY);
    expect(document.querySelector('[data-task="gym"]')).toBeNull();
  });

  it("«planificado vs. hecho» keeps the routine, marked as such", () => {
    const d = demoData(WEDNESDAY);
    const block = {
      id: "g1",
      taskId: "gym",
      activityId: "gym",
      start: zonedInstant(TIMEZONE, "2026-11-25", 17 * 60),
      end: zonedInstant(TIMEZONE, "2026-11-25", 18 * 60 + 30),
    };
    const rows = plannedVsDone({ ...d, plan: [block] }, WEDNESDAY);
    expect(rows.find((r) => r.taskId === "gym")?.routine).toBe(true);
    silos(() => ({ ...d, plan: [block] }), WEDNESDAY);
    const card = screen.getByText("Esta semana: planificado vs. hecho").closest(".card");
    expect(within(card as HTMLElement).getByText(/rutina/)).toBeTruthy();
  });
});

describe("Rutinas de la semana próxima", () => {
  it("Gym gets its 3 sessions on distinct days even with the week full of studies", () => {
    const d = pruebasData(SUNDAY);
    const monday = zonedInstant(TIMEZONE, "2026-11-23", 0);
    const { plan, result } = refreshPlan(d, SUNDAY);
    const gym = gymBlocks(plan, monday);
    expect(gym).toHaveLength(3);
    const days = new Set(gym.map((b) => new Date(b.start - 3 * 3600e3).toISOString().slice(0, 10)));
    expect(days.size).toBe(3);
    // Nothing missing from next week is reported.
    const next = result.status.find((s) => s.taskId === "gym");
    expect(next?.targetDeficit).toBe(270); // this week (only Sunday, off) is the old shortfall
  });

  it("today's Gym block does not count as one of next week's sessions", () => {
    const d = demoData(SUNDAY);
    const monday = zonedInstant(TIMEZONE, "2026-11-23", 0);
    const first = refreshPlan(d, SUNDAY).plan;
    // Today's block is already in the plan when it is planned again a few minutes later.
    expect(first.some((b) => b.taskId === "gym" && b.start < monday)).toBe(true);
    const again = refreshPlan({ ...d, plan: first }, SUNDAY + 3 * 60_000).plan;
    expect(gymBlocks(again, monday)).toHaveLength(3);
  });

  it("says so when a session does not fit", () => {
    const d = pruebasData(SUNDAY);
    // Only Monday and Tuesday allowed: 2 of the 3 sessions at most.
    const day = { start: 540, end: 1020 };
    const only = { all: day, days: { 0: null, 3: null, 4: null, 5: null, 6: null } };
    const tight: AppData = {
      ...d,
      activities: d.activities.map((a) =>
        a.id === "gym" ? { ...a, validHours: only as never } : a,
      ),
    };
    const base = refreshPlan(d, SUNDAY).result.status.find((s) => s.taskId === "gym");
    const { plan, result } = refreshPlan(tight, SUNDAY);
    const monday = zonedInstant(TIMEZONE, "2026-11-23", 0);
    expect(gymBlocks(plan, monday).length).toBeLessThan(3);
    const s = result.status.find((x) => x.taskId === "gym");
    expect((s?.minDeficit ?? 0) > (base?.minDeficit ?? 0)).toBe(true);
    expect(s?.level).toBe("critical");
  });
});
