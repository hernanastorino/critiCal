import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { Week } from "./components/Week.js";
import { demoData, emptyData, TIMEZONE } from "./demo.js";
import { addDays, localParts, zonedInstant } from "./engine.js";
import { StoreProvider } from "./store.js";

// 47.ª vuelta, puntos 6 y 9: la semana que se mira no cambia sola al cruzar la medianoche, y
// «Cerrar resumen» cierra también Ajustes.
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The next Sunday (today if it is one), as a date. */
function nextSunday(from: string): string {
  const weekday = new Date(`${from}T12:00:00Z`).getUTCDay();
  return addDays(from, (7 - weekday) % 7);
}
const SUNDAYS = [
  ["fecha fija", "2026-11-22"],
  ["fecha real", nextSunday(localParts(TIMEZONE, Date.now()).date)],
] as const;

describe.each(SUNDAYS)("6. la semana vista al cruzar la medianoche: %s", (_n, sunday) => {
  const range = () => screen.getByRole("heading", { level: 1 }).textContent;

  it("con «›» en la semana siguiente, pasada la medianoche sigue en esa", () => {
    vi.useFakeTimers({
      toFake: ["Date", "setInterval", "clearInterval"],
      now: zonedInstant(TIMEZONE, sunday, 23 * 60 + 59) + 50_000,
    });
    render(
      <StoreProvider initial={emptyData} persist={false}>
        <Week onSettings={vi.fn()} />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Semana siguiente" }));
    const viewed = range();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    // It is Monday now, and the week on the screen is still the one that was chosen.
    expect(localParts(TIMEZONE, Date.now()).date).toBe(addDays(sunday, 1));
    expect(range()).toBe(viewed);
  });

  it("sin tocar «›» la semana en pantalla pasa a la nueva, como siempre", () => {
    vi.useFakeTimers({
      toFake: ["Date", "setInterval", "clearInterval"],
      now: zonedInstant(TIMEZONE, sunday, 23 * 60 + 59) + 50_000,
    });
    render(
      <StoreProvider initial={emptyData} persist={false}>
        <Week onSettings={vi.fn()} />
      </StoreProvider>,
    );
    const before = range();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(range()).not.toBe(before);
  });
});

describe("9. «Cerrar resumen» de Planificación semanal", () => {
  const open = () => {
    render(<App fixedNow={zonedInstant(TIMEZONE, "2026-11-22", 19 * 60)} initial={demoData} />);
    fireEvent.click(screen.getByRole("button", { name: "Ajustes" }));
    fireEvent.click(screen.getByRole("button", { name: /^Planificación semanal/ }));
    expect(screen.getByRole("dialog", { name: "Planificación semanal" })).toBeTruthy();
  };

  it("cierra Ajustes entero", () => {
    open();
    fireEvent.click(screen.getByText("Cerrar resumen"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("la ✕ sigue volviendo a la lista de Ajustes", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(screen.getByRole("dialog", { name: "Ajustes" })).toBeTruthy();
  });
});
