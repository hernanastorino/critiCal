import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { demoData, TIMEZONE } from "./demo.js";
import { overlaps, zonedInstant } from "./engine.js";
import type { AppData, AppEvent } from "./model.js";
import { mealTimes, pinBlock } from "./planning.js";

const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return zonedInstant(TIMEZONE, date, h * 60 + m);
};
// Monday 2026-11-02, 8:00; holidays off so it is an ordinary week.
const NOW = at("2026-11-02", "08:00");
const stored = (): AppData => JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}");

const busy = (id: string, date: string, from: string, to: string): AppEvent => ({
  id,
  title: id,
  start: at(date, from),
  end: at(date, to),
  busy: true,
  source: "demo",
});

/** The demo with only `events` in the calendars. */
const withEvents =
  (events: AppEvent[], more: (d: AppData) => Partial<AppData> = () => ({})) =>
  (now: number) => {
    const d = { ...demoData(now), events, preferences: { holidaysOff: false } };
    return { ...d, ...more(d) };
  };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(cleanup);

const mealPills = () => [...screen.getByTestId("week").querySelectorAll<HTMLElement>(".pill.meal")];
const labels = () => mealPills().map((p) => p.getAttribute("aria-label"));

describe("meals on the calendar", () => {
  it("shows breakfast, lunch and dinner every day, in the meal color", () => {
    render(<App fixedNow={NOW} initial={withEvents([])} />);
    expect(mealPills()).toHaveLength(21);
    expect(labels()).toContain("Desayuno, 07:30");
    expect(labels()).toContain("Almuerzo, 13:00");
    expect(labels()).toContain("Cena, 21:00");
    // One look for all three: the class, not the meal, decides the color.
    expect(new Set(mealPills().map((p) => p.className.replace(/ past| selected/g, "")))).toEqual(
      new Set(["pill meal"]),
    );
  });

  it("moves lunch off a fixed event and never plans study on top of it", () => {
    render(
      <App
        fixedNow={NOW}
        initial={withEvents([busy("Consulta", "2026-11-03", "12:00", "13:30")])}
      />,
    );
    expect(labels()).toContain("Almuerzo, 13:30, corrido de las 13:00");
    const lunch = { start: at("2026-11-03", "13:30"), end: at("2026-11-03", "14:30") };
    expect(stored().plan.some((b) => overlaps(b, lunch))).toBe(false);
  });

  it("recalculates lunch around a block pinned on it", () => {
    const pinned = (d: AppData) => {
      const task = d.tasks.find((t) => t.status === "active");
      if (!task) throw new Error("the demo has tasks");
      const block = {
        id: "b",
        taskId: task.id,
        activityId: task.activityId,
        start: at("2026-11-03", "10:00"),
        end: at("2026-11-03", "11:00"),
      };
      return { pins: [pinBlock(block, at("2026-11-03", "13:00"))] };
    };
    const initial = withEvents([], pinned);
    const data = initial(NOW);
    const lunch = mealTimes(data, NOW, at("2026-11-03", "00:00"), at("2026-11-04", "00:00")).find(
      (m) => m.kind === "almuerzo",
    );
    const pin = data.pins?.[0];
    expect(pin && lunch?.at && overlaps(pin, lunch.at)).toBe(false);
    expect(lunch?.at?.start).toBe(pin?.end);
    render(<App fixedNow={NOW} initial={initial} />);
    expect(
      labels().some((l) => l?.startsWith("Almuerzo") && l.includes("corrido de las 13:00")),
    ).toBe(true);
  });

  it("counts a lunch out as that day's lunch", () => {
    const out = { ...busy("Almuerzo con la abuela", "2026-11-07", "12:30", "15:30") };
    render(<App fixedNow={NOW} initial={withEvents([out])} />);
    expect(mealPills()).toHaveLength(20);
    fireEvent.click(screen.getByText("Bandeja"));
    expect(screen.queryByText("Comidas sin lugar")).toBeNull();
  });

  it("explains a moved meal and opens where to change it", () => {
    render(
      <App
        fixedNow={NOW}
        initial={withEvents([busy("Consulta", "2026-11-03", "12:00", "13:30")])}
      />,
    );
    fireEvent.click(screen.getByLabelText("Almuerzo, 13:30, corrido de las 13:00"));
    const bubble = document.querySelector(".bubble") as HTMLElement;
    expect(within(bubble).getByText(/Corrido de las 13:00/)).toBeTruthy();
    fireEvent.click(within(bubble).getByText(/Cambiar hora y duración/));
    // Straight to «Mi semana», where meal times are set.
    expect(screen.getByRole("dialog", { name: "Mi semana" })).toBeTruthy();
    expect(document.activeElement?.classList.contains("settings-back")).toBe(true);
  });
});

describe("meals with no room", () => {
  it("warns in the inbox and opens that day's week", () => {
    const events = [busy("Jornada", "2026-11-10", "10:00", "17:00")];
    // From Thursday, next Tuesday is within the week ahead.
    render(<App fixedNow={at("2026-11-05", "08:00")} initial={withEvents(events)} />);
    fireEvent.click(screen.getByText("Bandeja"));
    expect(screen.getByText("Comidas sin lugar")).toBeTruthy();
    expect(screen.getByText("Sin lugar para almorzar · mar 10/11")).toBeTruthy();
    expect(screen.getByText(/Entre las 11:30 y las 15:30 todo está ocupado/)).toBeTruthy();
    fireEvent.click(screen.getByText("Ver el día"));
    // Next week, with no lunch on Tuesday but the other six.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/9 nov/);
    expect(labels().filter((l) => l?.startsWith("Almuerzo"))).toHaveLength(6);
  });
});
