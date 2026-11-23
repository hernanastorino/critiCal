import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { errorOf, NOW, roundTrip } from "./atacante11Kit.js";
import { Inbox } from "./components/Inbox.js";
import { Routines } from "./components/Preferences.js";
import { ToastProvider } from "./components/Toast.js";
import { diffData } from "./data.js";
import { demoData, emptyData } from "./demo.js";
import { zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import { decisions, refreshPlan, sessionsThisWeek } from "./planning.js";
import { readHours } from "./routineHours.js";
import { reducer, StoreProvider } from "./store.js";
import { runningSince } from "./testing.js";

afterEach(cleanup);

const TZ = "America/Montevideo";
const MON = zonedInstant(TZ, "2026-11-02", 6 * 60);
// 07:10 to 08:10 holds a whole hour but only 07:30–08:00 of the 30 min grid.
const OFF_GRID = { all: { start: 7 * 60 + 10, end: 8 * 60 + 10 } };
const form = (from: string, to: string) => ({
  all: { from, to },
  perDay: false,
  days: Array.from({ length: 7 }, () => ({ from: "", to: "" })),
});

describe("13th round: a franja that does not fall on the grid", () => {
  it("readHours counts only the part aligned to the grid", () => {
    const r = readHours(form("7:10", "8:10"), 60);
    expect(r.hours).toBeUndefined();
    expect(r.problems[0]?.field).toBe("all-to");
    expect(r.problems[0]?.text).toBe(
      "Con la grilla de 30 min, de 07:10 a 08:10 solo entra 07:30–08:00: ampliá la franja.",
    );
    expect(readHours(form("7:10", "8:40"), 60).problems).toHaveLength(0);
    expect(readHours(form("7:30", "8:30"), 60).problems).toHaveLength(0);
  });

  it("the Rutinas form says it in the field", () => {
    render(
      <StoreProvider initial={demoData} persist={false} fixedNow={MON}>
        <Routines />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Crear rutina nueva" }));
    fireEvent.change(screen.getByLabelText("Rutina"), { target: { value: "Correr" } });
    fireEvent.change(screen.getByLabelText("Desde, todos los días"), { target: { value: "7:10" } });
    fireEvent.change(screen.getByLabelText("Hasta, todos los días"), { target: { value: "8:10" } });
    expect(screen.getByRole("alert").textContent).toMatch(
      /Con la grilla de 30 min, de 07:10 a 08:10 solo entra 07:30–08:00/,
    );
  });

  const withRoutine = (validHours = OFF_GRID, at = NOW): AppData =>
    reducer(demoData(at), {
      type: "saveRoutine",
      name: "Correr",
      sessionsPerWeek: 3,
      sessionMinutes: 60,
      validHours,
      now: at,
    });

  it("a backup with such a franja is refused, one that fits comes back", () => {
    expect(errorOf(roundTrip(withRoutine()))).not.toBe("");
    expect(errorOf(roundTrip(withRoutine({ all: { start: 7 * 60 + 10, end: 8 * 60 + 40 } })))).toBe(
      "",
    );
  });

  it("the Bandeja says the franja is short, not that there are too many times", () => {
    const d = runningSince(withRoutine(OFF_GRID, MON), MON);
    const r = refreshPlan(d, MON);
    expect(decisions(r.input, r.result).impossible).not.toHaveLength(0);
    render(
      <StoreProvider initial={() => d} persist={false} fixedNow={MON}>
        <ToastProvider>
          <Inbox />
        </ToastProvider>
      </StoreProvider>,
    );
    expect(screen.getByText(/franja de horas es más corta que una sesión/)).toBeTruthy();
    expect(screen.queryByText(/más veces de las que caben/)).toBeNull();
  }, 30_000);
});

describe("13th round: habits of a backup without creation date", () => {
  const ACCOUNT = "11111111-1111-4111-8111-111111111111";
  // Saturday: a habit created today would ask only the share of the days left.
  const SAT = zonedInstant(TZ, "2026-11-07", 12 * 60);

  it("imported into an account they ask the whole week, and the rows carry an old date", () => {
    const r = roundTrip(demoData(SAT), { account: ACCOUNT });
    const data = "data" in r ? r.data : emptyData();
    const habits = data.tasks.filter((t) => t.kind === "habit" && !t.study);
    expect(habits.length).toBeGreaterThan(0);
    for (const t of habits) {
      expect(t.createdAt).toBeDefined();
      expect(sessionsThisWeek(t, TZ, SAT)).toBe(t.sessionsPerWeek);
    }
    const rows = diffData(emptyData(), data).upserts.find((u) => u.table === "tasks")?.rows;
    for (const t of habits)
      expect(new Date(String(rows?.find((x) => x.id === t.id)?.created_at)).getTime()).toBeLessThan(
        SAT - 7 * 86_400_000,
      );
  });

  it("without an account (the demo itself) nothing is added", () => {
    const r = roundTrip(demoData(SAT));
    const data = "data" in r ? r.data : emptyData();
    expect(data.tasks.filter((t) => t.kind === "habit").map((t) => t.createdAt)).toEqual(
      demoData(SAT)
        .tasks.filter((t) => t.kind === "habit")
        .map((t) => t.createdAt),
    );
  });
});
