import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Inbox } from "./components/Inbox.js";
import { ToastProvider } from "./components/Toast.js";
import { TIMEZONE } from "./demo.js";
import { pruebasData } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import { inboxRows } from "./inbox.js";
import type { AppData } from "./model.js";
import { refreshPlan, routineShortfalls } from "./planning.js";
import { StoreProvider } from "./store.js";

// Wednesday 2026-11-25, 08:00: the day of the Demo de pruebas.
const NOW = zonedInstant(TIMEZONE, "2026-11-25", 8 * 60);
const short = (d: AppData) => routineShortfalls(d, NOW, refreshPlan(d, NOW).result.blocks);
const gymHabit = (d: AppData, patch: Partial<AppData["tasks"][number]>): AppData => ({
  ...d,
  tasks: d.tasks.map((t) =>
    t.activityId === "gym" && t.kind === "habit" ? { ...t, ...patch } : t,
  ),
});

afterEach(cleanup);

describe("a routine that does not fit the week", () => {
  it("is found in the Demo de pruebas, from the sessions the plan really placed", () => {
    const found = short(pruebasData(NOW)).filter((r) => r.activityId === "gym");
    expect(found.map((r) => `${r.name}: ${r.placed} de ${r.wanted}`)).toEqual(["Gym: 0 de 3"]);
  }, 30_000);

  it("keeps the session that fits in normal hours: on Monday one of the three goes in, not red", () => {
    const monday = zonedInstant(TIMEZONE, "2026-11-23", 8 * 60);
    const data = pruebasData(monday);
    const { result } = refreshPlan(data, monday);
    const gym = result.blocks.filter(
      (b) => b.taskId === "gym" && b.start < monday + 7 * 86_400_000,
    );
    expect(gym.map((b) => b.level)).toEqual(["ok"]);
    expect(
      routineShortfalls(data, monday, result.blocks).map((r) => `${r.placed} de ${r.wanted}`),
    ).toEqual(["1 de 3"]);
  }, 30_000);

  it("counts in the rows of the Bandeja", () => {
    const rows = inboxRows(pruebasData(NOW), NOW);
    expect(rows.some((r) => r.title === "Gym" && r.detail === "Rutina que no entra")).toBe(true);
  }, 30_000);

  it("does not show when the routine is paused or skipped this week", () => {
    const data = pruebasData(NOW);
    expect(short(gymHabit(data, { paused: true }))).toEqual([]);
    expect(short(gymHabit(data, { skipUntil: NOW + 86_400_000 }))).toEqual([]);
  }, 30_000);

  it("goes once the week has room for it", () => {
    const data = pruebasData(NOW);
    const open: AppData = {
      ...data,
      activities: data.activities.map((a) =>
        a.id === "gym" ? { ...a, validHours: { all: { start: 6 * 60, end: 23 * 60 } } } : a,
      ),
    };
    expect(short(open).filter((r) => r.activityId === "gym")).toEqual([]);
  }, 30_000);

  it("is a card with a button that edits the routine", () => {
    const onRoutine = vi.fn();
    render(
      <ToastProvider>
        <StoreProvider initial={() => pruebasData(NOW)} persist={false} fixedNow={NOW}>
          <Inbox onRoutine={onRoutine} />
        </StoreProvider>
      </ToastProvider>,
    );
    expect(screen.getByText("Gym: esta semana entra 0 de 3")).toBeTruthy();
    // The «Franja de rutina» card of Gym has the same button, and it opens the same routine.
    const edit = screen.getAllByRole("button", { name: "Editar rutina" });
    expect(edit).toHaveLength(2);
    for (const button of edit) {
      act(() => {
        fireEvent.click(button);
      });
    }
    expect(onRoutine).toHaveBeenCalledTimes(2);
    expect(onRoutine).toHaveBeenCalledWith("gym");
  }, 30_000);
});
