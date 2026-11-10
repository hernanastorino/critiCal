import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { demoData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import type { AppData, AppEvent } from "./model.js";

const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return zonedInstant(TIMEZONE, date, h * 60 + m);
};
const NOW = at("2026-11-02", "08:00");

const busy = (id: string, from: string, to: string): AppEvent => ({
  id,
  title: id,
  start: at("2026-11-03", from),
  end: at("2026-11-03", to),
  busy: true,
  source: "demo",
});

const withEvents = (events: AppEvent[]) => (now: number) =>
  ({ ...demoData(now), events, preferences: { holidaysOff: false } }) as AppData;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(cleanup);

const dayPills = (date: string) => [
  ...screen.getByTestId("week").querySelectorAll<HTMLElement>(`.day[data-date="${date}"] .pill`),
];

describe("a block's bubble is a dialog", () => {
  it("takes the focus, closes with Escape and gives the focus back", () => {
    render(<App fixedNow={NOW} initial={withEvents([busy("Consulta", "10:00", "11:00")])} />);
    const pill = screen.getByLabelText(/^Consulta, mar 10:00 a 11:00/);
    pill.focus();
    fireEvent.click(pill);
    const dialog = screen.getByRole("dialog", { name: "Consulta" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(pill);
  });

  it("is a dialog for a meal too, and Escape closes it", () => {
    render(<App fixedNow={NOW} initial={withEvents([])} />);
    fireEvent.click(screen.getByLabelText(/^Almuerzo, lun 13:00/));
    const dialog = screen.getByRole("dialog", { name: "Almuerzo" });
    expect(within(dialog).getByText("Mover")).toBeTruthy();
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("blocks for a screen reader", () => {
  it("say when they end and are read in the order of the day", () => {
    render(<App fixedNow={NOW} initial={withEvents([busy("Consulta", "12:00", "13:30")])} />);
    const labels = dayPills("2026-11-03").map((p) => p.getAttribute("aria-label") ?? "");
    expect(labels.some((l) => /^Consulta, mar 12:00 a 13:30/.test(l))).toBe(true);
    const starts = dayPills("2026-11-03").map((p) => Number(p.getAttribute("data-at")));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});

describe("focus after «Deshacer»", () => {
  it("goes back to where it was", () => {
    render(<App fixedNow={NOW} initial={withEvents([])} />);
    fireEvent.click(screen.getByLabelText(/^Almuerzo, lun 13:00/));
    fireEvent.click(screen.getByText("Hoy no almuerzo"));
    const undo = screen.getByText("Deshacer");
    const before = screen.getByLabelText("Ajustes");
    before.focus();
    undo.focus();
    fireEvent.click(undo);
    return new Promise<void>((done) =>
      setTimeout(() => {
        expect(document.activeElement).toBe(before);
        done();
      }, 10),
    );
  });
});
