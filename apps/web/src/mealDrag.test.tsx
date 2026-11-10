import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { demoData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";

const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return zonedInstant(TIMEZONE, date, h * 60 + m);
};
// Monday 2026-11-02, 8:00; holidays off so it is an ordinary week.
const NOW = at("2026-11-02", "08:00");
const initial = (now: number): AppData => ({
  ...demoData(now),
  events: [],
  preferences: { holidaysOff: false },
});
const stored = (): AppData => JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}");

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const pill = (label: RegExp) =>
  [...screen.getByTestId("week").querySelectorAll<HTMLElement>(".pill.meal")].find((p) =>
    label.test(p.getAttribute("aria-label") ?? ""),
  ) as HTMLElement;

const hold = (el: HTMLElement, id: number) => {
  fireEvent.pointerDown(el, { clientX: 10, clientY: 110, pointerId: id });
  act(() => {
    vi.advanceTimersByTime(450);
  });
};

describe("dragging a meal", () => {
  it("moves it for that day only, says so, and «Deshacer» puts it back", () => {
    render(<App fixedNow={NOW} initial={initial} />);
    const dinner = pill(/^Cena, mié 21:00/);
    hold(dinner, 3);
    expect(dinner.className).toContain("dragging");
    // The ghost shows where it would land, in the meals' color.
    fireEvent.pointerMove(dinner, { clientX: 12, clientY: 20, pointerId: 3 });
    expect(document.querySelector(".pill.ghost")).toBeTruthy();
    fireEvent.pointerUp(dinner, { clientX: 12, clientY: 20, pointerId: 3 });
    fireEvent.click(dinner, { detail: 1 });
    // Not opened as a tap, and the toast tells.
    expect(document.querySelector(".bubble")).toBeNull();
    expect(screen.getByText(/^Cena a las \d\d:\d\d, solo ese día/)).toBeTruthy();
    const choice = stored().mealChoices?.find((c) => c.date === "2026-11-04");
    expect(choice?.kind).toBe("cena");
    expect(choice?.start).toBeDefined();
    expect(choice?.start).not.toBe(1260);
    // Only that day: the Tuesday one stays.
    expect(pill(/^Cena, mar 21:00/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Deshacer" })[0] as HTMLElement);
    expect(pill(/^Cena, mié 21:00/)).toBeTruthy();
    expect(stored().mealChoices ?? []).toEqual([]);
  });

  it("does not move one that already happened", () => {
    render(<App fixedNow={NOW} initial={initial} />);
    const breakfast = pill(/^Desayuno, lun 07:30/);
    hold(breakfast, 4);
    expect(breakfast.className).not.toContain("dragging");
  });

  it("does not move it to another day, and says so", () => {
    render(<App fixedNow={NOW} initial={initial} />);
    const dinner = pill(/^Cena, mié 21:00/);
    hold(dinner, 5);
    const other = document.querySelector('[data-date="2026-11-05"]') as HTMLElement;
    other.getBoundingClientRect = () => new DOMRect(100, 0, 40, 600);
    fireEvent.pointerMove(dinner, { clientX: 120, clientY: 300, pointerId: 5 });
    expect(document.querySelector(".pill.ghost")).toBeNull();
    fireEvent.pointerUp(dinner, { clientX: 120, clientY: 300, pointerId: 5 });
    expect(screen.getByText("Una comida se mueve solo dentro de su día")).toBeTruthy();
    expect(stored().mealChoices ?? []).toEqual([]);
  });

  it("in edit mode the arrows move the focused meal by one slot", () => {
    render(<App fixedNow={NOW} initial={initial} />);
    fireEvent.click(screen.getByLabelText("Modo edición"));
    const dinner = pill(/^Cena, mié 21:00/);
    fireEvent.keyDown(dinner, { key: "ArrowUp" });
    expect(pill(/^Cena, mié 20:30/)).toBeTruthy();
    expect(screen.getByText("Cena a las 20:30, solo ese día")).toBeTruthy();
  });
});
