import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { demoData } from "./demo.js";
import { deadlineInRange } from "./limits.js";

const NOW = Date.UTC(2026, 10, 2, 20);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(cleanup);

describe("deadline range", () => {
  it("accepts real dates up to five years ahead", () => {
    expect(deadlineInRange(NOW + 86_400_000, NOW)).toBe(true);
    expect(deadlineInRange(Date.UTC(2031, 9, 1), NOW)).toBe(true);
    // The whole last year counts, as the date field's max says, in any time zone.
    expect(deadlineInRange(Date.UTC(2032, 0, 1, 2, 59), NOW)).toBe(true);
    expect(deadlineInRange(Date.UTC(2032, 1, 1), NOW)).toBe(false);
    expect(deadlineInRange(Date.UTC(9999, 11, 31), NOW)).toBe(false);
    expect(deadlineInRange(Date.UTC(1999, 0, 1), NOW)).toBe(false);
    expect(deadlineInRange(Number.NaN, NOW)).toBe(false);
  });

  function newDeliverable(deadline: string) {
    render(<App fixedNow={NOW} initial={demoData} />);
    fireEvent.click(screen.getByRole("button", { name: /Silos/ }));
    fireEvent.click(screen.getByRole("button", { name: "Nueva actividad" }));
    const sheet = screen.getByRole("dialog", { name: "Nueva actividad" });
    fireEvent.change(within(sheet).getByLabelText("Fecha límite"), { target: { value: deadline } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Guardar" }));
    return sheet;
  }

  it("does not save year 9999, which the database cannot hold", () => {
    const sheet = newDeliverable("9999-12-31T23:59");
    expect(within(sheet).getByRole("alert").textContent).toMatch(
      /entre el 1\/1\/2000 y el 31\/12\/2031/,
    );
    expect(screen.getByRole("dialog", { name: "Nueva actividad" })).toBe(sheet);
    expect(screen.queryByText(/Algo falló/)).toBeNull();
  });

  it("does not crash on a cleared date", () => {
    const sheet = newDeliverable("");
    expect(within(sheet).getByRole("alert")).toBeTruthy();
  });

  it("saves a date in range", () => {
    newDeliverable("2026-11-20T10:00");
    expect(screen.queryByRole("dialog", { name: "Nueva actividad" })).toBeNull();
  });
});
