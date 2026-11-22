import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY, isTestDemo, pruebasData } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import { decisions, refreshPlan } from "./planning.js";
import { loadDemo } from "./store.js";

// Sunday 2026-11-22, 10:00.
const NOW = zonedInstant(TIMEZONE, "2026-11-22", 10 * 60);

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(cleanup);

describe("Demo de pruebas", () => {
  it("has a case for each thing to try", () => {
    const d = pruebasData(NOW);
    // A home with an address and a place without one.
    expect(d.places?.find((p) => p.isHome)?.address).toBeTruthy();
    expect(d.places?.some((p) => !p.address && !p.isHome)).toBe(true);
    // A routine with a day of its own and a day off.
    const gym = d.activities.find((a) => a.kind === "rutina");
    expect(Object.values(gym?.validHours?.days ?? {})).toContain(null);
    expect(Object.values(gym?.validHours?.days ?? {}).some((r) => r && r.start > 0)).toBe(true);
    // A trip by bus, there and back.
    expect(Object.values(d.tripMinutes ?? {})[0]?.back).toBeGreaterThan(0);
    // A parcial next week, parts with weights, and one task waiting to be assigned.
    expect(d.tasks.some((t) => t.exam && t.units.some((u) => u.weight))).toBe(true);
    expect(d.tasks.some((t) => t.needsReview)).toBe(true);
    // Meals of days already over, with an hour that is no longer today's.
    const runs = d.mealRuns ?? [];
    expect(runs.some((r) => r.to)).toBe(true);
    expect(runs.some((r) => !r.to)).toBe(true);
  });

  it("offers «Empezar antes» in the inbox", () => {
    const d = loadDemoWith(NOW);
    const r = refreshPlan(d, NOW);
    const kinds = decisions(r.input, r.result, { data: d, now: NOW }).options.map((o) => o.kind);
    expect(kinds).toContain("start-earlier");
  }, 30_000);

  it("starts from the login's discreet button and says so in Ajustes", async () => {
    render(<App fixedNow={NOW} initial={pruebasData} />);
    fireEvent.click(screen.getByRole("button", { name: "Demo de pruebas" }));
    expect(localStorage.getItem(DEMO_KIND_KEY)).toBe("pruebas");
    fireEvent.click(await screen.findByRole("button", { name: "Ajustes" }));
    expect(await screen.findByText(/Demo de pruebas: datos armados/)).toBeTruthy();
    // The first steps are there to try, unfinished.
    expect(screen.getAllByText(/Primeros pasos/).length).toBeGreaterThan(0);
  }, 30_000);

  it("opens straight from ?demo=pruebas and cleans the address", async () => {
    window.history.replaceState(null, "", "/?demo=pruebas");
    render(<App fixedNow={NOW} initial={pruebasData} />);
    expect(await screen.findByRole("button", { name: "Ajustes" })).toBeTruthy();
    expect(isTestDemo()).toBe(true);
    expect(window.location.search).toBe("");
  }, 30_000);

  it("the plain demo does not get the test data", () => {
    const d = loadDemo(NOW);
    expect(d.places).toBeUndefined();
  });
});

function loadDemoWith(now: number) {
  localStorage.setItem(DEMO_KIND_KEY, "pruebas");
  return loadDemo(now);
}
