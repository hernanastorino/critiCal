import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { visibleEvents } from "./calendars.js";
import { demoData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import { asking, inboxCards, inboxRows } from "./inbox.js";
import type { AppData } from "./model.js";
import { unlocated } from "./places.js";
import {
  decisions,
  missedMeals,
  pendingConfirmations,
  pinClashes,
  pinShortfall,
  refreshPlan,
  routineShortfalls,
} from "./planning.js";
import { loadDemo } from "./store.js";

// Sunday 2026-11-22, 10:00.
const NOW = zonedInstant(TIMEZONE, "2026-11-22", 10 * 60);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
  window.history.replaceState(null, "", "/");
});
afterEach(cleanup);

const withNothing = (d: AppData): AppData => ({ ...d, plan: [], proposals: [], events: [] });
const withProposal = (d: AppData): AppData => ({
  ...withNothing(d),
  proposals: [{ id: "p1", message: "Se liberó la tarde", plan: [] } as never],
});

describe("what enters the Bandeja", () => {
  const cases: [string, AppData][] = [
    ["the demo", demoData(NOW)],
    ["the demo a day later", demoData(NOW + 24 * 3_600_000)],
    ["a demo with nothing left", withNothing(demoData(NOW))],
    ["a demo with a proposal", withProposal(demoData(NOW))],
  ];

  for (const [name, data] of cases) {
    it(`has the rows the cards say, in the same order: ${name}`, () => {
      const asked = refreshPlan(data, NOW);
      const cards = inboxCards({
        data,
        now: NOW,
        pending: pendingConfirmations(data, NOW),
        unlocated: unlocated(data, visibleEvents(data), NOW),
        pinShort: pinShortfall(data, NOW, asked.result),
        clashes: pinClashes(data, NOW, asked.input),
        routineShort: routineShortfalls(data, NOW, asked.result.blocks),
        missedMeals: missedMeals(data, NOW),
        asked: {
          choose: decisions(asked.input, asked.result, { data, now: NOW }).options.length > 0,
          recommendations: decisions(asked.input, asked.result, { data, now: NOW }).recommendations,
        },
      });
      expect(inboxRows(data, NOW).map((r) => r.title)).toEqual(asking(cards).map((c) => c.title));
    }, 30_000);
  }

  it("keeps an address being timed out of the questions, but not out of the cards", () => {
    const card = { title: "Cena", detail: "¿Dónde es?", lookup: true };
    expect(asking([card, { title: "x", detail: "y" }])).toEqual([{ title: "x", detail: "y" }]);
  });

  it("is the same list the tab counts and the screen says is empty", async () => {
    const data = loadDemo(NOW);
    const rows = inboxRows(data, NOW);
    render(<App fixedNow={NOW} />);
    const tab = await screen.findByRole("button", { name: /Bandeja/ });
    if (rows.length > 0) expect(tab.textContent).toContain(String(rows.length));
    else expect(tab.querySelector(".badge")).toBeNull();
    fireEvent.click(tab);
    const empty = screen.queryByText("Todo al día ✓");
    expect(empty === null).toBe(rows.length > 0);
  }, 30_000);
});
