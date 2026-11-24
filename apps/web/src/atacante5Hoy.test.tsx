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

describe("awake time at the edges", () => {
  it("says the exact length instead of rounding it into a contradiction", () => {
    expect(awakeProblem("08:00", "11:59")).toMatch(/estás despierto 3h59:/);
    expect(awakeProblem("08:00", "06:01")).toMatch(/estás despierto 22h01:/);
    expect(awakeProblem("08:00", "12:00")).toBeNull();
    expect(awakeProblem("08:00", "06:00")).toBeNull();
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

describe("Ajustes → Hoy: «Me levanté» no es futura", () => {
  const at = (hhmm: string) => {
    const [h = 0, m = 0] = hhmm.split(":").map(Number);
    return zonedInstant("America/Montevideo", "2026-11-18", h * 60 + m);
  };
  function renderAt(now: number) {
    return render(
      <StoreProvider initial={demoData} persist={false} fixedNow={now}>
        <Settings onClose={() => {}} onReset={() => {}} onSignOut={() => {}} />
      </StoreProvider>,
    );
  }
  const apply = () => fireEvent.click(screen.getByRole("button", { name: "Reacomodar hoy" }));

  it("refuses a wake-up after now, with the error on the field", () => {
    renderAt(NOW);
    set("Me levanté a las", "13:00");
    apply();
    expect(screen.getByRole("alert").textContent).toBe("Todavía no son las 13:00.");
    expect(screen.getByLabelText("Me levanté a las").getAttribute("aria-invalid")).toBe("true");
    // Typing again clears it; a time that already passed (or is now) is fine.
    set("Me levanté a las", "12:00");
    expect(screen.queryByRole("alert")).toBeNull();
    apply();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("after midnight, 23:00 is still today's and has not come yet", () => {
    renderAt(at("00:30"));
    set("Me levanté a las", "23:00");
    apply();
    expect(screen.getByRole("alert").textContent).toBe("Todavía no son las 23:00.");
  });

  it("does not block changing only the bedtime when the routine wake-up is later than now", () => {
    renderAt(at("06:00"));
    set("Me acuesto a las", "23:30");
    apply();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
