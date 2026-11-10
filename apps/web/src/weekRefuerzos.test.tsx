import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { demoData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import { reducer } from "./store.js";

const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return zonedInstant(TIMEZONE, date, h * 60 + m);
};
// Monday 2026-11-02, 8:00.
const NOW = at("2026-11-02", "08:00");

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(cleanup);

const mealPill = (label: RegExp) =>
  [...screen.getByTestId("week").querySelectorAll<HTMLElement>(".pill.meal")].find((p) =>
    label.test(p.getAttribute("aria-label") ?? ""),
  ) as HTMLElement;

describe("week: details found by the attacker", () => {
  it("«Fijar acá» leaves the focus on the pinned block, not on the page", async () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    const pill = [...document.querySelectorAll<HTMLElement>(".pill.planned:not(.past)")].at(
      -1,
    ) as HTMLElement;
    fireEvent.click(pill, { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("button", { name: "Fijar acá" }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/, fijado/);
  });

  it("«Deshacer» on a change in another week takes you there and names the week", () => {
    const d = reducer(demoData(NOW), { type: "refresh", now: NOW });
    // A block this week, pinned where the plan had put it, and then the next week on screen.
    const block = d.plan.find((b) => b.start > NOW);
    if (!block) throw new Error("the demo plans something ahead");
    const pinned = reducer(d, {
      type: "pin",
      blockId: block.id,
      start: block.start + 3_600_000,
      now: NOW,
    });
    render(<App fixedNow={NOW} initial={() => pinned} />);
    const range = () => screen.getByRole("heading", { level: 1 }).textContent;
    fireEvent.click(screen.getByRole("button", { name: "Semana siguiente" }));
    expect(range()).toMatch(/9 – 15 nov/);
    fireEvent.click(screen.getByRole("button", { name: /^Deshacer: / }));
    expect(range()).toMatch(/2 – 8 nov/);
    expect(screen.getByText(/semana del 2 – 8 nov/)).toBeTruthy();
  });

  it("a meal skipped after moving it comes back at the moved time", () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    fireEvent.click(mealPill(/^Cena, mié 21:00/));
    fireEvent.change(screen.getByLabelText("Mover cena a"), { target: { value: "20:00" } });
    fireEvent.click(screen.getByText("Mover"));
    fireEvent.click(mealPill(/^Cena, mié 20:00/));
    fireEvent.click(screen.getByText(/no cena$/));
    const back = screen.getByLabelText(/sacada ese día, mié 20:00: volver a ponerla/);
    fireEvent.click(back);
    expect(mealPill(/^Cena, mié 20:00/)).toBeTruthy();
    expect(screen.getByText(/otra vez a la hora que le habías puesto/)).toBeTruthy();
  });

  it("moving or skipping a meal is in the undo history of the top bar", () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    fireEvent.click(mealPill(/^Cena, mié 21:00/));
    fireEvent.change(screen.getByLabelText("Mover cena a"), { target: { value: "20:00" } });
    fireEvent.click(screen.getByText("Mover"));
    fireEvent.click(screen.getByRole("button", { name: "Deshacer: mover o sacar una comida" }));
    expect(mealPill(/^Cena, mié 21:00/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Deshacer: / })).toBeNull();
  });
});

describe("meals saved as data", () => {
  it("keeps the moved time of a skipped meal, and drops it with «A su hora»", () => {
    const d = demoData(NOW);
    const moved = reducer(d, {
      type: "mealChoice",
      date: "2026-11-04",
      kind: "cena",
      start: 1200,
      now: NOW,
    });
    const skipped = reducer(moved, {
      type: "mealChoice",
      date: "2026-11-04",
      kind: "cena",
      skip: true,
      start: 1200,
      now: NOW,
    });
    expect(skipped.mealChoices).toEqual([
      { date: "2026-11-04", kind: "cena", skip: true, start: 1200 },
    ]);
    const undone = reducer(skipped, { type: "undoPlan", now: NOW }) as AppData;
    expect(undone.mealChoices).toEqual([{ date: "2026-11-04", kind: "cena", start: 1200 }]);
  });
});
