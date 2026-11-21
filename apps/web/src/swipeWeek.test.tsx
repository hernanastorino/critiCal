import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { demoData } from "./demo.js";

const NOW = Date.UTC(2026, 10, 2, 20);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(cleanup);

const range = () => document.querySelector(".week-nav h1.range")?.textContent;
const swipe = (dx: number, dy = 0, ms = 200) => {
  const week = screen.getByTestId("week");
  fireEvent.touchStart(week, { touches: [{ clientX: 200, clientY: 300 }], timeStamp: 1000 });
  fireEvent.touchEnd(week, {
    changedTouches: [{ clientX: 200 + dx, clientY: 300 + dy }],
    timeStamp: 1000 + ms,
  });
};

describe("swiping the week (SPEC §18.12)", () => {
  it("to the left shows the next week and to the right the one before", () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    const now = range();
    swipe(-120);
    const next = range();
    expect(next).not.toBe(now);
    swipe(120);
    expect(range()).toBe(now);
  });

  it("a mostly vertical or short slide does not turn the page", () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    const now = range();
    swipe(-80, 60);
    swipe(-30);
    expect(range()).toBe(now);
  });
});
