import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { swipeOf } from "./components/useSwipe.js";
import { demoData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import { seedHistory } from "./store.js";

const MONDAY = zonedInstant(TIMEZONE, "2026-11-02", 17 * 60 + 50);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "vibrate");
});

const open = () => {
  render(
    <App
      fixedNow={MONDAY}
      initial={(now) => seedHistory({ ...demoData(now), preferences: { holidaysOff: false } }, now)}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Bandeja/ }));
};
const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".card.swipeable"));
const hechos = () => screen.queryAllByLabelText(/^Hecho: /);
const swipe = (el: HTMLElement, dx: number, dy = 0, ms = 200) => {
  fireEvent.touchStart(el, { touches: [{ clientX: 200, clientY: 300 }], timeStamp: 1000 });
  fireEvent.touchEnd(el, {
    changedTouches: [{ clientX: 200 + dx, clientY: 300 + dy }],
    timeStamp: 1000 + ms,
  });
};

describe("swipeOf", () => {
  it("tells a quick, clearly sideways slide from the rest", () => {
    expect(swipeOf(-80, 10, 200)).toBe("left");
    expect(swipeOf(80, -10, 200)).toBe("right");
    expect(swipeOf(-30, 0, 100)).toBeNull();
    expect(swipeOf(-80, 60, 100)).toBeNull();
    expect(swipeOf(-80, 0, 900)).toBeNull();
  });
});

describe("swiping a «¿Cómo te fue?» card", () => {
  it("to the right marks it done, with the notice and «Deshacer» of its button", () => {
    open();
    const before = hechos().length;
    expect(before).toBeGreaterThan(1);
    const first = cards()[0] as HTMLElement;
    const name = within(first)
      .getByLabelText(/^Hecho: /)
      .getAttribute("aria-label");
    swipe(first, 120);
    expect(screen.getByText("Anotado como hecho.")).toBeTruthy();
    expect(hechos().length).toBe(before - 1);
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(hechos().length).toBe(before);
    expect(screen.getByLabelText(name as string)).toBeTruthy();
  });

  it("to the left marks it not done", () => {
    open();
    const before = hechos().length;
    swipe(cards()[0] as HTMLElement, -120);
    expect(screen.getByText(/Anotado, sin culpa/)).toBeTruthy();
    expect(hechos().length).toBe(before - 1);
  });

  it("a short or mostly vertical slide does nothing, and the buttons stay", () => {
    open();
    const before = hechos().length;
    const first = cards()[0] as HTMLElement;
    swipe(first, 30);
    swipe(first, 120, 90);
    expect(hechos().length).toBe(before);
    expect(within(first).getByLabelText(/^No hecho: /)).toBeTruthy();
  });

  it("buzzes briefly where the browser can, and does nothing odd where it cannot", () => {
    open();
    swipe(cards()[0] as HTMLElement, 120); // no `navigator.vibrate`: no error
    const later = Date.now() + 5000; // past the guard against a second answer in a row
    vi.spyOn(Date, "now").mockReturnValue(later);
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    swipe(cards()[0] as HTMLElement, -120);
    expect(vibrate).toHaveBeenCalledWith(10);
  });

  it("leaves the card where it was when the touch ends", () => {
    open();
    const first = cards()[0] as HTMLElement;
    fireEvent.touchStart(first, { touches: [{ clientX: 200, clientY: 300 }] });
    fireEvent.touchMove(first, { touches: [{ clientX: 320, clientY: 300 }] });
    expect(first.style.transform).toContain("translateX");
    fireEvent.touchCancel(first);
    expect(first.style.transform).toBe("");
  });

  it("does not lean with reduced motion, yet still answers", () => {
    window.matchMedia = ((q: string) => ({
      matches: q.includes("reduce"),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    })) as never;
    open();
    const first = cards()[0] as HTMLElement;
    fireEvent.touchStart(first, { touches: [{ clientX: 200, clientY: 300 }] });
    fireEvent.touchMove(first, { touches: [{ clientX: 320, clientY: 300 }] });
    expect(first.style.transform).toBe("");
    fireEvent.touchEnd(first, { changedTouches: [{ clientX: 320, clientY: 300 }] });
    expect(screen.getByText("Anotado como hecho.")).toBeTruthy();
  });
});
