import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { demoData, TIMEZONE } from "./demo.js";
import { localParts, zonedInstant } from "./engine.js";
import { REPLANNED_TOAST } from "./friendly.js";
import type { AppData } from "./model.js";
import { reducer } from "./store.js";

const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return zonedInstant(TIMEZONE, date, h * 60 + m);
};
const NOW = at("2026-11-03", "08:00");

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(cleanup);

/** The demo with lunch of the 3rd moved over the study block it has that day. */
const lunchOnStudy = (): AppData => {
  const d0 = reducer(
    { ...demoData(NOW), events: [], preferences: { holidaysOff: false } },
    {
      type: "refresh",
      now: NOW,
    },
  );
  const tz = d0.settings.timezone;
  const block = d0.plan.find((b) => b.start > NOW && localParts(tz, b.start).date === "2026-11-03");
  if (!block) throw new Error("the demo has no block on the 3rd");
  const minute = (block.start - zonedInstant(tz, "2026-11-03", 0)) / 60_000;
  return reducer(d0, {
    type: "mealChoice",
    date: "2026-11-03",
    kind: "almuerzo",
    start: minute,
    now: NOW,
  });
};

describe("comida encima del estudio: la propuesta de la Bandeja", () => {
  it("«Dejar como está» dice que sacó el bloque de debajo (no «todo sigue como estaba»)", () => {
    const data = lunchOnStudy();
    expect(data.proposals.at(-1)?.message).toMatch(/^Una comida quedó encima de /);
    render(<App fixedNow={NOW} initial={() => data} />);
    fireEvent.click(screen.getByText("Bandeja"));
    fireEvent.click(screen.getByText("Dejar como está"));
    const said = document.querySelector(".snack")?.textContent ?? "";
    expect(said).not.toMatch(/Todo sigue como estaba/);
    expect(said).toBe("La comida queda; saqué el bloque que tenía encimaDeshacer");
  });

  it("tras «Reacomodar» la Bandeja ya no muestra la propuesta ni el aviso anterior", () => {
    const data = lunchOnStudy();
    render(<App fixedNow={NOW} initial={() => data} />);
    fireEvent.click(screen.getByText("Bandeja"));
    fireEvent.click(screen.getByText("Reacomodar"));
    expect(screen.queryByText(/Una comida quedó encima/)).toBeNull();
    expect(screen.queryByText("Cambios para hoy")).toBeNull();
    expect(document.querySelector(".snack")?.textContent).toBe(REPLANNED_TOAST);
  });
});

describe("una comida no queda como una rayita al pie del día", () => {
  it("la cena a las 23:59 se rechaza: no entra antes de acostarse", () => {
    render(<App fixedNow={NOW} initial={() => ({ ...demoData(NOW), events: [] })} />);
    const pills = screen.getByTestId("week").querySelectorAll(".pill.meal");
    const supper = [...pills].find((p) => p.getAttribute("aria-label")?.startsWith("Cena, mié"));
    if (!supper) throw new Error("no supper on Wednesday");
    fireEvent.click(supper);
    fireEvent.change(screen.getByLabelText("Mover cena a"), { target: { value: "23:59" } });
    fireEvent.click(screen.getByText("Mover"));
    expect(screen.getByRole("alert").textContent).toMatch(/^Elegí una hora entre las /);
  });
});
