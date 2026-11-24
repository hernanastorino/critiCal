import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Inbox } from "./components/Inbox.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { pruebasData } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import { inboxRows } from "./inbox.js";
import type { AppData } from "./model.js";
import { preferenceMisfits } from "./preferredHours.js";
import { StoreProvider } from "./store.js";

const NOW = zonedInstant(TIMEZONE, "2026-11-23", 8 * 60);

/** Gym may go 09:00–17:00 but prefers 17:00–21:00. */
const withMisfit = (d: AppData, patch: Partial<AppData["activities"][number]> = {}): AppData => ({
  ...d,
  activities: d.activities.map((a) =>
    a.id === "gym"
      ? {
          ...a,
          preferred: { start: 17 * 60, end: 21 * 60 },
          validHours: { all: { start: 9 * 60, end: 17 * 60 } },
          ...patch,
        }
      : a,
  ),
});

afterEach(cleanup);

describe("a routine's preferred hours outside its valid hours", () => {
  it("is found when the preference never meets the valid hours", () => {
    const m = preferenceMisfits(withMisfit(demoData(NOW))).at(0);
    if (!m) throw new Error("no misfit found");
    expect(m.activity.id).toBe("gym");
    expect(m.allowed).toBe("09:00–17:00");
  });

  it("is not found when they overlap, when there is no preference, or on a materia", () => {
    expect(
      preferenceMisfits(withMisfit(demoData(NOW), { preferred: { start: 16 * 60, end: 18 * 60 } })),
    ).toEqual([]);
    expect(preferenceMisfits(withMisfit(demoData(NOW), { preferred: undefined }))).toEqual([]);
    expect(preferenceMisfits(withMisfit(demoData(NOW), { kind: "materia" }))).toEqual([]);
    expect(preferenceMisfits(demoData(NOW))).toEqual([]);
  });

  it("counts the days with their own range when no day follows the general one", () => {
    const days = {
      0: { start: 9 * 60, end: 12 * 60 },
      1: null,
      2: null,
      3: null,
      4: null,
      5: null,
      6: null,
    };
    const d = withMisfit(demoData(NOW), { validHours: { days } });
    expect(preferenceMisfits(d).length).toBe(1);
    const e = withMisfit(demoData(NOW), {
      validHours: { days: { ...days, 3: { start: 18 * 60, end: 20 * 60 } } },
    });
    expect(preferenceMisfits(e)).toEqual([]);
  });

  it("is found in the Demo de pruebas, whose Gym prefers the evening but goes 09:00–17:00", () => {
    expect(preferenceMisfits(pruebasData(NOW)).map((m) => m.activity.id)).toEqual(["gym"]);
  });

  it("is a card of the Bandeja with a button to edit the routine", () => {
    const onRoutine = vi.fn();
    render(
      <ToastProvider>
        <StoreProvider initial={() => withMisfit(demoData(NOW))} persist={false} fixedNow={NOW}>
          <Inbox onRoutine={onRoutine} />
        </StoreProvider>
      </ToastProvider>,
    );
    expect(screen.getByText("Franja de rutina")).toBeTruthy();
    expect(screen.getByText(/Preferís 17:00–21:00, pero solo puede ir 09:00–17:00/)).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Editar rutina" }));
    });
    expect(onRoutine).toHaveBeenCalledWith("gym");
  });

  it("counts in the rows the tab and the widget show", () => {
    expect(
      inboxRows(withMisfit(demoData(NOW)), NOW).some((r) => r.detail === "Franja de rutina"),
    ).toBe(true);
    expect(inboxRows(demoData(NOW), NOW).some((r) => r.detail === "Franja de rutina")).toBe(false);
  });
});
