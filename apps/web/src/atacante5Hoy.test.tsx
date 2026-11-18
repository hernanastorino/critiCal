import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Settings } from "./components/Settings.js";
import { awakeProblem } from "./dayLength.js";
import { demoData } from "./demo.js";
import { zonedInstant } from "./engine.js";
import { StoreProvider } from "./store.js";

afterEach(cleanup);

const NOW = zonedInstant("America/Montevideo", "2026-11-18", 12 * 60);

function renderSettings() {
  return render(
    <StoreProvider initial={demoData} persist={false} fixedNow={NOW}>
      <Settings onClose={() => {}} onReset={() => {}} onSignOut={() => {}} />
    </StoreProvider>,
  );
}

const set = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("awake time of the day", () => {
  it("lets ordinary days through, those past midnight included", () => {
    expect(awakeProblem("08:00", "00:00")).toBeNull();
    expect(awakeProblem("08:00", "23:00")).toBeNull();
    expect(awakeProblem("10:00", "02:30")).toBeNull();
    expect(awakeProblem("14:00", "06:00")).toBeNull();
  });

  it("refuses a day awake for under 4 h or over 22 h", () => {
    expect(awakeProblem("08:00", "11:00")).toMatch(/entre 4 y 22 h/);
    expect(awakeProblem("08:00", "07:00")).toMatch(/entre 4 y 22 h/);
    expect(awakeProblem("08:00", "08:00")).toMatch(/entre 4 y 22 h/);
  });
});

describe("Ajustes → Hoy", () => {
  it("refuses an absurd day with an error on the fields, and keeps normal ones", () => {
    renderSettings();
    set("Me levanté a las", "08:00");
    set("Me acuesto a las", "09:00");
    fireEvent.click(screen.getByRole("button", { name: "Reacomodar hoy" }));
    expect(screen.getByRole("alert").textContent).toMatch(/entre 4 y 22 h/);
    expect(screen.getByLabelText("Me acuesto a las").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(screen.getByLabelText("Me levanté a las"));
    // A normal day past midnight goes through (the sheet closes: here it stays, the
    // error is gone).
    set("Me acuesto a las", "01:30");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
