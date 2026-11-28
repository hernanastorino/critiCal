import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { demoData, TIMEZONE } from "./demo.js";
import { localParts, zonedInstant } from "./engine.js";
import type { AppData, AppEvent, Place } from "./model.js";

// 47.ª vuelta, punto 10: una comida movida a mano sobre algo fijo lo dice en su aria-label.
const FIXED = zonedInstant(TIMEZONE, "2026-11-03", 8 * 60);
const REAL = zonedInstant(TIMEZONE, localParts(TIMEZONE, Date.now()).date, 8 * 60);
const NOWS = [
  ["fecha fija", FIXED],
  ["fecha real", REAL],
] as const;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(cleanup);

const casa: Place = { id: "casa", name: "Casa", aliases: [], isHome: true };

/** Hoy: un taller de 20:30 a 22:00 y la cena puesta a mano a `dinner`. */
const scenario = (dinner: number) => (now: number) => {
  const date = localParts(TIMEZONE, now).date;
  const taller: AppEvent = {
    id: "taller",
    title: "Taller",
    start: zonedInstant(TIMEZONE, date, 20 * 60 + 30),
    end: zonedInstant(TIMEZONE, date, 22 * 60),
    busy: true,
    source: "demo",
  };
  const data: AppData = {
    ...demoData(now),
    events: [taller],
    places: [casa],
    preferences: { holidaysOff: false },
    mealChoices: [{ date, kind: "cena", start: dinner, asked: true }],
  };
  return data;
};

const dinnerLabel = (): string =>
  [...screen.getByTestId("week").querySelectorAll(".pill.meal")]
    .map((p) => p.getAttribute("aria-label") ?? "")
    .filter((l) => l.startsWith("Cena"))
    .filter((l) => l.includes("movido por vos"))
    .join("|");

describe.each(NOWS)("10. comida movida a mano encima de algo fijo: %s", (_n, now) => {
  it("el aria-label lo dice", () => {
    render(<App fixedNow={now} initial={scenario(21 * 60)} />);
    expect(dinnerLabel()).toMatch(/, movido por vos, encima de algo fijo$/);
  });

  it("en un hueco libre no lo dice", () => {
    render(<App fixedNow={now} initial={scenario(19 * 60)} />);
    expect(dinnerLabel()).toMatch(/, movido por vos$/);
    expect(dinnerLabel()).not.toContain("encima");
  });
});
